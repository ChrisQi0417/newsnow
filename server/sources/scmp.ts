export default defineSource({
  "scmp-news": defineRSSSource("https://www.scmp.com/rss/91/feed/", { translate: true }),
  "scmp-china": defineRSSSource("https://www.scmp.com/rss/4/feed/", { translate: true }),
  "scmp-hongkong": defineRSSSource("https://www.scmp.com/rss/2/feed/", { translate: true }),
})
