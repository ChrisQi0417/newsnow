import { beforeEach, describe, expect, it } from "vitest"
import { completeSourceRefresh, failSourceRefresh, refetchSources, requestSourceRefresh, resetSourceRefreshState, scheduleSourceAutoRefresh, withSourceRequestLimit } from "../src/utils/data"

beforeEach(() => {
  resetSourceRefreshState()
})

describe("automatic source refresh", () => {
  it("forces a latest request when a source first appears", () => {
    expect(scheduleSourceAutoRefresh("weather", 1000)).toBe(true)
    expect(refetchSources.has("weather")).toBe(true)
  })

  it("deduplicates automatic refreshes for one minute", () => {
    expect(scheduleSourceAutoRefresh("weather", 1000)).toBe(true)
    completeSourceRefresh("weather", 1000)

    expect(scheduleSourceAutoRefresh("weather", 60_999)).toBe(false)
    expect(refetchSources.has("weather")).toBe(false)
    expect(scheduleSourceAutoRefresh("weather", 61_000)).toBe(true)
    expect(refetchSources.has("weather")).toBe(true)
  })

  it("does not duplicate a refresh that is still queued", () => {
    expect(scheduleSourceAutoRefresh("weather", 1000)).toBe(true)
    expect(scheduleSourceAutoRefresh("weather", 120_000)).toBe(false)

    completeSourceRefresh("weather", 120_000)
    expect(scheduleSourceAutoRefresh("weather", 179_999)).toBe(false)
    expect(scheduleSourceAutoRefresh("weather", 180_000)).toBe(true)
  })

  it("allows a failed refresh to retry after the cooldown", () => {
    expect(scheduleSourceAutoRefresh("weather", 1000)).toBe(true)
    failSourceRefresh("weather")

    expect(scheduleSourceAutoRefresh("weather", 61_000)).toBe(true)
  })

  it("keeps other queued refreshes when a manual refresh is requested", () => {
    scheduleSourceAutoRefresh("weather", 1000)
    requestSourceRefresh("markets", 1000)

    expect(refetchSources).toEqual(new Set(["weather", "markets"]))
    expect(scheduleSourceAutoRefresh("markets", 2000)).toBe(false)
  })
})

describe("source request limiter", () => {
  it("allows at most two source requests at once", async () => {
    let active = 0
    let maxActive = 0
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => withSourceRequestLimit(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 15))
      active -= 1
      return index
    })))

    expect(results).toEqual([0, 1, 2, 3, 4, 5])
    expect(maxActive).toBe(2)
  })
})
