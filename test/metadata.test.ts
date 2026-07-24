import { describe, expect, it } from "vitest"
import { mergeNewSourcesByDefaultOrder, placeSourceAfter } from "../shared/metadata"

describe("stored column migration", () => {
  it("inserts a new source beside its default predecessor", () => {
    const stored = ["markets", "truthsocial", "reuters", "govcn"]
    const defaults = ["markets", "ai", "govcn", "truthsocial", "reuters"]

    expect(mergeNewSourcesByDefaultOrder(stored, defaults))
      .toEqual(["markets", "ai", "truthsocial", "reuters", "govcn"])
  })

  it("keeps the user's order and removes obsolete and duplicate sources", () => {
    const stored = ["reuters", "obsolete", "markets", "reuters"]
    const defaults = ["markets", "ai", "govcn", "reuters"]

    expect(mergeNewSourcesByDefaultOrder(stored, defaults))
      .toEqual(["reuters", "markets", "ai", "govcn"])
  })

  it("moves the AI source once when an earlier release appended it", () => {
    const stored = ["markets", "truthsocial", "reuters", "ai", "govcn"]

    expect(placeSourceAfter(stored, "ai", "markets"))
      .toEqual(["markets", "ai", "truthsocial", "reuters", "govcn"])
  })
})
