import { load } from "cheerio"
import { XMLParser } from "fast-xml-parser"
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

interface ApplePodcastFeedItem {
  description?: string | { $text?: string }
  guid?: string | { $text?: string }
  link?: string
  pubDate?: string
  title?: string | { $text?: string }
}

interface ApplePodcastFeed {
  includeEditorialStories?: boolean
  showName: string
  url: string
}

const officialPageUrl = "https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585"
const podcastFeeds: ApplePodcastFeed[] = [
  {
    showName: "Apple News Today",
    url: "https://apple.news/podcast/apple_news_today",
    includeEditorialStories: true,
  },
  {
    showName: "Apple News In Conversation",
    url: "https://apple.news/podcast/apple_news_in_conversation",
  },
]
const browserHeaders = {
  "Accept": "application/rss+xml,application/xml;q=0.9,text/html;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function readText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return normalizeText(String(value))
  if (value && typeof value === "object" && "$text" in value) {
    const text = (value as { $text?: unknown }).$text
    return typeof text === "string" || typeof text === "number" ? normalizeText(String(text)) : ""
  }
  return ""
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

function normalizeAppleNewsUrl(value?: string) {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.hostname !== "apple.news" || !/^\/A[\w-]+$/.test(url.pathname)) return
    url.search = ""
    url.hash = ""
    return url.href
  } catch {
  }
}

function podcastEpisodeItem(item: ApplePodcastFeedItem, showName: string): NewsItem | undefined {
  const title = readText(item.title)
  const url = normalizeAppleNewsUrl(item.link)
  if (!title || title.length < 5 || !url) return
  return {
    id: `podcast:${readText(item.guid) || url}`,
    title,
    url,
    pubDate: toTimestamp(item.pubDate),
    extra: {
      info: `Apple Podcasts · ${showName}`,
      hover: `来源：Apple News 官方 Podcast\n节目：${showName}`,
    },
  }
}

function editorialStoryItems(item: ApplePodcastFeedItem): NewsItem[] {
  const description = readText(item.description)
  if (!description) return []
  const $ = load(description)
  const pubDate = toTimestamp(item.pubDate)
  const stories: NewsItem[] = []

  $("p").each((_, element) => {
    const paragraph = $(element)
    const links = paragraph.find("a").toArray().flatMap((anchor) => {
      const source = normalizeText($(anchor).text())
      const url = normalizeAppleNewsUrl($(anchor).attr("href"))
      return source && url ? [{ source, url }] : []
    })
    if (links.length !== 1) return

    const { source, url } = links[0]
    const paragraphText = normalizeText(paragraph.text())
    const sourceIndex = paragraphText.indexOf(source)
    const title = normalizeText(paragraphText.slice(0, sourceIndex).replace(/\bThe\s*$/i, "")).replace(/[.:,;\s]+$/, "")
    if (sourceIndex < 20 || title.length < 20) return

    stories.push({
      id: url,
      title,
      url,
      pubDate,
      extra: {
        info: `Apple News 美区精选 · ${source}`,
        hover: `来源：Apple News 美区编辑精选\n原媒体：${source}`,
      },
    })
  })

  return stories
}

export function curateAppleNewsItems(items: NewsItem[], limit = 50) {
  const seen = new Set<string>()
  return items
    .filter(item => item.url && String(item.title).length >= 5)
    .sort((a, b) => Number(b.pubDate ?? 0) - Number(a.pubDate ?? 0))
    .filter((item) => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .slice(0, limit)
}

export function parseAppleNewsPodcastFeed(raw: string, feed: ApplePodcastFeed, limit = 50) {
  const parser = new XMLParser({
    attributeNamePrefix: "",
    textNodeName: "$text",
    ignoreAttributes: false,
  })
  const channel = parser.parse(raw)?.rss?.channel
  const feedItems = channel?.item
    ? (Array.isArray(channel.item) ? channel.item : [channel.item]) as ApplePodcastFeedItem[]
    : []

  return curateAppleNewsItems(feedItems.flatMap((item) => {
    const episode = podcastEpisodeItem(item, feed.showName)
    const stories = feed.includeEditorialStories ? editorialStoryItems(item) : []
    return [...(episode ? [episode] : []), ...stories]
  }), limit)
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
  const results = await Promise.allSettled(podcastFeeds.map(async (feed) => {
    const raw = await myFetch<string>(feed.url, {
      responseType: "text",
      headers: browserHeaders,
      retry: 1,
      timeout: 10000,
    })
    return parseAppleNewsPodcastFeed(raw, feed)
  }))
  let items = curateAppleNewsItems(results.flatMap(result => result.status === "fulfilled" ? result.value : []))

  if (!items.length) {
    const html = await myFetch<string>(officialPageUrl, {
      responseType: "text",
      headers: browserHeaders,
      retry: 1,
      timeout: 8000,
    })
    items = parseAppleNewsTodayPage(html)
  }
  if (!items.length) throw new Error("Cannot fetch Apple News Today episodes")

  const translated = await translateNewsItemsToChinese(items)
  return translated.map((item, index) => ({
    ...item,
    title: restoreAppleNewsProperNames(String(items[index].title), String(item.title)),
  }))
})
