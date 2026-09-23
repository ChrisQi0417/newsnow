// Local-only UI fixtures: never contact publishers during repeated browser tests.
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, resolve, sep } from "node:path"
import process from "node:process"

const root = resolve("dist/output/public")
const sources = JSON.parse(await readFile("shared/sources.json", "utf8"))
const updatedTime = Date.now()
const fixtures = Object.entries(sources).filter(([, source]) => !source.redirect).map(([id, source]) => ({
  id,
  status: "cache",
  updatedTime,
  translationComplete: true,
  items: Array.from({ length: 8 }, (_, index) => ({
    id: `${id}-${index}`,
    title: `验收测试：${source.name} ${source.title || "最新"} 第${index + 1}条消息`,
    url: `${source.home || "https://example.com"}#acceptance-${index}`,
    pubDate: updatedTime - index * 60000,
  })),
}))
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" }
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1")
  if (url.pathname.startsWith("/api/")) {
    console.log(`${request.method} ${url.pathname}${url.search}`)
    const data = url.pathname === "/api/s/entire" ? fixtures.filter(entry => entry.id !== "weather") : url.pathname === "/api/s" ? fixtures.find(entry => entry.id === url.searchParams.get("id")) : {}
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify(data))
    return
  }
  let path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
  if (!path.startsWith(`${root}${sep}`) && path !== root) {
    response.writeHead(403).end()
    return
  }
  if (!extname(path)) path = resolve(root, "index.html")
  try {
    const body = await readFile(path)
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" })
    response.end(body)
  } catch {
    response.writeHead(404).end()
  }
})
server.listen(Number(process.env.PORT || 5187), "127.0.0.1", () => console.log("Acceptance fixtures: http://127.0.0.1:5187/c/realtime"))
