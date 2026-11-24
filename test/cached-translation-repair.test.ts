import type { H3Event } from "h3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CacheInfo } from "../server/types"
import { sources } from "../shared/sources"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getter: vi.fn(),
  translate: vi.fn(),
  getRetry: vi.fn(),
  setRetry: vi.fn(),
  clearRetry: vi.fn(),
  getEntire: vi.fn(),
  setHeader: vi.fn(),
}))
vi.mock("../server/utils/translate", () => ({
  translateNewsItemsForOutput: mocks.translate,
  isChineseOutput: (items: Array<{ title: string }>) => items.every(item => /[\u3400-\u9FFF]/.test(item.title)),
  getTranslationIssues: () => [],
}))
vi.mock("../server/getters", () => ({
  resolveSourceID: (id: string) => id,
  hasGetter: () => true,
  getGetter: async () => mocks.getter,
}))
vi.mock("../server/database/cache", () => ({ getCacheTable: async () => mocks }))
vi.mock("h3", async importOriginal => ({
  ...await importOriginal<typeof import("h3")>(),
  getQuery: () => ({ id: "reuters" }),
  readBody: async () => ({ sources: ["reuters"] }),
  setHeader: mocks.setHeader,
}))

const now = 1_800_000_000_000
const interval = 15 * 60_000
const ai = { run: vi.fn() }
const event = { context: { cloudflare: { env: { AI: ai } } } } as unknown as H3Event
const records = new Map<string, CacheInfo>()
let cache: CacheInfo
let repair: typeof import("../server/utils/cached-translation-repair").repairCachedTranslation

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.spyOn(Date, "now").mockReturnValue(now)
  records.clear()
  cache = {
    id: "reuters",
    updated: now - 120_000,
    items: [{ id: "old", title: "Existing headline", url: "https://example.com/old", pubDate: now - 3_600_000 }],
    accountStatus: [{ handle: "OpenAI", status: "unavailable", nextRetryAt: now + interval, issues: ["x-embed:http-429"] }],
  }
  records.set(cache.id, cache)
  mocks.get.mockImplementation(async (key: string) => records.get(key))
  mocks.set.mockImplementation(async (key: string, items: CacheInfo["items"], accountStatus?: CacheInfo["accountStatus"], updated = Date.now()) => {
    records.set(key, { id: key as CacheInfo["id"], items, accountStatus, updated })
  })
  mocks.getEntire.mockImplementation(async () => [records.get("reuters")])
  mocks.translate.mockImplementation(async (items: CacheInfo["items"]) => items.map(item => ({ ...item, title: "已有新闻的中文翻译" })))
  repair = (await import("../server/utils/cached-translation-repair")).repairCachedTranslation
})
afterEach(() => vi.restoreAllMocks())

describe("cached Chinese translation repair", () => {
  it("repairs titles with the existing binding and preserves collection and account metadata", async () => {
    const result = await repair(cache, ai, mocks)
    expect(result).toEqual({ ...cache, items: [{ ...cache.items[0], title: "已有新闻的中文翻译" }] })
    expect(mocks.translate).toHaveBeenCalledWith(cache.items, "reuters", ai)
    expect(mocks.set).toHaveBeenNthCalledWith(1, "translation-repair:reuters", [], undefined, now)
    expect(mocks.set).toHaveBeenNthCalledWith(2, "reuters", result.items, cache.accountStatus, cache.updated)
    expect(mocks.clearRetry).not.toHaveBeenCalled()
  })

  it("coalesces simultaneous repair calls without collecting media", async () => {
    let finish!: (items: CacheInfo["items"]) => void
    mocks.translate.mockImplementation(() => new Promise((resolve) => {
      finish = resolve
    }))
    const pending = Promise.all([repair(cache, ai, mocks), repair(cache, ai, mocks)])
    await vi.waitFor(() => expect(mocks.translate).toHaveBeenCalledOnce())
    finish([{ ...cache.items[0], title: "共享中文翻译" }])
    const results = await pending
    expect(results[0]).toEqual(results[1])
    expect(mocks.getter).not.toHaveBeenCalled()
  })

  it("persists a 15 minute retry cooldown even when translation fails and the instance restarts", async () => {
    mocks.translate.mockRejectedValue(new Error("provider unavailable"))
    expect(await repair(cache, ai, mocks)).toEqual(cache)
    vi.resetModules()
    repair = (await import("../server/utils/cached-translation-repair")).repairCachedTranslation
    vi.mocked(Date.now).mockReturnValue(now + interval - 1)
    expect(await repair(cache, ai, mocks)).toEqual(cache)
    expect(mocks.translate).toHaveBeenCalledOnce()
    vi.mocked(Date.now).mockReturnValue(now + interval)
    await repair(cache, ai, mocks)
    expect(mocks.translate).toHaveBeenCalledTimes(2)
  })

  it("keeps local retry protection when persistent storage is unavailable", async () => {
    mocks.get.mockRejectedValue(new Error("storage unavailable"))
    mocks.set.mockRejectedValue(new Error("storage unavailable"))
    mocks.translate.mockRejectedValue(new Error("provider unavailable"))
    await repair(cache, ai, mocks)
    await repair(cache, ai, mocks)
    expect(mocks.translate).toHaveBeenCalledOnce()
  })

  it("returns a newer collection instead of overwriting it with an older translated snapshot", async () => {
    const newer = { ...cache, updated: now, items: [{ id: "new", title: "更新的新闻", url: "https://example.com/new" }] }
    mocks.translate.mockImplementation(async (items: CacheInfo["items"]) => {
      records.set("reuters", newer)
      return items.map(item => ({ ...item, title: "旧新闻翻译" }))
    })
    expect(await repair(cache, ai, mocks)).toEqual(newer)
    expect(mocks.set).toHaveBeenCalledOnce()
    expect(records.get("reuters")).toEqual(newer)
  })

  it("does not persist an older repair while this instance is collecting fresh content", async () => {
    expect((await repair(cache, ai, mocks, () => true)).items[0].title).toBe("已有新闻的中文翻译")
    expect(mocks.set).toHaveBeenCalledOnce()
    expect(records.get("reuters")).toEqual(cache)
  })

  it("does no repair work for Chinese content or when no AI binding exists", async () => {
    await repair(cache, undefined, mocks)
    await repair({ ...cache, items: [{ ...cache.items[0], title: "已有中文" }] }, ai, mocks)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.translate).not.toHaveBeenCalled()
  })
})

describe("cached repair API integration", () => {
  it("repairs a normal cache hit without calling the media getter", async () => {
    const handler = (await import("../server/api/s/index")).default
    const response = await handler(event)
    expect(response).toMatchObject({ updatedTime: cache.updated, accountStatus: cache.accountStatus, partial: true, translationComplete: true })
    expect(response.items[0].title).toBe("已有新闻的中文翻译")
    expect(mocks.getter).not.toHaveBeenCalled()
  })

  it("preserves source backoff and stale timestamps while repairing cached language", async () => {
    const retry = { failures: 1, lastAttemptAt: now - 1000, nextRetryAt: now + 899_000, issues: ["source:http-429"] }
    mocks.getRetry.mockResolvedValue(retry)
    const handler = (await import("../server/api/s/index")).default
    const response = await handler(event)
    expect(response).toMatchObject({ status: "cache", refreshError: true, nextRetryAt: retry.nextRetryAt, updatedTime: cache.updated, translationComplete: true })
    expect(mocks.clearRetry).not.toHaveBeenCalled()
    expect(mocks.getter).not.toHaveBeenCalled()
    expect(mocks.setHeader).toHaveBeenCalledWith(event, "Retry-After", 899)
  })

  it("keeps entire hydration cache-only", async () => {
    const handler = (await import("../server/api/s/entire.post")).default
    expect(await handler(event)).toEqual([expect.objectContaining({ items: cache.items, updatedTime: cache.updated, translationComplete: false })])
    expect(mocks.translate).not.toHaveBeenCalled()
    expect(mocks.getter).not.toHaveBeenCalled()
  })

  it("translates newly collected content once instead of first repairing an expired cache", async () => {
    cache.updated = now - sources.reuters.interval - 1
    const freshItems = [{ id: "new", title: "Fresh headline", url: "https://example.com/new" }]
    mocks.getter.mockResolvedValue(freshItems)
    const handler = (await import("../server/api/s/index")).default
    expect(await handler(event)).toMatchObject({ updatedTime: now, translationComplete: true })
    expect(mocks.getter).toHaveBeenCalledOnce()
    expect(mocks.translate).toHaveBeenCalledExactlyOnceWith(freshItems, "reuters", ai)
    expect(records.has("translation-repair:reuters")).toBe(false)
  })
})
