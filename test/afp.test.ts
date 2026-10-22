import { beforeEach, describe, expect, it, vi } from "vitest"
import afp, { parseAfpBluesky, parseAfpFactCheckBing } from "../server/sources/afp"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("../server/utils/fetch", () => ({ myFetch: fetchMock }))
vi.mock("../server/utils/translate", () => ({ translateNewsItemsToChinese: async (items: unknown) => items }))
vi.mock("../server/utils/source", () => ({
  defineSource: (value: unknown) => value,
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
})

const afpDid = "did:plc:r4ve5hjtfjubdwrvlxcad62e"
function blueskyPost(key = "3mygwokzthk2f", createdAt = "2020-01-01T05:30:23.800Z") {
  return { post: {
    uri: `at://${afpDid}/app.bsky.feed.post/${key}`,
    author: { did: afpDid, handle: "en.afp.com" },
    record: { $type: "app.bsky.feed.post", text: "Official AFP public update", createdAt },
  } }
}

describe("afp official Bluesky feed", () => {
  it("validates identity, constructs original post links, preserves timestamps and sorts unique posts", () => {
    const older = blueskyPost()
    const newer = blueskyPost("3mygv5zml6b2b", "2020-01-02T03:00:00.000Z")
    const items = parseAfpBluesky({ feed: [older, newer, older] })

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: newer.post.uri,
      title: "Official AFP public update",
      url: "https://bsky.app/profile/en.afp.com/post/3mygv5zml6b2b",
      pubDate: Date.parse(newer.post.record.createdAt),
      extra: { info: "法新社官方动态 · Bluesky" },
    })
    expect(items[1].pubDate).toBe(Date.parse(older.post.record.createdAt))
  })

  it("rejects forged identities, reposts, replies, malformed URIs, empty text and invalid or future timestamps", () => {
    const original = blueskyPost()
    const { post } = original
    const now = Date.parse("2020-01-03T00:00:00Z")
    const invalid = [
      { post: { ...post, author: { ...post.author, did: "did:plc:someoneelse" } } },
      { post: { ...post, author: { ...post.author, handle: "en.afp.com.evil.example" } } },
      { ...original, reason: { $type: "app.bsky.feed.defs#reasonRepost" } },
      { ...original, reply: { parent: {} } },
      { post: { ...post, record: { ...post.record, reply: { parent: {} } } } },
      { post: { ...post, uri: post.uri.replace(afpDid, "did:plc:someoneelse") } },
      { post: { ...post, uri: post.uri.replace("app.bsky.feed.post", "app.bsky.feed.repost") } },
      { post: { ...post, uri: `${post.uri}/bad` } },
      { post: { ...post, record: { ...post.record, text: "  \n " } } },
      { post: { ...post, record: { ...post.record, $type: "app.bsky.feed.repost" } } },
      blueskyPost(undefined, "not a date"),
      blueskyPost(undefined, "2020-02-30T05:30:23.800Z"),
      blueskyPost(undefined, "2020-01-01T24:00:00Z"),
      blueskyPost(undefined, "2021-01-01T05:30:23.800Z"),
      null,
      {},
    ]
    for (const entry of invalid) expect(parseAfpBluesky({ feed: [entry] }, now)).toEqual([])
    for (const data of [null, {}, "<html>unavailable</html>", { feed: {} }, { feed: [] }]) expect(parseAfpBluesky(data)).toEqual([])
  })

  it("returns official Bluesky content with a single request and no fallback traffic", async () => {
    fetchMock.mockResolvedValue({ feed: [blueskyPost()] })

    expect(await afp({} as never)).toEqual([expect.objectContaining({
      url: "https://bsky.app/profile/en.afp.com/post/3mygwokzthk2f",
      extra: { info: "法新社官方动态 · Bluesky", hover: expect.any(String) },
    })])
    expect(fetchMock).toHaveBeenCalledOnce()
    const [requestUrl, options] = fetchMock.mock.calls[0]
    const url = new URL(requestUrl)
    expect(url.origin).toBe("https://public.api.bsky.app")
    expect(url.pathname).toBe("/xrpc/app.bsky.feed.getAuthorFeed")
    expect(Object.fromEntries(url.searchParams)).toEqual({ actor: "en.afp.com", limit: "30", filter: "posts_no_replies" })
    expect(options).toMatchObject({ retry: 0, timeout: 4500 })
  })
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

  it("uses Bing only after Bluesky, the official hub and Google fail, within four requests", async () => {
    fetchMock.mockImplementation(async (url: string, options: { retry: number, timeout: number }) => {
      expect(options.retry).toBe(0)
      expect(options.timeout).toBeLessThanOrEqual(8000)
      if (new URL(url).hostname === "www.afp.com") throw Object.assign(new Error("unavailable"), { statusCode: 403 })
      return new URL(url).hostname === "www.bing.com" ? feed(entry()) : feed("")
    })

    expect(await afp({} as never)).toEqual([expect.objectContaining({ url: articleUrl })])
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(["public.api.bsky.app", "www.afp.com", "news.google.com", "www.bing.com"])
  })

  it("reports empty fallbacks without manufacturing articles or repeating upstream requests", async () => {
    fetchMock.mockResolvedValue(feed(""))

    await expect(afp({} as never)).rejects.toMatchObject({ issues: ["afp-bluesky:empty", "afp-hub:empty", "afp-index:empty", "afp-bing:empty"] })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
