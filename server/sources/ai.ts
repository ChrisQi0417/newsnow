import { load } from "cheerio"
import { XMLParser } from "fast-xml-parser"
import type { NewsItem } from "@shared/types"
import { rss2json } from "../utils/rss2json"
import { translateNewsItemsToChinese } from "../utils/translate"

interface OfficialFeed {
  filterAI?: boolean
  name: string
  url: string
}

interface ReutersSitemapUrl {
  "loc"?: string
  "lastmod"?: string
  "news:news"?: {
    "news:publication_date"?: string
    "news:title"?: string
  }
}

const officialFeeds: OfficialFeed[] = [
  { name: "OpenAI", url: "https://openai.com/news/rss.xml" },
  { name: "Google AI", url: "https://blog.google/technology/ai/rss/" },
  { name: "NVIDIA", url: "https://blogs.nvidia.com/feed/", filterAI: true },
  { name: "Microsoft Research", url: "https://www.microsoft.com/en-us/research/feed/", filterAI: true },
  { name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml" },
]

const aiTerms = /\b(?:AI|artificial intelligence|machine learning|deep learning|generative|foundation model|large language model|LLM|agentic|robotics|OpenAI|ChatGPT|Anthropic|Claude|Gemini|DeepMind|Meta AI|Llama|NVIDIA|Hugging Face)\b/i
const usTerms = /\b(?:U\.?S\.?|United States|American|America|White House|Congress|Pentagon|Washington|California|Silicon Valley|OpenAI|ChatGPT|Anthropic|Claude|Google|Gemini|Meta|Llama|Microsoft|NVIDIA|Amazon|Apple|xAI|Grok|Oracle|AMD|Intel|Tesla)\b/i

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function toTimestamp(value?: string) {
  if (!value) return
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function sourceInfo(name: string) {
  return {
    info: name,
    hover: `来源：${name}`,
  }
}

function findNearbyDate($: ReturnType<typeof load>, element: any) {
  let node = $(element)
  for (let depth = 0; depth < 6 && node.length; depth++) {
    const date = normalizeText(node.find("time").first().text())
      || normalizeText(node.text()).match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+20\d{2}\b/i)?.[0]
    if (date) return toTimestamp(date)
    node = node.parent()
  }
}

export function isUSFocusedAIHeadline(title: string) {
  return aiTerms.test(title) && usTerms.test(title)
}

export function restoreAIProperNames(originalTitle: string, translatedTitle: string) {
  const replacements: [string, RegExp][] = [
    ["Anthropic", /人类/g],
    ["Claude", /克劳德/g],
    ["Gemini", /双子座/g],
    ["DeepMind", /深度思维/g],
    ["Hugging Face", /拥抱脸/g],
    ["Llama", /(?:美洲驼|骆驼)/g],
    ["Moonshot AI", /登月/g],
    ["Fable", /寓言/g],
    ["Grok", /格罗克/g],
    ["Copilot", /副驾驶/g],
  ]

  return replacements.reduce((title, [name, translatedName]) => {
    if (!originalTitle.toLocaleLowerCase().includes(name.replace(/ AI$/, "").toLocaleLowerCase())) return title
    return normalizeText(title.replace(translatedName, ` ${name} `))
  }, translatedTitle)
}

export function parseAnthropicNewsPage(html: string): NewsItem[] {
  const $ = load(html)
  const seen = new Set<string>()
  const items: NewsItem[] = []

  $("a[href^='/news/']").each((_, element) => {
    const anchor = $(element)
    const href = anchor.attr("href")
    const title = normalizeText(
      anchor.find("h1,h2,h3,h4,[class*='title'],[class*='Title']").last().text()
      || anchor.attr("aria-label")?.replace(/^Read\s+/i, "")
      || "",
    )
    if (!href || title.length < 10) return

    const url = new URL(href, "https://www.anthropic.com").href
    if (seen.has(url)) return
    seen.add(url)
    items.push({
      id: url,
      title,
      url,
      pubDate: findNearbyDate($, element),
      extra: sourceInfo("Anthropic"),
    })
  })

  return items
}

export function parseMetaAINewsPage(html: string): NewsItem[] {
  const $ = load(html)
  const seen = new Set<string>()
  const items: NewsItem[] = []

  $("a[href*='ai.meta.com/blog/'],a[href^='/blog/']").each((_, element) => {
    const anchor = $(element)
    const href = anchor.attr("href")
    const title = normalizeText(
      anchor.attr("aria-label")?.replace(/^Read\s+/i, "")
      || anchor.text(),
    )
    if (!href || title.length < 10) return

    const url = new URL(href, "https://ai.meta.com").href
    if (url === "https://ai.meta.com/blog/" || seen.has(url)) return
    seen.add(url)
    items.push({
      id: url,
      title,
      url,
      pubDate: findNearbyDate($, element),
      extra: sourceInfo("Meta AI"),
    })
  })

  return items
}

export function parseReutersUSAINews(raw: string): NewsItem[] {
  const parser = new XMLParser({ ignoreAttributes: false })
  const urls = asArray<ReutersSitemapUrl>(parser.parse(raw)?.urlset?.url)
  const seen = new Set<string>()
  const items: NewsItem[] = []

  for (const item of urls) {
    const url = item.loc
    const title = normalizeText(item["news:news"]?.["news:title"] ?? "")
    const pubDate = toTimestamp(item["news:news"]?.["news:publication_date"] ?? item.lastmod)
    if (!url || !title || !pubDate || seen.has(url) || !isUSFocusedAIHeadline(title)) continue

    const pathname = new URL(url).pathname
    if (/^\/(?:ar|de|es|fr|it|ja|pt)\//.test(pathname)) continue
    seen.add(url)
    items.push({
      id: url,
      title,
      url,
      pubDate,
      extra: sourceInfo("Reuters 路透社"),
    })
  }

  return items
}

export function curateLatestAIItems(items: NewsItem[], limit = 50) {
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()

  return items
    .sort((a, b) => Number(b.pubDate ?? 0) - Number(a.pubDate ?? 0))
    .filter((item) => {
      const title = normalizeText(String(item.title)).toLocaleLowerCase()
      if (!item.url || seenUrls.has(item.url) || seenTitles.has(title)) return false
      seenUrls.add(item.url)
      seenTitles.add(title)
      return true
    })
    .slice(0, limit)
}

async function fetchOfficialFeed(feed: OfficialFeed) {
  const data = await rss2json(feed.url)
  if (!data?.items.length) throw new Error(`Empty feed: ${feed.name}`)

  return data.items
    .filter(item => !feed.filterAI || aiTerms.test(item.title))
    .slice(0, 8)
    .map<NewsItem>(item => ({
      id: item.link,
      title: normalizeText(item.title),
      url: item.link,
      pubDate: toTimestamp(item.created),
      extra: sourceInfo(feed.name),
    }))
}

async function fetchHTMLSource(name: string, url: string, parser: (html: string) => NewsItem[]) {
  const html = await myFetch<string>(url, {
    responseType: "text",
    headers: name === "Meta AI" ? { "User-Agent": "Mozilla/5.0" } : undefined,
  })
  const items = parser(html).slice(0, 8)
  if (!items.length) throw new Error(`Empty page: ${name}`)
  return items
}

async function fetchReutersUSAI() {
  const raw = await myFetch<string>("https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml", {
    responseType: "text",
  })
  return parseReutersUSAINews(raw).slice(0, 12)
}

export default defineSource(async () => {
  const requests = [
    ...officialFeeds.map(feed => ({
      name: feed.name,
      request: fetchOfficialFeed(feed),
    })),
    {
      name: "Anthropic",
      request: fetchHTMLSource("Anthropic", "https://www.anthropic.com/news", parseAnthropicNewsPage),
    },
    {
      name: "Meta AI",
      request: fetchHTMLSource("Meta AI", "https://ai.meta.com/blog/", parseMetaAINewsPage),
    },
    {
      name: "Reuters US AI",
      request: fetchReutersUSAI(),
    },
  ]

  const results = await Promise.all(requests.map(async ({ name, request }) => {
    try {
      return await request
    } catch (error) {
      logger.warn(`failed to fetch ${name}`, error)
      return []
    }
  }))

  const items = curateLatestAIItems(results.flat())
  if (!items.length) throw new Error("Cannot fetch US AI news")
  const translated = await translateNewsItemsToChinese(items)
  return translated.map((item, index) => ({
    ...item,
    title: restoreAIProperNames(String(items[index].title), String(item.title)),
  }))
})
