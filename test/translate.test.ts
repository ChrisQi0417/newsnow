import { afterEach, describe, expect, it, vi } from "vitest"
import { translateNewsItemsForOutput, translateTextsToChinese } from "../server/utils/translate"

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

  it("runs cold translation batches with a maximum concurrency of two", async () => {
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
    expect(maxActive).toBe(2)
    expect(translated.every(title => title.startsWith("中文："))).toBe(true)
    expect(runtimeCache.match).toHaveBeenCalledOnce()
    expect(runtimeCache.put).toHaveBeenCalledOnce()
  })

  it("reassembles Google segments that split one title at punctuation", async () => {
    const first = "Could AI really kill us all? Why tech CEOs want to slow down."
    const second = "Fifteen colleges now charge more than $100,000 a year in tuition."
    const runtimeCache = {
      delete: vi.fn(),
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([[
      ["人工智能真的会杀死我们所有人吗？", "Could AI really kill us all? "],
      ["为什么科技公司的首席执行官想要放慢脚步。", "Why tech CEOs want to slow down."],
      ["每年学费超过十万美元的大学已有十五所。", second],
    ]])))
    vi.stubGlobal("caches", { default: runtimeCache })
    vi.stubGlobal("fetch", fetchMock)

    await expect(translateTextsToChinese([first, second], "test-segmented-google")).resolves.toEqual([
      "人工智能真的会杀死我们所有人吗？为什么科技公司的首席执行官想要放慢脚步。",
      "每年学费超过十万美元的大学已有十五所。",
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("accepts a Google response that keeps a whole newline-delimited batch in one segment", async () => {
    const first = "NATO jets down drone in Lithuanian airspace after bloc warns strikes will drive support for Ukraine"
    const second = "Fuel shortage in Yemen hampers migrants fleeing conflict and seeking safety in Djibouti"
    const third = "Thailand and Cambodia begin UN conciliation process over disputed maritime claims"
    const sourceTitles = [first, second, third]
    const translations = [
      "北约战机在立陶宛领空击落无人机，此前北约警告称袭击将推动对乌克兰的支持",
      "也门燃料短缺阻碍移民逃离冲突并前往吉布提寻求安全",
      "泰国和柬埔寨就争议海事主张启动联合国调解程序",
    ]
    const runtimeCache = {
      delete: vi.fn(),
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([[[
      translations.join("\n"),
      sourceTitles.join("\n"),
    ]]])))
    vi.stubGlobal("caches", { default: runtimeCache })
    vi.stubGlobal("fetch", fetchMock)

    await expect(translateTextsToChinese(sourceTitles, "test-newline-batch")).resolves.toEqual(translations)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("uses the bounded fallback when Google rate-limits the edge worker", async () => {
    const source = "Fallback provider title 2026"
    const runtimeCache = {
      delete: vi.fn(),
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    }
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.hostname === "translate.googleapis.com" || url.hostname === "translate.google.com") {
        return new Response("rate limited", { status: 429 })
      }
      return new Response(JSON.stringify({ responseData: { translatedText: "后备翻译标题" } }))
    })
    vi.stubGlobal("caches", { default: runtimeCache })
    vi.stubGlobal("fetch", fetchMock)

    await expect(translateTextsToChinese([source], "test-rate-limit-fallback")).resolves.toEqual(["后备翻译标题"])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("fails open and preserves news data when translation providers are unavailable", async () => {
    const item = {
      id: "stable-item",
      title: "Provider outage title 2026",
      url: "https://example.com/stable-item",
      pubDate: 1_757_000_000_000,
      extra: { hover: "source metadata" },
    }
    const runtimeCache = {
      delete: vi.fn(),
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    }
    const fetchMock = vi.fn(async () => {
      throw new Error("translation provider unavailable")
    })
    vi.stubGlobal("caches", { default: runtimeCache })
    vi.stubGlobal("fetch", fetchMock)

    await expect(translateNewsItemsForOutput([item], "test-output-fail-open")).resolves.toEqual([item])
  })
})
