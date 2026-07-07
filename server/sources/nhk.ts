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

export default defineSource(async () => {
  const data: NHKWorldResponse = await myFetch("https://www3.nhk.or.jp/nhkworld/data/en/news/all.json")
  const base = "https://www3.nhk.or.jp"
  const items: NewsItem[] = data.data.slice(0, 50).map(item => ({
    id: item.id,
    title: item.title,
    url: new URL(item.page_url, base).href,
    pubDate: item.updated_at ? Number(item.updated_at) : undefined,
    extra: {
      hover: item.description,
    },
  }))

  return translateNewsItemsToChinese(items)
})
