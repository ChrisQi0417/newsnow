import { load } from "cheerio"
import { XMLParser } from "fast-xml-parser"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

interface PiFeedItem {
  guid?: string | { $text?: string }
  link?: string
  pubDate?: string
  source?: string | { $text?: string, url?: string }
  title?: string | { $text?: string }
}

interface PiMediaSource {
  domains: string[]
  displayName: string
  names: string[]
}

interface PiMediaJsonResponse {
  items?: Array<{
    link?: string
    pubDate?: string
    title?: string
  }>
  status?: string
}

const officialFeedUrl = "https://minepi.com/blog/feed/"
const officialBlogUrl = "https://minepi.com/blog/"
const readerFeedUrl = "https://r.jina.ai/http://minepi.com/blog/feed/"
const mediaFeedUrl = "https://news.google.com/rss/search?q=%22Pi%20Network%22%20when%3A7d&hl=en-US&gl=US&ceid=US%3Aen"
const mediaReaderFeedUrl = "https://r.jina.ai/http://news.google.com/rss/search?q=%22Pi%20Network%22%20when%3A7d%26hl=en-US%26gl=US%26ceid=US%3Aen"
const mediaJsonFeedUrls = ["CryptoPotato", "CryptoRank"].map((source) => {
  const query = encodeURIComponent(`"Pi Network" source:${source} when:7d`)
  const feed = encodeURIComponent(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`)
  return `https://api.rss2json.com/v1/api.json?rss_url=${feed}`
})
const directMediaFeeds = [
  { sourceName: "crypto.news", url: "https://crypto.news/tag/pi-network/feed/" },
  { sourceName: "CryptoPotato", url: "https://cryptopotato.com/feed/" },
]
const trustedMediaSources: PiMediaSource[] = [
  { displayName: "Reuters", names: ["Reuters"], domains: ["reuters.com"] },
  { displayName: "Bloomberg", names: ["Bloomberg"], domains: ["bloomberg.com"] },
  { displayName: "CoinDesk", names: ["CoinDesk"], domains: ["coindesk.com"] },
  { displayName: "Cointelegraph", names: ["Cointelegraph"], domains: ["cointelegraph.com"] },
  { displayName: "Decrypt", names: ["Decrypt"], domains: ["decrypt.co"] },
  { displayName: "The Block", names: ["The Block"], domains: ["theblock.co"] },
  { displayName: "crypto.news", names: ["Crypto News", "crypto.news"], domains: ["crypto.news"] },
  { displayName: "BeInCrypto", names: ["BeInCrypto"], domains: ["beincrypto.com"] },
  { displayName: "CryptoSlate", names: ["CryptoSlate"], domains: ["cryptoslate.com"] },
  { displayName: "FXStreet", names: ["FXStreet"], domains: ["fxstreet.com"] },
  { displayName: "CoinMarketCap", names: ["CoinMarketCap"], domains: ["coinmarketcap.com"] },
  { displayName: "CryptoPotato", names: ["CryptoPotato", "cryptopotato.com"], domains: ["cryptopotato.com"] },
  { displayName: "CryptoRank", names: ["CryptoRank"], domains: ["cryptorank.io"] },
  { displayName: "Yahoo Finance", names: ["Yahoo Finance"], domains: ["finance.yahoo.com"] },
]
const speculativeTitle = /price\s+(?:prediction|forecast|outlook|target)|(?:how high|how far) (?:can|will)|\bwill\b.+\?|\bcan\b.+\?|should you buy|buy now|\b\d+x\b|100x|moon|millionaire|\bai (?:predicts?|speculates?)\b|\bais speculate\b|rumou?r|binance.+\?|coinbase.+\?/i
const browserHeaders = {
  "Accept": "application/rss+xml,application/xml;q=0.9,text/html;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": officialBlogUrl,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function readText(value: PiFeedItem["title"] | PiFeedItem["guid"]) {
  if (typeof value === "string") return normalizeText(value)
  return typeof value?.$text === "string" ? normalizeText(value.$text) : ""
}

function toTimestamp(value?: string) {
  if (!value) return
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function normalizeOfficialUrl(value?: string) {
  if (!value) return

  try {
    const url = new URL(value)
    if (!["minepi.com", "www.minepi.com"].includes(url.hostname)) return
    if (!/^\/(?:blog|announcement)\//.test(url.pathname)) return
    url.protocol = "https:"
    url.hostname = "minepi.com"
    url.search = ""
    url.hash = ""
    return url.href
  } catch {
  }
}

function officialItem(title: string, url: string, pubDate?: number): NewsItem {
  return {
    id: url,
    title,
    url,
    pubDate,
    extra: {
      info: "Pi Network 官方",
      hover: "来源：Pi Network 官方博客",
    },
  }
}

function readSourceName(value: PiFeedItem["source"]) {
  if (typeof value === "string") return normalizeText(value)
  return typeof value?.$text === "string" ? normalizeText(value.$text) : ""
}

function readSourceUrl(value: PiFeedItem["source"]) {
  return typeof value === "object" && typeof value?.url === "string" ? value.url : ""
}

function trustedMediaName(value: string, sourceUrl: string) {
  const normalized = value.toLocaleLowerCase()
  try {
    const hostname = new URL(sourceUrl).hostname.toLocaleLowerCase().replace(/^www\./, "")
    return trustedMediaSources.find(source =>
      source.names.some(name => name.toLocaleLowerCase() === normalized)
      && source.domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)),
    )?.displayName
  } catch {
  }
}

function normalizeGoogleNewsUrl(value?: string) {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.hostname !== "news.google.com" || !url.pathname.startsWith("/rss/articles/")) return
    return url.href
  } catch {
  }
}

function normalizeDirectMediaUrl(value: string | undefined, sourceName: string) {
  const source = trustedMediaSources.find(item => item.displayName === sourceName)
  if (!value || !source) return
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, "")
    if (url.protocol !== "https:" || !source.domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) return
    url.hash = ""
    return url.href
  } catch {
  }
}

function normalizeMediaTitle(value: string, sourceName: string) {
  return decodeFeedTitle(value).replace(new RegExp(`\\s+-\\s+${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "")
}

function decodeFeedTitle(value: string) {
  return normalizeText(load(`<span>${value}</span>`).text())
}

function splitTrustedMediaHeadline(value: string) {
  const headline = normalizeText(value)
  const normalized = headline.toLocaleLowerCase()
  for (const source of trustedMediaSources) {
    for (const name of source.names) {
      const suffix = ` - ${name}`
      if (normalized.endsWith(suffix.toLocaleLowerCase())) {
        return {
          sourceName: source.displayName,
          title: headline.slice(0, -suffix.length),
        }
      }
    }
  }
}

function mediaItem(title: string, url: string, sourceName: string, pubDate?: number): NewsItem {
  const channel = new URL(url).hostname === "news.google.com" ? "经 Google News 聚合" : "媒体原生 RSS"
  return {
    id: url,
    title,
    url,
    pubDate,
    extra: {
      info: `白名单媒体 · ${sourceName}`,
      hover: `来源：${sourceName}（${channel}）\n非 Pi Network 官方公告，请结合官网交叉验证`,
    },
  }
}

export function curatePiNews(items: NewsItem[], limit = 30) {
  const seen = new Set<string>()
  const seenTitles = new Set<string>()

  return items
    .filter(item => item.url && String(item.title).length >= 5)
    .sort((a, b) => Number(b.pubDate ?? 0) - Number(a.pubDate ?? 0))
    .filter((item) => {
      if (seen.has(item.url)) return false
      const titleKey = normalizeText(String(item.title)).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")
      if (seenTitles.has(titleKey)) return false
      seen.add(item.url)
      seenTitles.add(titleKey)
      return true
    })
    .slice(0, limit)
}

export function parsePiOfficialFeed(raw: string) {
  const parser = new XMLParser({
    attributeNamePrefix: "",
    textNodeName: "$text",
    ignoreAttributes: false,
  })
  const channel = parser.parse(raw)?.rss?.channel
  const feedItems = channel?.item
    ? (Array.isArray(channel.item) ? channel.item : [channel.item]) as PiFeedItem[]
    : []

  return curatePiNews(feedItems.flatMap((item) => {
    const title = readText(item.title)
    const url = normalizeOfficialUrl(item.link || readText(item.guid))
    if (!title || !url) return []
    return [officialItem(title, url, toTimestamp(item.pubDate))]
  }))
}

export function parsePiMediaFeed(raw: string, limit = 15) {
  const parser = new XMLParser({
    attributeNamePrefix: "",
    textNodeName: "$text",
    ignoreAttributes: false,
  })
  const channel = parser.parse(raw)?.rss?.channel
  const feedItems = channel?.item
    ? (Array.isArray(channel.item) ? channel.item : [channel.item]) as PiFeedItem[]
    : []

  return curatePiNews(feedItems.flatMap((item) => {
    const source = trustedMediaName(readSourceName(item.source), readSourceUrl(item.source))
    const url = normalizeGoogleNewsUrl(item.link || readText(item.guid))
    if (!source || !url) return []
    const title = normalizeMediaTitle(readText(item.title), readSourceName(item.source))
    if (!title || speculativeTitle.test(title) || !/\bPi Network\b|\bPI\b/i.test(title)) return []
    return [mediaItem(title, url, source, toTimestamp(item.pubDate))]
  }), limit)
}

export function parsePiMediaReaderFeed(markdown: string, limit = 15) {
  const lines = markdown.split(/\r?\n/)
  const items: NewsItem[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line.startsWith("### [") || !line.endsWith(")")) continue
    const linkStart = line.lastIndexOf("](")
    if (linkStart < 5) continue

    const headline = splitTrustedMediaHeadline(line.slice(5, linkStart))
    const url = normalizeGoogleNewsUrl(line.slice(linkStart + 2, -1))
    if (!headline || !url || speculativeTitle.test(headline.title) || !/\bPi Network\b|\bPI\b/i.test(headline.title)) continue

    let pubDate: number | undefined
    for (let dateIndex = index + 1; dateIndex < lines.length; dateIndex++) {
      const dateLine = lines[dateIndex].trim()
      if (dateLine.startsWith("### [")) break
      if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s.+\sGMT$/.test(dateLine)) {
        pubDate = toTimestamp(dateLine)
        break
      }
    }
    items.push(mediaItem(headline.title, url, headline.sourceName, pubDate))
  }

  return curatePiNews(items, limit)
}

export function parsePiMediaJson(response: PiMediaJsonResponse, limit = 15) {
  if (response.status !== "ok" || !Array.isArray(response.items)) return []

  return curatePiNews(response.items.flatMap((item) => {
    const headline = splitTrustedMediaHeadline(decodeFeedTitle(item.title || ""))
    const url = normalizeGoogleNewsUrl(item.link)
    if (!headline || !url || speculativeTitle.test(headline.title) || !/\bPi Network\b|\bPI\b/i.test(headline.title)) return []
    const date = item.pubDate && /^\d{4}-\d{2}-\d{2}\s/.test(item.pubDate) ? `${item.pubDate} UTC` : item.pubDate
    return [mediaItem(headline.title, url, headline.sourceName, toTimestamp(date))]
  }), limit)
}

export function parsePiDirectMediaFeed(raw: string, sourceName: string, limit = 15) {
  const parser = new XMLParser({
    attributeNamePrefix: "",
    textNodeName: "$text",
    ignoreAttributes: false,
  })
  const channel = parser.parse(raw)?.rss?.channel
  const feedItems = channel?.item
    ? (Array.isArray(channel.item) ? channel.item : [channel.item]) as PiFeedItem[]
    : []

  return curatePiNews(feedItems.flatMap((item) => {
    const title = decodeFeedTitle(readText(item.title))
    const url = normalizeDirectMediaUrl(item.link || readText(item.guid), sourceName)
    if (!title || !url || speculativeTitle.test(title) || !/\bPi Network\b|\bPI\b/i.test(title)) return []
    return [mediaItem(title, url, sourceName, toTimestamp(item.pubDate))]
  }), limit)
}

export function parsePiOfficialBlogPage(html: string) {
  const $ = load(html)
  const items: NewsItem[] = []

  $("article").each((_, element) => {
    const article = $(element)
    const anchor = article.find("h3.title a").first()
    const title = normalizeText(anchor.text())
    const url = normalizeOfficialUrl(anchor.attr("href"))
    const pubDate = toTimestamp(normalizeText(article.find(".grav-wrap .text span").last().text()))
    if (!title || !url) return
    items.push(officialItem(title, url, pubDate))
  })

  return curatePiNews(items)
}

export function parsePiReaderFeed(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const items: NewsItem[] = []

  lines.forEach((line, index) => {
    const match = line.match(/^### \[(.+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (!match) return
    const title = normalizeText(match[1])
    const url = normalizeOfficialUrl(match[2])
    const pubDate = lines
      .slice(index + 1, index + 6)
      .map(line => toTimestamp(line.trim()))
      .find(timestamp => timestamp !== undefined)
    if (!title || !url) return
    items.push(officialItem(title, url, pubDate))
  })

  return curatePiNews(items)
}

export function restorePiProperNames(originalTitle: string, translatedTitle: string) {
  let restored = normalizeText(translatedTitle)
  if (/\bPi\b|Pi2Day|Pi Network/i.test(originalTitle)) {
    restored = restored.replace(/圆周率/g, "Pi")
  }
  if (/Pi Network/i.test(originalTitle)) {
    restored = restored.replace(/Pi\s*网络/gi, "Pi Network")
  }
  if (/Pi2Day/i.test(originalTitle)) {
    restored = restored.replace(/Pi\s*2\s*(?:日|天)/gi, "Pi2Day")
  }
  return restored
}

async function fetchOfficialFeed() {
  const raw = await myFetch<string>(officialFeedUrl, {
    responseType: "text",
    headers: browserHeaders,
    retry: 0,
    timeout: 6000,
  })
  return parsePiOfficialFeed(raw)
}

async function fetchReaderFeed() {
  const markdown = await myFetch<string>(readerFeedUrl, {
    responseType: "text",
    retry: 0,
    timeout: 8000,
  })
  return parsePiReaderFeed(markdown)
}

async function fetchOfficialBlogPage() {
  const html = await myFetch<string>(officialBlogUrl, {
    responseType: "text",
    headers: browserHeaders,
    retry: 0,
    timeout: 6000,
  })
  return parsePiOfficialBlogPage(html)
}

async function fetchMediaFeed() {
  const raw = await myFetch<string>(mediaFeedUrl, {
    responseType: "text",
    headers: browserHeaders,
    retry: 0,
    timeout: 4500,
  })
  return parsePiMediaFeed(raw)
}

async function fetchMediaReaderFeed() {
  const markdown = await myFetch<string>(mediaReaderFeedUrl, {
    responseType: "text",
    retry: 1,
    timeout: 10000,
  })
  return parsePiMediaReaderFeed(markdown)
}

async function fetchMediaJsonFeeds() {
  const items: NewsItem[] = []
  for (const [index, url] of mediaJsonFeedUrls.entries()) {
    if (index) await new Promise(resolve => setTimeout(resolve, 750))
    try {
      const response = await myFetch<PiMediaJsonResponse>(url, {
        retry: 0,
        timeout: 7000,
      })
      items.push(...parsePiMediaJson(response))
    } catch (error) {
      logger.warn("failed to fetch Pi Network structured media feed", error)
    }
  }
  return curatePiNews(items, 15)
}

async function fetchDirectMediaFeeds() {
  const results = await Promise.allSettled(directMediaFeeds.map(async (feed) => {
    const raw = await myFetch<string>(feed.url, {
      responseType: "text",
      headers: browserHeaders,
      retry: 1,
      timeout: 8000,
    })
    return parsePiDirectMediaFeed(raw, feed.sourceName)
  }))
  return curatePiNews(results.flatMap(result => result.status === "fulfilled" ? result.value : []), 15)
}

async function fetchMediaItems() {
  const results = await Promise.allSettled([fetchDirectMediaFeeds(), fetchMediaFeed(), fetchMediaReaderFeed(), fetchMediaJsonFeeds()])
  const items = curatePiNews(results.flatMap(result => result.status === "fulfilled" ? result.value : []), 15)
  if (!items.length) throw new Error("Cannot fetch trusted Pi Network media")
  return items
}

async function fetchOfficialItems() {
  let officialItems: NewsItem[] = []

  try {
    officialItems = await fetchOfficialFeed()
  } catch (error) {
    logger.warn("failed to fetch Pi Network official feed", error)
  }

  if (!officialItems.length) {
    try {
      officialItems = await fetchReaderFeed()
    } catch (error) {
      logger.warn("failed to fetch Pi Network reader feed", error)
    }
  }

  if (!officialItems.length) {
    try {
      officialItems = await fetchOfficialBlogPage()
    } catch (error) {
      logger.warn("failed to fetch Pi Network official blog", error)
    }
  }
  return officialItems
}

export default defineSource(async () => {
  const [officialResult, mediaResult] = await Promise.allSettled([fetchOfficialItems(), fetchMediaItems()])
  const officialItems = officialResult.status === "fulfilled" ? officialResult.value : []
  const mediaItems = mediaResult.status === "fulfilled" ? mediaResult.value : []
  if (mediaResult.status === "rejected") logger.warn("failed to fetch trusted Pi Network media feed", mediaResult.reason)

  const items = curatePiNews([...officialItems, ...mediaItems])
  if (!items.length) throw new Error("Cannot fetch Pi Network news")
  const translated = await translateNewsItemsToChinese(items)
  return translated.map((item, index) => ({
    ...item,
    title: restorePiProperNames(String(items[index].title), String(item.title)),
  }))
})
