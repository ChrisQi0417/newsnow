import type { NewsItem } from "@shared/types"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EdgeCache, getCacheTable } from "../server/database/cache"

function createRuntimeCache() {
  const values = new Map<string, Response>()
  return {
    delete: vi.fn(async (request: Request) => values.delete(request.url)),
    match: vi.fn(async (request: Request) => values.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      values.set(request.url, response.clone())
    }),
  }
}

describe("edge content cache", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("stores, reads, lists, and deletes source data", async () => {
    const runtimeCache = createRuntimeCache()
    const cache = new EdgeCache(runtimeCache)
    const items: NewsItem[] = [{ id: "story-1", title: "Story", url: "https://example.com/story-1" }]
    vi.spyOn(Date, "now").mockReturnValue(1_787_875_200_000)

    await cache.set("reuters", items)

    await expect(cache.get("reuters")).resolves.toEqual({
      id: "reuters",
      updated: 1_787_875_200_000,
      items,
    })
    await expect(cache.getEntire(["reuters", "missing"])).resolves.toEqual([{
      id: "reuters",
      updated: 1_787_875_200_000,
      items,
    }])
    await expect(cache.delete("reuters")).resolves.toBe(true)
    await expect(cache.get("reuters")).resolves.toBeUndefined()
  })

  it("prefers the edge cache when the runtime provides one", async () => {
    const runtimeCache = createRuntimeCache()
    vi.stubGlobal("caches", { default: runtimeCache })

    await expect(getCacheTable()).resolves.toBeInstanceOf(EdgeCache)
  })
})
