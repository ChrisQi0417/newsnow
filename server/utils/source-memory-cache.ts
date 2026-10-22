import type { SourceID } from "@shared/types"
import { ManualRefreshCooldown } from "@shared/consts"
import { sources } from "@shared/sources"
import type { CacheInfo } from "../types"

const maxEntries = 64
const maxEntryLength = 128_000
const maxRetention = 6 * 60 * 60_000
const recentSources = new Map<SourceID, { cache: CacheInfo, expiresAt: number }>()

function pruneRecentSources(now: number) {
  for (const [id, entry] of recentSources) {
    if (entry.expiresAt <= now) recentSources.delete(id)
  }
}

export function rememberSourceSuccess(cache: CacheInfo) {
  if (cache.id === "weather" || !cache.items.length) return
  pruneRecentSources(Date.now())
  // This is an outage fallback, so bound both the entry count and payload size.
  if (JSON.stringify(cache).length > maxEntryLength) return
  recentSources.delete(cache.id)
  recentSources.set(cache.id, {
    cache,
    expiresAt: cache.updated + Math.min(maxRetention, Math.max(ManualRefreshCooldown, sources[cache.id].interval)),
  })
  while (recentSources.size > maxEntries) recentSources.delete(recentSources.keys().next().value!)
}

export function readSourceSuccess(id: SourceID, now = Date.now()) {
  pruneRecentSources(now)
  return recentSources.get(id)?.cache
}

export function forgetSourceSuccess(id: SourceID) {
  recentSources.delete(id)
}
