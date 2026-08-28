import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseTruthSocialFeed, reuseCachedTruthSocialTranslations, translateTruthSocialItems } from "../server/sources/truthsocial"

const { translateMock } = vi.hoisted(() => ({
  translateMock: vi.fn(async (texts: string[]) => texts.map(text => `中文：${text}`)),
}))

vi.mock("../server/utils/translate", () => ({
  translateTextsToChinese: translateMock,
}))

describe("truth Social refresh", () => {
  beforeEach(() => {
    translateMock.mockClear()
  })

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

  it("reuses a matching cached translation and leaves changed posts untranslated", () => {
    const fresh = [
      {
        id: "1",
        title: "Current original post",
        url: "https://truthsocial.com/1",
        extra: { hover: "镜像：https://trumpstruth.org/1" },
      },
      {
        id: "2",
        title: "Changed original post",
        url: "https://truthsocial.com/2",
      },
    ]
    const cached = [
      {
        id: "1",
        title: "当前的原始帖子",
        url: "https://truthsocial.com/1",
        extra: { hover: "原文：Current original post\n镜像：https://trumpstruth.org/1" },
      },
      {
        id: "2",
        title: "旧帖子译文",
        url: "https://truthsocial.com/2",
        extra: { hover: "原文：Old original post" },
      },
    ]

    expect(reuseCachedTruthSocialTranslations(fresh, cached)).toEqual([
      {
        ...fresh[0],
        title: "当前的原始帖子",
        extra: { hover: "原文：Current original post\n镜像：https://trumpstruth.org/1" },
      },
      fresh[1],
    ])
  })

  it("translates cold posts in no more than three balanced requests", async () => {
    const items = [900, 650, 250, 100, 80].map((length, index) => ({
      id: String(index),
      title: `${String.fromCharCode(65 + index)}${"x".repeat(length - 1)}`,
      url: `https://truthsocial.com/${index}`,
    }))

    const translated = await translateTruthSocialItems(items)

    expect(translateMock).toHaveBeenCalledTimes(3)
    expect(translateMock.mock.calls.flatMap(([texts]) => texts)).toHaveLength(items.length)
    expect(translated.every(item => String(item.title).startsWith("中文："))).toBe(true)
    expect(translated.every(item => String(item.extra?.hover).startsWith("原文："))).toBe(true)
  })
})
