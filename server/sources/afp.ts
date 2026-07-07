import { load } from "cheerio"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

export default defineSource(async () => {
  const html = await myFetch<string>("https://www.afp.com/en", {
    responseType: "text",
  })
  const $ = load(html)
  const items: NewsItem[] = []

  $("#header_slider p").each((_, element) => {
    const place = $(element).find("span").first().text().trim()
    const dateText = $(element).find(".date").text().replace(/^\s*\|\s*/, "").trim()
    const title = $(element).find(".title").text().replace(/^\s*\|\s*/, "").trim()
    if (!title || !dateText) return

    items.push({
      id: `${dateText}-${place}-${title}`,
      title: place ? `${place}: ${title}` : title,
      url: "https://www.afp.com/en",
      pubDate: tranformToUTC(dateText, "DD/MM/YYYY - HH:mm:ss", "Europe/Paris"),
      extra: {
        hover: `AFP快讯：${place} | ${dateText}`,
      },
    })
  })

  if (!items.length) throw new Error("Cannot fetch AFP flash news")
  return translateNewsItemsToChinese(items)
})
