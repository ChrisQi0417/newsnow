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

export default defineSource(async () => {
  const raw = await myFetch<string>("https://trumpstruth.org/feed", {
    responseType: "text",
  })
  const parser = new XMLParser({
    ignoreAttributes: false,
  })
  const items = asArray<TruthSocialRSSItem>(parser.parse(raw)?.rss?.channel?.item)
  const news: NewsItem[] = items.slice(0, 50).map((item) => {
    const originalTitle = item.title?.trim()
    const description = stripHTML(item.description)
    const title = originalTitle && !originalTitle.startsWith("[No Title]") ? originalTitle : description || originalTitle || "Truth Social post"
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

  return translateNewsItemsToChinese(news)
})
