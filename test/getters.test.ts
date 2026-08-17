import { describe, expect, it } from "vitest"
import { getGetter, hasGetter, resolveSourceID, sourceModuleName } from "../server/getters"

describe("lazy source getters", () => {
  it("resolves standalone sources without loading every source module", async () => {
    expect(sourceModuleName("apple")).toBe("apple")
    expect(hasGetter("apple")).toBe(true)
    expect(await getGetter("apple")).toBeTypeOf("function")
  })

  it("resolves sub-sources through their parent module", async () => {
    expect(sourceModuleName("apnews-world")).toBe("apnews")
    expect(hasGetter("apnews-world")).toBe(true)
    expect(await getGetter("apnews-world")).toBeTypeOf("function")
  })

  it("resolves redirect aliases to their real sub-source", async () => {
    expect(resolveSourceID("apnews")).toBe("apnews-top")
    expect(resolveSourceID("wsj")).toBe("wsj-news")
    expect(await getGetter("apnews")).toBeTypeOf("function")
    expect(await getGetter("wsj")).toBeTypeOf("function")
  })
})
