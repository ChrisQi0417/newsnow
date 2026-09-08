import type { NewsItem, SourceID } from "@shared/types"
import { sources } from "@shared/sources"

export type DeskCategory = "all" | "world" | "tech" | "finance" | "weather" | "china" | "saved"
export interface DeskArticle {
  sourceId: SourceID
  item: NewsItem
}

export function sourceCategory(id: SourceID): DeskCategory {
  if (/^(?:govcn|people|xinhua|chinanews|scmp)(?:-|$)/.test(id)) return "china"
  if (id === "weather") return "weather"
  return sources[id].column || "world"
}

export function articleKey(article: DeskArticle) {
  return `${article.sourceId}:${article.item.id}`
}

export function articleTime(item: NewsItem) {
  const value = item.pubDate || item.extra?.date
  const time = typeof value === "number" ? value : Date.parse(value || "")
  return Number.isFinite(time) ? time : 0
}

export function matchesArticle(article: DeskArticle, search: string) {
  const source = sources[article.sourceId]
  const haystack = `${source.name} ${source.title || ""} ${article.item.title} ${article.item.extra?.info || ""} ${article.item.extra?.hover || ""}`.toLocaleLowerCase()
  return search.trim().toLocaleLowerCase().split(/\s+/).every(word => haystack.includes(word))
}

export function uniqueArticles(articles: DeskArticle[]) {
  const seen = new Set<string>()
  return articles.filter(({ item, sourceId }) => {
    // Only merge exact article URLs, never infer that similar headlines are the same event.
    let key = item.url
    if (["weather", "markets", "fed"].includes(sourceId)) {
      key = `${sourceId}:${item.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }
    try {
      const url = new URL(key)
      url.hash = ""
      for (const param of [...url.searchParams.keys()]) {
        if (param.startsWith("utm_")) url.searchParams.delete(param)
      }
      key = url.toString()
    } catch { /* Keep the original identity for nonstandard URLs. */ }
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function sourceKind(id: SourceID) {
  if (id === "truthsocial" || id === "twitter") return "账号原文"
  if (id === "weather" || id === "markets") return "数据汇总"
  if (id === "fed" || id === "govcn" || id === "github") return "官方发布"
  if (id === "ai" || id === "pi" || id === "apple") return "多源汇总"
  return "媒体报道"
}

export function sourceWarning(id: SourceID, items: NewsItem[]) {
  if (id === "twitter") {
    const missing = [["thsottiaux", "Tibo"], ["openai", "OpenAI"]].filter(([account]) => !items.some(item => item.url.toLowerCase().includes(`/${account}/status/`)))
    if (missing.length) return `${missing.map(([, name]) => name).join("、")} 暂未返回消息`
  }
  if (id === "weather" && items.some(item => String(item.id).endsWith("-unavailable"))) return "部分天气数据暂不可用"
  return undefined
}
