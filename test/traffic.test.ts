import { describe, expect, it } from "vitest"
import { TrafficBudget } from "../server/utils/traffic"

describe("outbound traffic budget", () => {
  it("caps each hostname and resets after a minute", () => {
    const budget = new TrafficBudget()
    for (let i = 0; i < 12; i++) budget.take("https://example.com/news", 1000)
    expect(() => budget.take("https://example.com/other", 1000)).toThrow("budget")
    expect(() => budget.take("https://example.com/news", 61000)).not.toThrow()
  })
  it("caps total calls even across different hosts", () => {
    const budget = new TrafficBudget()
    for (let i = 0; i < 60; i++) budget.take(`https://host${i}.example.com`, 1000)
    expect(() => budget.take("https://another.example.com", 1000)).toThrow("budget")
  })
  it("honors the longer Retry-After and prevents retries during cooldown", () => {
    const budget = new TrafficBudget()
    budget.fail("https://example.com", 1000, 3600000)
    expect(() => budget.take("https://example.com", 901000)).toThrow("cooldown")
    expect(() => budget.take("https://example.com", 3601000)).not.toThrow()
  })
})
