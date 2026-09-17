import type { SourceID, SourceResponse } from "@shared/types"
import { useQuery } from "@tanstack/react-query"
import { sources } from "@shared/sources"
import { cacheSources, completeSourceRefresh, failSourceRefresh, refetchSources, scheduleSourceAutoRefresh, withSourceRequestLimit } from "~/utils/data"
import { myFetch, safeParseString } from "~/utils"
import { readSourceSnapshot, saveSourceSnapshot } from "~/utils/snapshots"
import { isSourceResponse } from "~/utils/source-response"

export function useDeskCache(ids: SourceID[]) {
  return useQuery({
    queryKey: ["desk-cache", ids],
    enabled: ids.some(id => id !== "weather" && !cacheSources.has(id)),
    queryFn: async ({ signal }) => {
      const cached = await myFetch<SourceResponse[] | undefined>("/s/entire", {
        method: "POST",
        body: { sources: ids.filter(id => id !== "weather") },
        timeout: 2000,
        signal,
      })
      if (!Array.isArray(cached)) throw new Error("Invalid desk cache response")
      for (const entry of cached) {
        if (!entry || !ids.includes(entry.id) || !isSourceResponse(entry, entry.id)) continue
        if (entry.translationComplete === false) continue
        const previous = cacheSources.get(entry.id)
        if (!previous || new Date(previous.updatedTime).getTime() < new Date(entry.updatedTime).getTime()) cacheSources.set(entry.id, entry)
      }
      return cached || []
    },
    retry: false,
    staleTime: 3 * 60_000,
    refetchOnWindowFocus: false,
  })
}

export function useSourceFeed(id: SourceID) {
  const query = useQuery<SourceResponse>({
    queryKey: ["source", id],
    queryFn: async ({ signal }) => {
      const latest = refetchSources.has(id)
      if (!latest && cacheSources.has(id)) return cacheSources.get(id)!
      const headers: Record<string, string> = {}
      const jwt = safeParseString(localStorage.getItem("jwt"))
      if (latest && jwt) headers.Authorization = `Bearer ${jwt}`
      const data = await withSourceRequestLimit(() => {
        signal.throwIfAborted()
        return myFetch<SourceResponse>(`/s?id=${id}${latest ? "&latest" : ""}`, { headers, signal })
      }).catch((error) => {
        if (signal.aborted && latest) failSourceRefresh(id)
        throw error
      })
      if (!isSourceResponse(data, id)) throw new Error("Invalid news source response")
      if (latest) completeSourceRefresh(id)
      cacheSources.set(id, data)
      saveSourceSnapshot(data)
      return data
    },
    initialData: () => {
      const snapshot = cacheSources.get(id) || readSourceSnapshot(id)
      if (snapshot) cacheSources.set(id, snapshot)
      return snapshot
    },
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1500,
  })
  const { data, isFetching, isError, refetch } = query
  const refreshLatest = useCallback(() => {
    if (document.visibilityState !== "visible" || !navigator.onLine || isFetching) return
    if (scheduleSourceAutoRefresh(id)) void refetch()
  }, [id, isFetching, refetch])

  useEffect(() => {
    if (isError && !isFetching) failSourceRefresh(id)
  }, [id, isError, isFetching])

  useEffect(() => {
    if (data) refreshLatest()
  }, [data, refreshLatest])

  useEffect(() => {
    const interval = window.setInterval(refreshLatest, Math.max(sources[id].interval, 60_000))
    document.addEventListener("visibilitychange", refreshLatest)
    window.addEventListener("pageshow", refreshLatest)
    window.addEventListener("online", refreshLatest)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", refreshLatest)
      window.removeEventListener("pageshow", refreshLatest)
      window.removeEventListener("online", refreshLatest)
    }
  }, [id, refreshLatest])
  return query
}
