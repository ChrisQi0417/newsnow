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
    if (url.protocol !== "https:" || url.hostname !== "x.com" || !match) return
    if (!sameHandle(match[1], account)) return
    return `https://x.com/${account.handle}/status/${match[2]}`
  } catch {
  }
}

function createXPost(account: XAccount, title: string, url: string, pubDate?: number): NewsItem {
  return {
    id: url,
    title,
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

async function fetchAccountPosts(account: XAccount) {
  const profileUrl = `https://x.com/${account.handle}`
  try {
    const html = await myFetch<string>(profileUrl, {
      responseType: "text",
      headers: browserHeaders,
      retry: 1,
      timeout: 8000,
    })
    const items = parseXProfilePage(html, account)
    if (items.length) return items
  } catch (error) {
    logger.warn(`failed to fetch X profile @${account.handle}`, error)
  }

  const embedUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${account.handle}`
  const html = await myFetch<string>(embedUrl, {
    responseType: "text",
    headers: browserHeaders,
    retry: 1,
    timeout: 8000,
  })
  return parseXEmbeddedProfile(html, account)
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
  return translateNewsItemsToChinese(items)
})
