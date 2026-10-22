import { beforeEach, describe, expect, it, vi } from "vitest"
import afp, { parseAfpFactCheckBing } from "../server/sources/afp"

const { fetchMock, videoMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), videoMock: vi.fn() }))
vi.mock("../server/utils/fetch", () => ({ myFetch: fetchMock }))
vi.mock("../server/utils/translate", () => ({ translateNewsItemsToChinese: async (items: unknown) => items }))
vi.mock("../server/utils/source", () => ({
  defineSource: (value: unknown) => value,
  defineRSSSource: () => videoMock,
}))

const articleUrl = "https://factcheck.afp.com/doc.afp.com.D3V7463"
const feed = (items: string) => `<rss xmlns:News="https://www.bing.com/news"><channel>${items}</channel></rss>`
function entry(url = articleUrl, publisher = "AFP Fact Check", date = "Wed, 21 Oct 2026 07:22:00 GMT") {
  const wrapper = `http://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent(url)}`
  return `<item><title>Verified AFP fact-check headline</title><link>${wrapper}</link>
    <pubDate>${date}</pubDate><News:Source>${publisher}</News:Source></item>`
}

beforeEach(() => {
  fetchMock.mockReset()
  videoMock.mockReset().mockResolvedValue([])
})

describe("afp fact-check index fallback", () => {
  it("validates the publisher and original article URL, deduplicates and orders by publication", () => {
    const newerUrl = "https://factcheck.afp.com/doc.afp.com.D3NEW01"
    const items = parseAfpFactCheckBing(feed(entry() + entry() + entry(newerUrl, "AFP.com", "Thu, 22 Oct 2026 01:00:00 GMT")))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ url: newerUrl, pubDate: Date.parse("2026-10-22T01:00:00Z") })
    expect(items[1]).toMatchObject({
      title: "Verified AFP fact-check headline",
      url: articleUrl,
      extra: { info: "法新社事实核查 · Bing 新闻索引" },
    })
  })

  it("rejects forged publishers, lookalike domains, non-article URLs and invalid dates", () => {
    for (const item of [
      entry(articleUrl, "Unrelated publisher"),
      entry("https://factcheck.afp.com.evil.example/doc.afp.com.D3V7463"),
      entry("https://evil.example/doc.afp.com.D3V7463"),
      entry("http://factcheck.afp.com/doc.afp.com.D3V7463"),
      entry("https://factcheck.afp.com/Contact"),
      entry("https://reader:password@factcheck.afp.com/doc.afp.com.D3V7463"),
      entry(articleUrl, "AFP Fact Check", "invalid date"),
      entry().replace("www.bing.com", "www.bing.com.evil.example"),
    ]) {
      expect(parseAfpFactCheckBing(feed(item))).toEqual([])
    }
    expect(parseAfpFactCheckBing("<html>Service unavailable</html>")).toEqual([])
    expect(parseAfpFactCheckBing(feed(""))).toEqual([])
  })

  it("uses Bing after the official hub and Google fail and stops before the video fallback", async () => {
    fetchMock.mockImplementation(async (url: string, options: { retry: number, timeout: number }) => {
      expect(options.retry).toBe(0)
      expect(options.timeout).toBeLessThanOrEqual(8000)
      if (new URL(url).hostname === "www.afp.com") throw Object.assign(new Error("unavailable"), { statusCode: 403 })
      return new URL(url).hostname === "www.bing.com" ? feed(entry()) : feed("")
    })

    expect(await afp({} as never)).toEqual([expect.objectContaining({ url: articleUrl })])
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(["www.afp.com", "news.google.com", "www.bing.com"])
    expect(videoMock).not.toHaveBeenCalled()
  })

  it("reports empty fallbacks without manufacturing articles or repeating upstream requests", async () => {
    fetchMock.mockResolvedValue(feed(""))

    await expect(afp({} as never)).rejects.toMatchObject({ issues: ["afp-hub:empty", "afp-index:empty", "afp-bing:empty", "afp-video:empty"] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(videoMock).toHaveBeenCalledOnce()
  })
})
