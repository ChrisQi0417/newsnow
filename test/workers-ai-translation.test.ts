import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("workers AI translation", () => {
  it("translates with the binding, keeps article identity and reuses translations", async () => {
    const { translateNewsItemsForOutput } = await import("../server/utils/translate")
    const run = vi.fn(async () => ({ choices: [{ message: { content: "{\"0\":\"央行维持利率不变\"}" } }] }))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const item = { id: "item", title: "Central bank holds rates steady", url: "https://example.com/news", pubDate: 123 }
    const result = await translateNewsItemsForOutput([item], "bbc-world", { run })
    expect(result[0]).toEqual({ ...item, title: "央行维持利率不变", extra: { hover: `原文：${item.title}` } })
    expect(await translateNewsItemsForOutput([item], "bbc-world", { run })).toEqual(result)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith("@cf/qwen/qwen3-30b-a3b-fp8", expect.objectContaining({
      messages: [expect.objectContaining({ role: "system" }), { role: "user", content: JSON.stringify({ 0: item.title }) }],
      response_format: expect.objectContaining({ type: "json_schema" }),
      temperature: 0,
    }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never translates GitHub repository identifiers", async () => {
    const { isChineseOutput, translateNewsItemsForOutput } = await import("../server/utils/translate")
    const run = vi.fn(async () => ({ response: { 0: "快速编程工具" } }))
    const result = await translateNewsItemsForOutput([{ id: "repo", title: "owner/repo-name：Fast coding tools", url: "https://github.com/owner/repo-name" }], "github", { run })
    expect(result[0].title).toBe("owner/repo-name：快速编程工具")
    expect(run.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({
      messages: [expect.any(Object), { role: "user", content: "{\"0\":\"Fast coding tools\"}" }],
    })])
    const bare = { id: "bare", title: "owner/bare-repo", url: "https://github.com/owner/bare-repo" }
    expect(await translateNewsItemsForOutput([bare], "github", { run })).toEqual([bare])
    expect(run).toHaveBeenCalledOnce()
    expect(isChineseOutput([bare])).toBe(true)
    expect(isChineseOutput([{ ...bare, title: "owner/bare-repo: English description" }])).toBe(false)
    expect(isChineseOutput([{ ...bare, url: "https://example.com/owner/bare-repo" }])).toBe(false)
  })

  it("bounds inference concurrency to two and total calls to six", async () => {
    const { translateTextsToChinese } = await import("../server/utils/translate")
    let active = 0
    let maximum = 0
    const run = vi.fn(async (_model: string, input: Record<string, any>) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active -= 1
      return { response: Object.fromEntries(Object.keys(JSON.parse(input.messages[1].content)).map(key => [key, "新闻标题"])) }
    })
    const texts = Array.from({ length: 80 }, (_, index) => `Headline number ${index}`)
    const result = await translateTextsToChinese(texts, "limits", { run })
    expect(run).toHaveBeenCalledTimes(6)
    expect(maximum).toBe(2)
    expect(result.slice(60)).toEqual(texts.slice(60))
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
    const texts = ["No translated output", "Long post ".repeat(500)]
    expect(await translateTextsToChinese(texts, "invalid", { run })).toEqual(texts.map(text => text.trim()))
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("returns on timeout without starting more inferences", async () => {
    vi.useFakeTimers()
    const { translateTextsToChinese } = await import("../server/utils/translate")
    const run = vi.fn(() => new Promise(() => {}))
    const texts = Array.from({ length: 30 }, (_, index) => `Slow story ${index}`)
    const result = translateTextsToChinese(texts, "timeout", { run })
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await result).toEqual(texts)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("uses exact keys rather than JSON property order and repairs only missing values", async () => {
    const { translateTextsToChinese } = await import("../server/utils/translate")
    const run = vi.fn(async () => ({ response: "{\"1\":\"第二篇新闻\",\"0\":\"第一篇新闻\"}" }))
    expect(await translateTextsToChinese(["First headline", "Second headline"], "ordered", { run })).toEqual(["第一篇新闻", "第二篇新闻"])
    const incomplete = vi.fn()
      .mockResolvedValueOnce({ response: { 1: "第四篇新闻" } })
      .mockResolvedValueOnce({ response: { 0: "第三篇新闻" } })
    const texts = ["Third headline", "Fourth headline"]
    expect(await translateTextsToChinese(texts, "incomplete", { run: incomplete })).toEqual(["第三篇新闻", "第四篇新闻"])
    expect(incomplete.mock.calls[1][1].messages[1].content).toBe(JSON.stringify({ 0: texts[0] }))
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
