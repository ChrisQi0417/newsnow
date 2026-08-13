import { describe, expect, it } from "vitest"
import { getGetter, hasGetter, sourceModuleName } from "../server/getters"

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
})
