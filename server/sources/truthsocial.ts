import { XMLParser } from "fast-xml-parser"
import type { NewsItem } from "@shared/types"
import { translateTextsToChinese } from "../utils/translate"

// The edge cache survives Worker instances in the same Cloudflare data center.
const persistentCacheUrl = "https://newsnow-1nq.pages.dev/__internal-cache/truthsocial-translations-v1"
const zhRegExp = /[\u3400-\u9FFF]/
const latinRegExp = /[A-Z]/i

interface RuntimeCache {
  match: (request: Request) => Promise<Response | undefined>
  put: (request: Request, response: Response) => Promise<void>
}

interface TranslationTarget {
  indexes: number[]
  text: string
}

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

function normalizeTitle(title: unknown) {
  return String(title ?? "").replace(/\s+/g, " ").trim()
}

function cachedOriginalTitle(item: NewsItem) {
  const hover = typeof item.extra?.hover === "string" ? item.extra.hover : ""
  if (!hover.startsWith("原文：")) return ""
  return normalizeTitle(hover.slice(3).split("\n")[0])
}

function getRuntimeCache() {
  const runtimeCaches = (globalThis as unknown as { caches?: { default?: RuntimeCache } }).caches
  return runtimeCaches?.default
}

async function readPersistentTranslations() {
  const cache = getRuntimeCache()
  if (!cache) return []

  try {
    const response = await cache.match(new Request(persistentCacheUrl))
    if (!response?.ok) return []
    const items = await response.json()
    return Array.isArray(items) ? items as NewsItem[] : []
  } catch {
    return []
  }
}

async function writePersistentTranslations(items: NewsItem[]) {
  const cache = getRuntimeCache()
  if (!cache || !items.length) return

  try {
    await cache.put(new Request(persistentCacheUrl), new Response(JSON.stringify(items.slice(0, 30)), {
      headers: {
        "Cache-Control": "public, max-age=604800",
        "Content-Type": "application/json; charset=utf-8",
      },
    }))
  } catch {
    // Translation remains available for this response even if edge persistence is unavailable.
  }
}

export function parseTruthSocialFeed(raw: string): NewsItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
  })
  const items = asArray<TruthSocialRSSItem>(parser.parse(raw)?.rss?.channel?.item)
  return items.slice(0, 50).map((item) => {
    const originalTitle = item.title?.trim()
    const description = stripHTML(item.description)
    const isPlaceholder = !originalTitle || originalTitle.startsWith("[No Title]")
    const isLinkOnly = [description, originalTitle].some(value => /^(?:RT[:：]\s*)?https?:\/\//i.test(value ?? ""))
    const title = isLinkOnly
      ? "转发内容"
      : isPlaceholder
        ? description || "Truth Social 帖子"
        : originalTitle
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
}

export function reuseCachedTruthSocialTranslations(freshItems: NewsItem[], cachedItems: NewsItem[]) {
  const cachedById = new Map(cachedItems.map(item => [String(item.id), item]))

  return freshItems.map((item) => {
    const cached = cachedById.get(String(item.id))
    const originalTitle = normalizeTitle(item.title)
    if (!cached || !zhRegExp.test(String(cached.title ?? ""))) return item
    if (cachedOriginalTitle(cached) !== originalTitle) return item

    return {
      ...item,
      title: cached.title,
      extra: {
        ...item.extra,
        hover: item.extra?.hover ? `原文：${originalTitle}\n${item.extra.hover}` : `原文：${originalTitle}`,
      },
    }
  })
}

export async function translateTruthSocialItems(items: NewsItem[]) {
  const targetsByText = new Map<string, TranslationTarget>()
  items.slice(0, 30).forEach((item, index) => {
    const text = normalizeTitle(item.title)
    if (!text || !latinRegExp.test(text) || zhRegExp.test(text)) return
    const target = targetsByText.get(text)
    if (target) target.indexes.push(index)
    else targetsByText.set(text, { indexes: [index], text })
  })

  const targets = [...targetsByText.values()]
  if (!targets.length) return items

  const groups = Array.from({ length: Math.min(3, targets.length) }, () => ({ length: 0, targets: [] as TranslationTarget[] }))
  targets
    .sort((a, b) => b.text.length - a.text.length)
    .forEach((target) => {
      const group = groups.reduce((shortest, candidate) => candidate.length < shortest.length ? candidate : shortest)
      group.targets.push(target)
      group.length += target.text.length
    })

  const translatedByIndex = new Map<number, string>()
  await Promise.all(groups.map(async (group) => {
    const translated = await translateTextsToChinese(group.targets.map(target => target.text))
    group.targets.forEach((target, targetIndex) => {
      const value = normalizeTitle(translated[targetIndex])
      if (!value || value === target.text) return
      target.indexes.forEach(index => translatedByIndex.set(index, value))
    })
  }))

  return items.map((item, index) => {
    const translatedTitle = translatedByIndex.get(index)
    if (!translatedTitle) return item
    const originalTitle = normalizeTitle(item.title)
    return {
      ...item,
      title: translatedTitle,
      extra: {
        ...item.extra,
        hover: item.extra?.hover ? `原文：${originalTitle}\n${item.extra.hover}` : `原文：${originalTitle}`,
      },
    }
  })
}

export default defineSource(async (event) => {
  const [raw, cachedItems] = await Promise.all([
    myFetch<string, "text">("https://trumpstruth.org/feed", {
      responseType: "text",
      retry: 1,
      timeout: 6000,
    }),
    readPersistentTranslations(),
  ])
  const freshItems = parseTruthSocialFeed(raw)
  const news = reuseCachedTruthSocialTranslations(freshItems, cachedItems)
  const translated = await translateTruthSocialItems(news)
  const persist = writePersistentTranslations(translated)
  if (event?.context.waitUntil) event.context.waitUntil(persist)
  else await persist

  return translated
})
