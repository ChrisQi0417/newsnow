export default defineSource({
  "bloomberg-business": defineRSSSource("https://feeds.bloomberg.com/business/news.rss", { translate: true, limit: 50 }),
  "bloomberg-markets": defineRSSSource("https://feeds.bloomberg.com/markets/news.rss", { translate: true, limit: 50 }),
  "bloomberg-economics": defineRSSSource("https://feeds.bloomberg.com/economics/news.rss", { translate: true, limit: 50 }),
  "bloomberg-politics": defineRSSSource("https://feeds.bloomberg.com/politics/news.rss", { translate: true, limit: 50 }),
  "bloomberg-technology": defineRSSSource("https://feeds.bloomberg.com/technology/news.rss", { translate: true, limit: 50 }),
})
