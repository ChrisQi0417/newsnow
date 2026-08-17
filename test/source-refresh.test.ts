import { describe, expect, it } from "vitest"
import { parseAfpFactCheckReader, parseAfpNewsHub } from "../server/sources/afp"
import { parseAPNewsPage, parseAPNewsSitemap } from "../server/sources/apnews"
import { parseGovCnLatest } from "../server/sources/govcn"
import { discoverNikkeiNewsSitemaps, parseNikkeiNewsSitemap } from "../server/sources/nikkei"

describe("source refresh parsers", () => {
  it("parses current AFP News Hub bulletins with official timestamps", () => {
    const html = `
      <div id="header_slider">
        <p class="afp_news_visibility afp_news_visibility_show">
          <span>Washington (AFP)</span>
          <span class="date"> | 17/08/2026 - 02:16:07</span>
          <span class="title"> | Current AFP official bulletin</span>
        </p>
      </div>
    `
    expect(parseAfpNewsHub(html)).toEqual([expect.objectContaining({
      title: "Current AFP official bulletin",
      pubDate: Date.parse("2026-08-17T02:16:07Z"),
      extra: expect.objectContaining({ info: "Washington (AFP)" }),
    })])
  })

  it("parses dated AFP Fact Check official fallback entries", () => {
    const raw = `
      [Image Published on 15/08/2026 at 08:33 ## Current verified AFP report](https://factcheck.afp.com/doc.afp.com.C4JN668 "Current verified AFP report")
      [Image Published on 14/08/2026 at 18:24 ## Second verified AFP report](https://factcheck.afp.com/doc.afp.com.C4J62G3 "Second verified AFP report")
    `
    const items = parseAfpFactCheckReader(raw)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      title: "Current verified AFP report",
      url: "https://factcheck.afp.com/doc.afp.com.C4JN668",
      pubDate: Date.parse("2026-08-15T08:33:00Z"),
    })
  })

  it("reads AP publication timestamps from article cards and ignores navigation duplicates", () => {
    const html = `
      <nav><a href="/article/current-story-1234567890">Current story navigation title</a></nav>
      <div data-posted-date-timestamp="1786916231000">
        <a href="/article/current-story-1234567890">Current category</a>
        <a href="/article/current-story-1234567890">Current story article title</a>
      </div>
      <div data-posted-date-timestamp="1786901943000">
        <a href="https://apnews.com/article/second-story-1234567890">Second current article title</a>
      </div>
    `

    const items = parseAPNewsPage(html, "https://apnews.com/world-news")
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      title: "Current story article title",
      pubDate: 1786916231000,
      url: "https://apnews.com/article/current-story-1234567890",
    })
  })

  it("parses full AP titles and publication dates from the official news sitemap", () => {
    const xml = `
      <urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
        <url>
          <loc>https://apnews.com/article/current-story-1234567890</loc>
          <news:news>
            <news:publication_date>2026-08-16T17:37:11-04:00</news:publication_date>
            <news:title>Complete Associated Press article headline</news:title>
          </news:news>
        </url>
      </urlset>
    `

    expect(parseAPNewsSitemap(xml)).toEqual([expect.objectContaining({
      title: "Complete Associated Press article headline",
      url: "https://apnews.com/article/current-story-1234567890",
      pubDate: Date.parse("2026-08-16T17:37:11-04:00"),
    })])
  })

  it("parses the current gov.cn latest-news JSON and rejects invalid links", () => {
    const items = parseGovCnLatest([
      {
        TITLE: "中国政府网最新要闻",
        SUB_TITLE: "官方发布",
        URL: "https://www.gov.cn/yaowen/liebiao/202608/content_1.htm",
        DOCRELPUBTIME: "2026-08-16",
      },
      {
        TITLE: "无效链接",
        URL: "javascript:alert(1)",
        DOCRELPUBTIME: "2026-08-16",
      },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "中国政府网最新要闻",
      pubDate: Date.parse("2026-08-16T00:00:00+08:00"),
      extra: { hover: "官方发布" },
    })
  })

  it("discovers and parses dated Nikkei Asia news sitemaps", () => {
    const index = `
      <sitemapindex>
        <sitemap><loc>https://asia.nikkei.com/news_sitemap.xml?date=20260817</loc></sitemap>
        <sitemap><loc>https://example.com/untrusted.xml</loc></sitemap>
      </sitemapindex>
    `
    expect(discoverNikkeiNewsSitemaps(index)).toEqual([
      "https://asia.nikkei.com/news_sitemap.xml?date=20260817",
    ])

    const sitemap = `
      <urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
        <url>
          <loc>https://asia.nikkei.com/business/current-story</loc>
          <news:news>
            <news:publication_date>2026-08-16T07:37:22+09:00</news:publication_date>
            <news:title>Current Nikkei Asia story</news:title>
          </news:news>
        </url>
      </urlset>
    `
    expect(parseNikkeiNewsSitemap(sitemap)).toEqual([expect.objectContaining({
      title: "Current Nikkei Asia story",
      url: "https://asia.nikkei.com/business/current-story",
      pubDate: Date.parse("2026-08-16T07:37:22+09:00"),
    })])
  })
})
