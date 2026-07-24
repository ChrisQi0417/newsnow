import { describe, expect, it } from "vitest"
import {
  curateLatestAIItems,
  isUSFocusedAIHeadline,
  parseAnthropicNewsPage,
  parseMetaAINewsPage,
  parseReutersUSAINews,
  restoreAIProperNames,
} from "../server/sources/ai"

describe("us AI news", () => {
  it("parses Anthropic cards and publication-list entries", () => {
    const html = `
      <a href="/news/claude-sonnet-5">
        <time>Jun 30, 2026</time>
        <h4 class="card-title">Introducing Claude Sonnet 5</h4>
      </a>
      <a href="/news/economic-index">
        <time>Jul 22, 2026</time>
        <span class="publication-title">Ask Claude about the Anthropic Economic Index</span>
      </a>
    `
    const items = parseAnthropicNewsPage(html)

    expect(items).toHaveLength(2)
    expect(items[0].url).toBe("https://www.anthropic.com/news/claude-sonnet-5")
    expect(items[0].extra?.info).toBe("Anthropic")
    expect(items[1].pubDate).toBe(new Date("Jul 22, 2026").getTime())
  })

  it("parses Meta AI cards and removes duplicate image/title links", () => {
    const html = `
      <article>
        <a aria-label="Read Introducing Llama 5" href="https://ai.meta.com/blog/llama-5/"></a>
        <a href="https://ai.meta.com/blog/llama-5/">Introducing Llama 5</a>
        <div>July 9, 2026</div>
      </article>
    `
    const [item] = parseMetaAINewsPage(html)

    expect(parseMetaAINewsPage(html)).toHaveLength(1)
    expect(item.title).toBe("Introducing Llama 5")
    expect(item.pubDate).toBe(new Date("July 9, 2026").getTime())
    expect(item.extra?.info).toBe("Meta AI")
  })

  it("keeps Reuters AI news tied to the US and drops China-only headlines", () => {
    const raw = `
      <urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
        <url>
          <loc>https://www.reuters.com/technology/openai-model-2026-07-22/</loc>
          <news:news><news:publication_date>2026-07-22T12:00:00Z</news:publication_date><news:title>OpenAI launches a new AI model for US businesses</news:title></news:news>
        </url>
        <url>
          <loc>https://www.reuters.com/world/china/deepseek-model-2026-07-22/</loc>
          <news:news><news:publication_date>2026-07-22T11:00:00Z</news:publication_date><news:title>China's DeepSeek launches a new AI model</news:title></news:news>
        </url>
      </urlset>
    `
    const items = parseReutersUSAINews(raw)

    expect(items).toHaveLength(1)
    expect(items[0].extra?.info).toBe("Reuters 路透社")
    expect(isUSFocusedAIHeadline("US weighs NVIDIA AI chip exports to China")).toBe(true)
    expect(isUSFocusedAIHeadline("China's DeepSeek launches a new AI model")).toBe(false)
  })

  it("sorts newest first and removes duplicate URLs and titles", () => {
    const items = curateLatestAIItems([
      { id: "old", title: "Older AI item", url: "https://example.com/old", pubDate: 1 },
      { id: "new", title: "Latest AI item", url: "https://example.com/new", pubDate: 3 },
      { id: "duplicate-url", title: "Duplicate URL", url: "https://example.com/new", pubDate: 2 },
      { id: "duplicate-title", title: "Latest AI item", url: "https://example.com/other", pubDate: 2 },
    ])

    expect(items.map(item => item.id)).toEqual(["new", "old"])
  })

  it("keeps AI company and product names from being mistranslated", () => {
    const original = "US accuses China's Moonshot of stealing from Anthropic's Fable AI model"
    const translated = "美国指责中国登月公司窃取人类寓言人工智能模型"

    expect(restoreAIProperNames(original, translated))
      .toBe("美国指责中国 Moonshot AI 公司窃取 Anthropic Fable 人工智能模型")
  })
})
