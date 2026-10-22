import { beforeEach, describe, expect, it, vi } from "vitest"
import people from "../server/sources/people"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("../server/utils/fetch", () => ({ myFetch: fetchMock }))

const firstUrl = "http://politics.people.com.cn/GB/461001/"
const secondUrl = "http://politics.people.com.cn/GB/1024/index.html"
const thirdUrl = "https://www.people.com.cn/"
const articleUrl = "http://politics.people.com.cn/n1/2026/1022/c1001-12345678.html"
const validPage = `<a href="${articleUrl}">人民网最新有效新闻标题</a>`
const getter = people["people-politics"]!

beforeEach(() => {
  fetchMock.mockReset()
})

describe("people source fallback", () => {
  it("continues after a successful HTTP response contains no usable news", async () => {
    fetchMock.mockResolvedValueOnce("<html><h1>页面已迁移</h1></html>")
      .mockResolvedValueOnce(validPage)

    expect(await getter({} as never)).toEqual([expect.objectContaining({
      title: "人民网最新有效新闻标题",
      url: articleUrl,
      pubDate: Date.parse("2026-10-22T00:00:00+08:00"),
    })])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([firstUrl, secondUrl])
  })

  it("uses the final fallback after a network error followed by an empty page", async () => {
    fetchMock.mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce("<html>没有新闻条目</html>")
      .mockResolvedValueOnce(validPage)

    expect(await getter({} as never)).toHaveLength(1)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([firstUrl, secondUrl, thirdUrl])
  })

  it("stops after the first usable result without fetching backup pages", async () => {
    fetchMock.mockResolvedValue(validPage)

    expect(await getter({} as never)).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("reports failure after each configured page returns no usable news", async () => {
    fetchMock.mockResolvedValue("<html><a href='/'>返回首页</a></html>")

    await expect(getter({} as never)).rejects.toThrow("Cannot fetch people.cn latest news")
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([firstUrl, secondUrl, thirdUrl])
  })
})
