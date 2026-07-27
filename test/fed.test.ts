import { describe, expect, it } from "vitest"
import { curateFedNews, parseFedReferenceRates } from "../server/sources/fed"

describe("federal reserve data", () => {
  it("formats the target range, EFFR, and SOFR from New York Fed data", () => {
    const items = parseFedReferenceRates({
      refRates: [
        {
          effectiveDate: "2026-07-23",
          type: "EFFR",
          percentRate: 3.63,
          targetRateFrom: 3.5,
          targetRateTo: 3.75,
          volumeInBillions: 104,
        },
        {
          effectiveDate: "2026-07-23",
          type: "SOFR",
          percentRate: 3.64,
          volumeInBillions: 2971,
        },
      ],
    })

    expect(items.map(item => item.title)).toEqual([
      "联邦基金目标区间 3.50%-3.75%",
      "有效联邦基金利率（EFFR）3.63%",
      "担保隔夜融资利率（SOFR）3.64%",
    ])
    expect(items[0].pubDate).toBe("2026-07-23T12:00:00")
    expect(items[1].extra?.hover).toContain("交易量：1,040 亿美元")
    expect(items[2].extra?.hover).toContain("交易量：2.971 万亿美元")
    expect(items[2].extra?.hover).toContain("数据源：纽约联储")
  })

  it("drops missing values rather than showing a false zero", () => {
    const items = parseFedReferenceRates({
      refRates: [{
        effectiveDate: "2026-07-23",
        type: "EFFR",
      }],
    })

    expect(items).toEqual([])
  })

  it("sorts official news and removes duplicate URLs", () => {
    const items = curateFedNews([
      { id: 1, title: "Old", url: "https://federalreserve.gov/old", pubDate: 1 },
      { id: 2, title: "New", url: "https://federalreserve.gov/new", pubDate: 3 },
      { id: 3, title: "Duplicate", url: "https://federalreserve.gov/new", pubDate: 2 },
    ])

    expect(items.map(item => item.id)).toEqual([2, 1])
  })
})
