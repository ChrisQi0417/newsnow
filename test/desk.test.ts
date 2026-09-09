import { describe, expect, it } from "vitest"
import { articleKey, articleTime, matchesArticle, sourceCategory, sourceWarning, uniqueArticles } from "../src/utils/desk"
import type { DeskArticle } from "../src/utils/desk"

function article(sourceId: DeskArticle["sourceId"], id: string, url = "https://example.com/news"): DeskArticle {
  return { sourceId, item: { id, url, title: "OpenAI 发布新模型", pubDate: "2026-09-08T10:00:00Z" } }
}

describe("information desk", () => {
  it("warns about a reachable but stale NHK feed without flagging current news", () => {
    const item = article("nhk", "1").item
    expect(sourceWarning("nhk", [item], Date.parse("2026-09-11T10:00:00Z"))).toContain("48")
    expect(sourceWarning("nhk", [item], Date.parse("2026-09-08T11:00:00Z"))).toBeUndefined()
    expect(sourceWarning("fed", [item], Date.parse("2026-09-11T10:00:00Z"))).toBeUndefined()
  })
  it("keeps China sources out of international and technology filters", () => {
    expect(sourceCategory("xinhua-world")).toBe("china")
    expect(sourceCategory("people-finance")).toBe("china")
    expect(sourceCategory("ai")).toBe("tech")
    expect(sourceCategory("markets")).toBe("finance")
    expect(sourceCategory("weather")).toBe("weather")
  })
  it("searches all query words across source and content, ignoring case", () => {
    expect(matchesArticle(article("twitter", "1"), "openai 模型")).toBe(true)
    expect(matchesArticle(article("twitter", "1"), "tibo OpenAI")).toBe(true)
    expect(matchesArticle(article("twitter", "1"), "openai 地震")).toBe(false)
  })
  it("deduplicates tracking variants without merging different articles or data rows", () => {
    expect(uniqueArticles([
      article("reuters", "1", "https://example.com/news?utm_source=rss"),
      article("apple", "2", "https://example.com/news#top"),
      article("reuters", "3", "https://example.com/news?id=other"),
      article("weather", "beijing"),
      article("weather", "local"),
    ])).toHaveLength(4)
  })
  it("never uses fetch time as missing publication time", () => {
    expect(articleTime({ id: "a", title: "No date", url: "https://example.com" })).toBe(0)
    expect(articleTime(article("twitter", "1").item)).toBe(Date.parse("2026-09-08T10:00:00Z"))
    expect(articleKey(article("twitter", "1"))).not.toBe(articleKey(article("ai", "1")))
  })
})
