import { XMLParser } from "fast-xml-parser"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

const newsSitemapIndex = "https://asia.nikkei.com/sitemap_news.xml"
const rssFallback = defineRSSSource("https://asia.nikkei.com/rss/feed/nar", {
  translate: true,
  limit: 50,
})

const xml = new XMLParser({
  attributeNamePrefix: "",
  textNodeName: "$text",
  ignoreAttributes: false,
})

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (value && typeof value === "object" && "$text" in value) return String((value as { $text: unknown }).$text).trim()
  return ""
}

export function discoverNikkeiNewsSitemaps(raw: string) {
  const data = xml.parse(raw)
  return asArray(data?.sitemapindex?.sitemap)
    .map((entry: any) => text(entry?.loc))
    .filter((value) => {
      try {
        const url = new URL(value)
        return url.protocol === "https:" && url.hostname === "asia.nikkei.com" && url.pathname === "/news_sitemap.xml"
      } catch {
        return false
      }
    })
    .slice(0, 3)
}

export function parseNikkeiNewsSitemap(raw: string): NewsItem[] {
  const data = xml.parse(raw)
  const seen = new Set<string>()

  return asArray(data?.urlset?.url).flatMap((entry: any) => {
    const news = entry?.["news:news"]
    const title = text(news?.["news:title"])
    const publishedAt = new Date(text(news?.["news:publication_date"])).getTime()
    const value = text(entry?.loc)
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return []
    }
    if (!title || !Number.isFinite(publishedAt) || url.protocol !== "https:" || url.hostname !== "asia.nikkei.com" || seen.has(url.href)) return []
    seen.add(url.href)
    return [{
      id: url.href,
      title,
      url: url.href,
      pubDate: publishedAt,
      extra: {
        info: "Nikkei Asia 官方",
      },
    }]
  }).sort((a, b) => Number(b.pubDate) - Number(a.pubDate))
}

export default defineSource(async (event) => {
  try {
    const index = await myFetch<string>(newsSitemapIndex, { responseType: "text" })
    const urls = discoverNikkeiNewsSitemaps(index)
    const results = await Promise.allSettled(urls.map(url => myFetch<string>(url, { responseType: "text" })))
    const items = results.flatMap(result => result.status === "fulfilled" ? parseNikkeiNewsSitemap(result.value) : [])
    const unique = [...new Map(items.map(item => [item.id, item])).values()]
      .sort((a, b) => Number(b.pubDate) - Number(a.pubDate))
      .slice(0, 50)
    if (unique.length) return translateNewsItemsToChinese(unique, "nikkei")
  } catch (error) {
    logger.warn("failed to fetch Nikkei news sitemaps", error)
  }

  return rssFallback(event)
})
