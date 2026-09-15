import { afterEach, describe, expect, it, vi } from "vitest"
import { translateTextsToChinese } from "../server/utils/translate"

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

  it("runs cold translation batches with a maximum concurrency of three", async () => {
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
    expect(maxActive).toBe(3)
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
})
