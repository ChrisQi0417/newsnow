import { beforeEach, describe, expect, it, vi } from "vitest"
import type { H3Event } from "h3"

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

const { default: handler } = await import("../server/api/s/index")
const { default: entire } = await import("../server/api/s/entire.post")
const event = { context: {} } as H3Event
const items = [{ id: "1", title: "Previously retrieved news", url: "https://reuters.com/article/1" }]
let updated: number

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query = { id: "reuters" }
  updated = Date.now() - 30_000
  mocks.get.mockResolvedValue({ id: "reuters", items, updated })
  mocks.getEntire.mockResolvedValue([{ id: "reuters", items, updated }])
})

describe("desk cache transparency", () => {
  it("preserves the real retrieval timestamp on a recent cache hit", async () => {
    expect(await handler(event)).toMatchObject({ updatedTime: updated, items })
    expect(mocks.getter).not.toHaveBeenCalled()
  })
  it("preserves timestamps when hydrating the entire desk", async () => {
    expect(await entire(event)).toEqual([{ id: "reuters", status: "cache", items, updatedTime: updated }])
  })
  it("reports a failed latest fetch while retaining readable cached news", async () => {
    mocks.query.latest = "true"
    mocks.getter.mockRejectedValue(new Error("upstream unavailable"))
    expect(await handler(event)).toMatchObject({ status: "cache", refreshError: true, updatedTime: updated, items })
  })
  it("clears the fallback error flag after a successful fetch", async () => {
    mocks.query.latest = "true"
    mocks.getter.mockResolvedValue(items)
    const result = await handler(event)
    expect(result.status).toBe("success")
    expect(result.refreshError).toBeUndefined()
    expect(mocks.set).toHaveBeenCalledWith("reuters", items)
  })
})
