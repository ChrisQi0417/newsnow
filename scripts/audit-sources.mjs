import { readFile, writeFile } from "node:fs/promises"
import process from "node:process"
import { resolve } from "node:path"

const sources = JSON.parse(await readFile(new URL("../shared/sources.json", import.meta.url), "utf8"))
const base = process.env.AUDIT_URL || "https://newsnow-1nq.pages.dev"
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(sources).filter(id => !sources[id].redirect)
const forceLatest = process.env.AUDIT_FORCE_LATEST === "true"
const configuredDelay = Number(process.env.AUDIT_DELAY_MS)
const delayMs = Number.isFinite(configuredDelay) ? Math.max(5000, configuredDelay) : 5000
const outputPath = process.env.AUDIT_OUTPUT ? resolve(process.env.AUDIT_OUTPUT) : new URL("../source-audit.json", import.meta.url)
const chinesePattern = /[\u3400-\u9FFF]/
const latinPattern = /[A-Z]/i
const feedErrorPattern = /^(?:query length limit exceeded|error\b|cannot fetch\b)/i
const results = []
let cursor = 0
async function worker() {
  while (cursor < ids.length) {
    const id = ids[cursor++]
    const start = Date.now()
    try {
      const endpoint = new URL("/api/s", base)
      endpoint.searchParams.set("id", id)
      if (forceLatest) endpoint.searchParams.set("latest", "true")
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(45000) })
      const body = await response.text()
      let data
      try {
        data = JSON.parse(body)
      } catch {
        throw new Error(`HTTP ${response.status}, ${response.headers.get("content-type")}: ${body.slice(0, 180)}`)
      }
      const items = Array.isArray(data.items) ? data.items : []
      const titles = items.map(item => String(item.title ?? "").replace(/\s+/g, " ").trim())
      const invalidTitles = titles.filter(title => !title || feedErrorPattern.test(title))
      const englishOnly = titles.filter(title => latinPattern.test(title) && !chinesePattern.test(title))
      const chineseCount = titles.filter(title => chinesePattern.test(title)).length
      const times = items.map(item => new Date(item.pubDate || item.extra?.date || "").getTime()).filter(Number.isFinite)
      const updated = typeof data.updatedTime === "number" ? data.updatedTime : Date.parse(data.updatedTime)
      const cacheAgeMs = Number.isFinite(updated) ? Date.now() - updated : null
      const available = response.ok && ["success", "cache"].includes(data.status) && items.length > 0 && !data.refreshError && invalidTitles.length === 0
      const cacheFresh = cacheAgeMs !== null && cacheAgeMs >= -60_000 && cacheAgeMs <= Math.max(sources[id].interval, 600_000) + 60_000
      const chineseComplete = titles.length > 0 && englishOnly.length === 0
      results.push({
        id,
        http: response.status,
        status: data.status,
        count: items.length,
        chineseCount,
        englishOnlyCount: englishOnly.length,
        englishOnlySample: englishOnly.slice(0, 3),
        translationComplete: data.translationComplete,
        translationIssues: data.translationIssues,
        invalidTitles,
        refreshError: !!data.refreshError,
        updatedTime: data.updatedTime,
        newest: times.length ? new Date(Math.max(...times)).toISOString() : null,
        futureDatedCount: times.filter(time => time > Date.now() + 5 * 60_000).length,
        cacheAgeMs,
        available,
        cacheFresh,
        chineseComplete,
        ms: Date.now() - start,
        ok: available && cacheFresh && chineseComplete,
      })
    } catch (error) {
      results.push({ id, ok: false, error: error.message, ms: Date.now() - start })
    }
    console.log(`${id}: ${results.at(-1).ok ? "ok" : "FAILED"}`)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
}
await worker()
await writeFile(outputPath, JSON.stringify({ checkedAt: new Date().toISOString(), base, forceLatest, delayMs, results }, null, 2))
console.log(JSON.stringify({ total: results.length, available: results.filter(item => item.available).length, cacheFresh: results.filter(item => item.cacheFresh).length, chineseComplete: results.filter(item => item.chineseComplete).length, passed: results.filter(item => item.ok).length, englishHeadlines: results.reduce((sum, item) => sum + (item.englishOnlyCount || 0), 0), failed: results.filter(item => !item.ok) }, null, 2))
if (results.some(item => !item.ok)) process.exitCode = 1
