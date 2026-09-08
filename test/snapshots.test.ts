import { describe, expect, it } from "vitest"
import { parseSourceSnapshot } from "../src/utils/snapshots"

const snapshot = { id: "reuters", updatedTime: 1_000_000, items: [{ id: "1", title: "News", url: "https://reuters.com/article/1" }] }
describe("local news snapshots", () => {
  it("preserves the actual retrieval time and marks restored data as cache", () => {
    expect(parseSourceSnapshot(JSON.stringify(snapshot), "reuters", 2_000_000)).toMatchObject({ ...snapshot, status: "cache" })
  })
  it("rejects weather, mismatched sources, expired and future snapshots", () => {
    expect(parseSourceSnapshot(JSON.stringify({ ...snapshot, id: "weather" }), "weather", 2_000_000)).toBeUndefined()
    expect(parseSourceSnapshot(JSON.stringify(snapshot), "ai", 2_000_000)).toBeUndefined()
    expect(parseSourceSnapshot(JSON.stringify(snapshot), "reuters", 100_000_000)).toBeUndefined()
    expect(parseSourceSnapshot(JSON.stringify(snapshot), "reuters", 500_000)).toBeUndefined()
  })
  it("rejects corrupt storage and unsafe article URLs", () => {
    expect(parseSourceSnapshot("{broken", "reuters")).toBeUndefined()
    expect(parseSourceSnapshot(JSON.stringify({ ...snapshot, items: [null, { id: "2", title: "Bad", url: "javascript:alert(1)" }] }), "reuters", 2_000_000)?.items).toEqual([])
  })
})
