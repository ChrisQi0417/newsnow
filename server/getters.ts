import { sources } from "@shared/sources"
import type { SourceID } from "@shared/types"
import type { SourceGetter } from "./types"

interface SourceModule {
  default: SourceGetter | Partial<Record<SourceID, SourceGetter>>
}

const sourceModules = {
  afp: () => import("./sources/afp"),
  ai: () => import("./sources/ai"),
  apnews: () => import("./sources/apnews"),
  apple: () => import("./sources/apple"),
  bbc: () => import("./sources/bbc"),
  bbcnews: () => import("./sources/bbcnews"),
  bloomberg: () => import("./sources/bloomberg"),
  chinanews: () => import("./sources/chinanews"),
  dw: () => import("./sources/dw"),
  economist: () => import("./sources/economist"),
  fed: () => import("./sources/fed"),
  france24: () => import("./sources/france24"),
  ft: () => import("./sources/ft"),
  github: () => import("./sources/github"),
  govcn: () => import("./sources/govcn"),
  markets: () => import("./sources/markets"),
  nhk: () => import("./sources/nhk"),
  nikkei: () => import("./sources/nikkei"),
  people: () => import("./sources/people"),
  pi: () => import("./sources/pi"),
  reuters: () => import("./sources/reuters"),
  rfi: () => import("./sources/rfi"),
  scmp: () => import("./sources/scmp"),
  truthsocial: () => import("./sources/truthsocial"),
  twitter: () => import("./sources/twitter"),
  unnews: () => import("./sources/unnews"),
  weather: () => import("./sources/weather"),
  wsj: () => import("./sources/wsj"),
  xinhua: () => import("./sources/xinhua"),
} satisfies Record<string, () => Promise<SourceModule>>

type SourceModuleName = keyof typeof sourceModules

export function resolveSourceID(id: SourceID): SourceID {
  const visited = new Set<SourceID>()
  let current = id

  while (!visited.has(current)) {
    const redirect = sources[current]?.redirect
    if (!redirect) break
    visited.add(current)
    current = redirect
  }

  return current
}

export function sourceModuleName(id: SourceID): SourceModuleName | undefined {
  const name = resolveSourceID(id).split("-")[0] as SourceModuleName
  return name in sourceModules ? name : undefined
}

export function hasGetter(id: SourceID) {
  return Boolean(sourceModuleName(id))
}

export async function getGetter(id: SourceID): Promise<SourceGetter | undefined> {
  const resolvedID = resolveSourceID(id)
  const name = sourceModuleName(resolvedID)
  if (!name) return

  const source = (await sourceModules[name]()).default
  return typeof source === "function" ? source : source[resolvedID]
}
