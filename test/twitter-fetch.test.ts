import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import twitter from "../server/sources/twitter"
import { resetXAccountMemory } from "../server/utils/twitter-account-cache"

const { fetchMock, cacheMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), cacheMock: vi.fn() }))
vi.mock("../server/utils/fetch", () => ({ myFetch: fetchMock }))
vi.mock("../server/utils/translate", () => ({ translateNewsItemsToChinese: async (items: unknown) => items }))
vi.mock("../server/utils/logger", () => ({ logger: { warn: vi.fn() } }))
vi.mock("../server/database/cache", () => ({ getCacheTable: cacheMock }))

function tiboFeed(count = 1) {
  return {
    version: 1,
    source_scope: "timeline",
    stale: false,
    profile: { handle: "thsottiaux" },
    tweets: Array.from({ length: count }, (_, i) => ({
      id: String(1000 + i),
      url: `https://x.com/thsottiaux/status/${1000 + i}`,
      text: "Candidate Tibo post",
      at: "2026-10-21T10:00:00Z",
    })),
  }
}

function oEmbed(requestUrl: string) {
  const url = new URL(requestUrl).searchParams.get("url")!
  return {
    provider_name: "X",
    author_url: "https://x.com/thsottiaux",
    html: `<blockquote class="twitter-tweet"><p>Verified Tibo content</p><a href="${url}">October 21, 2026</a></blockquote>`,
  }
}

function embedded(handle = "OpenAI") {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { timeline: { entries: [{ type: "tweet", content: { tweet: {
      id_str: "2000",
      created_at: "2026-10-21T10:00:00Z",
      full_text: "Official account post",
      user: { screen_name: handle },
    } } }] } } },
  })}</script>`
}

const requestedUrls = () => fetchMock.mock.calls.map(([url]) => String(url))

beforeEach(() => {
  fetchMock.mockReset()
  cacheMock.mockReset().mockResolvedValue(undefined)
  resetXAccountMemory()
})
afterEach(() => vi.restoreAllMocks())

describe("x source request budget", () => {
  it("keeps verified Tibo posts and uses at most two verifications concurrently without redundant fallbacks", async () => {
    let active = 0
    let maximum = 0
    fetchMock.mockImplementation(async (url: string) => {
      const target = new URL(url)
      if (target.hostname === "codex-reset.com") return tiboFeed(10)
      if (target.hostname === "publish.x.com") {
        maximum = Math.max(maximum, ++active)
        await Promise.resolve()
        active--
        return oEmbed(url)
      }
      expect(active).toBe(0)
      expect(url).toBe("https://syndication.twitter.com/srv/timeline-profile/screen-name/OpenAI")
      return embedded()
    })

    expect(await twitter({} as never)).toHaveLength(11)
    expect(maximum).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(12)
    expect(requestedUrls().filter(url => url.includes("timeline-profile"))).toHaveLength(1)
    expect(requestedUrls().some(url => url.startsWith("https://x.com/"))).toBe(false)
  })

  it("stops OpenAI requests on HTTP 429 and preserves available Tibo content", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const target = new URL(url)
      if (target.hostname === "codex-reset.com") return tiboFeed()
      if (target.hostname === "publish.x.com") return oEmbed(url)
      throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 })
    })

    const event = { context: {} as Record<string, unknown> }
    expect(await twitter(event as never)).toEqual([expect.objectContaining({ url: "https://x.com/thsottiaux/status/1000" })])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(requestedUrls().at(-1)).toContain("timeline-profile/screen-name/OpenAI")
    expect(requestedUrls()).not.toContain("https://x.com/OpenAI")
    expect(event.context.newsnowAccountStatus).toEqual([
      expect.objectContaining({ handle: "thsottiaux", status: "success", issues: [] }),
      expect.objectContaining({ handle: "OpenAI", status: "unavailable", issues: ["x-openai-embed:http-429"], nextRetryAt: expect.any(Number) }),
    ])
    fetchMock.mockClear()
    expect(await twitter({ context: { newsnowManualRefresh: true } } as never)).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("preserves diagnostic codes for each account when all upstreams are rate limited", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 }))
    const event = { context: {} as Record<string, unknown> }
    await expect(twitter(event as never)).rejects.toMatchObject({ issues: ["x-thsottiaux-verified:http-429", "x-openai-embed:http-429"] })
    expect(event.context.newsnowAccountStatus).toEqual([
      expect.objectContaining({ handle: "thsottiaux", status: "unavailable" }),
      expect.objectContaining({ handle: "OpenAI", status: "unavailable" }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])("reads the combined cache once and preserves account collection time during migration (metadata: %s)", async (withMetadata) => {
    const previousTime = Date.now() - 31 * 60_000
    const previousOpenAI = { id: "old", title: "旧版真实 OpenAI 帖子", url: "https://x.com/OpenAI/status/3000", pubDate: previousTime - 60_000 }
    const get = vi.fn(async (key: string) => key === "twitter"
      ? {
          items: [previousOpenAI],
          updated: withMetadata ? Date.now() : previousTime,
          ...(withMetadata ? { accountStatus: [{ handle: "OpenAI", status: "stale", updatedTime: previousTime, issues: [] }] } : {}),
        }
      : undefined)
    const set = vi.fn()
    cacheMock.mockResolvedValue({ get, set })
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("codex-reset.com")) return tiboFeed()
      if (url.includes("publish.x.com")) return oEmbed(url)
      throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 })
    })
    const event = { context: {} as Record<string, unknown> }
    expect(await twitter(event as never)).toEqual(expect.arrayContaining([
      previousOpenAI,
      expect.objectContaining({ url: "https://x.com/thsottiaux/status/1000" }),
    ]))
    expect(get.mock.calls.filter(([key]) => key === "twitter")).toHaveLength(1)
    expect(set).toHaveBeenCalledWith("twitter-account:OpenAI", [previousOpenAI], undefined, previousTime)
    expect(event.context.newsnowAccountStatus).toEqual(expect.arrayContaining([
      expect.objectContaining({ handle: "OpenAI", status: "stale", updatedTime: previousTime }),
    ]))
  })

  it("retains the embedded Tibo fallback when its verified feed is unavailable", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("codex-reset.com")) throw Object.assign(new Error("unavailable"), { status: 503 })
      return embedded(url.endsWith("thsottiaux") ? "thsottiaux" : "OpenAI")
    })

    expect(await twitter({} as never)).toHaveLength(2)
    expect(requestedUrls()).toEqual([
      "https://codex-reset.com/api/feed",
      "https://syndication.twitter.com/srv/timeline-profile/screen-name/thsottiaux",
      "https://syndication.twitter.com/srv/timeline-profile/screen-name/OpenAI",
    ])
  })

  it("stops unstarted verification and same-account fallbacks after oEmbed rate limiting", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("codex-reset.com")) return tiboFeed(10)
      if (url.includes("publish.x.com")) throw Object.assign(new Error("rate limited"), { response: { status: 429 } })
      expect(url).toContain("screen-name/OpenAI")
      return embedded()
    })

    expect(await twitter({} as never)).toEqual([expect.objectContaining({ url: "https://x.com/OpenAI/status/2000" })])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(requestedUrls().filter(url => url.includes("publish.x.com"))).toHaveLength(2)
    expect(requestedUrls()).not.toContain("https://x.com/thsottiaux")
  })

  it("preserves already verified posts when another verification is rate limited", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("codex-reset.com")) return tiboFeed(10)
      if (url.includes("publish.x.com")) {
        if (url.includes("1000")) throw Object.assign(new Error("rate limited"), { status: 429 })
        return oEmbed(url)
      }
      return embedded()
    })

    expect(await twitter({} as never)).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "https://x.com/thsottiaux/status/1001" }),
      expect.objectContaining({ url: "https://x.com/OpenAI/status/2000" }),
    ]))
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("does not extend the verification time budget when reducing concurrency", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000)
    fetchMock.mockImplementation(async (url: string, options: { timeout: number }) => {
      if (url.includes("codex-reset.com")) return tiboFeed(10)
      if (url.includes("publish.x.com")) {
        expect(options.timeout).toBeLessThanOrEqual(6000)
        now.mockReturnValue(13000)
        return oEmbed(url)
      }
      return embedded()
    })

    expect(await twitter({} as never)).toHaveLength(2)
    expect(requestedUrls().filter(url => url.includes("publish.x.com"))).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
