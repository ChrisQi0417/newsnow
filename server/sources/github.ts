import { load } from "cheerio"
import type { NewsItem } from "@shared/types"
import { translateTextsToChinese } from "../utils/translate"

interface TrendingRepo {
  repo: string
  url: string
  description: string
  language: string
  stars: string
  starsToday: string
}

interface GitHubSearchResponse {
  items: {
    full_name: string
    html_url: string
    description?: string
    language?: string
    stargazers_count: number
  }[]
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function readRepo(article: any, $: ReturnType<typeof load>): TrendingRepo | undefined {
  const repoLink = $(article).find("h2 a[href^='/']").first()
  const repo = normalize(repoLink.text()).replace(/\s*\/\s*/, "/")
  const href = repoLink.attr("href")
  if (!repo || !href || !repo.includes("/")) return

  const detail = $(article).find("div.f6.color-fg-muted").last()
  const stars = normalize(detail.find("a[href$='/stargazers']").text())
  const starsToday = normalize(detail.find("span.d-inline-block.float-sm-right").text())

  return {
    repo,
    url: new URL(href, "https://github.com").href,
    description: normalize($(article).find("p.col-9").first().text()),
    language: normalize($(article).find("[itemprop='programmingLanguage']").first().text()),
    stars,
    starsToday,
  }
}

async function fetchTrendingRepos() {
  const html = await myFetch<string>("https://github.com/trending?since=daily", {
    responseType: "text",
  })
  const $ = load(html)
  return $("article.Box-row")
    .toArray()
    .map(article => readRepo(article, $))
    .filter(Boolean)
    .slice(0, 30) as TrendingRepo[]
}

async function fetchRecentPopularRepos() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const data = await myFetch<GitHubSearchResponse>("https://api.github.com/search/repositories", {
    query: {
      q: `created:>${since}`,
      sort: "stars",
      order: "desc",
      per_page: 30,
    },
  })
  return data.items.map(item => ({
    repo: item.full_name,
    url: item.html_url,
    description: item.description ?? "",
    language: item.language ?? "",
    stars: item.stargazers_count.toLocaleString("en-US"),
    starsToday: "近7天新仓库",
  }))
}

export default defineSource(async () => {
  let repos: TrendingRepo[]
  try {
    repos = await fetchTrendingRepos()
  } catch (e) {
    logger.warn("failed to fetch GitHub Trending page, using Search API fallback", e)
    repos = await fetchRecentPopularRepos()
  }

  if (!repos.length) throw new Error("Cannot fetch GitHub trending repositories")

  const translatedDescriptions = await translateTextsToChinese(repos.map(repo => repo.description))
  const items: NewsItem[] = repos.map((repo, index) => {
    const description = translatedDescriptions[index] || repo.description
    return {
      id: repo.url,
      title: description ? `${repo.repo}：${description}` : repo.repo,
      url: repo.url,
      extra: {
        hover: [
          repo.description && `原文：${repo.description}`,
          repo.language && `语言：${repo.language}`,
          repo.stars && `Stars：${repo.stars}`,
          repo.starsToday && `今日：${repo.starsToday}`,
        ].filter(Boolean).join("\n"),
        info: [
          repo.language,
          repo.stars && `${repo.stars} stars`,
          repo.starsToday,
        ].filter(Boolean).join(" · "),
      },
    }
  })

  return items
})
