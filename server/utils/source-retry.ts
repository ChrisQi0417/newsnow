import type { SourceID } from "@shared/types"

export const SourceRetryBaseDelay = 15 * 60_000
export const SourceRetryMaxDelay = 6 * 60 * 60_000

export interface SourceRetryState {
  failures: number
  lastAttemptAt: number
  nextRetryAt: number
  issues: string[]
}

export interface SourceRetryStore {
  getRetry?: (key: string) => Promise<SourceRetryState | undefined>
  setRetry?: (key: string, state: SourceRetryState) => Promise<void>
  clearRetry?: (key: string) => Promise<unknown>
}

// Retain protection when persistence is temporarily unavailable. This is an
// instance-local fallback, not a cross-isolate lock.
const retryStates = new Map<SourceID, { state: SourceRetryState, persisted: boolean }>()
const retryVersions = new Map<SourceID, number>()

function advanceRetryVersion(id: SourceID) {
  retryVersions.set(id, (retryVersions.get(id) ?? 0) + 1)
}

export function safeSourceIssues(issues: unknown): string[] {
  if (!Array.isArray(issues)) return []
  return [...new Set(issues.filter((issue): issue is string => typeof issue === "string"
    && /^[a-z][a-z0-9-]{0,31}:(?:http-[1-5]\d{2}|timeout|request-failed|empty)$/.test(issue)))].slice(0, 8)
}

export function parseSourceRetryState(value: unknown): SourceRetryState | undefined {
  if (!value || typeof value !== "object") return
  const state = value as Partial<SourceRetryState>
  if (!Number.isInteger(state.failures) || state.failures! < 1 || state.failures! > 6
    || !Number.isFinite(state.lastAttemptAt) || state.lastAttemptAt! < 0
    || !Number.isFinite(state.nextRetryAt) || state.nextRetryAt! <= state.lastAttemptAt!
    || state.nextRetryAt! - state.lastAttemptAt! > SourceRetryMaxDelay) {
    return
  }
  return {
    failures: state.failures!,
    lastAttemptAt: state.lastAttemptAt!,
    nextRetryAt: state.nextRetryAt!,
    issues: safeSourceIssues(state.issues),
  }
}

export async function getSourceRetry(id: SourceID, store?: SourceRetryStore): Promise<SourceRetryState | undefined> {
  if (!store?.getRetry) return retryStates.get(id)?.state
  const version = retryVersions.get(id) ?? 0
  try {
    const persisted = parseSourceRetryState(await store.getRetry(id))
    const local = retryStates.get(id)
    // An older read may finish after a newer failure or successful recovery.
    // Never let that result erase or resurrect the newer local state.
    if ((retryVersions.get(id) ?? 0) !== version) return local?.state
    if (persisted && (!local || persisted.lastAttemptAt > local.state.lastAttemptAt
      || (persisted.lastAttemptAt === local.state.lastAttemptAt && persisted.nextRetryAt === local.state.nextRetryAt))) {
      advanceRetryVersion(id)
      retryStates.set(id, { state: persisted, persisted: true })
      return persisted
    }
    if (!persisted && local?.persisted) {
      // Another instance successfully cleared this previously persisted failure.
      advanceRetryVersion(id)
      retryStates.delete(id)
      return undefined
    }
    return local?.state
  } catch { /* The local state still protects this instance during a cache outage. */ }
  return retryStates.get(id)?.state
}

export async function recordSourceFailure(id: SourceID, previous: SourceRetryState | undefined, issues: string[], store?: SourceRetryStore, now = Date.now()) {
  const failures = Math.min(6, (previous?.failures ?? 0) + 1)
  const state: SourceRetryState = {
    failures,
    lastAttemptAt: now,
    nextRetryAt: now + Math.min(SourceRetryMaxDelay, SourceRetryBaseDelay * 2 ** (failures - 1)),
    issues: safeSourceIssues(issues),
  }
  advanceRetryVersion(id)
  const local = { state, persisted: false }
  retryStates.set(id, local)
  try {
    if (store?.setRetry) {
      await store.setRetry(id, state)
      if (retryStates.get(id) === local) local.persisted = true
    }
  } catch { /* Keep the in-memory backoff even when persistence fails. */ }
  return state
}

export async function clearSourceRetry(id: SourceID, store?: SourceRetryStore) {
  advanceRetryVersion(id)
  retryStates.delete(id)
  try {
    await store?.clearRetry?.(id)
  } catch { /* A cache outage must not turn successful collection into an error. */ }
}

export class SourceRefreshFailure extends Error {
  constructor(readonly retry: SourceRetryState) {
    super("数据源暂时不可用，请稍后重试")
  }
}
