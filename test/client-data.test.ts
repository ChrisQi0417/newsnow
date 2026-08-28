import { describe, expect, it } from "vitest"
import { withSourceRequestLimit } from "../src/utils/data"

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
