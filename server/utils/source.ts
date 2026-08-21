import type { AllSourceID, NewsItem } from "@shared/types"
import defu from "defu"
import { translateNewsItemsToChinese } from "./translate"
import type { RSSHubOption, RSSHubInfo as RSSHubResponse, SourceGetter, SourceOption } from "#/types"

type R = Partial<Record<AllSourceID, SourceGetter>>
export function defineSource(source: SourceGetter): SourceGetter
export function defineSource(source: R): R
export function defineSource(source: SourceGetter | R): SourceGetter | R {
  return source
}

export function defineRSSSource(url: string, option?: SourceOption): SourceGetter {
  return async () => {
    // The API exposes at most 30 items; avoid parsing and translating a full archive feed.
    const data = await rss2json(url, Math.min(option?.limit ?? 30, 30))
    if (!data?.items.length) throw new Error("Cannot fetch rss data")
    const seen = new Set<string>()
    let items: NewsItem[] = data.items.flatMap((item) => {
      const title = String(item.title ?? "").replace(/\s+/g, " ").trim()
      const url = String(item.link ?? "").trim()
      if (!title || !url || seen.has(url)) return []
      seen.add(url)
      return [{
        title,
        url,
        id: url,
        pubDate: !option?.hiddenDate ? item.created : undefined,
      }]
    })
    if (option?.limit) items = items.slice(0, option.limit)
    return option?.translate ? translateNewsItemsToChinese(items) : items
  }
}

export function defineRSSHubSource(route: string, RSSHubOptions?: RSSHubOption, sourceOption?: SourceOption): SourceGetter {
  return async () => {
    // "https://rsshub.pseudoyu.com"
    const RSSHubBase = "https://rsshub.rssforever.com"
    const url = new URL(route, RSSHubBase)
    url.searchParams.set("format", "json")
    RSSHubOptions = defu<RSSHubOption, RSSHubOption[]>(RSSHubOptions, {
      sorted: true,
    })

    Object.entries(RSSHubOptions).forEach(([key, value]) => {
      url.searchParams.set(key, value.toString())
    })
    const data: RSSHubResponse = await myFetch(url)
    let items: NewsItem[] = data.items.map(item => ({
      title: item.title,
      url: item.url,
      id: item.id ?? item.url,
      pubDate: !sourceOption?.hiddenDate ? item.date_published : undefined,
    }))
    if (sourceOption?.limit) items = items.slice(0, sourceOption.limit)
    return sourceOption?.translate ? translateNewsItemsToChinese(items) : items
  }
}
