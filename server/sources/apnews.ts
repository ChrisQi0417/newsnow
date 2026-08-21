import { XMLParser } from "fast-xml-parser"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

const routes = {
  "apnews-top": "https://apnews.com/",
  "apnews-world": "https://apnews.com/world-news",
  "apnews-business": "https://apnews.com/business",
  "apnews-fact-check": "https://apnews.com/ap-fact-check",
}
const newsSitemapUrl = "https://apnews.com/news-sitemap-content.xml"

export function parseAPNewsSitemap(xml: string) {
  const parser = new XMLParser({
    attributeNamePrefix: "",
    ignoreAttributes: false,
  })
  const document = parser.parse(xml)
  const entries = document?.urlset?.url
  const urls = Array.isArray(entries) ? entries : entries ? [entries] : []

  return urls.flatMap((entry: any): NewsItem[] => {
    const url = typeof entry?.loc === "string" ? entry.loc.trim() : ""
    const title = typeof entry?.["news:news"]?.["news:title"] === "string"
      ? entry["news:news"]["news:title"].replace(/\s+/g, " ").trim()
      : ""
    const published = entry?.["news:news"]?.["news:publication_date"]
    const pubDate = typeof published === "string" ? Date.parse(published) : Number.NaN
    if (!url || !title || !Number.isFinite(pubDate)) return []

    let articleUrl: URL
    try {
      articleUrl = new URL(url)
    } catch {
      return []
    }
    if (articleUrl.hostname !== "apnews.com" || !articleUrl.pathname.startsWith("/article/")) return []
    return [{ id: articleUrl.href, title, url: articleUrl.href, pubDate }]
  })
}

function decodeAPText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

export function parseAPNewsPage(html: string, url: string) {
  const itemIndexes = new Map<string, number>()
  const items: NewsItem[] = []

  const timestampPattern = /data-posted-date-timestamp\s*=\s*["'](\d+)["']/gi
  const timestamps = [...html.matchAll(timestampPattern)]
  const fragments = timestamps.length
    ? timestamps.map((match, index) => ({
        html: html.slice((match.index ?? 0) + match[0].length, timestamps[index + 1]?.index ?? html.length),
        pubDate: Number(match[1]),
      }))
    : [{ html, pubDate: undefined }]
  const anchorPattern = /<a[^>]*href\s*=\s*["']([^"']*\/article\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

  for (const fragment of fragments) {
    anchorPattern.lastIndex = 0
    for (const match of fragment.html.matchAll(anchorPattern)) {
      const href = match[1]
      const title = decodeAPText(match[2]).replace(/\s+/g, " ").trim()
      if (!href || !title || title.length < 12) continue

      let articleUrl: URL
      try {
        articleUrl = new URL(href, url)
      } catch {
        continue
      }
      if (articleUrl.hostname !== "apnews.com") continue
      const normalizedUrl = articleUrl.href
      const existingIndex = itemIndexes.get(normalizedUrl)
      if (existingIndex !== undefined) {
        if (title.length > items[existingIndex].title.length) items[existingIndex].title = title
        continue
      }
      itemIndexes.set(normalizedUrl, items.length)
      items.push({
        id: normalizedUrl,
        title,
        url: normalizedUrl,
        pubDate: Number.isFinite(fragment.pubDate) && fragment.pubDate > 0 ? fragment.pubDate : undefined,
      })
    }
  }
  return items.slice(0, 50)
}

function defineAPNewsSource(url: string) {
  return defineSource(async () => {
    const [pageResult, sitemapResult] = await Promise.allSettled([
      myFetch<string>(url, { responseType: "text" }),
      myFetch<string>(newsSitemapUrl, { responseType: "text" }),
    ])
    const html = pageResult.status === "fulfilled" ? pageResult.value : ""
    const sitemap = sitemapResult.status === "fulfilled" ? sitemapResult.value : ""
    const sitemapItems = sitemap ? parseAPNewsSitemap(sitemap) : []
    const metadata = new Map(sitemapItems.map(item => [item.url, item]))
    const pageItems = html ? parseAPNewsPage(html, url) : []
    const items = (pageItems.length ? pageItems : sitemapItems.slice(0, 50)).map((item) => {
      const official = metadata.get(item.url)
      return official ? { ...item, title: official.title, pubDate: official.pubDate } : item
    })

    if (!items.length) throw new Error("Cannot fetch AP News page")
    return translateNewsItemsToChinese(items)
  })
}

export default defineSource(Object.fromEntries(
  Object.entries(routes).map(([id, url]) => [id, defineAPNewsSource(url)]),
))
