import { describe, expect, it } from "vitest"
import { fixedXAccounts, parseTiboFeedCandidates, parseXEmbeddedProfile, parseXOEmbedPost, parseXProfilePage } from "../server/sources/twitter"

const tibo = fixedXAccounts[0]
const openAI = fixedXAccounts[1]

describe("fixed X accounts", () => {
  it("accepts only the requested account from official X profile metadata", () => {
    const items = parseXProfilePage(`
      <article>
        <meta itemprop="alternateName" content="thsottiaux">
        <meta itemprop="articleBody" content="Newest Codex update from Tibo">
        <meta itemprop="datePublished" content="2026-08-12T07:18:26.000Z">
        <meta itemprop="url" content="https://x.com/thsottiaux/status/2087438544323420273">
      </article>
      <article>
        <meta itemprop="alternateName" content="OpenAI">
        <meta itemprop="articleBody" content="A quoted OpenAI post">
        <meta itemprop="datePublished" content="2026-08-12T06:00:00.000Z">
        <meta itemprop="url" content="https://x.com/OpenAI/status/2087430000000000000">
      </article>
      <article>
        <meta itemprop="alternateName" content="thsottiaux">
        <meta itemprop="articleBody" content="Untrusted copied post">
        <meta itemprop="datePublished" content="2026-08-12T08:00:00.000Z">
        <meta itemprop="url" content="https://example.com/thsottiaux/status/2087440000000000000">
      </article>
    `, tibo)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "Newest Codex update from Tibo",
      url: "https://x.com/thsottiaux/status/2087438544323420273",
      pubDate: new Date("2026-08-12T07:18:26.000Z").getTime(),
      extra: { info: "Tibo @thsottiaux" },
    })
  })

  it("decodes HTML entities exposed by X metadata", () => {
    const items = parseXProfilePage(`
      <article>
        <meta itemprop="alternateName" content="thsottiaux">
        <meta itemprop="articleBody" content="Codex &amp;amp; ChatGPT &amp;#x1F440;">
        <meta itemprop="datePublished" content="2026-08-12T07:18:26.000Z">
        <meta itemprop="url" content="https://x.com/thsottiaux/status/2087438544323420273">
      </article>
    `, tibo)

    expect(items[0].title).toBe("Codex & ChatGPT 👀")
  })

  it("parses the official embedded timeline only as a locked-account fallback", () => {
    const items = parseXEmbeddedProfile(`
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"timeline":{"entries":[
          {"type":"tweet","content":{"tweet":{"id_str":"2087248033906094175","created_at":"Tue Aug 11 18:41:25 +0000 2026","full_text":"OpenAI official desktop update","permalink":"/OpenAI/status/2087248033906094175","user":{"screen_name":"OpenAI"}}}},
          {"type":"tweet","content":{"tweet":{"id_str":"2087248033906094176","created_at":"Tue Aug 11 18:42:25 +0000 2026","full_text":"Reply to another account","permalink":"/OpenAI/status/2087248033906094176","in_reply_to_screen_name":"someone","user":{"screen_name":"OpenAI"}}}},
          {"type":"tweet","content":{"tweet":{"id_str":"2087248033906094177","created_at":"Tue Aug 11 18:43:25 +0000 2026","full_text":"Post from another user","permalink":"/someone/status/2087248033906094177","user":{"screen_name":"someone"}}}}
        ]}}}}
      </script>
    `, openAI)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "OpenAI official desktop update",
      url: "https://x.com/OpenAI/status/2087248033906094175",
      extra: { info: "OpenAI 官方 @OpenAI" },
    })
  })

  it("accepts only current, canonical, non-reply Tibo feed candidates", () => {
    const items = parseTiboFeedCandidates({
      version: 1,
      source_scope: "timeline",
      stale: false,
      profile: { handle: "thsottiaux" },
      tweets: [
        { id: "2094252447271366730", url: "https://x.com/thsottiaux/status/2094252447271366730", text: "Current Tibo update", at: "2026-08-31T02:34:27Z", is_reply: false },
        { id: "2094252447271366731", url: "https://x.com/thsottiaux/status/2094252447271366731", text: "Reply to another account", at: "2026-08-31T02:35:27Z", is_reply: true, replying_to: "someone" },
        { id: "2094252447271366732", url: "https://x.com/someone/status/2094252447271366732", text: "Wrong author", at: "2026-08-31T02:36:27Z", is_reply: false },
        { id: "2094252447271366733", url: "https://x.com/thsottiaux/status/999", text: "Mismatched status", at: "2026-08-31T02:37:27Z", is_reply: false },
      ],
    }, tibo)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "Current Tibo update",
      url: "https://x.com/thsottiaux/status/2094252447271366730",
      pubDate: new Date("2026-08-31T02:34:27Z").getTime(),
      extra: { info: "Tibo @thsottiaux" },
    })
  })

  it("rejects stale or misidentified Tibo feeds", () => {
    const base = {
      version: 1,
      source_scope: "timeline",
      stale: false,
      profile: { handle: "thsottiaux" },
      tweets: [{ id: "2094252447271366730", url: "https://x.com/thsottiaux/status/2094252447271366730", text: "Current Tibo update", at: "2026-08-31T02:34:27Z" }],
    }
    expect(parseTiboFeedCandidates({ ...base, stale: true }, tibo)).toEqual([])
    expect(parseTiboFeedCandidates({ ...base, profile: { handle: "someone" } }, tibo)).toEqual([])
  })

  it("uses X oEmbed only when the official author and status match", () => {
    const candidate = parseTiboFeedCandidates({
      version: 1,
      source_scope: "timeline",
      stale: false,
      profile: { handle: "thsottiaux" },
      tweets: [{ id: "2094252447271366730", url: "https://x.com/thsottiaux/status/2094252447271366730", text: "Unverified text", at: "2026-08-31T02:34:27Z" }],
    }, tibo)[0]
    const data = {
      provider_name: "X",
      author_url: "https://x.com/thsottiaux",
      html: `<blockquote class="twitter-tweet"><p lang="en">Official &amp; verified<br><br>Tibo text</p><a href="https://x.com/thsottiaux/status/2094252447271366730?ref_src=twsrc%5Etfw">August 31, 2026</a></blockquote>`,
    }

    expect(parseXOEmbedPost(data, tibo, candidate)).toMatchObject({
      title: "Official & verified Tibo text",
      url: candidate.url,
      pubDate: candidate.pubDate,
    })
    expect(parseXOEmbedPost({ ...data, author_url: "https://x.com/someone" }, tibo, candidate)).toBeUndefined()
    expect(parseXOEmbedPost({ ...data, html: data.html.replace("2094252447271366730", "2094252447271366739") }, tibo, candidate)).toBeUndefined()
  })
})
