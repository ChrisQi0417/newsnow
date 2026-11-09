import { officialBlueskyFeedUrl, parseOfficialBluesky } from "../utils/official-bluesky"
import { SourceUnavailableError, sourceFailure } from "../utils/source-failure"
import { translateNewsItemsToChinese } from "../utils/translate"

const publisher = { handle: "reuters.com", did: "did:plc:jbvnehrrdqoulco4rf5gxg5r", publisher: "路透社" }

export default defineSource(async () => {
  try {
    const data = await myFetch<unknown>(officialBlueskyFeedUrl(publisher.handle), { retry: 0, timeout: 4500 })
    const items = parseOfficialBluesky(data, publisher)
    if (items.length) return translateNewsItemsToChinese(items, "reuters")
  } catch (error) {
    throw new SourceUnavailableError([sourceFailure("reuters-public", error)])
  }
  throw new SourceUnavailableError([sourceFailure("reuters-public")])
})
