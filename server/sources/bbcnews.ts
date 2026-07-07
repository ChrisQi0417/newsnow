export default defineSource({
  "bbcnews-world": defineRSSSource("https://feeds.bbci.co.uk/news/world/rss.xml", { translate: true, limit: 50 }),
  "bbcnews-worldservice": defineRSSSource("http://wsrss.bbc.co.uk/bizdev/bbcminute/bbcminute.rss", { translate: true, limit: 20 }),
})
