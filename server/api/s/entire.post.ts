import type { SourceID, SourceResponse } from "@shared/types"
import { defineEventHandler, readBody } from "h3"
import { sources } from "@shared/sources"
import { getCacheTable } from "#/database/cache"
import { isChineseOutput } from "#/utils/translate"

export default defineEventHandler(async (event) => {
  try {
    const { sources: _ }: { sources: SourceID[] } = await readBody(event)
    const cacheTable = await getCacheTable()
    const ids = Array.isArray(_) ? [...new Set(_.filter(k => sources[k] && k !== "weather"))] : []
    if (ids?.length && cacheTable) {
      const caches = await cacheTable.getEntire(ids)
      return caches.map(cache => ({
        status: "cache",
        id: cache.id,
        // Hydration never fans out to upstream feeds or translation providers.
        items: cache.items,
        translationComplete: isChineseOutput(cache.items),
        updatedTime: cache.updated,
      })) as SourceResponse[]
    }
  } catch {
    //
  }
})
