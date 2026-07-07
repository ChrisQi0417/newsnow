export default defineSource({
  "apnews-top": defineRSSHubSource("/apnews/topics/ap-top-news", { limit: 50 }, { translate: true, limit: 50 }),
  "apnews-world": defineRSSHubSource("/apnews/topics/world-news", { limit: 50 }, { translate: true, limit: 50 }),
  "apnews-business": defineRSSHubSource("/apnews/topics/business", { limit: 50 }, { translate: true, limit: 50 }),
  "apnews-fact-check": defineRSSHubSource("/apnews/topics/ap-fact-check", { limit: 50 }, { translate: true, limit: 50 }),
})
