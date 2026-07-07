import { load } from "cheerio"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

const routes = {
  "apnews-top": "https://apnews.com/",
  "apnews-world": "https://apnews.com/world-news",
  "apnews-business": "https://apnews.com/business",
  "apnews-fact-check": "https://apnews.com/ap-fact-check",
}

function defineAPNewsSource(url: string, skipTopStories = false) {
  return defineSource(async () => {
    const html = await myFetch<string>(url, {
      responseType: "text",
    })
    const $ = load(html)
    const seen = new Set<string>()
    const items: NewsItem[] = []

    $("a[href*='/article/']").each((_, element) => {
      if (skipTopStories && $(element).closest(".Subheader-Top-Stories").length) return
      const href = $(element).attr("href")
      const title = $(element).text().replace(/\s+/g, " ").trim()
      if (!href || !title || title.length < 12) return

      const articleUrl = new URL(href, url).href
      if (seen.has(articleUrl)) return
      seen.add(articleUrl)
      items.push({
        id: articleUrl,
        title,
        url: articleUrl,
      })
    })

    if (!items.length) throw new Error("Cannot fetch AP News page")
    return translateNewsItemsToChinese(items.slice(0, 50))
  })
}

export default defineSource(Object.fromEntries(
  Object.entries(routes).map(([id, url]) => [id, defineAPNewsSource(url, id !== "apnews-top")]),
))
