import type { SourceID } from "@shared/types"
import type { CacheInfo } from "../types"
import type { TranslationAI } from "./translate"
import { isChineseOutput, translateNewsItemsForOutput } from "./translate"
import { readSourceSuccess } from "./source-memory-cache"

export const CachedTranslationRepairInterval = 15 * 60_000

interface TranslationRepairStore {
  get: (key: string) => Promise<CacheInfo | undefined>
  set: (key: string, items: CacheInfo["items"], accountStatus?: CacheInfo["accountStatus"], updated?: number) => Promise<unknown>
}

// Keys are restricted to the validated source registry by the API caller.
const attempts = new Map<SourceID, number>()
const inFlight = new Map<SourceID, Promise<CacheInfo>>()

/** Repair only cached titles; never collect media or change collection metadata. */
export async function repairCachedTranslation(
  cache: CacheInfo,
  ai?: TranslationAI,
  store?: TranslationRepairStore,
): Promise<CacheInfo> {
  // Repair uses the existing AI binding, not additional public translation APIs.
  if (!ai || !cache.items.length || isChineseOutput(cache.items)) return cache
  const pending = inFlight.get(cache.id)
  if (pending) {
    const result = await pending
    return result.updated >= cache.updated ? result : cache
  }

  const repair = async () => {
    const now = Date.now()
    const key = `translation-repair:${cache.id}`
    const resultKey = `translation-result:${cache.id}`
    try {
      const result = await store?.get(resultKey)
      if (result?.id === resultKey && result.updated === cache.updated && result.items.length === cache.items.length
        && result.items.every((item, index) => item.id === cache.items[index].id && item.url === cache.items[index].url)) {
        cache = { ...cache, items: result.items }
        if (isChineseOutput(cache.items)) return cache
      }
    } catch { /* A missing result falls through to the existing repair cooldown. */ }
    let attemptedAt = attempts.get(cache.id) ?? 0
    try {
      const marker = await store?.get(key)
      if (marker?.id === key && marker.updated <= now && marker.updated > attemptedAt) attemptedAt = marker.updated
    } catch { /* Instance-local cooldown survives a storage outage. */ }
    if (attemptedAt && now - attemptedAt < CachedTranslationRepairInterval) return cache
    attempts.set(cache.id, now)
    try {
      // Persist before inference, including when inference later fails.
      await store?.set(key, [], undefined, now)
    } catch { /* Keep the bounded instance-local cooldown. */ }

    let items: CacheInfo["items"]
    try {
      items = await translateNewsItemsForOutput(cache.items, cache.id, ai)
    } catch {
      return cache
    }
    if (items.length !== cache.items.length || items.every((item, index) => item.title === cache.items[index].title)) return cache
    const repaired = { ...cache, items }

    // A concurrent collection can complete while inference is running.
    const recent = readSourceSuccess(cache.id)
    if (recent && recent.updated > cache.updated) return recent
    try {
      const current = await store?.get(cache.id)
      if (current && current.updated !== cache.updated) return current.updated > cache.updated ? current : repaired
      if (current && isChineseOutput(current.items)) return current
      // Store a versioned overlay under a separate key. Edge Cache has no atomic
      // compare-and-set, so a delayed repair must never write the media cache.
      await store?.set(resultKey, items, undefined, cache.updated)
    } catch { /* Repaired titles remain usable in this response. */ }
    return repaired
  }

  const task = repair()
  inFlight.set(cache.id, task)
  try {
    return await task
  } finally {
    if (inFlight.get(cache.id) === task) inFlight.delete(cache.id)
  }
}
