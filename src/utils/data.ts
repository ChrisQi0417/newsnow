import type { SourceID, SourceResponse } from "@shared/types"
import { ManualRefreshCooldown, TTL } from "@shared/consts"
import { sources } from "@shared/sources"

export const cacheSources = new Map<SourceID, SourceResponse>()
export const refetchSources = new Set<SourceID>()

const sourceAutoRefreshTimes = new Map<SourceID, number>()
const manualRefreshTimes = new Map<SourceID, number>()
const sourceRequestConcurrency = 1
const sourceRequestMinStartGap = 1500
const sourceRequestWaiters: Array<() => void> = []
let activeSourceRequests = 0
let nextSourceRequestAt = 0

export function sourceRefreshInterval(id: SourceID) {
  return Math.max(sources[id].interval, TTL)
}

export function sourceNeedsRefresh(id: SourceID, updatedTime: number | string | undefined, now = Date.now()) {
  if (updatedTime === undefined || updatedTime === null || updatedTime === "") return true
  const raw = String(updatedTime)
  const timestamp = typeof updatedTime === "number" || /^\d+$/.test(raw) ? Number(updatedTime) : Date.parse(raw)
  return !Number.isFinite(timestamp) || now - timestamp >= sourceRefreshInterval(id)
}

export function scheduleSourceAutoRefresh(id: SourceID, now = Date.now()) {
  if (refetchSources.has(id)) return false

  const lastRefresh = sourceAutoRefreshTimes.get(id)
  if (lastRefresh !== undefined && now - lastRefresh < sourceRefreshInterval(id)) return false

  sourceAutoRefreshTimes.set(id, now)
  return true
}

export function requestSourceRefresh(id: SourceID, now = Date.now()) {
  if (refetchSources.has(id)) return false
  const lastManualRefresh = manualRefreshTimes.get(id)
  if (lastManualRefresh !== undefined && now - lastManualRefresh < ManualRefreshCooldown) return false
  manualRefreshTimes.set(id, now)
  sourceAutoRefreshTimes.set(id, now)
  refetchSources.add(id)
  return true
}

export function completeSourceRefresh(id: SourceID, now = Date.now()) {
  sourceAutoRefreshTimes.set(id, now)
  refetchSources.delete(id)
}

export function failSourceRefresh(id: SourceID) {
  refetchSources.delete(id)
}

export function resetSourceRefreshState() {
  sourceAutoRefreshTimes.clear()
  manualRefreshTimes.clear()
  refetchSources.clear()
  nextSourceRequestAt = 0
}

async function acquireSourceRequestSlot() {
  if (activeSourceRequests < sourceRequestConcurrency) {
    activeSourceRequests += 1
    return
  }
  await new Promise<void>(resolve => sourceRequestWaiters.push(resolve))
}

function releaseSourceRequestSlot() {
  const next = sourceRequestWaiters.shift()
  if (next) next()
  else activeSourceRequests -= 1
}

export async function withSourceRequestLimit<T>(request: () => Promise<T>): Promise<T> {
  await acquireSourceRequestSlot()
  try {
    const wait = Math.max(0, nextSourceRequestAt - Date.now())
    if (wait) await new Promise(resolve => setTimeout(resolve, wait))
    nextSourceRequestAt = Date.now() + sourceRequestMinStartGap
    return await request()
  } finally {
    releaseSourceRequestSlot()
  }
}
