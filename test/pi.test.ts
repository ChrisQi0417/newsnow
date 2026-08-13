import { describe, expect, it } from "vitest"
import { parsePiDirectMediaFeed, parsePiMediaFeed, parsePiMediaJson, parsePiMediaReaderFeed, parsePiOfficialBlogPage, parsePiOfficialFeed, parsePiReaderFeed, restorePiProperNames } from "../server/sources/pi"

describe("pi Network news", () => {
  it("parses, sorts, and deduplicates official feed items", () => {
    const items = parsePiOfficialFeed(`
      <rss><channel>
        <item>
          <title>Older Pi Network update</title>
          <link>https://minepi.com/blog/older/?campaign=test</link>
          <pubDate>Mon, 03 Aug 2026 16:00:00 +0000</pubDate>
        </item>
        <item>
          <title>Latest Pi2Day recap</title>
          <link>https://www.minepi.com/blog/latest/</link>
          <pubDate>Wed, 05 Aug 2026 16:00:00 +0000</pubDate>
        </item>
        <item>
          <title>Duplicate</title>
          <link>https://minepi.com/blog/latest/</link>
          <pubDate>Tue, 04 Aug 2026 16:00:00 +0000</pubDate>
        </item>
        <item>
          <title>Untrusted copy</title>
          <link>https://example.com/pi-network/</link>
          <pubDate>Thu, 06 Aug 2026 16:00:00 +0000</pubDate>
        </item>
      </channel></rss>
    `)

    expect(items.map(item => item.title)).toEqual([
      "Latest Pi2Day recap",
      "Older Pi Network update",
    ])
    expect(items[0].url).toBe("https://minepi.com/blog/latest/")
    expect(items[0].extra?.info).toBe("Pi Network 官方")
  })

  it("parses the official blog page as a feed fallback", () => {
    const items = parsePiOfficialBlogPage(`
      <article>
        <h3 class="title"><a href="https://minepi.com/blog/protocol-update/"> Protocol update </a></h3>
        <div class="grav-wrap"><div class="text"><a>Pi Network</a><span>August 5, 2026</span></div></div>
      </article>
    `)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "Protocol update",
      url: "https://minepi.com/blog/protocol-update/",
      pubDate: new Date("August 5, 2026").getTime(),
    })
  })

  it("accepts only official links from the reader fallback", () => {
    const items = parsePiReaderFeed(`
### [Pi2Day 2026 Recap](https://minepi.com/blog/pi2day-2026-recap/)

[https://minepi.com/blog/pi2day-2026-recap/](https://minepi.com/blog/pi2day-2026-recap/)

Wed, 05 Aug 2026 16:46:15 +0000

### [Promoted price prediction](https://example.com/pi-price/)

Thu, 06 Aug 2026 16:00:00 +0000
    `)

    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("Pi2Day 2026 Recap")
    expect(items[0].pubDate).toBe(new Date("Wed, 05 Aug 2026 16:46:15 +0000").getTime())
  })

  it("accepts only whitelisted media and filters speculative headlines", () => {
    const items = parsePiMediaFeed(`
      <rss><channel>
        <item>
          <title>Pi Network Protocol 26 deadline: what node operators must know - Crypto News</title>
          <link>https://news.google.com/rss/articles/trusted-one?oc=5</link>
          <pubDate>Tue, 11 Aug 2026 06:29:00 GMT</pubDate>
          <source url="https://crypto.news">Crypto News</source>
        </item>
        <item>
          <title>Pi Network's 3.11% drop: broad crypto selloff explained - CoinMarketCap</title>
          <link>https://news.google.com/rss/articles/trusted-two?oc=5</link>
          <pubDate>Tue, 11 Aug 2026 18:04:00 GMT</pubDate>
          <source url="https://coinmarketcap.com">CoinMarketCap</source>
        </item>
        <item>
          <title>Pi Network Price Prediction 2030: Will PI Reach $100? - CoinMarketCap</title>
          <link>https://news.google.com/rss/articles/speculation?oc=5</link>
          <pubDate>Wed, 12 Aug 2026 18:04:00 GMT</pubDate>
          <source url="https://coinmarketcap.com">CoinMarketCap</source>
        </item>
        <item>
          <title>Pi Network confirms a major partnership - CoinDesk</title>
          <link>https://news.google.com/rss/articles/untrusted?oc=5</link>
          <pubDate>Wed, 12 Aug 2026 19:04:00 GMT</pubDate>
          <source url="https://example.com">CoinDesk</source>
        </item>
        <item>
          <title>CoinDesk article about another token - CoinDesk</title>
          <link>https://news.google.com/rss/articles/wrong-topic?oc=5</link>
          <pubDate>Wed, 12 Aug 2026 20:04:00 GMT</pubDate>
          <source url="https://coindesk.com">CoinDesk</source>
        </item>
        <item>
          <title>Pi Network Protocol 26 deadline: what node operators must know - CryptoRank</title>
          <link>https://news.google.com/rss/articles/duplicate-title?oc=5</link>
          <pubDate>Mon, 10 Aug 2026 18:04:00 GMT</pubDate>
          <source url="https://cryptorank.io">CryptoRank</source>
        </item>
        <item>
          <title>XRP vs PI vs ADA: 3 AIs Speculate Which Will Perform Best - CryptoRank</title>
          <link>https://news.google.com/rss/articles/ai-speculation?oc=5</link>
          <pubDate>Wed, 12 Aug 2026 21:04:00 GMT</pubDate>
          <source url="https://cryptorank.io">CryptoRank</source>
        </item>
        <item>
          <title>Will Pi Network defend its gains? - FXStreet</title>
          <link>https://news.google.com/rss/articles/market-question?oc=5</link>
          <pubDate>Wed, 12 Aug 2026 22:04:00 GMT</pubDate>
          <source url="https://fxstreet.com">FXStreet</source>
        </item>
      </channel></rss>
    `)

    expect(items.map(item => item.title)).toEqual([
      "Pi Network's 3.11% drop: broad crypto selloff explained",
      "Pi Network Protocol 26 deadline: what node operators must know",
    ])
    expect(items.map(item => item.extra?.info)).toEqual([
      "白名单媒体 · CoinMarketCap",
      "白名单媒体 · crypto.news",
    ])
    expect(items.every(item => item.url.startsWith("https://news.google.com/rss/articles/"))).toBe(true)
  })

  it("parses the trusted-media reader fallback", () => {
    const items = parsePiMediaReaderFeed(`
Title: "Pi Network" - Google News

Markdown Content:
### [Pi Network price gains 5% as CPI cools, upgrade passes - Crypto News](https://news.google.com/rss/articles/trusted-reader?oc=5)

[Pi Network price gains 5% as CPI cools, upgrade passes](https://news.google.com/rss/articles/trusted-reader?oc=5)Crypto News

Wed, 12 Aug 2026 13:30:00 GMT

### [Pi Network Price Prediction 2030: Will PI Reach $100? - CoinMarketCap](https://news.google.com/rss/articles/speculative-reader?oc=5)

Wed, 12 Aug 2026 14:30:00 GMT

### [Pi Network announces a partnership - Unknown Publisher](https://news.google.com/rss/articles/untrusted-reader?oc=5)

Wed, 12 Aug 2026 15:30:00 GMT
    `)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "Pi Network price gains 5% as CPI cools, upgrade passes",
      pubDate: new Date("Wed, 12 Aug 2026 13:30:00 GMT").getTime(),
      extra: { info: "白名单媒体 · crypto.news" },
    })
  })

  it("parses the structured media fallback", () => {
    const items = parsePiMediaJson({
      status: "ok",
      items: [
        {
          title: "Pi Network Protocol 26 deadline: what node operators must know - Crypto News",
          link: "https://news.google.com/rss/articles/json-trusted?oc=5",
          pubDate: "2026-08-11 06:29:00",
        },
        {
          title: "Pi Network Price Prediction 2030: Will PI Reach $100? - CryptoRank",
          link: "https://news.google.com/rss/articles/json-speculative?oc=5",
          pubDate: "2026-08-12 06:29:00",
        },
        {
          title: "Pi Network confirms exchange listing - Unknown Publisher",
          link: "https://news.google.com/rss/articles/json-untrusted?oc=5",
          pubDate: "2026-08-12 07:29:00",
        },
      ],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "Pi Network Protocol 26 deadline: what node operators must know",
      pubDate: new Date("2026-08-11T06:29:00Z").getTime(),
      extra: { info: "白名单媒体 · crypto.news" },
    })
  })

  it("parses direct publisher feeds and validates article domains", () => {
    const items = parsePiDirectMediaFeed(`
      <rss><channel>
        <item>
          <title>Pi Network&amp;#8217;s Protocol 26 deadline is tomorrow</title>
          <link>https://crypto.news/pi-network-protocol-26/</link>
          <pubDate>Tue, 11 Aug 2026 06:29:28 +0000</pubDate>
        </item>
        <item>
          <title>Pi Network Price Prediction: Will PI Reach $100?</title>
          <link>https://crypto.news/pi-network-price-prediction/</link>
          <pubDate>Wed, 12 Aug 2026 06:29:28 +0000</pubDate>
        </item>
        <item>
          <title>Pi Network confirms a major milestone</title>
          <link>https://example.com/pi-network/</link>
          <pubDate>Wed, 12 Aug 2026 07:29:28 +0000</pubDate>
        </item>
      </channel></rss>
    `, "crypto.news")

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "Pi Network’s Protocol 26 deadline is tomorrow",
      url: "https://crypto.news/pi-network-protocol-26/",
      extra: { info: "白名单媒体 · crypto.news" },
    })
  })

  it("restores Pi product names after Chinese translation", () => {
    expect(restorePiProperNames(
      "Pi Network releases a Pi2Day update",
      "圆周率网络发布圆周率2日更新",
    )).toBe("Pi Network发布Pi2Day更新")
  })
})
