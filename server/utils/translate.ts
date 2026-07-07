import type { NewsItem } from "@shared/types"

const translateCache = new Map<string, string>()
const zhRegExp = /[\u3400-\u9FFF]/
const latinRegExp = /[A-Z]/i

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

async function translateBatch(texts: string[]): Promise<string[]> {
  const url = new URL("https://translate.googleapis.com/translate_a/single")
  url.searchParams.set("client", "gtx")
  url.searchParams.set("sl", "auto")
  url.searchParams.set("tl", "zh-CN")
  url.searchParams.set("dt", "t")
  url.searchParams.set("q", texts.join("\n"))

  const data = await myFetch<any>(url, {
    responseType: "json",
  })
  const translated = readGoogleTranslateResponse(data)
  if (!translated) return texts
  const lines = translated.split(/\n+/).map(normalizeTitle).filter(Boolean)
  if (lines.length === texts.length) return lines
  if (texts.length === 1) return [normalizeTitle(translated)]

  return Promise.all(texts.map(async (text) => {
    try {
      const [translated] = await translateBatch([text])
      return translated || text
    } catch {
      return text
    }
  }))
}

export async function translateNewsItemsToChinese(items: NewsItem[]): Promise<NewsItem[]> {
  const targets = items
    .map(item => normalizeTitle(String(item.title ?? "")))
    .filter(title => title && shouldTranslate(title))
  const uniqueTargets = [...new Set(targets)].filter(title => !translateCache.has(title))

  for (let i = 0; i < uniqueTargets.length; i += 8) {
    const batch = uniqueTargets.slice(i, i + 8)
    try {
      const translated = await translateBatch(batch)
      batch.forEach((title, index) => {
        translateCache.set(title, translated[index] || title)
      })
    } catch (e) {
      logger.warn("failed to translate news titles", e)
      batch.forEach(title => translateCache.set(title, title))
    }
  }

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
