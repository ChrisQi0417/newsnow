import { XMLParser } from "fast-xml-parser"
import type { NewsItem } from "@shared/types"

interface ReutersSitemapUrl {
  loc?: string
  lastmod?: string
  "news:news"?: {
    "news:publication_date"?: string
    "news:title"?: string
  }
}

const newsSections = new Set([
  "business",
  "legal",
  "markets",
  "sustainability",
  "technology",
  "world",
])

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export default defineSource(async () => {
  const raw = await myFetch<string>("https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml", {
    responseType: "text",
  })
  const parser = new XMLParser({
    ignoreAttributes: false,
  })
  const urls = asArray<ReutersSitemapUrl>(parser.parse(raw)?.urlset?.url)
  const seen = new Set<string>()
  const news: NewsItem[] = []

  for (const item of urls) {
    const url = item.loc
    const title = item["news:news"]?.["news:title"]
    const pubDate = item["news:news"]?.["news:publication_date"] ?? item.lastmod
    if (!url || !title || !pubDate || seen.has(url)) continue

    const pathname = new URL(url).pathname
    const [, section] = pathname.split("/")
    if (!newsSections.has(section)) continue
    if (/^\/(?:ar|de|es|fr|it|ja|pt)\//.test(pathname)) continue
    if (/^(?:OFRTP Summary|PUNTO|REFILE)/i.test(title)) continue

    seen.add(url)
    news.push({
      id: url,
      title,
      url,
      pubDate: new Date(pubDate).getTime(),
    })
  }

  return news.sort((a, b) => Number(b.pubDate) - Number(a.pubDate)).slice(0, 50)
})
