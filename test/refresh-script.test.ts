import process from "node:process"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../shared/sources.json", () => ({ default: { twitter: {}, alias: { redirect: "twitter" } } }))

const originalExitCode = process.exitCode

beforeEach(() => {
  vi.resetModules()
  process.exitCode = undefined
  vi.stubEnv("JWT_TOKEN", "")
  vi.stubEnv("NEWSNOW_REFRESH_URL", "https://maintenance.invalid")
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  process.exitCode = originalExitCode
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("manual maintenance refresh", () => {
  it.each([
    { partial: true, accountStatus: undefined, message: "部分内容未完整返回" },
    { partial: false, accountStatus: [{ handle: "OpenAI", status: "unavailable" }], message: "受影响账号：OpenAI 官方" },
    { partial: undefined, accountStatus: [{ handle: "thsottiaux", status: "stale" }], message: "受影响账号：Tibo" },
  ])("fails partial collection without adding another request ($message)", async ({ partial, accountStatus, message }) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ title: "已采集新闻" }], partial, accountStatus })))
    vi.stubGlobal("fetch", fetch)

    await import("../scripts/refresh")

    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith("https://maintenance.invalid/api/s?id=twitter", expect.any(Object))
  })

  it("reports incomplete Chinese translation even when collection succeeds", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ title: "Untranslated headline" }],
      translationComplete: false,
    })))
    vi.stubGlobal("fetch", fetch)

    await import("../scripts/refresh")

    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("中文翻译未完成"))
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith("https://maintenance.invalid/api/s?id=twitter", expect.any(Object))
  })

  it.each([undefined, true])("accepts a complete cached response without forcing a refresh (translationComplete=%s)", async (translationComplete) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ title: "已采集新闻" }],
      partial: false,
      translationComplete,
      accountStatus: [{ handle: "OpenAI", status: "success" }, { handle: "thsottiaux", status: "success" }],
    })))
    vi.stubGlobal("fetch", fetch)

    await import("../scripts/refresh")

    expect(process.exitCode).toBeUndefined()
    expect(console.error).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith("已检查 1 个来源；0 个未完整成功。")
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith("https://maintenance.invalid/api/s?id=twitter", expect.any(Object))
  })
})
