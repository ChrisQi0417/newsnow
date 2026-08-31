import type { SourceID, SourceResponse } from "@shared/types"

export const cacheSources = new Map<SourceID, SourceResponse>()
export const refetchSources = new Set<SourceID>()

const sourceAutoRefreshInterval = 60 * 1000
const sourceAutoRefreshTimes = new Map<SourceID, number>()

export function scheduleSourceAutoRefresh(id: SourceID, now = Date.now()) {
  const lastRefresh = sourceAutoRefreshTimes.get(id)
  if (lastRefresh !== undefined && now - lastRefresh < sourceAutoRefreshInterval) return false

  sourceAutoRefreshTimes.set(id, now)
  refetchSources.add(id)
  return true
}

export function requestSourceRefresh(id: SourceID, now = Date.now()) {
  sourceAutoRefreshTimes.set(id, now)
  refetchSources.add(id)
}

export function resetSourceRefreshState() {
  sourceAutoRefreshTimes.clear()
  refetchSources.clear()
}

const sourceRequestConcurrency = 2
const sourceRequestWaiters: Array<() => void> = []
let activeSourceRequests = 0

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
    return await request()
  } finally {
    releaseSourceRequestSlot()
  }
}
