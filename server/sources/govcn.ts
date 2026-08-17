interface GovCnLatestItem {
  DOCRELPUBTIME: string
  SUB_TITLE?: string
  TITLE: string
  URL: string
}

interface GovCnPolicyItem {
  description?: string
  link: string
  pubDate: string
  title: string
}

export function parseGovCnLatest(data: GovCnLatestItem[]) {
  const seen = new Set<string>()
  return data.flatMap((item) => {
    const title = item.TITLE?.replace(/\s+/g, " ").trim()
    let url: URL
    try {
      url = new URL(item.URL)
    } catch {
      return []
    }
    if (!title || url.protocol !== "https:" || seen.has(url.href)) return []
    seen.add(url.href)
    return [{
      id: url.href,
      title,
      url: url.href,
      pubDate: tranformToUTC(item.DOCRELPUBTIME, "YYYY-MM-DD"),
      extra: {
        hover: item.SUB_TITLE?.trim() || "来源：中国政府网要闻最新",
      },
    }]
  })
}

async function fetchPolicyFallback() {
  const raw = await myFetch<string>("https://www.gov.cn/pushinfo/v150203/pushinfo.jsonp", {
    responseType: "text",
  })
  const start = raw.indexOf("(")
  const end = raw.lastIndexOf(")")
  if (start < 0 || end <= start) throw new Error("Cannot parse gov.cn pushinfo")
  const json = raw.slice(start + 1, end)
  const data = JSON.parse(json) as GovCnPolicyItem[]

  return data.map(item => ({
    id: item.link,
    title: item.title,
    url: item.link,
    pubDate: tranformToUTC(item.pubDate, "YYYY-MM-DD"),
    extra: {
      hover: item.description,
    },
  }))
}

export default defineSource(async () => {
  try {
    const data = await myFetch<GovCnLatestItem[]>("https://www.gov.cn/yaowen/liebiao/YAOWENLIEBIAO.json", {
      responseType: "json",
    })
    const items = parseGovCnLatest(data)
    if (items.length) return items.slice(0, 50)
  } catch (error) {
    logger.warn("failed to fetch gov.cn latest news", error)
  }

  return fetchPolicyFallback()
})
