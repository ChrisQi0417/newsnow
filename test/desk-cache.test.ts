import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { H3Event } from "h3"
import { SourceUnavailableError, sourceFailure } from "../server/utils/source-failure"
import { SourceRetryBaseDelay, clearSourceRetry } from "../server/utils/source-retry"
import type { SourceRetryState } from "../server/utils/source-retry"
import { forgetSourceSuccess } from "../server/utils/source-memory-cache"
import { ManualRefreshCooldown } from "../shared/consts"
import { sources } from "../shared/sources"

const mocks = vi.hoisted(() => ({
  query: { id: "reuters" } as Record<string, string>,
  getter: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  getEntire: vi.fn(),
  getRetry: vi.fn(),
  setRetry: vi.fn(),
  clearRetry: vi.fn(),
  setHeader: vi.fn(),
}))

vi.mock("h3", async importOriginal => ({
  ...await importOriginal<typeof import("h3")>(),
  getQuery: () => mocks.query,
  readBody: async () => ({ sources: ["reuters"] }),
  setHeader: mocks.setHeader,
}))
vi.mock("../server/getters", () => ({
  resolveSourceID: (id: string) => id,
  hasGetter: () => true,
  getGetter: async () => mocks.getter,
}))
vi.mock("../server/database/cache", () => ({
  getCacheTable: async () => ({ get: mocks.get, set: mocks.set, getEntire: mocks.getEntire, getRetry: mocks.getRetry, setRetry: mocks.setRetry, clearRetry: mocks.clearRetry }),
}))
vi.mock("../server/utils/translate", () => ({
  translateNewsItemsForOutput: async (value: Array<{ title: string }>) => value.map(item => ({ ...item, title: `中文：${item.title}` })),
  isChineseOutput: () => false,
  getTranslationIssues: () => [],
}))

const { default: handler } = await import("../server/api/s/index")
const { default: entire } = await import("../server/api/s/entire.post")
const event = { context: {} } as H3Event
const items = [{ id: "1", title: "Previously retrieved news", url: "https://reuters.com/article/1" }]
let updated: number
const persistedRetries = new Map<string, SourceRetryState>()

beforeEach(async () => {
  vi.resetAllMocks()
  await clearSourceRetry("reuters")
  forgetSourceSuccess("reuters")
  persistedRetries.clear()
  mocks.getRetry.mockImplementation(async (id: string) => persistedRetries.get(id))
  mocks.setRetry.mockImplementation(async (id: string, state: SourceRetryState) => {
    persistedRetries.set(id, state)
  })
  mocks.clearRetry.mockImplementation(async (id: string) => {
    persistedRetries.delete(id)
  })
  mocks.query = { id: "reuters" }
  updated = Date.now() - 120_000
  mocks.get.mockResolvedValue({ id: "reuters", items, updated })
  mocks.getEntire.mockResolvedValue([{ id: "reuters", items, updated }])
})
afterEach(() => vi.restoreAllMocks())

describe("desk cache transparency", () => {
  it("reuses a just-refreshed source during the manual refresh cooldown", async () => {
    mocks.query.latest = "true"
    const recent = Date.now() - 10_000
    mocks.get.mockResolvedValue({ id: "reuters", items, updated: recent })
    expect(await handler(event)).toMatchObject({ updatedTime: recent, items })
    expect(mocks.getter).not.toHaveBeenCalled()
  })
  it("retains cached news and reports failure when upstream returns an empty list", async () => {
    mocks.query.latest = "true"
    mocks.getter.mockResolvedValue([])
    expect(await handler(event)).toMatchObject({ status: "cache", refreshError: true, updatedTime: updated, translationComplete: false, items })
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it("rejects an empty response when no readable cache exists", async () => {
    mocks.query.latest = "true"
    mocks.get.mockResolvedValue(undefined)
    mocks.getter.mockResolvedValue([])
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 503, data: { sourceIssues: ["source:empty"] } })
  })
  it("preserves the real retrieval timestamp on a recent cache hit", async () => {
    expect(await handler(event)).toMatchObject({ updatedTime: updated, translationComplete: false, items })
    expect(mocks.getter).not.toHaveBeenCalled()
  })
  it("preserves timestamps when hydrating the entire desk", async () => {
    expect(await entire(event)).toEqual([{ id: "reuters", status: "cache", items, translationComplete: false, updatedTime: updated }])
  })
  it("reports a failed latest fetch while retaining readable cached news", async () => {
    mocks.query.latest = "true"
    mocks.getter.mockRejectedValue(new Error("upstream unavailable"))
    expect(await handler(event)).toMatchObject({ status: "cache", refreshError: true, updatedTime: updated, translationComplete: false, items })
  })
  it("clears the fallback error flag after a successful fetch", async () => {
    mocks.query.latest = "true"
    mocks.getter.mockResolvedValue(items)
    const result = await handler(event)
    expect(result.status).toBe("success")
    expect(result.refreshError).toBeUndefined()
    expect(mocks.set).toHaveBeenCalledWith("reuters", [{ ...items[0], title: "中文：Previously retrieved news" }])
  })
  it("exposes only structured upstream failures alongside unchanged cached news", async () => {
    mocks.query.latest = "true"
    mocks.getter.mockRejectedValue(new SourceUnavailableError(["ap-page:http-403"]))
    expect(await handler(event)).toMatchObject({ sourceIssues: ["ap-page:http-403"], updatedTime: updated, items })
    expect(sourceFailure("index", new Error("secret request headers"))).toBe("index:request-failed")
    expect(sourceFailure("index", { name: "FetchError", cause: { name: "TimeoutError" } })).toBe("index:timeout")
  })
  it("coalesces simultaneous manual refreshes for the same source", async () => {
    mocks.query.latest = "true"
    mocks.getter.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return items
    })

    const results = await Promise.all([handler(event), handler(event)])

    expect(mocks.getter).toHaveBeenCalledOnce()
    expect(results.every(result => result.items.length === 1)).toBe(true)
  })

  it("reuses old content during backoff even when latest is requested repeatedly", async () => {
    const now = 1_800_000_000_000
    vi.spyOn(Date, "now").mockReturnValue(now)
    mocks.query.latest = "true"
    mocks.getter.mockRejectedValue(new SourceUnavailableError(["ap-page:http-429", "secret: https://private.example/token"]))
    const first = await handler(event)
    expect(first).toMatchObject({ status: "cache", refreshError: true, updatedTime: updated, items, nextRetryAt: now + SourceRetryBaseDelay, sourceIssues: ["ap-page:http-429"] })
    // A new process can recover the cooldown from persisted state.
    await clearSourceRetry("reuters")
    expect(await handler(event)).toEqual(first)
    delete mocks.query.latest
    expect(await handler(event)).toEqual(first)
    expect(mocks.getter).toHaveBeenCalledOnce()
    expect(mocks.setRetry).toHaveBeenCalledOnce()
    expect(mocks.setHeader).toHaveBeenLastCalledWith(event, "Retry-After", 900)
  })

  it("returns a retryable 503 without a cache and does not repeatedly contact upstream", async () => {
    mocks.query.latest = "true"
    mocks.get.mockResolvedValue(undefined)
    mocks.getter.mockRejectedValue(new Error("private upstream details"))
    for (let index = 0; index < 2; index++) {
      await expect(handler(event)).rejects.toMatchObject({
        statusCode: 503,
        message: "数据源暂时不可用，请稍后重试",
        data: { sourceIssues: ["source:request-failed"] },
      })
    }
    expect(mocks.getter).toHaveBeenCalledOnce()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it("allows one retry at the deadline, doubles repeated failures and clears state on recovery", async () => {
    const now = 1_800_000_000_000
    const clock = vi.spyOn(Date, "now").mockReturnValue(now)
    mocks.query.latest = "true"
    mocks.getter.mockRejectedValue(new Error("unavailable"))
    await handler(event)
    clock.mockReturnValue(now + SourceRetryBaseDelay - 1)
    await handler(event)
    expect(mocks.getter).toHaveBeenCalledOnce()
    clock.mockReturnValue(now + SourceRetryBaseDelay)
    await handler(event)
    expect(mocks.getter).toHaveBeenCalledTimes(2)
    expect(persistedRetries.get("reuters")).toMatchObject({ failures: 2, nextRetryAt: now + SourceRetryBaseDelay * 3 })
    clock.mockReturnValue(now + SourceRetryBaseDelay * 3)
    mocks.getter.mockResolvedValue(items)
    expect(await handler(event)).toMatchObject({ status: "success", updatedTime: now + SourceRetryBaseDelay * 3 })
    expect(persistedRetries.has("reuters")).toBe(false)
    expect(mocks.clearRetry).toHaveBeenCalledOnce()
  })

  it("counts a shared concurrent failure once", async () => {
    mocks.query.latest = "true"
    let reject!: (error: Error) => void
    mocks.getter.mockImplementation(() => new Promise((_resolve, rejectPromise) => {
      reject = rejectPromise
    }))
    const requests = Promise.all([handler(event), handler(event)])
    await vi.waitFor(() => expect(mocks.getter).toHaveBeenCalledOnce())
    reject(new Error("unavailable"))
    expect((await requests).every(result => result.refreshError)).toBe(true)
    expect(mocks.setRetry).toHaveBeenCalledOnce()
    expect(persistedRetries.get("reuters")?.failures).toBe(1)
  })

  it("keeps successfully collected news when writing the content cache fails", async () => {
    mocks.query.latest = "true"
    mocks.get.mockResolvedValue(undefined)
    mocks.getter.mockResolvedValue(items)
    mocks.set.mockRejectedValue(new Error("cache unavailable"))
    mocks.clearRetry.mockRejectedValue(new Error("retry cache unavailable"))
    expect(await handler(event)).toMatchObject({ status: "success", items: [{ ...items[0], title: "中文：Previously retrieved news" }] })
    expect(mocks.setRetry).not.toHaveBeenCalled()
  })

  it("uses recent successful content through the normal cadence when persistence fails", async () => {
    const now = 1_800_000_000_000
    const clock = vi.spyOn(Date, "now").mockReturnValue(now)
    mocks.query.latest = "true"
    mocks.getter.mockResolvedValue(items)
    mocks.set.mockRejectedValue(new Error("cache unavailable"))
    // An old persisted value must not replace the newer instance-local result.
    mocks.get.mockResolvedValue({ id: "reuters", items, updated: now - sources.reuters.interval * 2 })
    const result = await handler(event)
    clock.mockReturnValue(now + ManualRefreshCooldown - 1)
    expect(await handler(event)).toMatchObject({ updatedTime: now, items: result.items })
    delete mocks.query.latest
    clock.mockReturnValue(now + sources.reuters.interval - 1)
    expect(await handler(event)).toMatchObject({ updatedTime: now, items: result.items })
    expect(mocks.getter).toHaveBeenCalledOnce()
    clock.mockReturnValue(now + sources.reuters.interval)
    expect(await handler(event)).toMatchObject({ status: "success", updatedTime: now + sources.reuters.interval })
    expect(mocks.getter).toHaveBeenCalledTimes(2)
  })

  it("permits a manual refresh after cooldown even when the preceding cache write failed", async () => {
    const now = 1_800_000_000_000
    const clock = vi.spyOn(Date, "now").mockReturnValue(now)
    mocks.query.latest = "true"
    mocks.get.mockResolvedValue(undefined)
    mocks.getter.mockResolvedValue(items)
    mocks.set.mockRejectedValue(new Error("cache unavailable"))
    await handler(event)
    await handler(event)
    expect(mocks.getter).toHaveBeenCalledOnce()
    clock.mockReturnValue(now + ManualRefreshCooldown)
    await handler(event)
    expect(mocks.getter).toHaveBeenCalledTimes(2)
  })

  it("observes another instance clearing a previously persisted failure", async () => {
    const now = 1_800_000_000_000
    vi.spyOn(Date, "now").mockReturnValue(now)
    mocks.query.latest = "true"
    mocks.getter.mockRejectedValue(new Error("unavailable"))
    await handler(event)
    persistedRetries.delete("reuters")
    mocks.get.mockResolvedValue({ id: "reuters", items, updated: now })
    expect(await handler(event)).toMatchObject({ status: "success", updatedTime: now })
    expect((await handler(event)).refreshError).toBeUndefined()
    expect(mocks.getter).toHaveBeenCalledOnce()
  })

  it("does not share locally cached weather across requests", async () => {
    mocks.query = { id: "weather", latest: "true" }
    mocks.getter.mockResolvedValue(items)
    await handler(event)
    await handler(event)
    expect(mocks.getter).toHaveBeenCalledTimes(2)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it("retains instance-local protection if persistent retry storage fails", async () => {
    mocks.query.latest = "true"
    mocks.getter.mockRejectedValue(new Error("unavailable"))
    mocks.getRetry.mockRejectedValue(new Error("read unavailable"))
    mocks.setRetry.mockRejectedValue(new Error("write unavailable"))
    await handler(event)
    await handler(event)
    expect(mocks.getter).toHaveBeenCalledOnce()
  })
})
