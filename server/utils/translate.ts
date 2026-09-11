import type { NewsItem } from "@shared/types"

const translateCache = new Map<string, string>()
const zhRegExp = /[\u3400-\u9FFF]/
const latinRegExp = /[A-Z]/i
const persistentCacheBaseUrl = "https://newsnow-1nq.pages.dev/__internal-cache/translations-v2"
const persistentCacheMaxAge = 7 * 24 * 60 * 60
const persistentCacheEntryLimit = 300

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

function readGoogleTranslateResponse(data: any) {
  if (!Array.isArray(data?.[0])) return ""
  return data[0].map((part: any) => Array.isArray(part) ? part[0] ?? "" : "").join("").trim()
}

function shouldTranslate(title: string) {
  return latinRegExp.test(title) && !zhRegExp.test(title)
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

async function translateBatch(texts: string[]): Promise<string[]> {
  const url = new URL("https://translate.googleapis.com/translate_a/single")
  url.searchParams.set("client", "gtx")
  url.searchParams.set("sl", "auto")
  url.searchParams.set("tl", "zh-CN")
  url.searchParams.set("dt", "t")
  url.searchParams.set("q", texts.join("\n"))
  try {
    const data = await myFetch(url.toString(), { timeout: 8000, retry: 0 })
    const translated = readGoogleTranslateResponse(data)
    const lines = translated.split(/\n+/).map(normalizeTitle).filter(Boolean)
    if (lines.length === texts.length) return lines
    if (texts.length === 1 && translated) return [normalizeTitle(translated)]
  } catch {
    // Keep cached translations or source text; never rotate hosts or fan out per title.
  }
  return texts
}

export async function translateTextsToChinese(texts: string[], persistentCacheNamespace?: string): Promise<string[]> {
  const normalizedTexts = texts.map(text => normalizeTitle(String(text ?? "")))
  const targets = normalizedTexts.filter(text => text && shouldTranslate(text))
  const uniqueTargets = [...new Set(targets)]

  const persistentEntries = await readPersistentTranslations(
    uniqueTargets.filter(text => !translateCache.has(text)),
    persistentCacheNamespace,
  )
  const pendingTargets = uniqueTargets.filter(text => !translateCache.has(text))

  const batches: string[][] = []
  let batch: string[] = []
  let batchLength = 0
  for (const text of pendingTargets) {
    const nextLength = batchLength + text.length + (batch.length ? 1 : 0)
    if (batch.length && (batch.length >= 20 || nextLength > 1600)) {
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
  const workers = Array.from({ length: Math.min(1, batches.length) }, async () => {
    while (nextBatchIndex < batches.length) {
      const currentBatch = batches[nextBatchIndex++]
      try {
        const translated = await translateBatch(currentBatch)
        currentBatch.forEach((text, index) => {
          const translatedTitle = normalizeTitle(String(translated[index] ?? ""))
          if (translatedTitle && translatedTitle !== text) {
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
