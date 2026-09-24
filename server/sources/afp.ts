import type { NewsItem } from "@shared/types"
import { XMLParser } from "fast-xml-parser"
import { translateNewsItemsToChinese } from "../utils/translate"
import { SourceUnavailableError, sourceFailure } from "../utils/source-failure"

const newsHubUrl = "https://www.afp.com/en/node/3753800"
const officialVideoFeed = defineRSSSource("https://www.youtube.com/feeds/videos.xml?channel_id=UC86dbj-lbDks_hZ5gRKL49Q", {
  translate: true,
  limit: 30,
})
const factCheckReaderUrl = "https://r.jina.ai/http://factcheck.afp.com/"
const factCheckIndexUrl = "https://news.google.com/rss/search?q=site%3Afactcheck.afp.com%20when%3A14d&hl=en-US&gl=US&ceid=US%3Aen"

export function parseAfpFactCheckIndex(raw: string): NewsItem[] {
  const entries = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(raw)?.rss?.channel?.item
  const seen = new Set<string>()
  return (Array.isArray(entries) ? entries : entries ? [entries] : []).flatMap((entry): NewsItem[] => {
    try {
      const publisher = new URL(entry.source?.url)
      const url = new URL(entry.link)
      const title = typeof entry.title === "string" ? entry.title.replace(/\s+-\s+AFP Fact Check$/, "").trim() : ""
      const pubDate = Date.parse(entry.pubDate)
      if (publisher.protocol !== "https:" || publisher.hostname !== "factcheck.afp.com"
        || url.protocol !== "https:" || url.hostname !== "news.google.com" || !url.pathname.startsWith("/rss/articles/")
        || !title || !Number.isFinite(pubDate) || seen.has(url.href)) {
        return []
      }
      seen.add(url.href)
      return [{ id: url.href, title, url: url.href, pubDate, extra: {
        info: "法新社事实核查 · Google News 索引",
        hover: "来源：AFP Fact Check 官方内容；按发布时间排序，非综合快讯。",
      } }]
    } catch {
      return []
    }
  }).sort((a, b) => Number(b.pubDate) - Number(a.pubDate)).slice(0, 30)
}

function stripAfpMarkup(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function readAfpSpan(fragment: string, className: string) {
  const match = new RegExp(`<span\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`, "i").exec(fragment)
  return match ? stripAfpMarkup(match[1]) : ""
}

export function parseAfpNewsHub(html: string): NewsItem[] {
  const items: NewsItem[] = []
  const seen = new Set<string>()

  const entryPattern = /<p[^>]*class=["'][^"']*\bafp_news_visibility\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi
  for (const match of html.matchAll(entryPattern)) {
    const fragment = match[1]
    const firstSpan = /<span[^>]*>([\s\S]*?)<\/span>/i.exec(fragment)
    const city = firstSpan ? stripAfpMarkup(firstSpan[1]) : ""
    const date = readAfpSpan(fragment, "date").replace(/^\s*\|\s*/, "").trim()
    const title = readAfpSpan(fragment, "title").replace(/^\s*\|\s*/, "").trim()
    if (!date || !title) continue

    const pubDate = tranformToUTC(date, "DD/MM/YYYY - HH:mm:ss", "UTC")
    const key = `${pubDate}:${title}`
    if (!Number.isFinite(pubDate) || seen.has(key)) continue
    seen.add(key)

    const url = `${newsHubUrl}?at=${pubDate}`
    items.push({
      id: key,
      title,
      url,
      pubDate,
      extra: {
        info: city || "AFP News Hub 官方",
        hover: city ? `来源：AFP News Hub 官方快讯\n发布地：${city}` : "来源：AFP News Hub 官方快讯",
      },
    })
  }

  return items.sort((a, b) => Number(b.pubDate) - Number(a.pubDate)).slice(0, 30)
}

export function parseAfpFactCheckReader(raw: string): NewsItem[] {
  const seen = new Set<string>()
  const items: NewsItem[] = []

  for (const line of raw.split(/\r?\n/)) {
    const published = /Published on (\d{2}\/\d{2}\/\d{4}) at (\d{2}:\d{2})/.exec(line)
    const heading3 = line.indexOf(" ### ")
    const heading2 = line.indexOf(" ## ")
    const heading = heading3 >= 0 ? heading3 : heading2
    const headingLength = heading3 >= 0 ? 5 : 4
    if (!published || heading < 0) continue

    const linkMarker = line.indexOf("](https://factcheck.afp.com/", heading + headingLength)
    if (linkMarker < 0) continue
    const linkStart = linkMarker + 2
    const quotedTitle = line.indexOf(" \"", linkStart)
    const closingParenthesis = line.indexOf(")", linkStart)
    const linkEnd = quotedTitle >= 0 ? quotedTitle : closingParenthesis
    if (linkEnd < 0) continue

    const [, date, time] = published
    const rawTitle = line.slice(heading + headingLength, linkMarker)
    const value = line.slice(linkStart, linkEnd)
    const title = rawTitle.replace(/\s+/g, " ").trim()
    let url: URL
    try {
      url = new URL(value)
    } catch {
      continue
    }
    if (!title || url.hostname !== "factcheck.afp.com" || seen.has(url.href)) continue
    seen.add(url.href)
    items.push({
      id: url.href,
      title,
      url: url.href,
      pubDate: tranformToUTC(`${date} ${time}`, "DD/MM/YYYY HH:mm", "UTC"),
      extra: {
        info: "AFP Fact Check 官方",
        hover: "来源：AFP Fact Check 官方发布",
      },
    })
  }

  return items.sort((a, b) => Number(b.pubDate) - Number(a.pubDate)).slice(0, 30)
}

export default defineSource(async (event) => {
  const issues: string[] = []
  try {
    const html = await myFetch<string, "text">(newsHubUrl, {
      responseType: "text",
      retry: 0,
      timeout: 8000,
    })
    const items = parseAfpNewsHub(html)
    if (items.length) {
      return translateNewsItemsToChinese(items, "afp")
    }
    issues.push(sourceFailure("afp-hub"))
  } catch (error) {
    issues.push(sourceFailure("afp-hub", error))
  }

  try {
    const raw = await myFetch<string, "text">(factCheckIndexUrl, { responseType: "text", retry: 0, timeout: 4500 })
    const items = parseAfpFactCheckIndex(raw)
    if (items.length) return translateNewsItemsToChinese(items, "afp")
    issues.push(sourceFailure("afp-index"))
  } catch (error) {
    issues.push(sourceFailure("afp-index", error))
  }

  try {
    const raw = await myFetch<string, "text">(factCheckReaderUrl, {
      responseType: "text",
      retry: 0,
      timeout: 8000,
    })
    const items = parseAfpFactCheckReader(raw)
    if (items.length) {
      return translateNewsItemsToChinese(items, "afp")
    }
    issues.push(sourceFailure("afp-reader"))
  } catch (error) {
    issues.push(sourceFailure("afp-reader", error))
  }

  let items: NewsItem[] = []
  try {
    items = await officialVideoFeed(event)
    if (!items.length) issues.push(sourceFailure("afp-video"))
  } catch (error) {
    issues.push(sourceFailure("afp-video", error))
  }
  if (!items.length) throw new SourceUnavailableError(issues)
  return items.map(item => ({
    ...item,
    extra: {
      ...item.extra,
      info: "AFP News Agency 官方",
      hover: item.extra?.hover
        ? `${item.extra.hover}\n来源：AFP News Agency 官方频道`
        : "来源：AFP News Agency 官方频道",
    },
  }))
})
