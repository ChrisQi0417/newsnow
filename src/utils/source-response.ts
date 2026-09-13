import type { SourceID, SourceResponse } from "@shared/types"

export function isSourceResponse(data: unknown, id: SourceID): data is SourceResponse {
  if (!data || typeof data !== "object") return false
  const value = data as Partial<SourceResponse>
  return value.id === id && (value.status === "success" || value.status === "cache")
    && value.updatedTime !== undefined && Number.isFinite(new Date(value.updatedTime).getTime())
    && Array.isArray(value.items) && value.items.length > 0
    && value.items.every(item => item && typeof item.title === "string" && typeof item.url === "string")
}
