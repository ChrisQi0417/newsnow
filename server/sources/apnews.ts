import { load } from "cheerio"
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

function timestampFromElement($: ReturnType<typeof load>, element: any) {
  const container = $(element).closest("[data-posted-date-timestamp]")
  const value = Number(container.attr("data-posted-date-timestamp"))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function parseAPNewsPage(html: string, url: string) {
  const $ = load(html)
  const itemIndexes = new Map<string, number>()
  const items: NewsItem[] = []

  const collect = (selector: string) => {
    $(selector).each((_, element) => {
      const href = $(element).attr("href")
      const title = $(element).text().replace(/\s+/g, " ").trim()
      if (!href || !title || title.length < 12) return

      const articleUrl = new URL(href, url).href
      if (new URL(articleUrl).hostname !== "apnews.com") return
      const existingIndex = itemIndexes.get(articleUrl)
      if (existingIndex !== undefined) {
        if (title.length > items[existingIndex].title.length) items[existingIndex].title = title
        return
      }
      itemIndexes.set(articleUrl, items.length)
      items.push({
        id: articleUrl,
        title,
        url: articleUrl,
        pubDate: timestampFromElement($, element),
      })
    })
  }

  collect("[data-posted-date-timestamp] a[href*='/article/']")
  if (!items.length) collect("a[href*='/article/']")
  return items.slice(0, 50)
}

function defineAPNewsSource(url: string) {
  return defineSource(async () => {
    const [html, sitemap] = await Promise.all([
      myFetch<string>(url, { responseType: "text" }),
      myFetch<string>(newsSitemapUrl, { responseType: "text" }),
    ])
    const sitemapItems = parseAPNewsSitemap(sitemap)
    const metadata = new Map(sitemapItems.map(item => [item.url, item]))
    const items = parseAPNewsPage(html, url).map((item) => {
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
