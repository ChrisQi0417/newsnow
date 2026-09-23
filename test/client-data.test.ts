import { beforeEach, describe, expect, it } from "vitest"
import { completeSourceRefresh, failSourceRefresh, refetchSources, requestSourceRefresh, resetSourceRefreshState, scheduleSourceAutoRefresh, sourceNeedsRefresh, sourceRefreshInterval, withSourceRequestLimit } from "../src/utils/data"

beforeEach(() => {
  resetSourceRefreshState()
})

describe("automatic source refresh", () => {
  it("throttles consecutive manual refreshes after the previous one completes", () => {
    expect(requestSourceRefresh("weather", 1000)).toBe(true)
    completeSourceRefresh("weather", 1200)
    expect(requestSourceRefresh("weather", 2000)).toBe(false)
    expect(requestSourceRefresh("weather", 61_000)).toBe(true)
  })
  it("schedules stale sources without forcing an upstream refresh", () => {
    expect(scheduleSourceAutoRefresh("weather", 1000)).toBe(true)
    expect(refetchSources.has("weather")).toBe(false)
  })

  it("respects the configured refresh cadence", () => {
    const interval = sourceRefreshInterval("weather")
    expect(scheduleSourceAutoRefresh("weather", 1000)).toBe(true)
    completeSourceRefresh("weather", 1000)

    expect(scheduleSourceAutoRefresh("weather", interval + 999)).toBe(false)
    expect(refetchSources.has("weather")).toBe(false)
    expect(scheduleSourceAutoRefresh("weather", interval + 1000)).toBe(true)
    expect(refetchSources.has("weather")).toBe(false)
  })

  it("does not duplicate a refresh that is still queued", () => {
    expect(requestSourceRefresh("weather", 1000)).toBe(true)
    expect(scheduleSourceAutoRefresh("weather", 120_000)).toBe(false)
    expect(requestSourceRefresh("weather", 120_000)).toBe(false)
    completeSourceRefresh("weather", 120_000)
    expect(scheduleSourceAutoRefresh("weather", sourceRefreshInterval("weather") + 120_000)).toBe(true)
  })

  it("allows a failed refresh to retry after the cooldown", () => {
    expect(requestSourceRefresh("weather", 1000)).toBe(true)
    failSourceRefresh("weather")

    expect(scheduleSourceAutoRefresh("weather", sourceRefreshInterval("weather") + 1000)).toBe(true)
  })

  it("keeps other queued refreshes when a manual refresh is requested", () => {
    scheduleSourceAutoRefresh("weather", 1000)
    expect(requestSourceRefresh("markets", 1000)).toBe(true)

    expect(refetchSources).toEqual(new Set(["markets"]))
    expect(scheduleSourceAutoRefresh("markets", 2000)).toBe(false)
  })

  it("checks freshness against each source's effective interval", () => {
    const interval = sourceRefreshInterval("weather")
    expect(sourceNeedsRefresh("weather", 10_000, 10_000 + interval - 1)).toBe(false)
    expect(sourceNeedsRefresh("weather", 10_000, 10_000 + interval)).toBe(true)
    expect(sourceNeedsRefresh("weather", undefined)).toBe(true)
  })
})

describe("source request limiter", () => {
  it("allows at most one source request at once", async () => {
    let active = 0
    let maxActive = 0
    const results = await Promise.all(Array.from({ length: 2 }, (_, index) => withSourceRequestLimit(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 15))
      active -= 1
      return index
    })))

    expect(results).toEqual([0, 1])
    expect(maxActive).toBe(1)
  })
})
