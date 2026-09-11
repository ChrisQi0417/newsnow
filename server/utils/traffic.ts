// Per-worker safety budget; shared source caching provides the cross-request layer.
export class TrafficBudget {
  private window = 0
  private total = 0
  private hosts = new Map<string, number>()
  private blocked = new Map<string, number>()

  take(url: string, now = Date.now()) {
    const host = new URL(url).hostname
    if ((this.blocked.get(host) || 0) > now) throw new Error("Upstream cooldown active")
    if (now - this.window >= 60_000) {
      this.window = now
      this.total = 0
      this.hosts.clear()
      for (const [key, until] of this.blocked) {
        if (until <= now) this.blocked.delete(key)
      }
    }
    const count = this.hosts.get(host) || 0
    if (this.total >= 60 || count >= 12) throw new Error("Outbound request budget exhausted")
    this.total++
    this.hosts.set(host, count + 1)
  }

  fail(url: string, now = Date.now(), retryAfter = 0) {
    this.blocked.set(new URL(url).hostname, now + Math.max(15 * 60_000, retryAfter))
  }
}

export const outboundBudget = new TrafficBudget()

export const sourceAttempts = new Map<string, number>()
export function reserveSourceRefresh(key: string, now = Date.now()) {
  for (const [id, until] of sourceAttempts) {
    if (until <= now) sourceAttempts.delete(id)
  }
  if ((sourceAttempts.get(key) || 0) > now || sourceAttempts.size >= 1000) throw new Error("Source refresh cooldown active")
  // Reserve before fetching, including failed attempts and concurrent callers.
  sourceAttempts.set(key, now + 15 * 60_000)
}
