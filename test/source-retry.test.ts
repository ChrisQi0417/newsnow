import { beforeEach, describe, expect, it, vi } from "vitest"
import { SourceRetryBaseDelay, SourceRetryMaxDelay, clearSourceRetry, getSourceRetry, parseSourceRetryState, recordSourceFailure, safeSourceIssues } from "../server/utils/source-retry"
import type { SourceRetryState } from "../server/utils/source-retry"

beforeEach(() => clearSourceRetry("bbc"))

describe("source retry policy", () => {
  it("backs off from fifteen minutes to six hours without growing unbounded", async () => {
    let state: SourceRetryState | undefined
    let now = 1000
    const delays = []
    for (let attempt = 0; attempt < 10; attempt++) {
      state = await recordSourceFailure("bbc", state, ["source:timeout"], undefined, now)
      delays.push(state.nextRetryAt - now)
      now = state.nextRetryAt
    }
    expect(delays).toEqual([1, 2, 4, 8, 16, 24, 24, 24, 24, 24].map(multiplier => SourceRetryBaseDelay * multiplier))
    expect(state?.failures).toBe(6)
    expect(delays.at(-1)).toBe(SourceRetryMaxDelay)
    await clearSourceRetry("bbc")
    expect(await getSourceRetry("bbc")).toBeUndefined()
  })

  it("rejects malformed persisted state and exposes only bounded diagnostic codes", () => {
    const state = { failures: 1, lastAttemptAt: 1000, nextRetryAt: 901000, issues: ["source:timeout"] }
    expect(parseSourceRetryState(state)).toEqual(state)
    for (const value of [null, {}, { ...state, failures: 0 }, { ...state, failures: 7 }, { ...state, lastAttemptAt: Infinity }, { ...state, nextRetryAt: 1000 }, { ...state, nextRetryAt: 1000 + SourceRetryMaxDelay + 1 }]) {
      expect(parseSourceRetryState(value)).toBeUndefined()
    }
    expect(safeSourceIssues(["source:http-429", "source:http-429", "source:timeout", "https://secret.example/token", "request:private response", 123])).toEqual(["source:http-429", "source:timeout"])
    expect(safeSourceIssues(Array.from({ length: 20 }, (_, index) => `stage-${index}:empty`))).toHaveLength(8)
  })

  it("distinguishes remotely cleared failures from failures whose persistence was rejected", async () => {
    let persisted: SourceRetryState | undefined
    const store = {
      getRetry: async () => persisted,
      setRetry: async (_id: string, state: SourceRetryState) => {
        persisted = state
      },
    }
    const state = await recordSourceFailure("bbc", undefined, ["source:timeout"], store, 1000)
    expect(await getSourceRetry("bbc", store)).toEqual(state)
    persisted = undefined
    expect(await getSourceRetry("bbc", store)).toBeUndefined()
    const failingStore = { getRetry: async () => undefined, setRetry: vi.fn().mockRejectedValue(new Error("unavailable")) }
    const unpersisted = await recordSourceFailure("bbc", undefined, ["source:timeout"], failingStore, 2000)
    expect(await getSourceRetry("bbc", failingStore)).toEqual(unpersisted)
  })

  it("keeps a newer failure when a previously started persistent read returns no state", async () => {
    let finishRead!: (value: SourceRetryState | undefined) => void
    const pendingRead = getSourceRetry("bbc", { getRetry: () => new Promise((resolve) => {
      finishRead = resolve
    }) })
    const state = await recordSourceFailure("bbc", undefined, ["source:timeout"], { setRetry: async () => {} }, 1000)
    finishRead(undefined)
    expect(await pendingRead).toEqual(state)
  })

  it("does not resurrect a failure after a newer clear while a read is pending", async () => {
    const state = await recordSourceFailure("bbc", undefined, ["source:timeout"], undefined, 1000)
    let finishRead!: (value: SourceRetryState | undefined) => void
    const pendingRead = getSourceRetry("bbc", { getRetry: () => new Promise((resolve) => {
      finishRead = resolve
    }) })
    await clearSourceRetry("bbc", { clearRetry: async () => {} })
    finishRead(state)
    expect(await pendingRead).toBeUndefined()
    expect(await getSourceRetry("bbc")).toBeUndefined()
  })

  it("does not let a stale read undo a remotely observed recovery", async () => {
    const state = await recordSourceFailure("bbc", undefined, ["source:timeout"], { setRetry: async () => {} }, 1000)
    let finishRead!: (value: SourceRetryState | undefined) => void
    const pendingRead = getSourceRetry("bbc", { getRetry: () => new Promise((resolve) => {
      finishRead = resolve
    }) })
    expect(await getSourceRetry("bbc", { getRetry: async () => undefined })).toBeUndefined()
    finishRead(state)
    expect(await pendingRead).toBeUndefined()
    expect(await getSourceRetry("bbc")).toBeUndefined()
  })

  it("does not let an older empty read erase a newly observed remote failure", async () => {
    let finishRead!: (value: SourceRetryState | undefined) => void
    const pendingRead = getSourceRetry("bbc", { getRetry: () => new Promise((resolve) => {
      finishRead = resolve
    }) })
    const state = { failures: 1, lastAttemptAt: 1000, nextRetryAt: 901000, issues: ["source:timeout"] }
    expect(await getSourceRetry("bbc", { getRetry: async () => state })).toEqual(state)
    finishRead(undefined)
    expect(await pendingRead).toEqual(state)
    expect(await getSourceRetry("bbc")).toEqual(state)
  })
})
