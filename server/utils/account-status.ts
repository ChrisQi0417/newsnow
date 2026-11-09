import type { SourceAccountStatus } from "@shared/types"
import { safeSourceIssues } from "./source-retry"

export function parseAccountStatus(value: unknown): SourceAccountStatus[] | undefined {
  if (!Array.isArray(value)) return
  const states = value.filter((entry): entry is SourceAccountStatus => !!entry && typeof entry === "object"
    && ["thsottiaux", "OpenAI"].includes(entry.handle)
    && ["success", "stale", "unavailable"].includes(entry.status)
    && (entry.updatedTime === undefined || (Number.isFinite(entry.updatedTime) && entry.updatedTime >= 0))
    && (entry.nextRetryAt === undefined || (Number.isFinite(entry.nextRetryAt) && entry.nextRetryAt >= 0)))
  const unique = new Map(states.map(entry => [entry.handle, {
    handle: entry.handle,
    status: entry.status,
    ...(entry.updatedTime === undefined ? {} : { updatedTime: entry.updatedTime }),
    ...(entry.nextRetryAt === undefined ? {} : { nextRetryAt: entry.nextRetryAt }),
    issues: safeSourceIssues(entry.issues),
  }]))
  return unique.size ? [...unique.values()] : undefined
}

export function accountStatusFields(value: unknown) {
  const accountStatus = parseAccountStatus(value)
  return accountStatus
    ? {
        accountStatus,
        partial: accountStatus.some(entry => entry.status !== "success"),
      }
    : {}
}
