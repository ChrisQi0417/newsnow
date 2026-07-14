import { load } from "cheerio"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

const routes = {
  "xinhua-china": "https://english.news.cn/china/index.htm",
  "xinhua-world": "https://english.news.cn/world/index.htm",
  "xinhua-business": "https://english.news.cn/list/china-business.htm",
  "xinhua-tech": "https://english.news.cn/list/china-science.htm",
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function dateFromXinhuaUrl(url: string) {
  const match = /\/(20\d{6})\//.exec(url)
  if (!match) return
  return tranformToUTC(`${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6)}`, "YYYY-MM-DD")
}

function readItemDate($: ReturnType<typeof load>, element: any, url: string) {
  const time = normalize($(element).siblings(".time").first().text()
    || $(element).closest(".tit").find(".time").first().text()
    || $(element).closest(".item").find(".time").first().text())
  if (time) return tranformToUTC(time, "YYYY-MM-DD HH:mm:ss")
  return dateFromXinhuaUrl(url)
}

function defineXinhuaSource(url: string) {
  return defineSource(async () => {
    const html = await myFetch<string>(url, {
      responseType: "text",
    })
    const $ = load(html)
    const seen = new Set<string>()
    const items: NewsItem[] = []

    $("a[href*='20']").each((_, element) => {
      const href = $(element).attr("href")
      const title = normalize($(element).text())
      if (!href || title.length < 8) return

      const articleUrl = new URL(href, url).href
      if (!/\/20\d{6}\//.test(articleUrl) || seen.has(articleUrl)) return
      seen.add(articleUrl)
      items.push({
        id: articleUrl,
        title,
        url: articleUrl,
        pubDate: readItemDate($, element, articleUrl),
      })
    })

    const sortedItems = items
      .sort((a, b) => Number(b.pubDate ?? 0) - Number(a.pubDate ?? 0))
      .slice(0, 50)
    if (!sortedItems.length) throw new Error("Cannot fetch Xinhua latest news")
    return translateNewsItemsToChinese(sortedItems)
  })
}

export default defineSource(Object.fromEntries(
  Object.entries(routes).map(([id, url]) => [id, defineXinhuaSource(url)]),
))
