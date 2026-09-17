import type { NewsItem } from "@shared/types"
import { logger } from "#/utils/logger"

const translateCache = new Map<string, string>()
const zhRegExp = /[\u3400-\u9FFF]/
const latinRegExp = /[A-Z]/i
// Bump the namespace after changing batch parsing so stale partial translations are retried.
const persistentCacheBaseUrl = "https://newsnow-1nq.pages.dev/__internal-cache/translations-v3"
const persistentCacheMaxAge = 7 * 24 * 60 * 60
const persistentCacheEntryLimit = 300
// Keep the translation path bounded for Cloudflare Pages Functions. A failed
// provider must fall back quickly instead of consuming the whole request's
// CPU/resource budget while the source data remains available.
const translationRequestTimeoutMs = 1800
const translationBudgetMs = 5000
const translationRetryCooldownMs = 30_000
const translationProviderCooldownMs = 5 * 60_000
const failedTranslations = new Map<string, number>()
const blockedTranslationProviders = new Map<string, number>()

interface RuntimeCache {
  match: (request: Request) => Promise<Response | undefined>
  put: (request: Request, response: Response) => Promise<void>
}

interface PersistentTranslation {
  source: string
  translation: string
}

function normalizeTitle(title: string) {
  return title.replace(/\s+/g, " ").trim()
}

function normalizeTranslationBoundary(value: string) {
  return normalizeTitle(value)
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase()
}

async function translationFetch(input: string, init: RequestInit, deadline: number) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error("translation deadline exceeded")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(translationRequestTimeoutMs, remaining))
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function decodeMyMemoryText(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function readGoogleTranslateResponse(data: any, texts: string[]) {
  if (!Array.isArray(data?.[0])) return []

  const parts = data[0].flatMap((part: any) => {
    if (!Array.isArray(part)) return []
    // Keep line breaks intact here. Google often returns one segment for the
    // entire newline-delimited batch, and those breaks are the only reliable
    // boundary between titles in that response shape.
    const translation = String(part[0] ?? "").trim()
    const source = String(part[1] ?? "").trim()
    return translation && source ? [{ translation, source }] : []
  })
  if (!parts.length) return []

  const sourceLines = parts.flatMap(part => part.source.split(/\r?\n/).map(normalizeTitle).filter(Boolean))
  const translationLines = parts.flatMap(part => part.translation.split(/\r?\n/).map(normalizeTitle).filter(Boolean))
  if (
    sourceLines.length === texts.length
    && translationLines.length === texts.length
    && sourceLines.every((source, index) => normalizeTranslationBoundary(source) === normalizeTranslationBoundary(texts[index]))
  ) {
    return translationLines
  }

  const results: string[] = []
  let partIndex = 0
  for (const text of texts) {
    const target = normalizeTranslationBoundary(text)
    let source = ""
    let translation = ""
    let matched = false

    while (partIndex < parts.length) {
      const part = parts[partIndex++]
      source += part.source
      translation += part.translation
      const normalizedSource = normalizeTranslationBoundary(source)
      if (normalizedSource === target) {
        results.push(normalizeTitle(translation))
        matched = true
        break
      }
      if (!target.startsWith(normalizedSource)) return []
    }

    if (!matched) return []
  }

  return results.length === texts.length ? results : []
}

function shouldTranslate(title: string) {
  return latinRegExp.test(title) && !zhRegExp.test(title)
}

export function isChineseOutput(items: NewsItem[]) {
  return items.every(item => !shouldTranslate(normalizeTitle(String(item.title ?? ""))))
}

function getRuntimeCache() {
  const runtimeCaches = (globalThis as unknown as { caches?: { default?: RuntimeCache } }).caches
  return runtimeCaches?.default
}

function getPersistentCacheRequest(namespace: string) {
  return new Request(`${persistentCacheBaseUrl}/${encodeURIComponent(namespace)}`)
}

async function readPersistentTranslations(texts: string[], namespace?: string) {
  const entries = new Map<string, string>()
  const cache = getRuntimeCache()
  if (!cache || !texts.length || !namespace) return entries

  try {
    const response = await cache.match(getPersistentCacheRequest(namespace))
    if (!response?.ok) return entries
    const data = await response.json() as { entries?: PersistentTranslation[] }
    const targets = new Set(texts)
    for (const entry of Array.isArray(data.entries) ? data.entries : []) {
      const source = normalizeTitle(String(entry.source ?? ""))
      const translation = normalizeTitle(String(entry.translation ?? ""))
      if (!source || !translation || source === translation || !zhRegExp.test(translation)) continue
      entries.set(source, translation)
      if (targets.has(source)) translateCache.set(source, translation)
    }
  } catch {
    // A cache miss or malformed entry should fall through to live translation.
  }

  return entries
}

async function writePersistentTranslations(namespace: string | undefined, entries: Map<string, string>) {
  const cache = getRuntimeCache()
  if (!cache || !namespace || !entries.size) return

  const recentEntries = [...entries.entries()].slice(-persistentCacheEntryLimit).map(([source, translation]) => ({ source, translation }))
  try {
    await cache.put(getPersistentCacheRequest(namespace), new Response(JSON.stringify({ entries: recentEntries }), {
      headers: {
        "Cache-Control": `public, max-age=${persistentCacheMaxAge}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    }))
  } catch {
    // The current response can still use the translation when edge persistence fails.
  }
}

async function translateWithMyMemory(texts: string[], deadline: number) {
  const translated = [...texts]
  let nextIndex = 0
  let successCount = 0
  let nonOkCount = 0
  let invalidCount = 0
  let errorCount = 0
  const workerCount = Math.min(4, texts.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < texts.length) {
      const index = nextIndex++
      if (Date.now() >= deadline) continue

      const url = new URL("https://api.mymemory.translated.net/get")
      url.searchParams.set("q", texts[index])
      url.searchParams.set("langpair", "en|zh-CN")

      try {
        const response = await translationFetch(url.toString(), {
          headers: {
            "Accept": "application/json",
            "User-Agent": "NewsNow translation",
          },
        }, deadline)
        if (!response.ok) {
          nonOkCount += 1
          continue
        }
        const data = await response.json() as { responseData?: { translatedText?: string } }
        const value = normalizeTitle(decodeMyMemoryText(String(data.responseData?.translatedText ?? "")))
        if (value && value !== texts[index] && zhRegExp.test(value)) {
          translated[index] = value
          successCount += 1
        } else {
          invalidCount += 1
        }
      } catch {
        // Keep the original title when the bounded fallback is unavailable.
        errorCount += 1
      }
    }
  })
  await Promise.all(workers)
  logger.warn(`MyMemory fallback translated ${successCount}/${texts.length}; nonOk=${nonOkCount} invalid=${invalidCount} errors=${errorCount}`)
  return translated
}

async function translateBatch(texts: string[], deadline: number): Promise<string[]> {
  for (const endpoint of [
    "https://translate.googleapis.com/translate_a/single",
    "https://translate.google.com/translate_a/single",
  ]) {
    if (Date.now() >= deadline) break
    const blockedUntil = blockedTranslationProviders.get(endpoint) ?? 0
    if (blockedUntil > Date.now()) continue
    const url = new URL(endpoint)
    url.searchParams.set("client", "gtx")
    url.searchParams.set("sl", "auto")
    url.searchParams.set("tl", "zh-CN")
    url.searchParams.set("dt", "t")
    url.searchParams.set("q", texts.join("\n"))

    try {
      const response = await translationFetch(url.toString(), {
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "User-Agent": "NewsNow translation",
        },
      }, deadline)
      if (!response.ok) {
        if (response.status === 429) {
          blockedTranslationProviders.set(endpoint, Date.now() + translationProviderCooldownMs)
          logger.warn(`translation provider ${new URL(endpoint).hostname} rate limited; using bounded fallback`)
        } else {
          logger.warn(`translation provider ${new URL(endpoint).hostname} returned HTTP ${response.status}`)
        }
        continue
      }
      const raw = await response.text()
      const data = JSON.parse(raw)
      const translated = readGoogleTranslateResponse(data, texts)
      if (translated.length === texts.length) return translated
      logger.warn(`translation provider ${new URL(endpoint).hostname} returned ${translated.length}/${texts.length} segments`)
    } catch {
      // Try the alternate Google endpoint before falling back to the source title.
      logger.warn(`translation provider ${new URL(endpoint).hostname} request failed`)
    }
  }

  const translated = await translateWithMyMemory(texts, deadline)
  // Keep source identity and ordering when every provider is unavailable. A
  // later request can retry after the cooldown without amplifying traffic.
  return translated
}

export async function translateTextsToChinese(texts: string[], persistentCacheNamespace?: string): Promise<string[]> {
  const normalizedTexts = texts.map(text => normalizeTitle(String(text ?? "")))
  const targets = normalizedTexts.filter(text => text && shouldTranslate(text))
  const uniqueTargets = [...new Set(targets)]
  const deadline = Date.now() + translationBudgetMs

  const persistentEntries = await readPersistentTranslations(
    uniqueTargets.filter(text => !translateCache.has(text)),
    persistentCacheNamespace,
  )
  const pendingTargets = uniqueTargets.filter((text) => {
    const cached = translateCache.get(text)
    const failedAt = failedTranslations.get(text)
    return (!cached || cached === text || !zhRegExp.test(cached))
      && (failedAt === undefined || Date.now() - failedAt >= translationRetryCooldownMs)
  })

  const batches: string[][] = []
  let batch: string[] = []
  let batchLength = 0
  for (const text of pendingTargets) {
    const nextLength = batchLength + text.length + (batch.length ? 1 : 0)
    if (batch.length && (batch.length >= 10 || nextLength > 900)) {
      batches.push(batch)
      batch = []
      batchLength = 0
    }
    batch.push(text)
    batchLength += text.length + (batch.length > 1 ? 1 : 0)
  }
  if (batch.length) batches.push(batch)

  let persistentCacheChanged = false
  let nextBatchIndex = 0
  const workers = Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (nextBatchIndex < batches.length) {
      const currentBatch = batches[nextBatchIndex++]
      try {
        const translated = await translateBatch(currentBatch, deadline)
        currentBatch.forEach((text, index) => {
          const translatedTitle = normalizeTitle(String(translated[index] ?? ""))
          if (translatedTitle && translatedTitle !== text && zhRegExp.test(translatedTitle)) {
            translateCache.set(text, translatedTitle)
            if (zhRegExp.test(translatedTitle)) {
              persistentEntries.delete(text)
              persistentEntries.set(text, translatedTitle)
              persistentCacheChanged = true
            }
          } else {
            // Do not pin a failed translation to the original English title.
            // A later refresh should be able to retry after the provider recovers.
            translateCache.delete(text)
            failedTranslations.set(text, Date.now())
          }
        })
      } catch (e) {
        logger.warn("failed to translate texts", e)
        currentBatch.forEach(text => translateCache.delete(text))
      }
    }
  })
  await Promise.all(workers)
  if (persistentCacheChanged) {
    await writePersistentTranslations(persistentCacheNamespace, persistentEntries)
  }

  return normalizedTexts.map(text => translateCache.get(text) ?? text)
}

export async function translateNewsItemsToChinese(items: NewsItem[], persistentCacheNamespace?: string): Promise<NewsItem[]> {
  await translateTextsToChinese(items.slice(0, 30).map(item => String(item.title ?? "")), persistentCacheNamespace)

  return items.map((item) => {
    const originalTitle = normalizeTitle(String(item.title ?? ""))
    const translatedTitle = translateCache.get(originalTitle)
    if (!translatedTitle || translatedTitle === originalTitle) return item
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

/**
 * Translate public source output without allowing a translation outage to
 * turn an otherwise valid source response into an API failure. The returned
 * items keep their identity, URL, timestamps, ordering, and non-title data.
 */
export async function translateNewsItemsForOutput(items: NewsItem[], namespace: string): Promise<NewsItem[]> {
  if (!items.length) return items
  try {
    const translated = await translateNewsItemsToChinese(items, `source:${namespace}`)
    return translated.length === items.length ? translated : items
  } catch {
    return items
  }
}
