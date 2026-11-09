import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NewsItem } from "../shared/types"
import type { SourceRetryState } from "../server/utils/source-retry"
import type { CachedXHandle, XAccountStore } from "../server/utils/twitter-account-cache"
import { loadXAccount, resetXAccountMemory, xAccountCacheKey } from "../server/utils/twitter-account-cache"

const initialTime = Date.parse("2026-11-09T12:00:00Z")
const minute = 60_000
function posts(handle: CachedXHandle, count = 1): NewsItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${handle}-${index}`,
    url: `https://x.com/${handle}/status/${1000 + index}`,
    title: `真实帖子 ${index}`,
    pubDate: initialTime - minute,
  }))
}

function createStore() {
  const contents = new Map<string, { items: NewsItem[], updated: number }>()
  const retries = new Map<string, SourceRetryState>()
  const store: XAccountStore = {
    get: vi.fn(async key => contents.get(key)),
    set: vi.fn(async (key, items, _accountStatus, updated) => {
      contents.set(key, { items, updated: updated ?? Date.now() })
    }),
    getRetry: vi.fn(async key => retries.get(key)),
    setRetry: vi.fn(async (key, state) => {
      retries.set(key, state)
    }),
    clearRetry: vi.fn(async (key) => {
      retries.delete(key)
    }),
  }
  return { store, contents, retries }
}

beforeEach(() => {
  resetXAccountMemory()
  vi.useFakeTimers()
  vi.setSystemTime(initialTime)
})
afterEach(() => vi.useRealTimers())

describe("x account cache and failure protection", () => {
  it("retains an unavailable account's previous posts and timestamp without discarding the other account's updates", async () => {
    const { store, retries } = createStore()
    const tibo = vi.fn().mockResolvedValue({ items: posts("thsottiaux") })
    const openAI = vi.fn().mockResolvedValueOnce({ items: posts("OpenAI") }).mockRejectedValue(Object.assign(new Error("limited"), { statusCode: 429 }))
    await loadXAccount("thsottiaux", store, tibo)
    await loadXAccount("OpenAI", store, openAI)
    vi.setSystemTime(initialTime + 31 * minute)
    const latestTibo = await loadXAccount("thsottiaux", store, tibo)
    const retainedOpenAI = await loadXAccount("OpenAI", store, openAI)
    expect(latestTibo.status).toMatchObject({ status: "success", updatedTime: Date.now() })
    expect(retainedOpenAI).toMatchObject({
      items: posts("OpenAI"),
      status: { handle: "OpenAI", status: "stale", updatedTime: initialTime, nextRetryAt: Date.now() + 15 * minute, issues: ["x-openai:http-429"] },
    })
    expect(retries.has(xAccountCacheKey("OpenAI"))).toBe(true)
    expect(retries.has(xAccountCacheKey("thsottiaux"))).toBe(false)

    vi.setSystemTime(initialTime + 33 * minute)
    const duringCooldown = await loadXAccount("OpenAI", store, openAI, true)
    expect(duringCooldown).toEqual(retainedOpenAI)
    expect(openAI).toHaveBeenCalledTimes(2)
  })

  it("rehydrates cooldown in a new instance and clears only the recovered account after expiry", async () => {
    const { store, retries } = createStore()
    const openAI = vi.fn().mockResolvedValueOnce({ items: posts("OpenAI") }).mockRejectedValueOnce(Object.assign(new Error("limited"), { statusCode: 429 })).mockResolvedValue({ items: posts("OpenAI", 2) })
    await loadXAccount("OpenAI", store, openAI)
    vi.setSystemTime(initialTime + 31 * minute)
    await loadXAccount("OpenAI", store, openAI)
    const unrelated = { failures: 1, lastAttemptAt: Date.now(), nextRetryAt: Date.now() + 15 * minute, issues: ["x-thsottiaux:http-429"] }
    retries.set(xAccountCacheKey("thsottiaux"), unrelated)
    resetXAccountMemory()
    vi.setSystemTime(initialTime + 32 * minute)
    expect((await loadXAccount("OpenAI", store, openAI, true)).status.status).toBe("stale")
    expect(openAI).toHaveBeenCalledTimes(2)
    vi.setSystemTime(initialTime + 47 * minute)
    const recovered = await loadXAccount("OpenAI", store, openAI)
    expect(recovered.status).toEqual({ handle: "OpenAI", status: "success", updatedTime: Date.now(), issues: [] })
    expect(recovered.items).toHaveLength(2)
    expect(retries.has(xAccountCacheKey("OpenAI"))).toBe(false)
    expect(retries.get(xAccountCacheKey("thsottiaux"))).toEqual(unrelated)
  })

  it("backs off repeated failures independently and provides a bounded fallback during storage outages", async () => {
    const { store } = createStore()
    vi.mocked(store.set).mockRejectedValue(new Error("storage down"))
    vi.mocked(store.setRetry!).mockRejectedValue(new Error("storage down"))
    const openAI = vi.fn().mockResolvedValueOnce({ items: posts("OpenAI", 20) }).mockRejectedValue(Object.assign(new Error("limited"), { statusCode: 429 }))
    expect((await loadXAccount("OpenAI", store, openAI)).items).toHaveLength(15)
    vi.setSystemTime(initialTime + 10 * minute)
    await loadXAccount("OpenAI", store, openAI)
    expect(openAI).toHaveBeenCalledTimes(1)
    vi.setSystemTime(initialTime + 31 * minute)
    const firstFailure = await loadXAccount("OpenAI", store, openAI)
    expect(firstFailure.status.nextRetryAt).toBe(Date.now() + 15 * minute)
    vi.setSystemTime(initialTime + 47 * minute)
    const nextFailure = await loadXAccount("OpenAI", store, openAI)
    expect(nextFailure.status).toMatchObject({ updatedTime: initialTime, nextRetryAt: Date.now() + 30 * minute })
    expect(nextFailure.items).toHaveLength(15)
  })

  it("keeps rate-limit protection when only part of a verification batch succeeded", async () => {
    const { store } = createStore()
    const tibo = vi.fn().mockResolvedValue({ items: posts("thsottiaux"), issues: ["x-thsottiaux:http-429"] })
    const result = await loadXAccount("thsottiaux", store, tibo)
    expect(result.status).toMatchObject({ status: "stale", updatedTime: initialTime, nextRetryAt: initialTime + 15 * minute })
    vi.setSystemTime(initialTime + 2 * minute)
    await loadXAccount("thsottiaux", store, tibo, true)
    expect(tibo).toHaveBeenCalledOnce()
  })

  it("merges a rate-limited partial refresh into previous posts without resetting the last complete collection time", async () => {
    const { store, contents } = createStore()
    const previous = posts("thsottiaux", 15).map((post, index) => ({ ...post, pubDate: initialTime - (index + 1) * minute }))
    const newest = { ...posts("thsottiaux")[0], id: "new", url: "https://x.com/thsottiaux/status/9999", pubDate: initialTime + 30 * minute }
    const revised = { ...previous[0], title: "已核验的新文本" }
    const tibo = vi.fn().mockResolvedValueOnce({ items: previous }).mockResolvedValueOnce({ items: [newest, revised], issues: ["x-thsottiaux:http-429"] })
    await loadXAccount("thsottiaux", store, tibo)
    vi.setSystemTime(initialTime + 31 * minute)
    const partial = await loadXAccount("thsottiaux", store, tibo)
    expect(partial.items).toEqual([newest, revised, ...previous.slice(1, 14)])
    expect(partial.status).toMatchObject({ status: "stale", updatedTime: initialTime, nextRetryAt: Date.now() + 15 * minute })
    expect(contents.get(xAccountCacheKey("thsottiaux"))).toEqual({ items: partial.items, updated: initialTime })
    resetXAccountMemory()
    vi.setSystemTime(initialTime + 32 * minute)
    expect(await loadXAccount("thsottiaux", store, tibo, true)).toEqual(partial)
    expect(tibo).toHaveBeenCalledTimes(2)
  })

  it("migrates genuine account posts from the old combined cache before a rate-limited first refresh", async () => {
    const { store, contents } = createStore()
    const oldOpenAI = posts("OpenAI", 2)
    const legacy = vi.fn(async () => ({ items: oldOpenAI, updated: initialTime }))
    const openAI = vi.fn().mockRejectedValue(Object.assign(new Error("limited"), { statusCode: 429 }))
    const tibo = vi.fn().mockResolvedValue({ items: posts("thsottiaux") })
    vi.setSystemTime(initialTime + 31 * minute)
    const migrated = await loadXAccount("OpenAI", store, openAI, false, legacy)
    expect(migrated).toMatchObject({ items: oldOpenAI, status: { status: "stale", updatedTime: initialTime } })
    expect(contents.get(xAccountCacheKey("OpenAI"))).toEqual({ items: oldOpenAI, updated: initialTime })
    expect((await loadXAccount("thsottiaux", store, tibo, false, legacy)).status.status).toBe("success")
    expect(tibo).toHaveBeenCalledOnce()
    resetXAccountMemory()
    expect(await loadXAccount("OpenAI", store, openAI, false, legacy)).toEqual(migrated)
    expect(openAI).toHaveBeenCalledOnce()
  })
})
