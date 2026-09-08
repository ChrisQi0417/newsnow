import type { SourceID, SourceResponse } from "@shared/types"

export function parseSourceSnapshot(raw: string | null, id: SourceID, now = Date.now()): SourceResponse | undefined {
  if (!raw || id === "weather") return
  try {
    const entry = JSON.parse(raw)
    const updated = new Date(entry.updatedTime).getTime()
    if (entry.id !== id || !Number.isFinite(updated) || updated > now || now - updated > 24 * 60 * 60_000 || !Array.isArray(entry.items)) return
    const items = entry.items.filter((item: any) => item && typeof item.title === "string"
      && typeof item.url === "string" && /^https?:\/\//.test(item.url)
      && ["string", "number"].includes(typeof item.id)).slice(0, 30)
    return { id, status: "cache", updatedTime: updated, items }
  } catch {
    return undefined
  }
}

export function readSourceSnapshot(id: SourceID) {
  try {
    return parseSourceSnapshot(localStorage.getItem(`newsnow-source-v1-${id}`), id)
  } catch {
    return undefined
  }
}

export function saveSourceSnapshot(response: SourceResponse) {
  if (response.id === "weather" || response.refreshError || !response.items.length) return
  try {
    const raw = JSON.stringify({ ...response, items: response.items.slice(0, 30) })
    if (raw.length < 60_000) localStorage.setItem(`newsnow-source-v1-${response.id}`, raw)
  } catch { /* Reading still works when browser storage is unavailable or full. */ }
}
