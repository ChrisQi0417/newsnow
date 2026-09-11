import { $fetch } from "ofetch"
import { outboundBudget } from "./traffic"

export const myFetch = $fetch.create({
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  },
  timeout: 10000,
  retry: 0,
  onRequest({ request, options }) {
    // Override source-level retries too: a fallback must not multiply TCP attempts.
    options.retry = 0
    outboundBudget.take(String(request))
  },
  onRequestError({ request }) {
    outboundBudget.fail(String(request))
  },
  onResponseError({ request, response }) {
    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      const value = response.headers.get("retry-after") || ""
      const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0
      outboundBudget.fail(String(request), Date.now(), delay)
    }
  },
})
