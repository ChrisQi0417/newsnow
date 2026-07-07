import process from "node:process"
import { Interval } from "./consts"
import { typeSafeObjectFromEntries } from "./type.util"
import type { OriginSource, Source, SourceID } from "./types"

const Time = {
  Test: 1,
  Realtime: 2 * 60 * 1000,
  Fast: 5 * 60 * 1000,
  Default: Interval, // 10min
  Common: 30 * 60 * 1000,
  Slow: 60 * 60 * 1000,
}

// Curated for factuality: prefer wire services, official primary releases,
// public international broadcasters, and accountable newsrooms over social hot lists.
export const originSources = {
  "govcn": {
    name: "中国政府网",
    type: "realtime",
    column: "china",
    color: "red",
    interval: Time.Common,
    desc: "国务院政策和政务原始发布",
    home: "https://www.gov.cn/",
  },
  "people": {
    name: "人民网",
    color: "red",
    interval: Time.Common,
    home: "https://www.people.com.cn/",
    sub: {
      politics: {
        title: "国内",
        type: "realtime",
        column: "china",
        home: "https://politics.people.com.cn/",
      },
      world: {
        title: "国际",
        type: "realtime",
        column: "world",
        home: "https://world.people.com.cn/",
      },
      finance: {
        title: "财经",
        type: "realtime",
        column: "finance",
        home: "https://finance.people.com.cn/",
      },
    },
  },
  "chinanews": {
    name: "中国新闻网",
    color: "red",
    interval: Time.Common,
    home: "https://www.chinanews.com/",
    sub: {
      china: {
        title: "国内",
        type: "realtime",
        column: "china",
        home: "https://www.chinanews.com/china/",
      },
      world: {
        title: "国际",
        type: "realtime",
        column: "world",
        home: "https://www.chinanews.com/world/",
      },
      finance: {
        title: "财经",
        type: "realtime",
        column: "finance",
        home: "https://www.chinanews.com/finance/",
      },
    },
  },
  "xinhua": {
    name: "新华社英文",
    color: "red",
    interval: Time.Common,
    home: "https://english.news.cn/",
    sub: {
      china: {
        title: "China",
        type: "realtime",
        column: "china",
      },
      world: {
        title: "World",
        type: "realtime",
        column: "world",
      },
      business: {
        title: "Business",
        type: "realtime",
        column: "finance",
      },
      tech: {
        title: "Sci-Tech",
        type: "realtime",
        column: "tech",
      },
    },
  },
  "reuters": {
    name: "Reuters",
    title: "Latest",
    type: "realtime",
    column: "world",
    color: "orange",
    interval: Time.Fast,
    desc: "Official Reuters news sitemap",
    home: "https://www.reuters.com/",
  },
  "apnews": {
    name: "AP News",
    color: "slate",
    interval: Time.Fast,
    desc: "Associated Press topics via RSSHub",
    home: "https://apnews.com/",
    sub: {
      top: {
        title: "Top",
        type: "realtime",
        column: "world",
      },
      world: {
        title: "World",
        type: "realtime",
        column: "world",
      },
      business: {
        title: "Business",
        type: "realtime",
        column: "finance",
      },
      "fact-check": {
        title: "Fact Check",
        type: "realtime",
        column: "world",
      },
    },
  },
  "bbc": {
    name: "BBC中文",
    type: "realtime",
    column: "world",
    color: "red",
    interval: Time.Common,
    home: "https://www.bbc.com/zhongwen/simp",
  },
  "dw": {
    name: "德国之声中文",
    type: "realtime",
    column: "world",
    color: "blue",
    interval: Time.Common,
    home: "https://www.dw.com/zh/",
  },
  "rfi": {
    name: "法广中文",
    type: "realtime",
    column: "world",
    color: "blue",
    interval: Time.Common,
    home: "https://www.rfi.fr/cn/",
  },
  "unnews": {
    name: "联合国新闻",
    type: "realtime",
    column: "world",
    color: "blue",
    interval: Time.Common,
    desc: "联合国官方中文新闻",
    home: "https://news.un.org/zh/",
  },
  "scmp": {
    name: "南华早报",
    color: "orange",
    interval: Time.Common,
    home: "https://www.scmp.com/",
    sub: {
      news: {
        title: "News",
        type: "realtime",
        column: "world",
      },
      china: {
        title: "China",
        type: "realtime",
        column: "china",
      },
      hongkong: {
        title: "Hong Kong",
        type: "realtime",
        column: "china",
      },
    },
  },
} as const satisfies Record<string, OriginSource>

export function genSources() {
  const _: [SourceID, Source][] = []

  Object.entries(originSources).forEach(([id, source]: [any, OriginSource]) => {
    const parent = {
      name: source.name,
      type: source.type,
      disable: source.disable,
      desc: source.desc,
      column: source.column,
      home: source.home,
      color: source.color ?? "primary",
      interval: source.interval ?? Time.Default,
    }
    if (source.sub && Object.keys(source.sub).length) {
      Object.entries(source.sub).forEach(([subId, subSource], i) => {
        if (i === 0) {
          _.push([id, {
            redirect: `${id}-${subId}`,
            ...parent,
            ...subSource,
          }] as [any, Source])
        }
        _.push([`${id}-${subId}`, { ...parent, ...subSource }] as [any, Source])
      })
    } else {
      _.push([id, {
        title: source.title,
        ...parent,
      }])
    }
  })

  return typeSafeObjectFromEntries(_.filter(([_, v]) => {
    if (v.disable === "cf" && process.env.CF_PAGES) {
      return false
    } else if (v.disable === true) {
      return false
    } else {
      return true
    }
  }))
}
