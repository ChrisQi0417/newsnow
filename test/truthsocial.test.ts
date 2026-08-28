import { describe, expect, it } from "vitest"
import { parseTruthSocialFeed } from "../server/sources/truthsocial"

describe("truth Social refresh", () => {
  it("parses posts and keeps repost placeholders out of translation", () => {
    const items = parseTruthSocialFeed(`
      <rss xmlns:truth="https://trumpstruth.org/ns"><channel>
        <item>
          <title>Current original post</title>
          <description><![CDATA[Current original post]]></description>
          <guid>post-1</guid>
          <link>https://trumpstruth.org/status/1</link>
          <truth:originalUrl>https://truthsocial.com/@realDonaldTrump/1</truth:originalUrl>
          <truth:originalId>1</truth:originalId>
          <pubDate>Fri, 28 Aug 2026 02:17:04 +0000</pubDate>
        </item>
        <item>
          <title>[No Title] - Post from August 28, 2026</title>
          <description><![CDATA[RT: https://truthsocial.com/users/realDonaldTrump/statuses/2]]></description>
          <guid>post-2</guid>
        </item>
      </channel></rss>
    `)

    expect(items).toEqual([
      expect.objectContaining({
        id: 1,
        title: "Current original post",
        url: "https://truthsocial.com/@realDonaldTrump/1",
      }),
      expect.objectContaining({
        id: "post-2",
        title: "转发内容",
      }),
    ])
  })
})
