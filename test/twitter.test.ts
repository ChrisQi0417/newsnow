import { describe, expect, it } from "vitest"
import { fixedXAccounts, parseXEmbeddedProfile, parseXProfilePage, readXFallbackTranslation, readXMyMemoryTranslation, readXReaderTranslation, restoreXProperNames } from "../server/sources/twitter"

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

  it("restores product and account names after Chinese translation", () => {
    expect(restoreXProperNames(
      "Tibo shares an OpenAI Codex and ChatGPT update",
      "蒂博分享开放人工智能法典和聊天GPT更新",
    )).toBe("Tibo分享OpenAI Codex和ChatGPT更新")
  })

  it("reads the compact Google fallback response", () => {
    expect(readXFallbackTranslation(["为什么转而使用 Codex？"])).toBe("为什么转而使用 Codex？")
    expect(readXFallbackTranslation([["为什么转而使用 Codex？", "en"]])).toBe("为什么转而使用 Codex？")
    expect(readXFallbackTranslation({ translated: "invalid" })).toBe("")
  })

  it("reads the non-Google translation fallback response", () => {
    expect(readXMyMemoryTranslation({ responseData: { translatedText: "为什么转而使用 Codex？" } }))
      .toBe("为什么转而使用 Codex？")
    expect(readXMyMemoryTranslation({ responseData: null })).toBe("")
  })

  it("reads a translated response forwarded by the reader", () => {
    expect(readXReaderTranslation(`
Title:

URL Source: https://clients5.google.com/translate_a/t

Markdown Content:
["为什么转而使用 Codex？"]
    `)).toBe("为什么转而使用 Codex？")
    expect(readXReaderTranslation("invalid response")).toBe("")
  })
})
