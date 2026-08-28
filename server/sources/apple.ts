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

const htmlEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "...",
  ldquo: "\u201C",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  nbsp: " ",
  ndash: "\u2013",
  quot: "\"",
  rdquo: "\u201D",
  rsquo: "\u2019",
}

function decodeHtmlText(value: string) {
  return normalizeText(value
    .replace(/<br\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
      if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
      return htmlEntities[code.toLowerCase()] ?? entity
    }))
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

function appleNewsLinks(html: string) {
  const lowerHtml = html.toLowerCase()
  const hrefRegExp = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/i
  const links: { source: string, url: string }[] = []
  let cursor = 0

  while (cursor < html.length) {
    const start = lowerHtml.indexOf("<a", cursor)
    if (start < 0) break
    if (!/\s/.test(html[start + 2] ?? "")) {
      cursor = start + 2
      continue
    }

    const openEnd = lowerHtml.indexOf(">", start + 3)
    const closeStart = openEnd >= 0 ? lowerHtml.indexOf("</a>", openEnd + 1) : -1
    if (openEnd < 0 || closeStart < 0) break

    const href = hrefRegExp.exec(html.slice(start + 2, openEnd))
    const source = decodeHtmlText(html.slice(openEnd + 1, closeStart))
    const url = normalizeAppleNewsUrl(href?.[1] || href?.[2])
    if (source && url) links.push({ source, url })
    cursor = closeStart + 4
  }

  return links
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
  const pubDate = toTimestamp(item.pubDate)
  const stories: NewsItem[] = []
  const paragraphRegExp = /<p\b[^>]*>([\s\S]*?)<\/p>/gi

  for (const paragraphMatch of description.matchAll(paragraphRegExp)) {
    const paragraph = paragraphMatch[1]
    const links = appleNewsLinks(paragraph)
    if (links.length !== 1) continue

    const { source, url } = links[0]
    const paragraphText = decodeHtmlText(paragraph)
    const sourceIndex = paragraphText.indexOf(source)
    const title = normalizeText(paragraphText.slice(0, sourceIndex).replace(/\bThe\s*$/i, "")).replace(/[.:,;\s]+$/, "")
    if (sourceIndex < 20 || title.length < 20) continue

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
  }

  return stories
}

export function curateAppleNewsItems(items: NewsItem[], limit = 30) {
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

export function parseAppleNewsPodcastFeed(raw: string, feed: ApplePodcastFeed, limit = 30) {
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
  const series: AppleNewsTodaySeries[] = []
  const scriptRegExp = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi

  for (const script of html.matchAll(scriptRegExp)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue
    try {
      series.push(...jsonLdObjects(JSON.parse(script[2])))
    } catch {
    }
  }

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

  const translated = await translateNewsItemsToChinese(items, "apple")
  return translated.map((item, index) => ({
    ...item,
    title: restoreAppleNewsProperNames(String(items[index].title), String(item.title)),
  }))
})
