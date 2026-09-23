import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("translation resource limits", () => {
  it("caps the total provider calls even when every response is unusable", async () => {
    const { translateTextsToChinese } = await import("../server/utils/translate")
    const fetchMock = vi.fn(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)
    const titles = Array.from({ length: 30 }, (_, index) => `Untranslated headline ${index} ${"word ".repeat(35)}`.trim())
    expect(await translateTextsToChinese(titles)).toEqual(titles)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(8)
  })

  it("cancels error bodies and stops the fallback when its quota is exhausted", async () => {
    const { translateTextsToChinese, getTranslationIssues } = await import("../server/utils/translate")
    const cancel = vi.fn()
    const fetchMock = vi.fn(async (input: string) => {
      if (new URL(input).hostname !== "api.mymemory.translated.net") {
        return new Response(new ReadableStream({ cancel }), { status: 429 })
      }
      return new Response(JSON.stringify({ responseStatus: 403, quotaFinished: true, responseData: { translatedText: "已用尽额度" } }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const titles = ["First quota headline", "Second quota headline"]
    expect(await translateTextsToChinese(titles)).toEqual(titles)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getTranslationIssues(titles.map((title, index) => ({ id: index, title, url: "https://example.com" })))).toEqual(expect.arrayContaining([
      "translate.googleapis.com:http-429",
      "api.mymemory.translated.net:quota-or-rejected",
    ]))
  })

  it("keeps the timeout active while reading a stalled response body", async () => {
    vi.useFakeTimers()
    const { translateTextsToChinese } = await import("../server/utils/translate")
    const aborted = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener("abort", () => {
          aborted()
          controller.error(new Error("body aborted"))
        })
      },
    }))))
    const result = translateTextsToChinese(["Stalled body headline"])
    await vi.advanceTimersByTimeAsync(12_001)
    expect(await result).toEqual(["Stalled body headline"])
    expect(aborted).toHaveBeenCalledTimes(3)
  })
})
