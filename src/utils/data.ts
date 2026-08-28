import type { SourceID, SourceResponse } from "@shared/types"

export const cacheSources = new Map<SourceID, SourceResponse>()
export const refetchSources = new Set<SourceID>()

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
