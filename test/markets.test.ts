import { describe, expect, it, vi } from "vitest"
import { marketQuotesToNewsItems, parseTencentQuotes, parseTradingViewQuotes } from "../server/sources/markets"

describe("global market quotes", () => {
  it("maps TradingView values and quote delay into Chinese display items", () => {
    const quotes = parseTradingViewQuotes({
      data: [{
        s: "SP:SPX",
        d: ["SPX", "S&P 500", 7457.69, -1.00985, -76.08, null, "delayed_streaming_600", "America/New_York", 1784334000],
      }],
    })
    const [item] = marketQuotesToNewsItems(quotes)

    expect(item.title).toBe("美国｜标普500 7,457.69 ▼ -1.01%")
    expect(item.pubDate).toBe(1784334000000)
    expect(item.extra?.info).toBe("-76.08 · 延迟10分钟")
    expect(item.extra?.hover).toContain("数据源：TradingView")
  })

  it("parses the Tencent fallback without depending on its GBK market name", () => {
    vi.setSystemTime(new Date("2026-07-18T08:00:00Z"))
    const quotes = parseTencentQuotes("v_usINX=\"200~ignored~.INX~7457.69~7533.77~~~~~~~~~~~~~~~~~~~~~~~~~~2026-07-17 16:43:30~-76.08~-1.01~\";")
    const [item] = marketQuotesToNewsItems(quotes)

    expect(quotes).toHaveLength(1)
    expect(item.title).toBe("美国｜标普500 7,457.69 ▼ -1.01%")
    expect(item.extra?.info).toBe("-76.08 · 备用行情")
    expect(item.extra?.hover).toContain("数据源：腾讯行情")
    vi.useRealTimers()
  })

  it("drops incomplete quotes instead of displaying a zero price", () => {
    expect(parseTradingViewQuotes({
      data: [{
        s: "SP:SPX",
        d: ["SPX", "S&P 500", null, null, null, "USD", "streaming", "America/New_York", null],
      }],
    })).toEqual([])
  })
})
