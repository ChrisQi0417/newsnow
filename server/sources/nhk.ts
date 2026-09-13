import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

interface NHKWorldItem {
  id: string
  page_url: string
  updated_at?: string
  title: string
  description?: string
}

interface NHKWorldResponse {
  data: NHKWorldItem[]
}

export function parseNHKNews(data: NHKWorldResponse): NewsItem[] {
  const base = "https://www3.nhk.or.jp"
  return data.data.slice(0, 30).map(item => ({
    id: item.id,
    title: item.title,
    url: new URL(item.page_url, base).href,
    pubDate: item.updated_at ? Number(item.updated_at) : undefined,
    extra: {
      hover: item.description,
    },
  }))
}

export default defineSource(async () => {
  const data: NHKWorldResponse = await myFetch("https://api.nhkworld.jp/nwapi/news/v1/en/articles?type=news&tag=&offset=0&limit=30")
  const items = parseNHKNews(data)
  return translateNewsItemsToChinese(items, "nhk")
})
