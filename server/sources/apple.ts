import { load } from "cheerio"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

interface AppleNewsTodayEpisode {
  "@type"?: string | string[]
  "datePublished"?: string
  "name"?: string
  "url"?: string
}

interface AppleNewsTodaySeries {
  "@graph"?: unknown[]
  "@type"?: string | string[]
  "name"?: string
  "workExample"?: AppleNewsTodayEpisode | AppleNewsTodayEpisode[]
}

const officialPageUrl = "https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585"
const browserHeaders = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function includesType(value: AppleNewsTodaySeries["@type"], expected: string) {
  return (Array.isArray(value) ? value : [value]).includes(expected)
}

function toTimestamp(value?: string) {
  if (!value) return
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function normalizeEpisodeUrl(value?: string) {
  if (!value) return

  try {
    const url = new URL(value)
    const episodeId = url.searchParams.get("i")
    if (url.protocol !== "https:" || url.hostname !== "podcasts.apple.com") return
    if (!/^\/us\/podcast\/[^/]+\/id1473872585$/.test(url.pathname)) return
    if (!episodeId || !/^\d+$/.test(episodeId)) return
    url.search = ""
    url.searchParams.set("i", episodeId)
    url.hash = ""
    return url.href
  } catch {
  }
}

function jsonLdObjects(value: unknown): AppleNewsTodaySeries[] {
  const objects = Array.isArray(value) ? value : [value]
  return objects.flatMap((object) => {
    if (!object || typeof object !== "object") return []
    const series = object as AppleNewsTodaySeries
    return [series, ...(Array.isArray(series["@graph"]) ? jsonLdObjects(series["@graph"]) : [])]
  })
}

export function parseAppleNewsTodayPage(html: string, limit = 30) {
  const $ = load(html)
  const series: AppleNewsTodaySeries[] = []

  $("script[type='application/ld+json']").each((_, element) => {
    try {
      series.push(...jsonLdObjects(JSON.parse($(element).text())))
    } catch {
    }
  })

  const appleNewsToday = series.find(item =>
    item.name === "Apple News Today"
    && includesType(item["@type"], "CreativeWorkSeries")
    && item.workExample,
  )
  const episodes = appleNewsToday?.workExample
    ? (Array.isArray(appleNewsToday.workExample) ? appleNewsToday.workExample : [appleNewsToday.workExample])
    : []
  const seen = new Set<string>()

  return episodes
    .flatMap((episode): NewsItem[] => {
      const title = normalizeText(String(episode.name ?? ""))
      const url = normalizeEpisodeUrl(episode.url)
      const isEpisode = includesType(episode["@type"], "AudioObject")
        || includesType(episode["@type"], "PodcastEpisode")
      if (!title || title.length < 5 || !url || !isEpisode) return []
      return [{
        id: url,
        title,
        url,
        pubDate: toTimestamp(episode.datePublished),
        extra: {
          info: "Apple News Today",
          hover: "来源：Apple News 官方每日简报",
        },
      }]
    })
    .sort((a, b) => Number(b.pubDate ?? 0) - Number(a.pubDate ?? 0))
    .filter((item) => {
      const episodeId = new URL(item.url).searchParams.get("i") ?? item.url
      if (seen.has(episodeId)) return false
      seen.add(episodeId)
      return true
    })
    .slice(0, limit)
}

export function restoreAppleNewsProperNames(originalTitle: string, translatedTitle: string) {
  let restored = normalizeText(translatedTitle)
  if (/Apple News Today/i.test(originalTitle)) {
    restored = restored.replace(/(?:苹果|Apple)\s*(?:新闻|News)\s*(?:今日|今天|Today)?/gi, "Apple News Today")
  } else if (/Apple News/i.test(originalTitle)) {
    restored = restored.replace(/(?:苹果|Apple)\s*(?:新闻|News)/gi, "Apple News")
  }
  return restored
}

export default defineSource(async () => {
  const html = await myFetch<string>(officialPageUrl, {
    responseType: "text",
    headers: browserHeaders,
    retry: 1,
    timeout: 8000,
  })
  const items = parseAppleNewsTodayPage(html)
  if (!items.length) throw new Error("Cannot fetch Apple News Today episodes")

  const translated = await translateNewsItemsToChinese(items)
  return translated.map((item, index) => ({
    ...item,
    title: restoreAppleNewsProperNames(String(items[index].title), String(item.title)),
  }))
})
