import type { NewsItem } from "@shared/types"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Cache, EdgeCache, getCacheTable } from "../server/database/cache"

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
  it("preserves independent account timestamps and cooldowns across persistent cache instances", async () => {
    const runtime = createRuntimeCache()
    const states = [{ handle: "OpenAI" as const, status: "stale" as const, updatedTime: 1000, nextRetryAt: 901000, issues: ["x-embed:http-429"] }]
    await new EdgeCache(runtime).set("twitter", [], states, 1000)
    expect(await new EdgeCache(runtime).get("twitter")).toMatchObject({ accountStatus: states, updated: 1000 })
  })
  it("reads legacy SQL array payloads and preserves metadata in new payloads", async () => {
    let row = { id: "twitter", data: JSON.stringify([{ id: "1", title: "旧内容", url: "https://x.com/OpenAI/status/1" }]), updated: 1000 }
    const statement = {
      get: async () => row,
      all: async () => [row],
      run: async (id: string, data: string, updated: number) => {
        row = { id, data, updated }
      },
    }
    const cache = new Cache({ prepare: () => statement } as never)
    expect((await cache.get("twitter"))?.items).toHaveLength(1)
    const states = [{ handle: "OpenAI" as const, status: "stale" as const, updatedTime: 1000, nextRetryAt: 901000, issues: ["x-embed:http-429"] }]
    await cache.set("twitter", [], states, 1000)
    expect(await cache.get("twitter")).toMatchObject({ accountStatus: states, updated: 1000 })
    expect(await cache.getEntire(["twitter"])).toEqual([expect.objectContaining({ accountStatus: states })])
  })
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

  it("persists cooldowns across cache instances independently of readable news", async () => {
    const runtimeCache = createRuntimeCache()
    const first = new EdgeCache(runtimeCache)
    const second = new EdgeCache(runtimeCache)
    const items: NewsItem[] = [{ id: "old", title: "已保存新闻", url: "https://example.com/old" }]
    await first.set("reuters", items)
    const before = await first.get("reuters")
    const retry = { failures: 1, lastAttemptAt: 1000, nextRetryAt: 901000, issues: ["source:http-429"] }
    await first.setRetry("reuters", retry)
    expect(await second.getRetry("reuters")).toEqual(retry)
    expect(await second.get("reuters")).toEqual(before)
    await second.clearRetry("reuters")
    expect(await first.getRetry("reuters")).toBeUndefined()
    expect(await first.get("reuters")).toEqual(before)
  })
})
