import { load } from "cheerio"
import type { NewsItem } from "@shared/types"

const routes = {
  "people-politics": ["http://politics.people.com.cn/GB/461001/", "http://politics.people.com.cn/GB/1024/index.html", "https://www.people.com.cn/"],
  "people-world": ["https://world.people.com.cn/"],
  "people-finance": ["http://finance.people.com.cn/"],
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function dateFromPeopleUrl(url: string) {
  const match = /\/n1\/(\d{4})\/(\d{4})\//.exec(url)
  if (!match) return
  return tranformToUTC(`${match[1]}-${match[2].slice(0, 2)}-${match[2].slice(2)}`, "YYYY-MM-DD")
}

async function fetchFirstAvailable(urls: string[]) {
  let lastError: any
  for (const url of urls) {
    try {
      return {
        url,
        html: await myFetch<string>(url, { responseType: "text" }),
      }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

function definePeopleSource(urls: string[]) {
  return defineSource(async () => {
    const { url: baseUrl, html } = await fetchFirstAvailable(urls)
    const $ = load(html)
    const seen = new Set<string>()
    const items: NewsItem[] = []

    $("a[href*='/n1/20']").each((_, element) => {
      const href = $(element).attr("href")
      const title = normalize($(element).text())
      if (!href || title.length < 6) return

      const articleUrl = new URL(href, baseUrl).href
      if (seen.has(articleUrl)) return
      seen.add(articleUrl)
      items.push({
        id: articleUrl,
        title,
        url: articleUrl,
        pubDate: dateFromPeopleUrl(articleUrl),
      })
    })

    if (!items.length) throw new Error("Cannot fetch people.cn latest news")
    return items.slice(0, 50)
  })
}

export default defineSource(Object.fromEntries(
  Object.entries(routes).map(([id, urls]) => [id, definePeopleSource(urls)]),
))
