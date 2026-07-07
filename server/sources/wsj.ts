export default defineSource({
  "wsj-news": defineRSSSource("https://feeds.a.dj.com/rss/RSSWSJD.xml", { translate: true, limit: 50 }),
  "wsj-world": defineRSSSource("https://feeds.a.dj.com/rss/RSSWorldNews.xml", { translate: true, limit: 50 }),
  "wsj-markets": defineRSSSource("https://feeds.a.dj.com/rss/RSSMarketsMain.xml", { translate: true, limit: 50 }),
})
