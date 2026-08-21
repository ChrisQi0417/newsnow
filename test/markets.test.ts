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

  it("displays the dollar index and spot gold as live Chinese market items", () => {
    const quotes = parseTradingViewQuotes({
      data: [
        {
          s: "TVC:DXY",
          d: ["DXY", "U.S. Dollar Currency Index", 99.932, 0.1302579, 0.13, "USD", "streaming", "America/New_York", 1785772704],
        },
        {
          s: "OANDA:XAUUSD",
          d: ["XAUUSD", "Gold", 4037.27, -0.1951713, -7.895, "USD", "streaming", "America/New_York", 1785772694],
        },
      ],
    })
    const items = marketQuotesToNewsItems(quotes)

    expect(items.map(item => item.title)).toEqual([
      "外汇｜美元指数 99.93 ▲ +0.13%",
      "贵金属｜现货黄金 4,037.27 ▼ -0.20%",
    ])
    expect(items.map(item => item.url)).toEqual([
      "https://www.tradingview.com/symbols/TVC-DXY/",
      "https://www.tradingview.com/symbols/OANDA-XAUUSD/",
    ])
    expect(items.every(item => item.extra?.info.endsWith("· 实时"))).toBe(true)
  })

  it("keeps the requested market priority regardless of provider response order", () => {
    const symbols = [
      "KRX:KOSPI",
      "TVC:NI225",
      "SSE:000001",
      "SP:SPX",
      "OANDA:XAUUSD",
      "TVC:DXY",
      "BMFBOVESPA:IBOV",
    ]
    const quotes = parseTradingViewQuotes({
      data: symbols.map((symbol, index) => ({
        s: symbol,
        d: [symbol, symbol, 100 + index, 1, 1, null, "streaming", "UTC", 1785772704],
      })),
    })

    expect(marketQuotesToNewsItems(quotes).map(item => item.title.split(" ")[0])).toEqual([
      "外汇｜美元指数",
      "贵金属｜现货黄金",
      "美国｜标普500",
      "中国｜上证综指",
      "日本｜日经225",
      "韩国｜KOSPI",
      "巴西｜Bovespa",
    ])
  })

  it("shows ChiNext and STAR Market instead of CSI 300 in the China section", () => {
    const quotes = parseTradingViewQuotes({
      data: [
        { s: "SSE:000300", d: ["000300", "CSI 300", 4700, 1, 1, null, "streaming", "Asia/Shanghai", 1787295610] },
        { s: "SSE:000001", d: ["000001", "SSE Composite", 3900, 1, 1, null, "streaming", "Asia/Shanghai", 1787295610] },
        { s: "SZSE:399001", d: ["399001", "Shenzhen Component", 12000, 1, 1, null, "streaming", "Asia/Shanghai", 1787295610] },
        { s: "SZSE:399006", d: ["399006", "ChiNext Index", 3500, 1, 1, null, "streaming", "Asia/Shanghai", 1787295610] },
        { s: "SSE:000688", d: ["000688", "STAR 50", 1650, 1, 1, null, "streaming", "Asia/Shanghai", 1787295610] },
      ],
    })
    const chinaTitles = marketQuotesToNewsItems(quotes)
      .map(item => item.title.split(" ")[0])
      .filter(title => title.startsWith("中国｜"))

    expect(chinaTitles).toEqual([
      "中国｜上证综指",
      "中国｜深证成指",
      "中国｜创业板",
      "中国｜科创板",
    ])
    expect(chinaTitles).not.toContain("中国｜沪深300")
  })

  it("parses Tencent fallback quotes for ChiNext and STAR Market", () => {
    const quoteLine = (symbol: string, name: string, code: string, close: number, change: number, percent: number) => {
      const fields = Array.from<string>({ length: 33 }).fill("")
      fields[1] = name
      fields[2] = code
      fields[3] = String(close)
      fields[31] = String(change)
      fields[32] = String(percent)
      return `v_${symbol}="${fields.join("~")}";`
    }
    const raw = [
      quoteLine("sz399006", "创业板指", "399006", 3545.58, 49.99, 1.43),
      quoteLine("sh000688", "科创50", "000688", 1653.56, 0.59, 0.04),
    ].join("\n")
    const items = marketQuotesToNewsItems(parseTencentQuotes(raw))

    expect(items.map(item => item.title.split(" ")[0])).toEqual([
      "中国｜创业板",
      "中国｜科创板",
    ])
    expect(items.every((item) => {
      const info = item.extra?.info
      return typeof info === "string" && info.endsWith("· 备用行情")
    })).toBe(true)
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
