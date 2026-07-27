import type { NewsItem } from "@shared/types"
import { rss2json } from "../utils/rss2json"
import { translateNewsItemsToChinese } from "../utils/translate"

interface FedFeed {
  limit: number
  name: string
  url: string
}

export interface FedReferenceRate {
  effectiveDate: string
  percentRate?: number
  revisionIndicator?: string
  targetRateFrom?: number
  targetRateTo?: number
  type: string
  volumeInBillions?: number
}

export interface FedReferenceRateResponse {
  refRates?: FedReferenceRate[]
}

const feeds: FedFeed[] = [
  {
    name: "官方公告",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    limit: 12,
  },
  {
    name: "官员讲话",
    url: "https://www.federalreserve.gov/feeds/speeches.xml",
    limit: 8,
  },
  {
    name: "国会证词",
    url: "https://www.federalreserve.gov/feeds/testimony.xml",
    limit: 5,
  },
]

const rateUrls = {
  target: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm",
  effr: "https://www.newyorkfed.org/markets/reference-rates/effr",
  sofr: "https://www.newyorkfed.org/markets/reference-rates/sofr",
}

function asFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function toCalendarDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
  return `${date}T12:00:00`
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`
}

function formatVolume(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(3)} 万亿美元`
  return `${(value * 10).toLocaleString("zh-CN")} 亿美元`
}

function rateExtra(rate: FedReferenceRate, label: string) {
  const details = [
    `数据日期：${rate.effectiveDate}`,
    `数据源：纽约联储`,
  ]
  if (rate.volumeInBillions !== undefined) {
    details.push(`交易量：${formatVolume(rate.volumeInBillions)}`)
  }
  if (rate.revisionIndicator) details.push(`修订标记：${rate.revisionIndicator}`)

  return {
    info: label,
    hover: details.join("\n"),
  }
}

export function parseFedReferenceRates(response: FedReferenceRateResponse): NewsItem[] {
  const rates = response.refRates ?? []
  const effr = rates.find(rate => rate.type === "EFFR")
  const sofr = rates.find(rate => rate.type === "SOFR")
  const items: NewsItem[] = []

  const targetFrom = asFiniteNumber(effr?.targetRateFrom)
  const targetTo = asFiniteNumber(effr?.targetRateTo)
  if (effr && targetFrom !== undefined && targetTo !== undefined) {
    items.push({
      id: "fed-target-range",
      title: `联邦基金目标区间 ${formatPercent(targetFrom)}-${formatPercent(targetTo)}`,
      url: rateUrls.target,
      pubDate: toCalendarDate(effr.effectiveDate),
      extra: rateExtra(effr, "当前政策目标"),
    })
  }

  const effrRate = asFiniteNumber(effr?.percentRate)
  if (effr && effrRate !== undefined) {
    items.push({
      id: "fed-effr",
      title: `有效联邦基金利率（EFFR）${formatPercent(effrRate)}`,
      url: rateUrls.effr,
      pubDate: toCalendarDate(effr.effectiveDate),
      extra: rateExtra(effr, "纽约联储日度数据"),
    })
  }

  const sofrRate = asFiniteNumber(sofr?.percentRate)
  if (sofr && sofrRate !== undefined) {
    items.push({
      id: "fed-sofr",
      title: `担保隔夜融资利率（SOFR）${formatPercent(sofrRate)}`,
      url: rateUrls.sofr,
      pubDate: toCalendarDate(sofr.effectiveDate),
      extra: rateExtra(sofr, "纽约联储日度数据"),
    })
  }

  return items
}

export function curateFedNews(items: NewsItem[], limit = 27) {
  const seen = new Set<string>()
  return items
    .sort((a, b) => Number(b.pubDate ?? 0) - Number(a.pubDate ?? 0))
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .slice(0, limit)
}

async function fetchFeed(feed: FedFeed) {
  const data = await rss2json(feed.url)
  if (!data?.items.length) throw new Error(`Empty feed: ${feed.name}`)

  return data.items.slice(0, feed.limit).map<NewsItem>(item => ({
    id: item.link,
    title: item.title,
    url: item.link,
    pubDate: item.created,
    extra: {
      info: feed.name,
      hover: `来源：美国联邦储备委员会\n分类：${feed.name}`,
    },
  }))
}

export default defineSource(async () => {
  let rateItems: NewsItem[] = []
  try {
    const response = await myFetch<FedReferenceRateResponse>("https://markets.newyorkfed.org/api/rates/all/latest.json")
    rateItems = parseFedReferenceRates(response)
  } catch (error) {
    logger.warn("failed to fetch New York Fed reference rates", error)
  }

  const feedResults = await Promise.all(feeds.map(async (feed) => {
    try {
      return await fetchFeed(feed)
    } catch (error) {
      logger.warn(`failed to fetch Federal Reserve ${feed.name}`, error)
      return []
    }
  }))
  const news = curateFedNews(feedResults.flat())
  const translatedNews = await translateNewsItemsToChinese(news)
  const items = [...rateItems, ...translatedNews]
  if (!items.length) throw new Error("Cannot fetch Federal Reserve data")
  return items
})
