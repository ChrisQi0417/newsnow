import { describe, expect, it, vi } from "vitest"
import apnews, { parseAPNewsBing, parseAPNewsIndex } from "../server/sources/apnews"
import afp, { parseAfpFactCheckIndex } from "../server/sources/afp"
import nhk, { parseNHKNews } from "../server/sources/nhk"
import { isSourceResponse } from "../src/utils/source-response"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("../server/utils/fetch", () => ({ myFetch: fetchMock }))
vi.mock("../server/utils/translate", () => ({ translateNewsItemsToChinese: async (items: unknown) => items }))

function entry(id: string, publisher = "https://apnews.com", date = "Sat, 12 Sep 2026 16:00:00 GMT") {
  return `<item><title>Verified news headline - AP News</title><link>https://news.google.com/rss/articles/${id}</link><pubDate>${date}</pubDate><source url="${publisher}">AP News</source></item>`
}
const feed = (items: string) => `<rss><channel>${items}</channel></rss>`

describe("source outage recovery", () => {
  it("validates Bing original URLs and excludes ordinary news from fact checking", () => {
    const item = `<item><title>FACT FOCUS: Verified claim</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fapnews.com%2Farticle%2Ffact-focus-abc</link><pubDate>Sun, 13 Sep 2026 01:00:00 GMT</pubDate></item>`
    expect(parseAPNewsBing(feed(item + item), "https://apnews.com/ap-fact-check")).toEqual([expect.objectContaining({
      title: "FACT FOCUS: Verified claim",
      url: "https://apnews.com/article/fact-focus-abc",
      pubDate: Date.parse("2026-09-13T01:00:00Z"),
    })])
    expect(parseAPNewsBing(feed(item.replace("apnews.com", "apnews.com.evil.example")), "https://apnews.com/")).toEqual([])
    expect(parseAPNewsBing(feed(item.replace("FACT FOCUS", "Sports").replace("fact-focus", "sports")), "https://apnews.com/ap-fact-check")).toEqual([])
  })

  it("uses the independent Google index after a Bing outage", async () => {
    fetchMock.mockReset().mockImplementation(async (url: string) => {
      const target = new URL(url)
      if (target.hostname !== "news.google.com") throw new Error("503 unavailable")
      return feed(entry("recovered"))
    })
    expect(await apnews["apnews-world"]!({} as never)).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("recovers AFP from a publisher-verified index after the bulletin markup disappears", async () => {
    const index = feed(entry("afp", "https://factcheck.afp.com").replace(" - AP News", " - AFP Fact Check"))
    fetchMock.mockReset().mockImplementation(async (url: string, options: { retry: number }) => {
      expect(options.retry).toBe(0)
      return new URL(url).hostname === "www.afp.com" ? "<h1>The news hub</h1>" : index
    })
    expect(await afp({} as never)).toEqual([expect.objectContaining({
      title: "Verified news headline",
      extra: expect.objectContaining({ info: "法新社事实核查 · Google News 索引" }),
    })])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(parseAfpFactCheckIndex(feed(entry("spoof", "https://factcheck.afp.com.evil.example")))).toEqual([])
    expect(parseAfpFactCheckIndex(feed(entry("bad", "https://factcheck.afp.com", "bad date")))).toEqual([])
    expect(parseAfpFactCheckIndex(index.replace("https://news.google.com/rss/articles/afp", "https://evil.example/afp"))).toEqual([])
  })

  it("reports bounded AP failure codes without leaking upstream error messages", async () => {
    fetchMock.mockReset().mockRejectedValue(Object.assign(new Error("private upstream details"), { statusCode: 403 }))
    await expect(apnews["apnews-top"]!({} as never)).rejects.toMatchObject({ issues: [
      "ap-page:http-403",
      "ap-sitemap:http-403",
      "bing-index:http-403",
      "google-index:http-403",
    ] })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("accepts only dated AP publisher entries, deduplicates and sorts newest first", () => {
    const items = parseAPNewsIndex(feed(entry("old") + entry("new", undefined, "Sun, 13 Sep 2026 00:00:00 GMT") + entry("old")
      + entry("fake", "https://apnews.com.example.com") + entry("broken", undefined, "bad date")))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: "https://news.google.com/rss/articles/new",
      title: "Verified news headline",
      pubDate: Date.parse("2026-09-13T00:00:00Z"),
      extra: { info: "美联社 · Google News 索引" },
    })
    expect(parseAPNewsIndex("<html>Service unavailable</html>")).toEqual([])
  })

  it.each(["apnews-top", "apnews-world", "apnews-business", "apnews-fact-check"])("recovers %s when the official site rejects automated access", async (id) => {
    fetchMock.mockReset().mockImplementation(async (url: string) => {
      if (new URL(url).hostname === "apnews.com") throw new Error("403 Forbidden")
      expect(new URL(url).hostname).toBe("www.bing.com")
      expect(new URL(url).searchParams.get("q")).toContain("site:apnews.com")
      if (id === "apnews-world") expect(new URL(url).searchParams.get("q")).toContain("-basketball")
      if (id === "apnews-fact-check") expect(new URL(url).searchParams.get("q")).toContain("\"FACT FOCUS\"")
      return feed(`<item><title>FACT FOCUS: Recovered headline</title><link>https://apnews.com/article/recovered</link><pubDate>Sun, 13 Sep 2026 01:00:00 GMT</pubDate></item>`)
    })
    const getter = apnews[id as keyof typeof apnews]!
    const items = await getter({} as never)
    expect(items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("uses NHK's current API and preserves its publication timestamp and article URL", async () => {
    const data = { data: [{ id: "20260913de49938", title: "Current NHK headline", page_url: "/nhkworld/news/20260913de49938/", updated_at: "1789248503000" }] }
    fetchMock.mockReset().mockResolvedValue(data)
    expect(await nhk({} as never)).toEqual(parseNHKNews(data))
    expect(fetchMock).toHaveBeenCalledWith("https://api.nhkworld.jp/nwapi/news/v1/en/articles?type=news&tag=&offset=0&limit=30")
    expect(parseNHKNews(data)[0]).toMatchObject({ pubDate: 1789248503000, url: "https://www3.nhk.or.jp/nhkworld/news/20260913de49938/" })
  })

  it("rejects HTML, empty or malformed responses before they can poison the client cache", () => {
    const valid = { id: "reuters", status: "success", updatedTime: 1789248503000, items: [{ id: "1", title: "News", url: "https://www.reuters.com/world/1" }] }
    expect(isSourceResponse(valid, "reuters")).toBe(true)
    expect(isSourceResponse({ ...valid, status: "cache", refreshError: true }, "reuters")).toBe(true)
    for (const invalid of ["<!DOCTYPE html>", null, {}, { ...valid, items: [] }, { ...valid, items: [null] }, { ...valid, updatedTime: "bad" }, { ...valid, id: "bbc" }]) {
      expect(isSourceResponse(invalid, "reuters")).toBe(false)
    }
  })
})
