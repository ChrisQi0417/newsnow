import type { NewsItem, SourceID, SourceResponse } from "@shared/types"
import { type H3Event, createError, defineEventHandler, getQuery, setHeader } from "h3"
import { sources } from "@shared/sources"
import { TTL } from "@shared/consts"
import { logger } from "#/utils/logger"
import { getGetter, hasGetter, resolveSourceID } from "#/getters"
import { getCacheTable } from "#/database/cache"
import type { CacheInfo } from "#/types"
import { isChineseOutput, translateNewsItemsForOutput } from "#/utils/translate"

const inFlightRefreshes = new Map<SourceID, Promise<NewsItem[]>>()

async function readableItems(id: SourceID, items: CacheInfo["items"]) {
  const translatedItems = await translateNewsItemsForOutput(items, id)
  return {
    items: translatedItems,
    translationComplete: isChineseOutput(translatedItems),
  }
}

function cachedItems(items: CacheInfo["items"]) {
  return {
    items,
    translationComplete: isChineseOutput(items),
  }
}

async function refreshSource(id: SourceID, event: H3Event, cacheTable: Awaited<ReturnType<typeof getCacheTable>>) {
  const load = async () => {
    const getter = await getGetter(id)
    if (!getter) throw new Error("Invalid source id")
    const fetchedItems = (await getter(event)).slice(0, 30)
    const readable = await readableItems(id, fetchedItems)
    if (!readable.items.length) throw new Error("Source returned no news")
    if (cacheTable && id !== "weather") {
      await cacheTable.set(id, readable.items)
    }
    logger.success(`fetch ${id} latest`)
    return readable.items
  }

  if (id === "weather") return load()
  const existing = inFlightRefreshes.get(id)
  if (existing) return existing

  const pending = load()
  inFlightRefreshes.set(id, pending)
  try {
    return await pending
  } finally {
    if (inFlightRefreshes.get(id) === pending) inFlightRefreshes.delete(id)
  }
}

export default defineEventHandler(async (event): Promise<SourceResponse> => {
  try {
    const query = getQuery(event)
    const latest = query.latest !== undefined && query.latest !== "false"
    const requestedID = query.id as SourceID
    const id = resolveSourceID(requestedID)
    if (!requestedID || !sources[requestedID] || !sources[id] || !hasGetter(id)) throw new Error("Invalid source id")

    const requestScoped = id === "weather"
    if (requestScoped) setHeader(event, "Cache-Control", "private, no-store")
    const cacheTable = requestScoped ? undefined : await getCacheTable()
    // Date.now() in Cloudflare Worker will not update throughout the entire runtime.
    const now = Date.now()
    let cache: CacheInfo | undefined
    if (cacheTable) {
      cache = await cacheTable.get(id)
      // An explicit latest request is the refresh button contract. Do not let
      // the normal interval/TTL cache path hide fresh source data from it.
      if (cache && !latest) {
        // Respect each source's collection cadence before contacting its upstream.
        if (now - cache.updated < sources[id].interval) {
          return {
            status: "success",
            id,
            updatedTime: cache.updated,
            ...cachedItems(cache.items),
          }
        }

        // Keep recently cached content available during the short cache grace period.
        if (now - cache.updated < TTL) {
          return {
            status: "cache",
            id,
            updatedTime: cache.updated,
            ...cachedItems(cache.items),
          }
        }
      }
    }

    try {
      const refreshedItems = await refreshSource(id, event, cacheTable)
      return {
        status: "success",
        id,
        updatedTime: now,
        items: refreshedItems,
        translationComplete: isChineseOutput(refreshedItems),
      }
    } catch (e) {
      if (cache!) {
        return {
          status: "cache",
          refreshError: true,
          id,
          updatedTime: cache.updated,
          ...cachedItems(cache.items),
        }
      } else {
        throw e
      }
    }
  } catch (e: any) {
    logger.error(e)
    throw createError({
      statusCode: 500,
      message: e instanceof Error ? e.message : "Internal Server Error",
    })
  }
})
