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
    const payload = await response.json() as {
      items?: unknown[]
      refreshError?: boolean
      partial?: boolean
      translationComplete?: boolean
      accountStatus?: Array<{ handle?: string, status?: string }>
    }
    const count = Array.isArray(payload.items) ? payload.items.length : 0
    const affectedAccounts = Array.isArray(payload.accountStatus)
      ? payload.accountStatus.filter(account => account && account.status !== "success").map(account => account.handle === "OpenAI" ? "OpenAI 官方" : account.handle === "thsottiaux" ? "Tibo" : "未知账号")
      : []
    const partial = payload.partial === true || affectedAccounts.length > 0
    const translationIncomplete = payload.translationComplete === false
    if (!response.ok || payload.refreshError || !count || partial || translationIncomplete) {
      failures.push(id)
      const details = affectedAccounts.length ? `；受影响账号：${affectedAccounts.join("、")}` : partial ? "；部分内容未完整返回" : ""
      console.error(`${id}：刷新未完整成功（HTTP ${response.status}，${count} 条内容${details}${translationIncomplete ? "；中文翻译未完成" : ""}）`)
    } else {
      console.log(`${id}：${count} 条内容`)
    }
  } catch (error) {
    failures.push(id)
    console.error(`${id}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timeout)
  }

  if (index < sourceIds.length - 1) await new Promise(resolve => setTimeout(resolve, delayMs))
}

console.log(`已检查 ${sourceIds.length} 个来源；${failures.length} 个未完整成功。`)
if (failures.length) process.exitCode = 1
