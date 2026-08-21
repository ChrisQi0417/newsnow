import { describe, expect, it } from "vitest"
import { mergeNewSourcesByDefaultOrder, metadata, orderSourcesByDefaultOrder, placeSourceAfter, realtimeSourcePriority } from "../shared/metadata"
import { sources } from "../shared/sources"

describe("stored column migration", () => {
  it("keeps the requested modules at the start of realtime", () => {
    expect(metadata.realtime.sources.slice(0, 7)).toEqual([
      "weather",
      "markets",
      "truthsocial",
      "github",
      "twitter",
      "ai",
      "apple",
    ])
    expect(metadata.hottest.sources).toContain("pi")
    expect(metadata.hottest.sources).toContain("apple")
  })

  it("puts China-focused sources at the end of realtime", () => {
    const chinaSources = [
      "scmp-news",
      "scmp-hongkong",
      "scmp-china",
      "xinhua-world",
      "xinhua-business",
      "xinhua-tech",
      "xinhua-china",
      "govcn",
      "people-world",
      "people-finance",
      "people-politics",
      "chinanews-world",
      "chinanews-finance",
      "chinanews-china",
    ]

    expect(metadata.realtime.sources.slice(-chinaSources.length)).toEqual(chinaSources)
  })

  it("includes every realtime source exactly once", () => {
    const realtimeSources = Object.entries(sources)
      .filter(([, source]) => source.type === "realtime" && !source.redirect)
      .map(([id]) => id)

    expect(metadata.realtime.sources).toHaveLength(realtimeSources.length)
    expect(new Set(metadata.realtime.sources).size).toBe(realtimeSources.length)
    expect(metadata.realtime.sources).toEqual(expect.arrayContaining(realtimeSources))
    expect(realtimeSourcePriority).toHaveLength(realtimeSources.length)
  })

  it("migrates an existing custom order to the new realtime priority", () => {
    const stored = ["govcn", "apple", "twitter", "weather", "markets", "truthsocial"]

    expect(orderSourcesByDefaultOrder(stored, metadata.realtime.sources)).toEqual([
      "weather",
      "markets",
      "truthsocial",
      "twitter",
      "apple",
      "govcn",
    ])
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
