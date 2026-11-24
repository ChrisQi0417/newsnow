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
  isCollecting: () => boolean = () => false,
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
      // Edge Cache has no atomic compare-and-set. Recheck the version immediately
      // before writing and never persist over a known in-flight collection.
      if (current && !isCollecting()) await store?.set(cache.id, items, cache.accountStatus, cache.updated)
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
