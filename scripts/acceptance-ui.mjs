import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import process from "node:process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright")
const browser = await chromium.launch({ channel: "chrome", headless: true })
const output = resolve(".cache/acceptance")
await mkdir(output, { recursive: true })
const results = []
try {
  for (const width of [1365, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" })
    const page = await context.newPage()
    const errors = []
    const requests = []
    page.on("pageerror", error => errors.push(error.message))
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname === "/api/s") requests.push({ id: url.searchParams.get("id"), latest: url.searchParams.has("latest"), at: Date.now() })
    })
    await page.goto("http://127.0.0.1:5187/c/realtime")
    await page.getByText("384 条已载入", { exact: false }).waitFor({ timeout: 20000 })
    const headings = await page.locator(".source-heading h2").allTextContents()
    assert.equal(new Set(headings).size, headings.length, "Publisher cards must not repeat")
    assert.ok(headings.length > 20)
    assert.deepEqual(requests.map(request => request.id), ["weather"], "Fresh cache must not trigger per-source fetches")

    let categories = 0
    const groupedPanels = page.locator(".source-panel").filter({ has: page.locator(".source-category-tabs") })
    for (const panel of await groupedPanels.all()) {
      for (const button of await panel.locator(".source-category-tabs button").all()) {
        const label = await button.textContent()
        await button.click()
        assert.equal(await button.getAttribute("aria-pressed"), "true")
        assert.equal(await panel.locator(".source-subtitle").textContent(), label)
        assert.ok(await panel.locator(".article-title").count())
        categories += 1
      }
    }
    assert.equal(requests.length, 1, "Switching cached categories must not contact the network")
    const panel = page.locator(".source-panel").filter({ has: page.getByRole("heading", { name: "路透社", exact: true }) })
    const refresh = panel.getByRole("button", { name: /刷新/ })
    const response = page.waitForResponse(response => response.url().includes("id=reuters"))
    await refresh.click()
    await response
    await page.waitForFunction(() => !document.querySelector(".source-panel[aria-label=\"路透社\"] .source-heading button:last-child").disabled)
    await refresh.click()
    await page.getByText("已请求刷新，请间隔一分钟后再试。", { exact: true }).waitFor()
    assert.equal(requests.filter(request => request.id === "reuters").length, 1)
    assert.equal(requests.find(request => request.id === "reuters").latest, true)

    await page.locator(".article-open").first().click()
    await page.getByRole("dialog").waitFor()
    await page.getByRole("button", { name: "关闭阅读面板" }).click()
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" })
      for (const element of document.querySelectorAll("[data-overlayscrollbars-viewport]")) element.scrollTo({ top: 0, behavior: "instant" })
    })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "No horizontal overflow")
    await page.screenshot({ path: resolve(output, `desktop-${width}.png`) })
    await page.goto("http://127.0.0.1:5187/c/hottest")
    await page.locator(".article-title").first().waitFor()
    assert.ok(await page.locator(".article-title").count(), "Selected feed must not be blank")
    assert.deepEqual(errors, [])
    results.push({ width, publishers: headings.length, categories, initialSourceRequests: 1, repeatedManualRequests: 1, errors })
    await context.close()
  }
  await writeFile(resolve(output, "ui-report.json"), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
}
