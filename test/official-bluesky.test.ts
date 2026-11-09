import { beforeEach, describe, expect, it, vi } from "vitest"
import { officialBlueskyFeedUrl, parseOfficialBluesky } from "../server/utils/official-bluesky"
import reuters from "../server/sources/reuters"
import apnews from "../server/sources/apnews"

const { fetchMock, translateMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  translateMock: vi.fn(async (items: unknown) => items),
}))
vi.mock("../server/utils/fetch", () => ({ myFetch: fetchMock }))
vi.mock("../server/utils/translate", () => ({ translateNewsItemsToChinese: translateMock }))

const reutersPublisher = { handle: "reuters.com", did: "did:plc:jbvnehrrdqoulco4rf5gxg5r", publisher: "路透社" }
const apPublisher = { handle: "apnews.com", did: "did:plc:a67zdrt4nl2tv2qojpngogbq", publisher: "美联社" }

function post(publisher: { handle: string, did: string }) {
  return { post: {
    uri: `at://${publisher.did}/app.bsky.feed.post/3mygwokzthk2f`,
    author: { did: publisher.did, handle: publisher.handle },
    record: { $type: "app.bsky.feed.post", text: "Verified official public update", createdAt: "2020-01-01T05:30:23.800Z" },
  } }
}

beforeEach(() => {
  fetchMock.mockReset()
  translateMock.mockClear()
})

describe("official publisher feed identity", () => {
  it.each([reutersPublisher, apPublisher])("accepts only matching handle, DID and URI for $handle", (publisher) => {
    const original = post(publisher)
    const items = parseOfficialBluesky({ feed: [original] }, publisher)
    expect(items).toEqual([expect.objectContaining({
      url: `https://bsky.app/profile/${publisher.handle}/post/3mygwokzthk2f`,
      pubDate: Date.parse("2020-01-01T05:30:23.800Z"),
      extra: { info: `${publisher.publisher}官方动态 · Bluesky`, hover: expect.stringContaining(publisher.handle) },
    })])
    const invalid = [
      { post: { ...original.post, author: { ...original.post.author, did: "did:plc:someoneelse" } } },
      { post: { ...original.post, author: { ...original.post.author, handle: `${publisher.handle}.evil.example` } } },
      { post: { ...original.post, uri: original.post.uri.replace(publisher.did, "did:plc:someoneelse") } },
      { ...original, reason: { $type: "app.bsky.feed.defs#reasonRepost" } },
    ]
    expect(parseOfficialBluesky({ feed: invalid }, publisher)).toEqual([])
  })
})

describe("official publisher source requests", () => {
  it("uses one verified Reuters public request and keeps Chinese translation connected", async () => {
    fetchMock.mockResolvedValue({ feed: [post(reutersPublisher)] })
    const items = await reuters({} as never)
    expect(items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(officialBlueskyFeedUrl("reuters.com"), { retry: 0, timeout: 4500 })
    expect(translateMock).toHaveBeenCalledWith(items, "reuters")
  })

  it("reports empty Reuters public data without revisiting the rejected sitemap", async () => {
    fetchMock.mockResolvedValue({ feed: [post(apPublisher)] })
    await expect(reuters({} as never)).rejects.toMatchObject({ issues: ["reuters-public:empty"] })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(translateMock).not.toHaveBeenCalled()
  })

  it("reports public endpoint limits without retrying or visiting another Reuters endpoint", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("rate limited"), { statusCode: 429 }))
    await expect(reuters({} as never)).rejects.toMatchObject({ issues: ["reuters-public:http-429"] })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("short-circuits AP top after one official public request and labels the alternate ordering", async () => {
    fetchMock.mockResolvedValue({ feed: [post(apPublisher)] })
    const items = await apnews["apnews-top"]!({} as never)
    expect(items).toEqual([expect.objectContaining({
      extra: { info: "美联社官方动态 · Bluesky", hover: expect.stringContaining("非官网头条排序") },
    })])
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(officialBlueskyFeedUrl("apnews.com"), { retry: 0, timeout: 4500 })
    expect(translateMock).toHaveBeenCalledWith(items, "apnews:https://apnews.com/")
  })

  it.each(["apnews-world", "apnews-business", "apnews-fact-check"])("keeps the official public stream out of %s", async (id) => {
    fetchMock.mockResolvedValue("<a href=\"/article/section-story\">Official editorial section headline</a>")
    expect(await apnews[id as keyof typeof apnews]!({} as never)).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => new URL(url).hostname === "apnews.com")).toBe(true)
  })
})
