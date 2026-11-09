import type { NewsItem } from "@shared/types"
import { ManualRefreshCooldown } from "@shared/consts"
import { SourceUnavailableError, sourceFailure } from "./source-failure"
import { SourceRetryBaseDelay, SourceRetryMaxDelay, parseSourceRetryState, safeSourceIssues } from "./source-retry"
import type { SourceRetryState } from "./source-retry"

export type CachedXHandle = "OpenAI" | "thsottiaux"
export interface XAccountStatus {
  handle: CachedXHandle
  status: "success" | "stale" | "unavailable"
  updatedTime?: number
  nextRetryAt?: number
  issues: string[]
}
interface AccountContent {
  items: NewsItem[]
  updated: number
}
export interface XAccountStore {
  get: (key: string) => Promise<AccountContent | undefined>
  set: (key: string, items: NewsItem[], accountStatus?: undefined, updated?: number) => Promise<unknown>
  getRetry?: (key: string) => Promise<SourceRetryState | undefined>
  setRetry?: (key: string, state: SourceRetryState) => Promise<unknown>
  clearRetry?: (key: string) => Promise<unknown>
}
export interface XAccountFetchResult {
  items: NewsItem[]
  issues?: string[]
}
interface AccountResult {
  items: NewsItem[]
  status: XAccountStatus
}
interface AccountMemory {
  content?: AccountContent
  contentPersisted?: boolean
  retry?: SourceRetryState
  retryPersisted?: boolean
}

const interval = 30 * 60_000
const retention = 7 * 24 * 60 * 60_000
// Only the two fixed handles can occupy these maps. Bound retained content too.
const memory = new Map<CachedXHandle, AccountMemory>()
const pending = new Map<CachedXHandle, Promise<AccountResult>>()
export const xAccountCacheKey = (handle: CachedXHandle) => `twitter-account:${handle}`

function validContent(value: AccountContent | undefined, handle: CachedXHandle, now: number): AccountContent | undefined {
  if (!value || !Number.isFinite(value.updated) || value.updated < now - retention || value.updated > now + 60_000 || !Array.isArray(value.items)) return
  const items = value.items.filter((item) => {
    try {
      const url = new URL(item.url)
      return url.protocol === "https:" && url.hostname === "x.com"
        && new RegExp(`^/${handle}/status/\\d+$`, "i").test(url.pathname)
        && typeof item.title === "string" && Boolean(item.title.trim())
    } catch {
      return false
    }
  }).slice(0, 15)
  if (!items.length || JSON.stringify(items).length > 64 * 1024) return
  return { updated: value.updated, items }
}

export function resetXAccountMemory() {
  memory.clear()
  pending.clear()
}

function mergeAccountItems(fresh: NewsItem[], previous: NewsItem[]) {
  const seen = new Set<string>()
  return [...fresh, ...previous].filter((item) => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  }).sort((a, b) => Number(b.pubDate ?? 0) - Number(a.pubDate ?? 0)).slice(0, 15)
}

export async function loadXAccount(handle: CachedXHandle, store: XAccountStore | undefined, fetchPosts: () => Promise<XAccountFetchResult>, force = false, loadLegacyContent?: () => Promise<AccountContent | undefined>): Promise<AccountResult> {
  const inFlight = pending.get(handle)
  if (inFlight) return inFlight
  const task = load()
  pending.set(handle, task)
  try {
    return await task
  } finally {
    if (pending.get(handle) === task) pending.delete(handle)
  }

  async function load(): Promise<AccountResult> {
    const key = xAccountCacheKey(handle)
    const now = Date.now()
    const state = memory.get(handle) ?? {}
    memory.set(handle, state)
    let content = validContent(state.content, handle, now)
    try {
      const persisted = validContent(await store?.get(key), handle, now)
      if (persisted && (!content || persisted.updated > content.updated || (persisted.updated === content.updated && state.contentPersisted))) {
        content = persisted
        state.contentPersisted = true
      }
    } catch { /* Retain valid instance content during storage failures. */ }
    state.content = content
    if (!content && loadLegacyContent) {
      try {
        content = validContent(await loadLegacyContent(), handle, now)
        if (content) await persistContent()
      } catch { /* Missing legacy content must not prevent a fresh account fetch. */ }
    }
    let retry = state.retry
    if (store?.getRetry) {
      try {
        const persisted = parseSourceRetryState(await store.getRetry(key))
        if (persisted && (!retry || persisted.lastAttemptAt >= retry.lastAttemptAt)) {
          retry = persisted
          state.retryPersisted = true
        } else if (!persisted && state.retryPersisted) {
          retry = undefined
          state.retryPersisted = false
        }
      } catch { /* Retain instance cooldown while persistence is unavailable. */ }
    }
    // A successful content write can outlive a failed deletion of an older retry.
    if (content && retry && content.updated > retry.lastAttemptAt) retry = undefined
    state.retry = retry
    if (retry && now < retry.nextRetryAt) return result(retry)
    if (!retry && content && now - content.updated < (force ? ManualRefreshCooldown : interval)) return result()

    try {
      const fetched = await fetchPosts()
      const fresh = validContent({ items: fetched.items, updated: Date.now() }, handle, Date.now())
      if (!fresh) throw new SourceUnavailableError([sourceFailure(`x-${handle.toLowerCase()}`)])
      const issues = safeSourceIssues(fetched.issues)
      content = issues.length && content
        ? { items: mergeAccountItems(fresh.items, content.items), updated: content.updated }
        : fresh
      await persistContent()
      if (issues.length) return await failed(issues)
      state.retry = undefined
      state.retryPersisted = false
      try {
        await store?.clearRetry?.(key)
      } catch { /* Newer content suppresses a stale persisted retry. */ }
      return result()
    } catch (error) {
      return failed(error instanceof SourceUnavailableError ? error.issues : [sourceFailure(`x-${handle.toLowerCase()}`, error)])
    }

    async function persistContent() {
      state.content = content
      state.contentPersisted = false
      try {
        if (store && content) {
          await store.set(key, content.items, undefined, content.updated)
          state.contentPersisted = true
        }
      } catch { /* The bounded local copy retains its original collection time. */ }
    }

    function result(failure?: SourceRetryState): AccountResult {
      return {
        items: content?.items ?? [],
        status: {
          handle,
          status: failure ? content ? "stale" : "unavailable" : "success",
          ...(content ? { updatedTime: content.updated } : {}),
          ...(failure ? { nextRetryAt: failure.nextRetryAt } : {}),
          issues: failure?.issues ?? [],
        },
      }
    }

    async function failed(issues: string[]): Promise<AccountResult> {
      const failures = Math.min(6, (retry?.failures ?? 0) + 1)
      const lastAttemptAt = Date.now()
      const failure: SourceRetryState = {
        failures,
        lastAttemptAt,
        nextRetryAt: lastAttemptAt + Math.min(SourceRetryMaxDelay, SourceRetryBaseDelay * 2 ** (failures - 1)),
        issues: safeSourceIssues(issues),
      }
      state.retry = failure
      state.retryPersisted = false
      try {
        if (store?.setRetry) {
          await store.setRetry(key, failure)
          state.retryPersisted = true
        }
      } catch { /* Keep local failure protection when storage is unavailable. */ }
      return result(failure)
    }
  }
}
