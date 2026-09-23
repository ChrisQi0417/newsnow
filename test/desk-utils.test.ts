import { describe, expect, it } from "vitest"
import type { SourceID } from "@shared/types"
import { groupSourcesByPublisher, sourceCategoryLabel } from "../src/utils/desk"

describe("publisher module grouping", () => {
  it("combines a publisher's feeds while preserving their category order", () => {
    const groups = groupSourcesByPublisher([
      "bloomberg-business",
      "bloomberg-markets",
      "bloomberg-technology",
      "reuters",
    ])

    expect(groups).toEqual([
      {
        id: "bloomberg-business",
        ids: ["bloomberg-business", "bloomberg-markets", "bloomberg-technology"],
        name: "彭博社",
      },
      { id: "reuters", ids: ["reuters"], name: "路透社" },
    ])
  })

  it("groups BBC Chinese and international feeds under one publisher", () => {
    const ids: SourceID[] = ["bbc", "bbcnews-world", "bbcnews-worldservice"]
    const groups = groupSourcesByPublisher(ids)

    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe("BBC")
    expect(ids.map(id => sourceCategoryLabel(id))).toEqual([
      "中文",
      "国际",
      "国际广播",
    ])
  })
})
