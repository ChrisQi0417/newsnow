import { beforeEach, describe, expect, it, vi } from "vitest"
import apnews from "../server/sources/apnews"

const { fetchMock, translateMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  translateMock: vi.fn(async (items: unknown) => items),
}))
vi.mock("../server/utils/fetch", () => ({ myFetch: fetchMock }))
vi.mock("../server/utils/translate", () => ({ translateNewsItemsToChinese: translateMock }))

const businessUrl = "https://apnews.com/business"
const sitemapUrl = "https://apnews.com/news-sitemap-content.xml"
const malformedSitemap = "<urlset><url attr=\"unterminated></url></urlset>"
const page = `<div data-posted-date-timestamp="1794225600000">
  <a href="/article/business-report">Current business article headline</a>
</div>`
const index = `<rss><channel><item>
  <title>Indexed business article headline</title>
  <link>https://apnews.com/article/indexed-business-report</link>
  <pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate>
</item></channel></rss>`

beforeEach(() => {
  fetchMock.mockReset()
  translateMock.mockClear()
})

describe("ap source parsing isolation", () => {
  it("preserves a successful section page when sitemap XML is malformed", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === sitemapUrl) return malformedSitemap
      if (url === businessUrl) return page
      throw new Error(`Unexpected fallback: ${url}`)
    })

    const items = await apnews["apnews-business"]!({} as never)

    expect(items).toEqual([expect.objectContaining({
      title: "Current business article headline",
      url: "https://apnews.com/article/business-report",
      pubDate: 1794225600000,
    })])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(translateMock).toHaveBeenCalledWith(items, `apnews:${businessUrl}`)
  })

  it("continues to the existing index when sitemap XML is malformed and the section page is empty", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === sitemapUrl) return malformedSitemap
      if (url === businessUrl) return "<h1>Business</h1>"
      if (new URL(url).hostname === "www.bing.com") return index
      throw new Error(`Unexpected fallback: ${url}`)
    })

    const items = await apnews["apnews-business"]!({} as never)

    expect(items).toEqual([expect.objectContaining({
      title: "Indexed business article headline",
      url: "https://apnews.com/article/indexed-business-report",
      pubDate: Date.parse("2026-11-09T12:00:00Z"),
    })])
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(["apnews.com", "apnews.com", "www.bing.com"])
    expect(translateMock).toHaveBeenCalledWith(items, `apnews:${businessUrl}`)
  })
})
