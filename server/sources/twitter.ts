import { load } from "cheerio"
import type { NewsItem } from "@shared/types"

interface TrendItem {
  detailUrl?: string
  rank: number
  trend: string
  url: string
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function twitterSearchUrl(trend: string) {
  return `https://twitter.com/search?q=${encodeURIComponent(trend)}&src=trend_click&vertical=trends`
}

function toNewsItems(trends: TrendItem[]) {
  const now = Date.now()
  return trends.map<NewsItem>(trend => ({
    id: `twitter-${trend.rank}-${trend.trend}`,
    title: `全球第 ${trend.rank}：${trend.trend}`,
    url: trend.url,
    pubDate: now,
    extra: {
      hover: [
        "Twitter/X 全球实时趋势",
        trend.detailUrl && `趋势详情：${trend.detailUrl}`,
      ].filter(Boolean).join("\n"),
      info: "Twitter/X 热度",
    },
  }))
}

async function fetchGetDayTrends() {
  const baseUrl = "https://getdaytrends.com/"
  const html = await myFetch<string>(baseUrl, {
    responseType: "text",
  })
  const $ = load(html)
  const seen = new Set<string>()
  const trends: TrendItem[] = []

  $("table.trends tbody tr").each((_, element) => {
    const rank = Number(normalize($(element).find("th.pos").first().text()))
    const link = $(element).find("td.main a").first()
    const trend = normalize(link.text())
    const detailHref = link.attr("href")
    if (!rank || !trend || seen.has(trend)) return

    seen.add(trend)
    trends.push({
      detailUrl: detailHref ? new URL(detailHref, baseUrl).href : undefined,
      rank,
      trend,
      url: twitterSearchUrl(trend),
    })
  })

  return trends.slice(0, 50)
}

async function fetchTrends24() {
  const html = await myFetch<string>("https://trends24.in/", {
    responseType: "text",
  })
  const $ = load(html)
  const seen = new Set<string>()
  const trends: TrendItem[] = []

  $(".trend-card__list li").each((_, element) => {
    const link = $(element).find("a.trend-link").first()
    const trend = normalize(link.text())
    const url = link.attr("href") || twitterSearchUrl(trend)
    if (!trend || seen.has(trend)) return

    seen.add(trend)
    trends.push({
      rank: trends.length + 1,
      trend,
      url,
    })
  })

  return trends.slice(0, 50)
}

export default defineSource(async () => {
  let trends: TrendItem[]
  try {
    trends = await fetchGetDayTrends()
  } catch (e) {
    logger.warn("failed to fetch GetDayTrends, using Trends24 fallback", e)
    trends = await fetchTrends24()
  }

  if (!trends.length) throw new Error("Cannot fetch Twitter/X trends")
  return toNewsItems(trends)
})
