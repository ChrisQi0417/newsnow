import { atomWithStorage, createJSONStorage } from "jotai/utils"
import { sources } from "@shared/sources"
import type { DeskArticle } from "~/utils/desk"

const savedStorage = createJSONStorage<DeskArticle[]>()
export const savedArticlesAtom = atomWithStorage<DeskArticle[]>("newsnow-saved-articles-v1", [], {
  ...savedStorage,
  getItem(key, fallback) {
    const value = savedStorage.getItem(key, fallback)
    if (!Array.isArray(value)) return fallback
    return value.filter(entry => entry && sources[entry.sourceId as keyof typeof sources]
      && typeof entry.item?.title === "string" && typeof entry.item?.url === "string"
      && /^https?:\/\//.test(entry.item.url) && ["string", "number"].includes(typeof entry.item.id)).slice(0, 300)
  },
})
export const deskLayoutAtom = atomWithStorage<"grid" | "feed">("newsnow-desk-layout", "grid")
export const readArticlesAtom = atomWithStorage<string[]>("newsnow-read-articles-v1", [])
