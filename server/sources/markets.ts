import type { NewsItem } from "@shared/types"

interface MarketConfig {
  currency: string
  fallbackSymbol?: string
  name: string
  region: string
  symbol: string
  timezone: string
}

export interface MarketQuote {
  change: number
  changePercent: number
  close: number
  currency: string
  provider: "TradingView" | "腾讯行情"
  quoteStatus: string
  symbol: string
  updatedAt: number
}

interface TradingViewResponse {
  data?: {
    d: (number | string | null)[]
    s: string
  }[]
}

const marketConfigs: MarketConfig[] = [
  { symbol: "SSE:000001", fallbackSymbol: "sh000001", region: "中国", name: "上证综指", currency: "CNY", timezone: "Asia/Shanghai" },
  { symbol: "SSE:000300", region: "中国", name: "沪深300", currency: "CNY", timezone: "Asia/Shanghai" },
  { symbol: "SZSE:399001", region: "中国", name: "深证成指", currency: "CNY", timezone: "Asia/Shanghai" },
  { symbol: "TVC:HSI", fallbackSymbol: "hkHSI", region: "香港", name: "恒生指数", currency: "HKD", timezone: "Asia/Hong_Kong" },
  { symbol: "TVC:NI225", region: "日本", name: "日经225", currency: "JPY", timezone: "Asia/Tokyo" },
  { symbol: "KRX:KOSPI", region: "韩国", name: "KOSPI", currency: "KRW", timezone: "Asia/Seoul" },
  { symbol: "BSE:SENSEX", region: "印度", name: "SENSEX", currency: "INR", timezone: "Asia/Kolkata" },
  { symbol: "ASX:XJO", region: "澳大利亚", name: "标普/澳证200", currency: "AUD", timezone: "Australia/Sydney" },
  { symbol: "TVC:UKX", fallbackSymbol: "ukUKX", region: "英国", name: "富时100", currency: "GBP", timezone: "Europe/London" },
  { symbol: "XETR:DAX", region: "德国", name: "DAX", currency: "EUR", timezone: "Europe/Berlin" },
  { symbol: "EURONEXT:PX1", region: "法国", name: "CAC 40", currency: "EUR", timezone: "Europe/Paris" },
  { symbol: "SP:SPX", fallbackSymbol: "usINX", region: "美国", name: "标普500", currency: "USD", timezone: "America/New_York" },
  { symbol: "TVC:DJI", fallbackSymbol: "usDJI", region: "美国", name: "道琼斯", currency: "USD", timezone: "America/New_York" },
  { symbol: "NASDAQ:IXIC", fallbackSymbol: "usIXIC", region: "美国", name: "纳斯达克综合", currency: "USD", timezone: "America/New_York" },
  { symbol: "BMFBOVESPA:IBOV", region: "巴西", name: "Bovespa", currency: "BRL", timezone: "America/Sao_Paulo" },
]

const tradingViewColumns = [
  "name",
  "description",
  "close",
  "change",
  "change_abs",
  "currency",
  "update_mode",
  "timezone",
  "last_bar_update_time",
]

function asFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function quoteStatus(updateMode: unknown) {
  if (updateMode === "streaming") return "实时"
  if (updateMode === "endofday") return "收盘行情"

  const delaySeconds = typeof updateMode === "string"
    ? Number(updateMode.match(/delayed_streaming_(\d+)/)?.[1])
    : 0
  if (delaySeconds) return `延迟${Math.round(delaySeconds / 60)}分钟`
  if (typeof updateMode === "string" && updateMode.includes("delayed")) return "延迟行情"
  return "行情"
}

export function parseTradingViewQuotes(response: TradingViewResponse): MarketQuote[] {
  const configBySymbol = new Map(marketConfigs.map(config => [config.symbol, config]))

  return (response.data ?? []).flatMap((row) => {
    const config = configBySymbol.get(row.s)
    const close = asFiniteNumber(row.d[2])
    const changePercent = asFiniteNumber(row.d[3])
    const change = asFiniteNumber(row.d[4])
    const updatedAt = asFiniteNumber(row.d[8])
    if (!config || close === undefined || changePercent === undefined || change === undefined) return []

    return [{
      symbol: config.symbol,
      close,
      change,
      changePercent,
      currency: typeof row.d[5] === "string" && row.d[5] ? row.d[5] : config.currency,
      quoteStatus: quoteStatus(row.d[6]),
      updatedAt: updatedAt ? updatedAt * 1000 : Date.now(),
      provider: "TradingView" as const,
    }]
  })
}

export function parseTencentQuotes(raw: string): MarketQuote[] {
  const configByFallbackSymbol = new Map(
    marketConfigs
      .filter(config => config.fallbackSymbol)
      .map(config => [config.fallbackSymbol!, config]),
  )
  const quotes: MarketQuote[] = []

  for (const match of raw.matchAll(/v_([^=]+)="([^"]*)";/g)) {
    const config = configByFallbackSymbol.get(match[1])
    const fields = match[2].split("~")
    const close = asFiniteNumber(fields[3])
    const change = asFiniteNumber(fields[31])
    const changePercent = asFiniteNumber(fields[32])
    if (!config || close === undefined || change === undefined || changePercent === undefined) continue

    quotes.push({
      symbol: config.symbol,
      close,
      change,
      changePercent,
      currency: config.currency,
      quoteStatus: "备用行情",
      updatedAt: Date.now(),
      provider: "腾讯行情",
    })
  }

  return quotes
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)
}

function formatSigned(value: number) {
  if (value > 0) return `+${formatNumber(value)}`
  return formatNumber(value)
}

function formatPercent(value: number) {
  if (value > 0) return `+${value.toFixed(2)}%`
  return `${value.toFixed(2)}%`
}

function marketUrl(symbol: string) {
  return `https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`
}

function formatMarketTime(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    hour12: false,
    timeStyle: "medium",
    timeZone: timezone,
  }).format(timestamp)
}

export function marketQuotesToNewsItems(quotes: MarketQuote[]): NewsItem[] {
  const quoteBySymbol = new Map(quotes.map(quote => [quote.symbol, quote]))

  return marketConfigs.flatMap((config) => {
    const quote = quoteBySymbol.get(config.symbol)
    if (!quote) return []

    const direction = quote.changePercent > 0 ? "▲" : quote.changePercent < 0 ? "▼" : "•"
    return [{
      id: `market-${quote.symbol}`,
      title: `${config.region}｜${config.name} ${formatNumber(quote.close)} ${direction} ${formatPercent(quote.changePercent)}`,
      url: marketUrl(quote.symbol),
      pubDate: quote.updatedAt,
      extra: {
        info: `${formatSigned(quote.change)} · ${quote.quoteStatus}`,
        hover: [
          `现价：${formatNumber(quote.close)} ${quote.currency}`,
          `涨跌：${formatSigned(quote.change)}（${formatPercent(quote.changePercent)}）`,
          `行情时间：${formatMarketTime(quote.updatedAt, config.timezone)}`,
          `数据源：${quote.provider}`,
        ].join("\n"),
      },
    }]
  })
}

function mergeQuotes(primary: MarketQuote[], fallback: MarketQuote[]) {
  const quoteBySymbol = new Map<string, MarketQuote>()
  primary.forEach(quote => quoteBySymbol.set(quote.symbol, quote))
  fallback.forEach((quote) => {
    if (!quoteBySymbol.has(quote.symbol)) quoteBySymbol.set(quote.symbol, quote)
  })
  return [...quoteBySymbol.values()]
}

async function fetchTradingViewQuotes() {
  const response = await myFetch<TradingViewResponse>("https://scanner.tradingview.com/global/scan", {
    method: "POST",
    body: {
      symbols: {
        tickers: marketConfigs.map(config => config.symbol),
        query: {
          types: [],
        },
      },
      columns: tradingViewColumns,
    },
  })
  return parseTradingViewQuotes(response)
}

async function fetchTencentQuotes() {
  const symbols = marketConfigs.flatMap(config => config.fallbackSymbol ? [config.fallbackSymbol] : [])
  const raw = await myFetch<string>(`https://qt.gtimg.cn/q=${symbols.join(",")}`, {
    responseType: "text",
  })
  return parseTencentQuotes(raw)
}

export default defineSource(async () => {
  let quotes: MarketQuote[] = []

  try {
    quotes = await fetchTradingViewQuotes()
  } catch (error) {
    logger.warn("failed to fetch TradingView global market quotes", error)
  }

  if (quotes.length < 10) {
    try {
      quotes = mergeQuotes(quotes, await fetchTencentQuotes())
    } catch (error) {
      logger.warn("failed to fetch Tencent fallback market quotes", error)
    }
  }

  const items = marketQuotesToNewsItems(quotes)
  if (!items.length) throw new Error("Cannot fetch global market quotes")
  return items
})
