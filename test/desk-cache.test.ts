import { beforeEach, describe, expect, it, vi } from "vitest"
import type { H3Event } from "h3"
import { SourceUnavailableError, sourceFailure } from "../server/utils/source-failure"

const mocks = vi.hoisted(() => ({
  query: { id: "reuters" } as Record<string, string>,
  getter: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  getEntire: vi.fn(),
}))

vi.mock("h3", async importOriginal => ({
  ...await importOriginal<typeof import("h3")>(),
  getQuery: () => mocks.query,
  readBody: async () => ({ sources: ["reuters"] }),
}))
vi.mock("../server/getters", () => ({
  resolveSourceID: (id: string) => id,
  hasGetter: () => true,
  getGetter: async () => mocks.getter,
}))
vi.mock("../server/database/cache", () => ({
  getCacheTable: async () => ({ get: mocks.get, set: mocks.set, getEntire: mocks.getEntire }),
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query = { id: "reuters" }
  updated = Date.now() - 120_000
  mocks.get.mockResolvedValue({ id: "reuters", items, updated })
  mocks.getEntire.mockResolvedValue([{ id: "reuters", items, updated }])
})

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
    await expect(handler(event)).rejects.toThrow("Source returned no news")
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
})
