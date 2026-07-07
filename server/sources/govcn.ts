interface GovCnItem {
  description?: string
  link: string
  pubDate: string
  title: string
}

export default defineSource(async () => {
  const raw: string = await myFetch("https://www.gov.cn/pushinfo/v150203/pushinfo.jsonp")
  const [, json = "[]"] = raw.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/) ?? []
  const data = JSON.parse(json) as GovCnItem[]

  return data.map(item => ({
    id: item.link,
    title: item.title,
    url: item.link,
    pubDate: tranformToUTC(item.pubDate, "YYYY-MM-DD"),
    extra: {
      hover: item.description,
    },
  }))
})
