import { describe, expect, it } from "vitest"
import { parseRSSXML } from "./rss2json"

describe("parseRSSXML", () => {
  it("uses Atom alternate links and original publication times", () => {
    const feed = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>AFP News Agency</title>
        <link rel="self" href="https://www.youtube.com/feed.xml" />
        <link rel="alternate" href="https://www.youtube.com/@AFP" />
        <entry>
          <id>yt:video:123</id>
          <title>Current AFP report</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=123" />
          <published>2026-08-16T16:52:06+00:00</published>
          <updated>2026-08-16T16:56:14+00:00</updated>
        </entry>
      </feed>
    `

    const result = parseRSSXML(feed)
    expect(result?.link).toBe("https://www.youtube.com/@AFP")
    expect(result?.items[0]).toMatchObject({
      title: "Current AFP report",
      link: "https://www.youtube.com/watch?v=123",
      created: "2026-08-16T16:52:06+00:00",
    })
  })
})
