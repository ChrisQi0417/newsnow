import { XMLParser } from "fast-xml-parser"
import type { RSSInfo } from "../types"

function text(value: any) {
  return value && typeof value === "object" && "$text" in value ? value.$text : value
}

function link(value: any): string {
  if (Array.isArray(value)) {
    const alternate = value.find(item => item?.rel === "alternate" && item?.href)
    return link(alternate ?? value[0])
  }
  if (value && typeof value === "object") return String(value.href ?? value.$text ?? "")
  return typeof value === "string" ? value : ""
}

export function parseRSSXML(data: string): RSSInfo | undefined {
  const xml = new XMLParser({
    attributeNamePrefix: "",
    textNodeName: "$text",
    ignoreAttributes: false,
  })

  const result = xml.parse(data as string)

  const rdf = result["rdf:RDF"]
  let channel = result.rss && result.rss.channel ? result.rss.channel : (result.feed ?? rdf?.channel)
  if (Array.isArray(channel)) channel = channel[0]
  if (!channel) return

  const rss = {
    title: channel.title ?? "",
    description: channel.description ?? "",
    link: link(channel.link),
    image: channel.image ? channel.image.url : channel["itunes:image"] ? channel["itunes:image"].href : "",
    category: channel.category || [],
    updatedTime: channel.lastBuildDate ?? channel.updated,
    items: [],
  }

  let items = channel.item || channel.entry || rdf?.item || []
  if (items && !Array.isArray(items)) items = [items]

  for (let i = 0; i < items.length; i++) {
    const val = items[i]
    const media = {}

    const obj = {
      id: text(val.guid) ?? text(val.id),
      title: text(val.title),
      description: text(val.summary) ?? text(val.description),
      link: link(val.link),
      author: val.author && val.author.name ? val.author.name : val["dc:creator"],
      created: val.published ?? val.updated ?? val.pubDate ?? val.created ?? val["dc:date"],
      category: val.category || [],
      content: val.content && val.content.$text ? val.content.$text : val["content:encoded"],
      enclosures: val.enclosure ? (Array.isArray(val.enclosure) ? val.enclosure : [val.enclosure]) : [],
    };

    ["content:encoded", "podcast:transcript", "itunes:summary", "itunes:author", "itunes:explicit", "itunes:duration", "itunes:season", "itunes:episode", "itunes:episodeType", "itunes:image"].forEach((s) => {
      // @ts-expect-error TODO
      if (val[s]) obj[s.replace(":", "_")] = val[s]
    })

    if (val["media:thumbnail"]) {
      Object.assign(media, { thumbnail: val["media:thumbnail"] })
      obj.enclosures.push(val["media:thumbnail"])
    }

    if (val["media:content"]) {
      Object.assign(media, { thumbnail: val["media:content"] })
      obj.enclosures.push(val["media:content"])
    }

    if (val["media:group"]) {
      if (val["media:group"]["media:title"]) obj.title = val["media:group"]["media:title"]

      if (val["media:group"]["media:description"]) obj.description = val["media:group"]["media:description"]

      if (val["media:group"]["media:thumbnail"]) obj.enclosures.push(val["media:group"]["media:thumbnail"].url)

      if (val["media:group"]["media:content"]) obj.enclosures.push(val["media:group"]["media:content"])
    }

    Object.assign(obj, { media })

    // @ts-expect-error TODO
    rss.items.push(obj)
  }

  return rss
}

export async function rss2json(url: string): Promise<RSSInfo | undefined> {
  if (!/^https?:\/\/[^\s$.?#].\S*/i.test(url)) return

  const data = await myFetch<string>(url, {
    responseType: "text",
  })
  return parseRSSXML(data)
}
