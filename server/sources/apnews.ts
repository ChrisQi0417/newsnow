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

const indexQueries: Record<string, string> = {
  "https://apnews.com/": "when:7d",
  "https://apnews.com/world-news": "(world OR international OR diplomacy OR war) when:7d",
  "https://apnews.com/business": "(business OR economy OR markets OR finance) when:7d",
  "https://apnews.com/ap-fact-check": "\"fact check\" when:30d",
}

export function parseAPNewsIndex(raw: string): NewsItem[] {
  const document = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(raw)
  const entries = document?.rss?.channel?.item
  const seen = new Set<string>()
  return (Array.isArray(entries) ? entries : entries ? [entries] : []).flatMap((entry): NewsItem[] => {
    try {
      const publisher = new URL(entry.source?.url)
      const url = new URL(entry.link)
      const title = typeof entry.title === "string" ? entry.title.replace(/\s+-\s+AP News$/, "").trim() : ""
      const pubDate = Date.parse(entry.pubDate)
      if (publisher.protocol !== "https:" || publisher.hostname !== "apnews.com"
        || url.protocol !== "https:" || url.hostname !== "news.google.com" || !url.pathname.startsWith("/rss/articles/")
        || !title || !Number.isFinite(pubDate) || seen.has(url.href)) {
        return []
      }
      seen.add(url.href)
      return [{ id: url.href, title, url: url.href, pubDate, extra: { info: "美联社 · Google News 索引" } }]
    } catch {
      return []
    }
  }).sort((a, b) => Number(b.pubDate) - Number(a.pubDate)).slice(0, 30)
}

export function parseAPNewsRelay(data: any, feedUrl: string): NewsItem[] {
  if (data?.status !== "ok" || !Array.isArray(data.items)) return []
  try {
    const expected = new URL(feedUrl)
    const actual = new URL(data.feed?.url)
    if (actual.origin !== expected.origin || actual.pathname !== expected.pathname
      || [...expected.searchParams].some(([key, value]) => actual.searchParams.get(key) !== value)) {
      return []
    }
  } catch {
    return []
  }
  const seen = new Set<string>()
  return data.items.flatMap((item: any): NewsItem[] => {
    try {
      const url = new URL(item.link)
      if (typeof item.title !== "string" || !item.title.endsWith(" - AP News")
        || url.protocol !== "https:" || url.hostname !== "news.google.com" || !url.pathname.startsWith("/rss/articles/")) {
        return []
      }
      const pubDate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(item.pubDate)
        ? Date.parse(`${item.pubDate.replace(" ", "T")}Z`)
        : Number.NaN
      const title = item.title.replace(/ - AP News$/, "").trim()
      if (!title || !Number.isFinite(pubDate) || seen.has(url.href)) return []
      seen.add(url.href)
      return [{ id: url.href, title, url: url.href, pubDate, extra: {
        info: "美联社 · Google News 索引（备用）",
        hover: "Google News 索引经 RSS2JSON 转换；按主题检索，非官网栏目排序。",
      } }]
    } catch {
      return []
    }
  }).sort((a: NewsItem, b: NewsItem) => Number(b.pubDate) - Number(a.pubDate)).slice(0, 30)
}

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
      myFetch<string>(url, { responseType: "text", timeout: 8000, retry: 0 }),
      myFetch<string>(newsSitemapUrl, { responseType: "text", timeout: 8000, retry: 0 }),
    ])
    const html = pageResult.status === "fulfilled" ? pageResult.value : ""
    const sitemap = sitemapResult.status === "fulfilled" ? sitemapResult.value : ""
    const sitemapItems = sitemap ? parseAPNewsSitemap(sitemap) : []
    const metadata = new Map(sitemapItems.map(item => [item.url, item]))
    const pageItems = html ? parseAPNewsPage(html, url) : []
    // A general sitemap must not replace a specific editorial section.
    let items = (pageItems.length ? pageItems : url === routes["apnews-top"] ? sitemapItems.slice(0, 30) : []).map((item) => {
      const official = metadata.get(item.url)
      return official ? { ...item, title: official.title, pubDate: official.pubDate } : item
    })

    if (!items.length) {
      const feed = new URL("https://news.google.com/rss/search")
      feed.searchParams.set("q", `site:apnews.com/article ${indexQueries[url]}`)
      feed.searchParams.set("hl", "en-US")
      feed.searchParams.set("gl", "US")
      feed.searchParams.set("ceid", "US:en")
      const feedUrl = feed.href.replace(/\+/g, "%20")
      try {
        items = parseAPNewsIndex(await myFetch<string>(feedUrl, { responseType: "text", timeout: 4500, retry: 0 }))
      } catch {
        // The public index can return 503 from some Cloudflare regions.
      }
      if (!items.length) {
        const relay = await myFetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`, { timeout: 6000, retry: 0 })
        items = parseAPNewsRelay(relay, feedUrl)
      }
    }
    if (!items.length) throw new Error("Cannot fetch AP News page or publisher index")
    return translateNewsItemsToChinese(items.slice(0, 30), `apnews:${url}`)
  })
}

export default defineSource(Object.fromEntries(
  Object.entries(routes).map(([id, url]) => [id, defineAPNewsSource(url)]),
))
