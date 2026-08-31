import { load } from "cheerio"
import type { NewsItem } from "@shared/types"
import { translateNewsItemsToChinese } from "../utils/translate"

export interface XAccount {
  displayName: string
  handle: "OpenAI" | "thsottiaux"
  info: string
}

interface EmbeddedTweet {
  created_at?: string
  full_text?: string
  id_str?: string
  in_reply_to_screen_name?: string
  permalink?: string
  retweeted_status?: unknown
  text?: string
  user?: {
    screen_name?: string
  }
}

interface EmbeddedTimelineData {
  props?: {
    pageProps?: {
      timeline?: {
        entries?: Array<{
          content?: { tweet?: EmbeddedTweet }
          type?: string
        }>
      }
    }
  }
}

interface TiboFeedTweet {
  at?: string
  declared_at?: string
  id?: string
  is_reply?: boolean
  replying_to?: string | null
  text?: string
  url?: string
}

interface TiboFeedResponse {
  profile?: {
    handle?: string
  }
  source_scope?: string
  stale?: boolean
  tweets?: TiboFeedTweet[]
  version?: number
}

interface XOEmbedResponse {
  author_url?: string
  html?: string
  provider_name?: string
}

export const fixedXAccounts: readonly XAccount[] = [
  {
    displayName: "Tibo",
    handle: "thsottiaux",
    info: "Tibo @thsottiaux",
  },
  {
    displayName: "OpenAI 官方",
    handle: "OpenAI",
    info: "OpenAI 官方 @OpenAI",
  },
]

const browserHeaders = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
}

function normalizeText(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\"",
  }
  return value
    .replace(/&(#x?[\da-f]+|amp|apos|gt|lt|quot);/gi, (match, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLocaleLowerCase()] ?? match
      const hexadecimal = entity[1]?.toLocaleLowerCase() === "x"
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    })
    .replace(/\s+/g, " ")
    .trim()
}

function sameHandle(value: string | undefined, account: XAccount) {
  return value?.replace(/^@/, "").toLocaleLowerCase() === account.handle.toLocaleLowerCase()
}

function toTimestamp(value?: string) {
  if (!value) return
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function normalizePostUrl(value: string | undefined, account: XAccount) {
  if (!value) return

  try {
    const url = new URL(value, `https://x.com/${account.handle}`)
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/i)
    if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) || !match) return
    if (!sameHandle(match[1], account)) return
    return `https://x.com/${account.handle}/status/${match[2]}`
  } catch {
  }
}

function sameProfileUrl(value: string | undefined, account: XAccount) {
  if (!value) return false
  try {
    const url = new URL(value)
    const match = url.pathname.match(/^\/([^/]+)\/?$/)
    return url.protocol === "https:"
      && ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)
      && Boolean(match && sameHandle(match[1], account))
  } catch {
    return false
  }
}

function createXPost(account: XAccount, title: string, url: string, pubDate?: number): NewsItem {
  const displayTitle = /^https?:\/\/\S+$/i.test(title) ? `链接内容：${title}` : title
  return {
    id: url,
    title: displayTitle,
    url,
    pubDate,
    extra: {
      info: account.info,
      hover: `来源：X 官方账号 ${account.displayName}（@${account.handle}）`,
    },
  }
}

export function curateFixedXPosts(items: NewsItem[], limit = 40) {
  const seen = new Set<string>()
  return items
    .filter(item => item.url && normalizeText(String(item.title)).length >= 2)
    .sort((a, b) => Number(b.pubDate ?? 0) - Number(a.pubDate ?? 0))
    .filter((item) => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .slice(0, limit)
}

export function parseXProfilePage(html: string, account: XAccount) {
  const $ = load(html)
  const items: NewsItem[] = []

  $("article").each((_, element) => {
    const article = $(element)
    const author = article.find("meta[itemprop='alternateName']").first().attr("content")
    const title = normalizeText(article.find("meta[itemprop='articleBody']").first().attr("content") ?? "")
    const url = normalizePostUrl(article.find("meta[itemprop='url']").first().attr("content"), account)
    const pubDate = toTimestamp(article.find("meta[itemprop='datePublished']").first().attr("content"))
    if (!sameHandle(author, account) || !title || !url) return
    items.push(createXPost(account, title, url, pubDate))
  })

  return curateFixedXPosts(items)
}

export function parseXEmbeddedProfile(html: string, account: XAccount) {
  const $ = load(html)
  const raw = $("script#__NEXT_DATA__[type='application/json']").first().text()
  if (!raw) return []

  let data: EmbeddedTimelineData
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }

  const entries = data.props?.pageProps?.timeline?.entries ?? []
  const items = entries.flatMap(({ content, type }): NewsItem[] => {
    const tweet = content?.tweet
    const title = normalizeText(tweet?.full_text ?? tweet?.text ?? "")
    const url = normalizePostUrl(tweet?.permalink || (tweet?.id_str ? `/${account.handle}/status/${tweet.id_str}` : undefined), account)
    const isOwnPost = sameHandle(tweet?.user?.screen_name, account) && !tweet?.retweeted_status
    const isOwnThread = !tweet?.in_reply_to_screen_name || sameHandle(tweet.in_reply_to_screen_name, account)
    if (type !== "tweet" || !isOwnPost || !isOwnThread || !title || !url) return []
    return [createXPost(account, title, url, toTimestamp(tweet?.created_at))]
  })

  return curateFixedXPosts(items)
}

export function parseTiboFeedCandidates(data: unknown, account: XAccount, limit = 10) {
  const feed = data as TiboFeedResponse
  if (account.handle !== "thsottiaux"
    || feed?.version !== 1
    || feed.source_scope !== "timeline"
    || feed.stale !== false
    || !sameHandle(feed.profile?.handle, account)
    || !Array.isArray(feed.tweets)) {
    return []
  }

  const items = feed.tweets.flatMap((tweet): NewsItem[] => {
    const id = String(tweet.id ?? "")
    const title = normalizeText(String(tweet.text ?? ""))
    const url = normalizePostUrl(tweet.url, account)
    const isOwnThread = !tweet.is_reply || sameHandle(tweet.replying_to ?? undefined, account)
    const pubDate = toTimestamp(tweet.at ?? tweet.declared_at)
    if (!/^\d+$/.test(id) || !title || !url || !url.endsWith(`/status/${id}`) || !isOwnThread || !pubDate) return []
    return [createXPost(account, title, url, pubDate)]
  })

  return curateFixedXPosts(items, limit)
}

export function parseXOEmbedPost(data: XOEmbedResponse, account: XAccount, candidate?: NewsItem) {
  if (!/^(?:X|Twitter)$/i.test(String(data?.provider_name ?? "")) || !sameProfileUrl(data?.author_url, account) || !data?.html) return

  const $ = load(data.html)
  const paragraph = $("blockquote.twitter-tweet p").first()
  paragraph.find("br").replaceWith(" ")
  const title = normalizeText(paragraph.text() || String(candidate?.title ?? ""))
  const url = normalizePostUrl($("blockquote.twitter-tweet a[href*='/status/']").last().attr("href"), account)
  if (!title || !url || (candidate?.url && candidate.url !== url)) return
  return createXPost(account, title, url, candidate?.pubDate as number | undefined)
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index])
    }
  }))
  return results
}

async function fetchVerifiedTiboPosts(account: XAccount) {
  const feed = await myFetch<TiboFeedResponse>("https://codex-reset.com/api/feed", {
    headers: {
      "Accept": "application/json",
      "User-Agent": "NewsNow Tibo timeline",
    },
    retry: 1,
    timeout: 6000,
  })
  const candidates = parseTiboFeedCandidates(feed, account)
  const verified = await mapConcurrent(candidates, 5, async (candidate) => {
    try {
      const url = new URL("https://publish.x.com/oembed")
      url.searchParams.set("url", candidate.url)
      url.searchParams.set("omit_script", "1")
      url.searchParams.set("dnt", "true")
      const data = await myFetch<XOEmbedResponse>(url.toString(), {
        headers: {
          "Accept": "application/json",
          "User-Agent": "NewsNow X verification",
        },
        retry: 1,
        timeout: 6000,
      })
      return parseXOEmbedPost(data, account, candidate)
    } catch {
      return undefined
    }
  })
  return curateFixedXPosts(verified.filter((item): item is NewsItem => Boolean(item)), candidates.length)
}

async function fetchEmbeddedAccountPosts(account: XAccount) {
  const embedUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${account.handle}`
  const html = await myFetch<string>(embedUrl, {
    responseType: "text",
    headers: browserHeaders,
    retry: 1,
    timeout: 8000,
  })
  return parseXEmbeddedProfile(html, account)
}

async function fetchAccountPosts(account: XAccount) {
  const embeddedPromise = fetchEmbeddedAccountPosts(account).catch((error) => {
    logger.warn(`failed to fetch embedded X timeline @${account.handle}`, error)
    return []
  })

  if (account.handle === "thsottiaux") {
    const [embedded, verified] = await Promise.all([
      embeddedPromise,
      fetchVerifiedTiboPosts(account).catch((error) => {
        logger.warn("failed to fetch verified Tibo timeline", error)
        return []
      }),
    ])
    if (verified.length) return verified
    if (embedded.length) return embedded
  } else {
    const embedded = await embeddedPromise
    if (embedded.length) return embedded
  }

  const profileUrl = `https://x.com/${account.handle}`
  const html = await myFetch<string>(profileUrl, {
    responseType: "text",
    headers: browserHeaders,
    retry: 1,
    timeout: 8000,
  })
  return parseXProfilePage(html, account)
}

export default defineSource(async () => {
  const results = await Promise.all(fixedXAccounts.map(async (account) => {
    try {
      return await fetchAccountPosts(account)
    } catch (error) {
      logger.warn(`failed to fetch all X sources for @${account.handle}`, error)
      return []
    }
  }))

  const items = curateFixedXPosts(results.flat())
  if (!items.length) throw new Error("Cannot fetch Tibo or OpenAI X posts")
  return translateNewsItemsToChinese(items, "twitter")
})
