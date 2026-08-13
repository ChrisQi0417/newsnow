import { describe, expect, it } from "vitest"
import { parseAppleNewsPodcastFeed, parseAppleNewsTodayPage, restoreAppleNewsProperNames } from "../server/sources/apple"

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

  it("parses podcasts and US Apple News editorial story links", () => {
    const items = parseAppleNewsPodcastFeed(`
      <rss><channel>
        <item>
          <title>Inside the latest U.S. headlines</title>
          <description><![CDATA[
            <p>The government released a major economic report. The <a href="https://apple.news/AtrustedStoryOne">Reuters</a>'s team explains the data.</p>
            <p>A court issued a consequential ruling. The <a href="https://apple.news/AtrustedStoryTwo">Washington Post</a>'s reporters break it down.</p>
            <p>Plus, one company <a href="https://apple.news/AshortOne">advanced</a>, another <a href="https://apple.news/AshortTwo">retreated</a>.</p>
            <p>An untrusted copy. The <a href="https://example.com/story">Example</a> reports.</p>
          ]]></description>
          <guid>official-episode-guid</guid>
          <pubDate>Wed, 12 Aug 2026 10:00:00 GMT</pubDate>
          <link>https://apple.news/AofficialEpisode</link>
        </item>
      </channel></rss>
    `, {
      showName: "Apple News Today",
      url: "https://apple.news/podcast/apple_news_today",
      includeEditorialStories: true,
    })

    expect(items).toHaveLength(3)
    expect(items.map(item => item.extra?.info)).toEqual([
      "Apple Podcasts · Apple News Today",
      "Apple News 美区精选 · Reuters",
      "Apple News 美区精选 · Washington Post",
    ])
    expect(items[1]).toMatchObject({
      title: "The government released a major economic report",
      url: "https://apple.news/AtrustedStoryOne",
      pubDate: new Date("Wed, 12 Aug 2026 10:00:00 GMT").getTime(),
    })
  })

  it("keeps In Conversation episodes as official podcasts", () => {
    const items = parseAppleNewsPodcastFeed(`
      <rss><channel><item>
        <title>A weekly deep dive</title>
        <description><![CDATA[<p>Read more from <a href="https://apple.news/AnotExtracted">The Atlantic</a>.</p>]]></description>
        <guid>conversation-guid</guid>
        <pubDate>Thu, 06 Aug 2026 21:00:00 GMT</pubDate>
        <link>https://apple.news/AconversationEpisode</link>
      </item></channel></rss>
    `, {
      showName: "Apple News In Conversation",
      url: "https://apple.news/podcast/apple_news_in_conversation",
    })

    expect(items).toHaveLength(1)
    expect(items[0].extra?.info).toBe("Apple Podcasts · Apple News In Conversation")
  })

  it("restores the Apple News brand after translation", () => {
    expect(restoreAppleNewsProperNames(
      "Apple News Today covers the election",
      "苹果新闻今日报道选举",
    )).toBe("Apple News Today报道选举")
  })
})
