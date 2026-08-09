import { describe, expect, it } from "vitest"
import { parseAppleNewsTodayPage, restoreAppleNewsProperNames } from "../server/sources/apple"

describe("apple News Today", () => {
  it("parses, sorts, and deduplicates official Apple podcast episodes", () => {
    const items = parseAppleNewsTodayPage(`
      <script type="application/ld+json">{"name":"Unrelated show","@type":"CreativeWorkSeries"}</script>
      <script type="application/ld+json">
        {
          "@type": "CreativeWorkSeries",
          "name": "Apple News Today",
          "workExample": [
            {
              "@type": "AudioObject",
              "datePublished": "2026-08-07T11:00:00Z",
              "name": "An older Apple News briefing",
              "url": "https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585?i=1000000000001&uo=4"
            },
            {
              "@type": "PodcastEpisode",
              "datePublished": "2026-08-08T11:00:00Z",
              "name": "The latest U.S. headlines",
              "url": "https://podcasts.apple.com/us/podcast/the-latest-u-s-headlines/id1473872585?i=1000000000002"
            },
            {
              "@type": "PodcastEpisode",
              "datePublished": "2026-08-06T11:00:00Z",
              "name": "Duplicate episode",
              "url": "https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585?i=1000000000002"
            },
            {
              "@type": "PodcastEpisode",
              "datePublished": "2026-08-09T11:00:00Z",
              "name": "An untrusted copy",
              "url": "https://example.com/apple-news-today?id=1000000000003"
            }
          ]
        }
      </script>
    `)

    expect(items.map(item => item.title)).toEqual([
      "The latest U.S. headlines",
      "An older Apple News briefing",
    ])
    expect(items[0]).toMatchObject({
      url: "https://podcasts.apple.com/us/podcast/the-latest-u-s-headlines/id1473872585?i=1000000000002",
      pubDate: new Date("2026-08-08T11:00:00Z").getTime(),
      extra: { info: "Apple News Today" },
    })
  })

  it("supports Apple JSON-LD graphs", () => {
    const items = parseAppleNewsTodayPage(`
      <script type="application/ld+json">
        {"@graph":[{"@type":"CreativeWorkSeries","name":"Apple News Today","workExample":{
          "@type":"PodcastEpisode",
          "datePublished":"2026-08-08",
          "name":"Daily briefing",
          "url":"https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585?i=1000000000004"
        }}]}
      </script>
    `)

    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("Daily briefing")
  })

  it("restores the Apple News brand after translation", () => {
    expect(restoreAppleNewsProperNames(
      "Apple News Today covers the election",
      "苹果新闻今日报道选举",
    )).toBe("Apple News Today报道选举")
  })
})
