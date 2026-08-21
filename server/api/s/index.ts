import type { SourceID, SourceResponse } from "@shared/types"
import { getGetter, hasGetter, resolveSourceID } from "#/getters"
import { getCacheTable } from "#/database/cache"
import type { CacheInfo } from "#/types"
import { getTranslationDiagnostic } from "#/utils/translate"

export default defineEventHandler(async (event): Promise<SourceResponse> => {
  try {
    setHeader(event, "X-NewsNow-Revision", "translation-batch-v3")
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
        // interval 刷新间隔，对于缓存失效也要执行的。本质上表示本来内容更新就很慢，这个间隔内可能内容压根不会更新。
        // 默认 10 分钟，是低于 TTL 的，但部分 Source 的更新间隔会超过 TTL，甚至有的一天更新一次。
        if (now - cache.updated < sources[id].interval) {
          return {
            status: "success",
            id,
            updatedTime: now,
            items: cache.items,
          }
        }

        // 而 TTL 缓存失效时间，在时间范围内，就算内容更新了也要用这个缓存。
        // 复用缓存是不会更新时间的。
        if (now - cache.updated < TTL) {
          return {
            status: "cache",
            id,
            updatedTime: cache.updated,
            items: cache.items,
          }
        }
      }
    }

    try {
      const getter = await getGetter(id)
      if (!getter) throw new Error("Invalid source id")
      const newData = (await getter(event)).slice(0, 30)
      if (query.debugTranslation !== undefined) {
        setHeader(event, "X-NewsNow-Translation", getTranslationDiagnostic())
      }
      if (cacheTable && newData.length) {
        if (event.context.waitUntil) event.context.waitUntil(cacheTable.set(id, newData))
        else await cacheTable.set(id, newData)
      }
      logger.success(`fetch ${id} latest`)
      return {
        status: "success",
        id,
        updatedTime: now,
        items: newData,
      }
    } catch (e) {
      if (cache!) {
        return {
          status: "cache",
          id,
          updatedTime: cache.updated,
          items: cache.items,
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
