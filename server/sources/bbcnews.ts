export default defineSource({
  "bbcnews-world": defineRSSSource("https://feeds.bbci.co.uk/news/world/rss.xml", { translate: true, limit: 50 }),
  "bbcnews-worldservice": defineRSSSource("https://podcasts.files.bbci.co.uk/p02nq0gn.rss", { translate: true, limit: 20 }),
})
