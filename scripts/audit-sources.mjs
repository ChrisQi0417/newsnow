import { readFile, writeFile } from "node:fs/promises"
import process from "node:process"

const sources = JSON.parse(await readFile(new URL("../shared/sources.json", import.meta.url), "utf8"))
const base = process.env.AUDIT_URL || "https://newsnow-1nq.pages.dev"
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(sources).filter(id => !sources[id].redirect)
const results = []
let cursor = 0
async function worker() {
  while (cursor < ids.length) {
    const id = ids[cursor++]
    const start = Date.now()
    try {
      const response = await fetch(`${base}/api/s?id=${encodeURIComponent(id)}&latest=true`, { signal: AbortSignal.timeout(45000) })
      const body = await response.text()
      let data
      try {
        data = JSON.parse(body)
      } catch {
        throw new Error(`HTTP ${response.status}, ${response.headers.get("content-type")}: ${body.slice(0, 180)}`)
      }
      const items = Array.isArray(data.items) ? data.items : []
      const times = items.map(item => new Date(item.pubDate || item.extra?.date || "").getTime()).filter(Number.isFinite)
      results.push({ id, http: response.status, count: items.length, refreshError: !!data.refreshError, updatedTime: data.updatedTime, newest: times.length ? new Date(Math.max(...times)).toISOString() : null, ms: Date.now() - start, ok: response.ok && items.length > 0 && !data.refreshError })
    } catch (error) {
      results.push({ id, ok: false, error: error.message, ms: Date.now() - start })
    }
    console.log(`${id}: ${results.at(-1).ok ? "ok" : "FAILED"}`)
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
}
await worker()
await writeFile(new URL("../source-audit.json", import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), base, results }, null, 2))
console.log(JSON.stringify({ total: results.length, passed: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok), newest: results.filter(item => item.ok).map(({ id, newest }) => ({ id, newest })) }, null, 2))
