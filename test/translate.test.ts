import { afterEach, describe, expect, it, vi } from "vitest"
import { translateTextsToChinese } from "../server/utils/translate"

vi.mock("../server/utils/fetch", () => ({
  myFetch: async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error("Translation unavailable")
    return response.json()
  },
}))

describe("shared translation acceleration", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses an exact persistent translation without calling a provider", async () => {
    const source = "Persistent translation cache title alpha 2026"
    const translation = "持久译文缓存标题甲"
    const runtimeCache = {
      delete: vi.fn(),
      match: vi.fn(async () => new Response(JSON.stringify({ entries: [{ source, translation }] }))),
      put: vi.fn(),
    }
    const fetchMock = vi.fn()
    vi.stubGlobal("caches", { default: runtimeCache })
    vi.stubGlobal("fetch", fetchMock)

    await expect(translateTextsToChinese([source], "test-persistent-hit")).resolves.toEqual([translation])
    expect(runtimeCache.match).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("runs cold translation batches sequentially", async () => {
    const sources = Array.from({ length: 6 }, (_, index) => `Cold concurrent title ${index} ${"x".repeat(850)}`)
    let active = 0
    let maxActive = 0
    const runtimeCache = {
      delete: vi.fn(),
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    }
    const fetchMock = vi.fn(async (input: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 20))
      const source = new URL(input).searchParams.get("q") ?? ""
      active -= 1
      return new Response(JSON.stringify([[[`中文：${source}`, source]]]))
    })
    vi.stubGlobal("caches", { default: runtimeCache })
    vi.stubGlobal("fetch", fetchMock)

    const translated = await translateTextsToChinese(sources, "test-concurrency")

    expect(fetchMock).toHaveBeenCalledTimes(sources.length)
    expect(maxActive).toBe(1)
    expect(translated.every(title => title.startsWith("中文："))).toBe(true)
    expect(runtimeCache.match).toHaveBeenCalledOnce()
    expect(runtimeCache.put).toHaveBeenCalledOnce()
  })
  it("does not rotate providers or request individual titles after a failure", async () => {
    const fetchMock = vi.fn(async () => new Response("blocked", { status: 429 }))
    vi.stubGlobal("fetch", fetchMock)
    const titles = ["Untranslated rate limit test one", "Untranslated rate limit test two"]
    expect(await translateTextsToChinese(titles)).toEqual(titles)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
