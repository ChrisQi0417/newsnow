import type { NewsItem } from "@shared/types"

const translateCache = new Map<string, string>()
const zhRegExp = /[\u3400-\u9FFF]/
const latinRegExp = /[A-Z]/i
let translationDiagnostic = "idle"

export function getTranslationDiagnostic() {
  return translationDiagnostic
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

function decodeMyMemoryText(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

async function translateWithLingva(texts: string[]): Promise<string[]> {
  const batches: string[][] = []
  let batch: string[] = []
  let batchLength = 0
  for (const text of texts) {
    const nextLength = batchLength + text.length + (batch.length ? 1 : 0)
    if (batch.length && (batch.length >= 10 || nextLength > 1400)) {
      batches.push(batch)
      batch = []
      batchLength = 0
    }
    batch.push(text)
    batchLength += text.length + (batch.length > 1 ? 1 : 0)
  }
  if (batch.length) batches.push(batch)

  const translated: string[] = []
  let successes = 0

  for (const batch of batches) {
    const url = `https://lingva.dialectapp.org/api/v1/en/zh/${encodeURIComponent(batch.join("\n"))}`

    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "NewsNow translation",
        },
      })
      if (!response.ok) {
        translated.push(...batch)
        continue
      }
      const data = JSON.parse(await response.text())
      const rawValue = String(data?.translation ?? "")
      const lines = rawValue.split(/\r?\n+/).map(normalizeTitle).filter(Boolean)
      if (lines.length === batch.length && lines.every(Boolean)) {
        translated.push(...lines)
        successes += lines.filter((value, index) => value !== batch[index]).length
      } else if (batch.length === 1 && lines[0] && lines[0] !== batch[0]) {
        translated.push(lines[0])
        successes += 1
      } else {
        translated.push(...batch)
      }
    } catch {
      translated.push(...batch)
    }
  }

  translationDiagnostic = `lingva:${successes}/${texts.length}`
  return translated
}

async function translateWithMyMemory(texts: string[]): Promise<string[]> {
  const translated: string[] = []
  let successes = 0

  for (const text of texts) {
    const url = new URL("https://api.mymemory.translated.net/get")
    url.searchParams.set("q", text)
    url.searchParams.set("langpair", "en|zh-CN")

    try {
      const response = await fetch(url.toString(), {
        headers: {
          "Accept": "application/json",
          "User-Agent": "NewsNow translation",
        },
      })
      if (!response.ok) {
        translated.push(text)
        continue
      }
      const data = JSON.parse(await response.text())
      const value = normalizeTitle(decodeMyMemoryText(String(data?.responseData?.translatedText ?? "")))
      if (value && value !== text) {
        translated.push(value)
        successes += 1
      } else {
        translated.push(text)
      }
    } catch {
      translated.push(text)
    }
  }

  translationDiagnostic = `mymemory:${successes}/${texts.length}`
  return translated
}

async function translateWithFallback(texts: string[]) {
  const lingva = await translateWithLingva(texts)
  const unresolvedIndexes = lingva.flatMap((value, index) => value === texts[index] ? [index] : [])
  if (!unresolvedIndexes.length) return lingva

  const fallback = await translateWithMyMemory(unresolvedIndexes.map(index => texts[index]))
  let fallbackIndex = 0
  return lingva.map((value, index) => {
    if (value !== texts[index]) return value
    return fallback[fallbackIndex++] ?? value
  })
}

async function translateBatch(texts: string[]): Promise<string[]> {
  let data: any
  const diagnostics: string[] = []
  for (const endpoint of [
    "https://translate.google.com/translate_a/single",
    "https://translate.googleapis.com/translate_a/single",
    "https://translate.google.co.uk/translate_a/single",
    "https://translate.google.de/translate_a/single",
  ]) {
    const url = new URL(endpoint)
    url.searchParams.set("client", "gtx")
    url.searchParams.set("sl", "auto")
    url.searchParams.set("tl", "zh-CN")
    url.searchParams.set("dt", "t")
    url.searchParams.set("q", texts.join("\n"))

    try {
      const response = await fetch(url.toString(), {
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "User-Agent": "NewsNow translation",
        },
      })
      if (!response.ok) {
        diagnostics.push(`${new URL(endpoint).hostname}:${response.status}`)
        continue
      }
      const raw = await response.text()
      data = JSON.parse(raw)
      const translated = readGoogleTranslateResponse(data)
      if (translated) {
        translationDiagnostic = `${new URL(endpoint).hostname}:ok:${raw.length}:${texts.length}`
        break
      }
      diagnostics.push(`${new URL(endpoint).hostname}:empty:${raw.length}`)
    } catch {
      diagnostics.push(`${new URL(endpoint).hostname}:error`)
      // Try the alternate Google endpoint before falling back to the source title.
    }
  }

  const translated = readGoogleTranslateResponse(data)
  if (!translated) {
    translationDiagnostic = `${diagnostics.join(",") || "no-response"};lingva`
    return translateWithFallback(texts)
  }
  const lines = translated.split(/\n+/).map(normalizeTitle).filter(Boolean)
  if (lines.length === texts.length) return lines
  if (texts.length === 1) return [normalizeTitle(translated)]
  translationDiagnostic = `line-mismatch:${lines.length}/${texts.length};lingva`

  // Handle a malformed batch response title by title with a fallback provider.
  return translateWithFallback(texts)
}

export async function translateTextsToChinese(texts: string[]): Promise<string[]> {
  const normalizedTexts = texts.map(text => normalizeTitle(String(text ?? "")))
  const targets = normalizedTexts.filter(text => text && shouldTranslate(text))
  const uniqueTargets = [...new Set(targets)].filter(text => !translateCache.has(text))

  const batches: string[][] = []
  let batch: string[] = []
  let batchLength = 0
  for (const text of uniqueTargets) {
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

  for (const batch of batches) {
    try {
      const translated = await translateBatch(batch)
      batch.forEach((text, index) => {
        const translatedTitle = normalizeTitle(String(translated[index] ?? ""))
        if (translatedTitle && translatedTitle !== text) {
          translateCache.set(text, translatedTitle)
        } else {
          // Do not pin a failed translation to the original English title.
          // A later refresh should be able to retry after the provider recovers.
          translateCache.delete(text)
        }
      })
    } catch (e) {
      logger.warn("failed to translate texts", e)
      batch.forEach(text => translateCache.delete(text))
    }
  }

  return normalizedTexts.map(text => translateCache.get(text) ?? text)
}

export async function translateNewsItemsToChinese(items: NewsItem[]): Promise<NewsItem[]> {
  await translateTextsToChinese(items.slice(0, 30).map(item => String(item.title ?? "")))

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
