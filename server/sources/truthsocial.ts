import { XMLParser } from "fast-xml-parser"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

interface TruthSocialRSSItem {
  "title"?: string
  "link"?: string
  "description"?: string
  "guid"?: string
  "pubDate"?: string
  "truth:originalUrl"?: string
  "truth:originalId"?: string
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function stripHTML(html = "") {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeTitle(title: unknown) {
  return String(title ?? "").replace(/\s+/g, " ").trim()
}

function cachedOriginalTitle(item: NewsItem) {
  const hover = typeof item.extra?.hover === "string" ? item.extra.hover : ""
  if (!hover.startsWith("原文：")) return ""
  return normalizeTitle(hover.slice(3).split("\n")[0])
}

export function parseTruthSocialFeed(raw: string): NewsItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
  })
  const items = asArray<TruthSocialRSSItem>(parser.parse(raw)?.rss?.channel?.item)
  return items.slice(0, 50).map((item) => {
    const originalTitle = item.title?.trim()
    const description = stripHTML(item.description)
    const isPlaceholder = !originalTitle || originalTitle.startsWith("[No Title]")
    const isLinkOnly = [description, originalTitle].some(value => /^(?:RT[:：]\s*)?https?:\/\//i.test(value ?? ""))
    const title = isLinkOnly
      ? "转发内容"
      : isPlaceholder
        ? description || "Truth Social 帖子"
        : originalTitle
    const originalUrl = item["truth:originalUrl"]
    const mirrorUrl = item.link

    return {
      id: item["truth:originalId"] ?? item.guid ?? originalUrl ?? mirrorUrl ?? title,
      title,
      url: originalUrl ?? mirrorUrl ?? "https://truthsocial.com/@realDonaldTrump",
      pubDate: item.pubDate,
      extra: {
        hover: mirrorUrl && originalUrl ? `镜像：${mirrorUrl}` : undefined,
      },
    }
  })
}

export function reuseCachedTruthSocialTranslations(freshItems: NewsItem[], cachedItems: NewsItem[]) {
  const cachedById = new Map(cachedItems.map(item => [String(item.id), item]))

  return freshItems.map((item) => {
    const cached = cachedById.get(String(item.id))
    const originalTitle = normalizeTitle(item.title)
    if (!cached || !/[\u3400-\u9FFF]/.test(String(cached.title ?? ""))) return item
    if (cachedOriginalTitle(cached) !== originalTitle) return item

    return {
      ...item,
      title: cached.title,
      extra: {
        ...item.extra,
        hover: item.extra?.hover ? `原文：${originalTitle}\n${item.extra.hover}` : `原文：${originalTitle}`,
      },
    }
  })
}

export default defineSource(async (event) => {
  const raw = await myFetch<string, "text">("https://trumpstruth.org/feed", {
    responseType: "text",
    retry: 1,
    timeout: 6000,
  })
  const freshItems = parseTruthSocialFeed(raw)
  const cachedItems = Array.isArray(event?.context.truthSocialCachedItems)
    ? event.context.truthSocialCachedItems as NewsItem[]
    : []
  const news = reuseCachedTruthSocialTranslations(freshItems, cachedItems)

  return translateNewsItemsToChinese(news)
})
