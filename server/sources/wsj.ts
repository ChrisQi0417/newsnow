export default defineSource({
  "wsj-news": defineRSSSource("https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness", { translate: true, limit: 50 }),
  "wsj-world": defineRSSSource("https://feeds.content.dowjones.io/public/rss/RSSWorldNews", { translate: true, limit: 50 }),
  "wsj-markets": defineRSSSource("https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", { translate: true, limit: 50 }),
})
