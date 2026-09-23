import process from "node:process"
import sources from "../shared/sources.json"

const baseUrl = (process.env.NEWSNOW_REFRESH_URL || "https://newsnow-1nq.pages.dev").replace(/\/+$/, "")
const configuredDelay = Number(process.env.REFRESH_DELAY_MS)
const delayMs = Number.isFinite(configuredDelay) ? Math.max(5000, configuredDelay) : 8000
const token = process.env.JWT_TOKEN
const sourceIds = Object.entries(sources)
  .filter(([, source]) => !("redirect" in source))
  .map(([id]) => id)
const failures: string[] = []

for (const [index, id] of sourceIds.entries()) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)
  try {
    const response = await fetch(`${baseUrl}/api/s?id=${encodeURIComponent(id)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    })
    const payload = await response.json() as { items?: unknown[], refreshError?: boolean }
    const count = Array.isArray(payload.items) ? payload.items.length : 0
    if (!response.ok || payload.refreshError || !count) {
      failures.push(id)
      console.error(`${id}: failed (HTTP ${response.status}, ${count} items)`)
    } else {
      console.log(`${id}: ${count} items`)
    }
  } catch (error) {
    failures.push(id)
    console.error(`${id}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timeout)
  }

  if (index < sourceIds.length - 1) await new Promise(resolve => setTimeout(resolve, delayMs))
}

console.log(`Finished ${sourceIds.length} sources; ${failures.length} failed.`)
if (failures.length) process.exitCode = 1
