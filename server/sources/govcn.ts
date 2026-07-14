interface GovCnItem {
  description?: string
  link: string
  pubDate: string
  title: string
}

export default defineSource(async () => {
  const raw = await myFetch<string>("https://www.gov.cn/pushinfo/v150203/pushinfo.jsonp", {
    responseType: "text",
  })
  const start = raw.indexOf("(")
  const end = raw.lastIndexOf(")")
  if (start < 0 || end <= start) throw new Error("Cannot parse gov.cn pushinfo")
  const json = raw.slice(start + 1, end)
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
