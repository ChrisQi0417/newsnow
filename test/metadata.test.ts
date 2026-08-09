import { describe, expect, it } from "vitest"
import { mergeNewSourcesByDefaultOrder, metadata, placeSourceAfter } from "../shared/metadata"

describe("stored column migration", () => {
  it("includes Pi Network and Apple News in realtime and hottest defaults", () => {
    expect(metadata.realtime.sources.slice(0, 4)).toEqual(["markets", "pi", "apple", "ai"])
    expect(metadata.hottest.sources).toContain("pi")
    expect(metadata.hottest.sources).toContain("apple")
  })

  it("inserts new sources beside their default predecessors", () => {
    const stored = ["markets", "truthsocial", "reuters", "govcn"]
    const defaults = ["markets", "pi", "apple", "ai", "fed", "github", "govcn", "truthsocial", "reuters"]

    expect(mergeNewSourcesByDefaultOrder(stored, defaults))
      .toEqual(["markets", "pi", "apple", "ai", "fed", "github", "truthsocial", "reuters", "govcn"])
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

  it("moves GitHub Trending after the Federal Reserve card", () => {
    const stored = ["markets", "ai", "fed", "truthsocial", "github", "reuters"]

    expect(placeSourceAfter(stored, "github", "fed"))
      .toEqual(["markets", "ai", "fed", "github", "truthsocial", "reuters"])
  })
})
