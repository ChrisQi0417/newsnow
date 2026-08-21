import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

const newsHubUrl = "https://www.afp.com/en/node/3753800"
const officialVideoFeed = defineRSSSource("https://www.youtube.com/feeds/videos.xml?channel_id=UC86dbj-lbDks_hZ5gRKL49Q", {
  translate: true,
  limit: 30,
})
const factCheckReaderUrl = "https://r.jina.ai/http://factcheck.afp.com/"

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
  try {
    const html = await myFetch<string>(newsHubUrl, {
      responseType: "text",
      retry: 1,
      timeout: 8000,
    })
    const items = parseAfpNewsHub(html)
    if (items.length) {
      return translateNewsItemsToChinese(items)
    }
  } catch (error) {
    logger.warn("failed to fetch AFP News Hub", error)
  }

  try {
    const raw = await myFetch<string>(factCheckReaderUrl, {
      responseType: "text",
      retry: 1,
      timeout: 8000,
    })
    const items = parseAfpFactCheckReader(raw)
    if (items.length) {
      return translateNewsItemsToChinese(items)
    }
  } catch (error) {
    logger.warn("failed to fetch AFP Fact Check", error)
  }

  const items = await officialVideoFeed(event)
  if (!items.length) throw new Error("Cannot fetch AFP official sources")
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
