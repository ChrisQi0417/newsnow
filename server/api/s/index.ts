import type { SourceID, SourceResponse } from "@shared/types"
import { type H3Event, createError, defineEventHandler, getQuery, isError, setHeader } from "h3"
import { sources } from "@shared/sources"
import { ManualRefreshCooldown, TTL } from "@shared/consts"
import { logger } from "#/utils/logger"
import { getGetter, hasGetter, resolveSourceID } from "#/getters"
import { getCacheTable } from "#/database/cache"
import type { CacheInfo } from "#/types"
import { getTranslationIssues, isChineseOutput, translateNewsItemsForOutput } from "#/utils/translate"
import { SourceUnavailableError, sourceFailure } from "#/utils/source-failure"
import { SourceRefreshFailure, clearSourceRetry, getSourceRetry, recordSourceFailure } from "#/utils/source-retry"
import type { SourceRetryState } from "#/utils/source-retry"
import { forgetSourceSuccess, readSourceSuccess, rememberSourceSuccess } from "#/utils/source-memory-cache"

const inFlightRefreshes = new Map<SourceID, Promise<CacheInfo>>()

async function readableItems(id: SourceID, items: CacheInfo["items"], event: H3Event) {
  const binding = event.context.cloudflare?.env?.AI
  const ai = typeof binding?.run === "function" ? binding : undefined
  const translatedItems = await translateNewsItemsForOutput(items, id, ai)
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

async function refreshSource(id: SourceID, event: H3Event, cacheTable: Awaited<ReturnType<typeof getCacheTable>>, previousRetry?: SourceRetryState) {
  const load = async () => {
    let readable: Awaited<ReturnType<typeof readableItems>>
    try {
      const getter = await getGetter(id)
      if (!getter) throw new Error("Invalid source id")
      const fetchedItems = (await getter(event)).slice(0, 30)
      if (!fetchedItems.length) throw new SourceUnavailableError(["source:empty"])
      readable = await readableItems(id, fetchedItems, event)
      if (!readable.items.length) throw new SourceUnavailableError(["source:empty"])
    } catch (error) {
      if (id === "weather") throw error
      const issues = error instanceof SourceUnavailableError ? error.issues : [sourceFailure("source", error)]
      // Record once inside the coalesced fetch, not once per waiting request.
      throw new SourceRefreshFailure(await recordSourceFailure(id, previousRetry, issues, cacheTable))
    }
    const result: CacheInfo = { id, items: readable.items, updated: Date.now() }
    if (id !== "weather") await clearSourceRetry(id, cacheTable)
    if (cacheTable && id !== "weather") {
      try {
        await cacheTable.set(id, readable.items)
        forgetSourceSuccess(id)
      } catch {
        // A persistence outage must not discard successfully collected content.
        rememberSourceSuccess(result)
        logger.warn(`failed to persist ${id} cache`)
      }
    } else if (id !== "weather") {
      rememberSourceSuccess(result)
    }
    logger.success(`fetch ${id} latest`)
    return result
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

function deferSourceRefresh(event: H3Event, id: SourceID, retry: SourceRetryState, cache?: CacheInfo): SourceResponse & { nextRetryAt: number } {
  setHeader(event, "Retry-After", Math.max(1, Math.ceil((retry.nextRetryAt - Date.now()) / 1000)))
  if (cache?.items.length) {
    return {
      status: "cache",
      refreshError: true,
      sourceIssues: retry.issues,
      nextRetryAt: retry.nextRetryAt,
      id,
      updatedTime: cache.updated,
      ...cachedItems(cache.items),
    }
  }
  throw createError({
    statusCode: 503,
    message: "数据源暂时不可用，请稍后重试",
    data: { nextRetryAt: retry.nextRetryAt, sourceIssues: retry.issues },
  })
}

export default defineEventHandler(async (event): Promise<SourceResponse> => {
  try {
    const query = getQuery(event)
    const latest = query.latest !== undefined && query.latest !== "false"
    const requestedID = query.id as SourceID
    const id = resolveSourceID(requestedID)
    if (!requestedID || !sources[requestedID] || !sources[id] || !hasGetter(id)) throw createError({ statusCode: 400, message: "无效的数据源" })

    const requestScoped = id === "weather"
    if (requestScoped) setHeader(event, "Cache-Control", "private, no-store")
    const cacheTable = requestScoped ? undefined : await getCacheTable()
    // Date.now() in Cloudflare Worker will not update throughout the entire runtime.
    const now = Date.now()
    let cache: CacheInfo | undefined
    if (cacheTable) {
      try {
        cache = await cacheTable.get(id)
      } catch {
        logger.warn(`failed to read ${id} cache`)
      }
    }
    const recent = requestScoped ? undefined : readSourceSuccess(id, now)
    if (recent && (!cache || recent.updated > cache.updated)) cache = recent
    const retry = requestScoped ? undefined : await getSourceRetry(id, cacheTable)
    // Even explicit manual refreshes respect an upstream failure's cooldown.
    if (retry && now < retry.nextRetryAt) return deferSourceRefresh(event, id, retry, cache)
    if (cache?.items.length) {
      // Manual refresh bypasses the ordinary cadence, but repeated clicks
      // within a minute reuse the completed fetch across users of this cache.
      if (!latest || now - cache.updated < ManualRefreshCooldown) {
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
      const refreshed = await refreshSource(id, event, cacheTable, retry)
      return {
        status: "success",
        id,
        updatedTime: refreshed.updated,
        items: refreshed.items,
        translationComplete: isChineseOutput(refreshed.items),
        translationIssues: getTranslationIssues(refreshed.items),
      }
    } catch (e) {
      if (e instanceof SourceRefreshFailure) return deferSourceRefresh(event, id, e.retry, cache)
      if (cache!) {
        return {
          status: "cache",
          refreshError: true,
          sourceIssues: e instanceof SourceUnavailableError ? e.issues : undefined,
          id,
          updatedTime: cache.updated,
          ...cachedItems(cache.items),
        }
      } else {
        throw e
      }
    }
  } catch (e: any) {
    if (isError(e)) throw e
    logger.error("source request failed")
    throw createError({
      statusCode: 500,
      message: "数据源请求失败，请稍后重试",
    })
  }
})
