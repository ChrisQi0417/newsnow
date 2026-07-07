export default defineSource({
  "xinhua-china": defineRSSSource("https://www.xinhuanet.com/english/rss/chinarss.xml", { translate: true }),
  "xinhua-world": defineRSSSource("https://www.xinhuanet.com/english/rss/worldrss.xml", { translate: true }),
  "xinhua-business": defineRSSSource("https://www.xinhuanet.com/english/rss/businessrss.xml", { translate: true }),
  "xinhua-tech": defineRSSSource("https://www.xinhuanet.com/english/rss/scirss.xml", { translate: true }),
})
