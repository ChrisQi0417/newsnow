import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("workers AI translation", () => {
  it("translates with the binding, keeps article identity and reuses translations", async () => {
    const { translateNewsItemsForOutput } = await import("../server/utils/translate")
    const run = vi.fn(async () => ({ translated_text: "央行维持利率不变" }))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const item = { id: "item", title: "Central bank holds rates steady", url: "https://example.com/news", pubDate: 123 }
    const result = await translateNewsItemsForOutput([item], "bbc-world", { run })
    expect(result[0]).toEqual({ ...item, title: "央行维持利率不变", extra: { hover: `原文：${item.title}` } })
    expect(await translateNewsItemsForOutput([item], "bbc-world", { run })).toEqual(result)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith("@cf/meta/m2m100-1.2b", { text: item.title, source_lang: "en", target_lang: "zh" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never translates GitHub repository identifiers", async () => {
    const { translateNewsItemsForOutput } = await import("../server/utils/translate")
    const run = vi.fn(async () => ({ translated_text: "快速编程工具" }))
    const result = await translateNewsItemsForOutput([{ id: "repo", title: "owner/repo-name：Fast coding tools", url: "https://github.com/owner/repo-name" }], "github", { run })
    expect(result[0].title).toBe("owner/repo-name：快速编程工具")
    expect(run.mock.calls[0]).toEqual([expect.any(String), { text: "Fast coding tools", source_lang: "en", target_lang: "zh" }])
  })

  it("bounds inference concurrency to two and total calls to thirty", async () => {
    const { translateTextsToChinese } = await import("../server/utils/translate")
    let active = 0
    let maximum = 0
    const run = vi.fn(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active -= 1
      return { translated_text: "新闻标题" }
    })
    const texts = Array.from({ length: 40 }, (_, index) => `Headline number ${index}`)
    const result = await translateTextsToChinese(texts, "limits", { run })
    expect(run).toHaveBeenCalledTimes(30)
    expect(maximum).toBe(2)
    expect(result.slice(30)).toEqual(texts.slice(30))
  })

  it("stops after a quota failure without fanning out to public providers", async () => {
    const { translateTextsToChinese, getTranslationIssues } = await import("../server/utils/translate")
    const run = vi.fn(async () => {
      throw new Error("Daily quota exceeded")
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const texts = ["First story", "Second story", "Third story", "Fourth story"]
    expect(await translateTextsToChinese(texts, "quota", { run })).toEqual(texts)
    expect(run.mock.calls.length).toBeLessThanOrEqual(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getTranslationIssues([{ id: "1", title: texts[0], url: "https://example.com" }])).toContain("workers-ai:quota")
    await translateTextsToChinese(["New story during cooldown"], "other", { run })
    expect(run.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("retains originals for invalid responses and long posts without truncation", async () => {
    const { translateTextsToChinese } = await import("../server/utils/translate")
    const run = vi.fn(async () => ({ request_id: "async-is-not-a-translation" }))
    const texts = ["No translated output", "Long post ".repeat(150)]
    expect(await translateTextsToChinese(texts, "invalid", { run })).toEqual(texts.map(text => text.trim()))
    expect(run).toHaveBeenCalledOnce()
  })

  it("returns on timeout without starting more inferences", async () => {
    vi.useFakeTimers()
    const { translateTextsToChinese } = await import("../server/utils/translate")
    const run = vi.fn(() => new Promise(() => {}))
    const texts = ["Slow first", "Slow second", "Do not start third"]
    const result = translateTextsToChinese(texts, "timeout", { run })
    await vi.advanceTimersByTimeAsync(4001)
    expect(await result).toEqual(texts)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("defers collector translations to the output stage on Pages", async () => {
    const { translateNewsItemsToChinese, translateCollectedTextsToChinese } = await import("../server/utils/translate")
    vi.stubGlobal("caches", { default: { match: vi.fn(), put: vi.fn() } })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const item = { id: "raw", title: "Raw news headline", url: "https://example.com" }
    expect(await translateNewsItemsToChinese([item], "collector")).toEqual([item])
    expect(await translateCollectedTextsToChinese([item.title], "github")).toEqual([item.title])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
