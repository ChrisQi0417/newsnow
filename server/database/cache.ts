import process from "node:process"
import type { NewsItem, SourceID } from "@shared/types"
import type { Database } from "db0"
import type { CacheInfo, CacheRow } from "../types"

const edgeCacheBaseUrl = "https://newsnow-1nq.pages.dev/__internal-cache/sources-v1"
const edgeCacheMaxAge = 7 * 24 * 60 * 60

export interface EdgeRuntimeCache {
  delete: (request: Request) => Promise<boolean>
  match: (request: Request) => Promise<Response | undefined>
  put: (request: Request, response: Response) => Promise<void>
}

function getRuntimeCache() {
  const runtimeCaches = (globalThis as unknown as { caches?: { default?: EdgeRuntimeCache } }).caches
  return runtimeCaches?.default
}

function edgeCacheRequest(key: string) {
  return new Request(`${edgeCacheBaseUrl}/${encodeURIComponent(key)}`)
}

export class EdgeCache {
  private cache

  constructor(cache: EdgeRuntimeCache) {
    this.cache = cache
  }

  async set(key: string, value: NewsItem[]) {
    const data: CacheInfo = {
      id: key as SourceID,
      updated: Date.now(),
      items: value,
    }
    await this.cache.put(edgeCacheRequest(key), new Response(JSON.stringify(data), {
      headers: {
        "Cache-Control": `public, max-age=${edgeCacheMaxAge}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    }))
    logger.success(`set ${key} edge cache`)
  }

  async get(key: string): Promise<CacheInfo | undefined> {
    try {
      const response = await this.cache.match(edgeCacheRequest(key))
      if (!response?.ok) return
      const data = await response.json() as Partial<CacheInfo>
      if (data.id !== key || !Number.isFinite(data.updated) || !Array.isArray(data.items)) return
      logger.success(`get ${key} edge cache`)
      return {
        id: key as SourceID,
        updated: data.updated as number,
        items: data.items,
      }
    } catch {}
  }

  async getEntire(keys: string[]): Promise<CacheInfo[]> {
    const results = await Promise.all(keys.map(key => this.get(key)))
    return results.filter((cache): cache is CacheInfo => Boolean(cache))
  }

  async delete(key: string) {
    return this.cache.delete(edgeCacheRequest(key))
  }
}

export class Cache {
  private db
  constructor(db: Database) {
    this.db = db
  }

  async init() {
    await this.db.prepare(`
      CREATE TABLE IF NOT EXISTS cache (
        id TEXT PRIMARY KEY,
        updated INTEGER,
        data TEXT
      );
    `).run()
    logger.success(`init cache table`)
  }

  async set(key: string, value: NewsItem[]) {
    const now = Date.now()
    await this.db.prepare(
      `INSERT OR REPLACE INTO cache (id, data, updated) VALUES (?, ?, ?)`,
    ).run(key, JSON.stringify(value), now)
    logger.success(`set ${key} cache`)
  }

  async get(key: string): Promise<CacheInfo | undefined > {
    const row = (await this.db.prepare(`SELECT id, data, updated FROM cache WHERE id = ?`).get(key)) as CacheRow | undefined
    if (row) {
      logger.success(`get ${key} cache`)
      return {
        id: row.id,
        updated: row.updated,
        items: JSON.parse(row.data),
      }
    }
  }

  async getEntire(keys: string[]): Promise<CacheInfo[]> {
    const keysStr = keys.map(k => `id = '${k}'`).join(" or ")
    const res = await this.db.prepare(`SELECT id, data, updated FROM cache WHERE ${keysStr}`).all() as any
    const rows = (res.results ?? res) as CacheRow[]

    /**
     * https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/#return-object
     * cloudflare d1 .all() will return
     * {
     *   success: boolean
     *   meta:
     *   results:
     * }
     */
    if (rows?.length) {
      logger.success(`get entire (...) cache`)
      return rows.map(row => ({
        id: row.id,
        updated: row.updated,
        items: JSON.parse(row.data) as NewsItem[],
      }))
    } else {
      return []
    }
  }

  async delete(key: string) {
    return await this.db.prepare(`DELETE FROM cache WHERE id = ?`).run(key)
  }
}

export async function getCacheTable() {
  if (process.env.ENABLE_CACHE === "false") return

  const runtimeCache = getRuntimeCache()
  if (runtimeCache) return new EdgeCache(runtimeCache)

  try {
    const db = useDatabase()
    logger.info("db: ", db.getInstance())
    const cacheTable = new Cache(db)
    if (process.env.INIT_TABLE !== "false") await cacheTable.init()
    return cacheTable
  } catch (e) {
    logger.error("failed to init database ", e)
  }
}
