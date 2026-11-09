import type { NewsItem } from "@shared/types"

export interface OfficialBlueskyPublisher {
  handle: string
  did: string
  publisher: string
  note?: string
}

interface OfficialBlueskyFeed {
  feed?: Array<{
    reason?: unknown
    reply?: unknown
    post?: {
      uri?: string
      author?: { did?: string, handle?: string }
      record?: {
        $type?: string
        text?: string
        createdAt?: string
        reply?: unknown
      }
    }
  }>
}

export function officialBlueskyFeedUrl(handle: string) {
  return `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=30&filter=posts_no_replies`
}

export function parseOfficialBluesky(data: unknown, publisher: OfficialBlueskyPublisher, now = Date.now()): NewsItem[] {
  const feed = (data as OfficialBlueskyFeed | undefined)?.feed
  if (!Array.isArray(feed)) return []
  const seen = new Set<string>()
  return feed.flatMap((entry): NewsItem[] => {
    const post = entry?.post
    const record = post?.record
    const uri = typeof post?.uri === "string" ? post.uri : ""
    const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([a-z2-7]{13})$/.exec(uri)
    const title = typeof record?.text === "string" ? record.text.replace(/\s+/g, " ").trim() : ""
    const createdAt = typeof record?.createdAt === "string" ? record.createdAt : ""
    const pubDate = Date.parse(createdAt)
    const day = createdAt.slice(0, 10)
    const dayTimestamp = Date.parse(`${day}T00:00:00Z`)
    if (entry?.reason || entry?.reply || record?.reply
      || post?.author?.did !== publisher.did || post.author.handle !== publisher.handle
      || record?.$type !== "app.bsky.feed.post" || !match || match[1] !== publisher.did
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt)
      || !Number.isFinite(dayTimestamp) || new Date(dayTimestamp).toISOString().slice(0, 10) !== day
      || !Number.isFinite(pubDate) || pubDate > now + 5 * 60 * 1000
      || !title || seen.has(uri)) {
      return []
    }
    seen.add(uri)
    return [{
      id: uri,
      title,
      url: `https://bsky.app/profile/${publisher.handle}/post/${match[2]}`,
      pubDate,
      extra: {
        info: `${publisher.publisher}官方动态 · Bluesky`,
        hover: `来源：${publisher.publisher}官方 Bluesky 账号 ${publisher.handle}；发布时间为原帖时间。${publisher.note ?? ""}`,
      },
    }]
  }).sort((a, b) => Number(b.pubDate) - Number(a.pubDate)).slice(0, 30)
}
