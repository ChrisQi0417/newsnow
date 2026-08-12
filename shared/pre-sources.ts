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
  markets: {
    name: "全球股市",
    title: "主要指数",
    type: "realtime",
    column: "finance",
    color: "cyan",
    interval: Time.Realtime,
    desc: "优先按美元指数、黄金、美国、中国、日本、韩国展示，行情标注实时或延迟状态",
    home: "https://www.tradingview.com/markets/world-stocks/world-stock-markets/",
  },
  weather: {
    name: "天气与台风",
    title: "当地・北京・台风",
    type: "realtime",
    column: "world",
    color: "sky",
    interval: Time.Fast,
    desc: "按访问 IP 的近似位置显示当地及北京天气，并汇总 JMA 与 NHC 实时台风和飓风公报",
    home: "https://open-meteo.com/",
  },
  pi: {
    name: "Pi Network",
    title: "官方动态",
    type: "realtime",
    column: "finance",
    color: "violet",
    interval: Time.Fast,
    desc: "Pi Network 官方博客公告，英文标题翻译为中文；不收录价格预测和推广站点",
    home: "https://minepi.com/blog/",
  },
  apple: {
    name: "Apple News",
    title: "今日要闻",
    type: "realtime",
    column: "world",
    color: "rose",
    interval: Time.Fast,
    desc: "Apple News 编辑团队每日简报，来自 Apple News Today，英文标题翻译为中文",
    home: "https://podcasts.apple.com/us/podcast/apple-news-today/id1473872585",
  },
  ai: {
    name: "美国 AI",
    title: "最新动态",
    type: "realtime",
    column: "tech",
    color: "blue",
    interval: Time.Fast,
    desc: "以美国为重点的人工智能动态，聚合官方发布与路透社报道并翻译为中文",
    home: "https://openai.com/news/",
  },
  fed: {
    name: "美联储",
    title: "利率与动态",
    type: "realtime",
    column: "finance",
    color: "green",
    interval: Time.Fast,
    desc: "纽约联储参考利率与美联储官方公告、讲话、证词，英文标题翻译为中文",
    home: "https://www.federalreserve.gov/",
  },
  github: {
    name: "GitHub Trending",
    title: "今日热门仓库",
    type: "realtime",
    column: "tech",
    color: "slate",
    interval: Time.Fast,
    desc: "GitHub 官方每日热门仓库，项目说明翻译为中文",
    home: "https://github.com/trending",
  },
  govcn: {
    name: "中国政府网",
    type: "realtime",
    column: "china",
    color: "red",
    interval: Time.Fast,
    desc: "国务院政策和政务原始发布",
    home: "https://www.gov.cn/",
  },
  people: {
    name: "人民网",
    color: "red",
    interval: Time.Fast,
    home: "https://www.people.com.cn/",
    sub: {
      politics: {
        title: "国内",
        type: "realtime",
        column: "china",
        home: "http://politics.people.com.cn/",
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
        home: "http://finance.people.com.cn/",
      },
    },
  },
  chinanews: {
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
  xinhua: {
    name: "新华社英文",
    color: "red",
    interval: Time.Fast,
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
  twitter: {
    name: "Twitter/X",
    title: "Tibo 与 OpenAI",
    type: "realtime",
    column: "tech",
    color: "blue",
    interval: Time.Fast,
    desc: "仅收录 Tibo（@thsottiaux）和 OpenAI 官方账号（@OpenAI）的 X 帖子",
    home: "https://x.com/thsottiaux",
  },
  truthsocial: {
    name: "特朗普 Truth Social",
    title: "特朗普发布",
    type: "realtime",
    column: "world",
    color: "red",
    interval: Time.Fast,
    desc: "Donald Trump Truth Social posts; official Truth Social URL is retained when available",
    home: "https://truthsocial.com/@realDonaldTrump",
  },
  reuters: {
    name: "路透社",
    title: "综合",
    type: "realtime",
    column: "world",
    color: "orange",
    interval: Time.Fast,
    desc: "Reuters official news sitemap, titles translated to Chinese",
    home: "https://www.reuters.com/",
  },
  apnews: {
    name: "美联社",
    color: "slate",
    interval: Time.Fast,
    desc: "Associated Press topics via RSSHub, titles translated to Chinese",
    home: "https://apnews.com/",
    sub: {
      "top": {
        title: "头条",
        type: "realtime",
        column: "world",
      },
      "world": {
        title: "国际",
        type: "realtime",
        column: "world",
      },
      "business": {
        title: "商业",
        type: "realtime",
        column: "finance",
      },
      "fact-check": {
        title: "事实核查",
        type: "realtime",
        column: "world",
      },
    },
  },
  afp: {
    name: "法新社",
    title: "综合",
    type: "realtime",
    column: "world",
    color: "blue",
    interval: Time.Common,
    desc: "AFP.com official flash news, titles translated to Chinese",
    home: "https://www.afp.com/en",
  },
  bbc: {
    name: "BBC中文",
    type: "realtime",
    column: "world",
    color: "red",
    interval: Time.Common,
    home: "https://www.bbc.com/zhongwen/simp",
  },
  bbcnews: {
    name: "BBC新闻",
    color: "red",
    interval: Time.Fast,
    desc: "BBC News and BBC World Service global news feeds, titles translated to Chinese",
    home: "https://www.bbc.com/news/world",
    sub: {
      world: {
        title: "国际",
        type: "realtime",
        column: "world",
      },
      worldservice: {
        title: "国际广播",
        type: "realtime",
        column: "world",
        home: "https://www.bbc.co.uk/programmes/p02nq0gn",
      },
    },
  },
  bloomberg: {
    name: "彭博社",
    color: "orange",
    interval: Time.Fast,
    desc: "Bloomberg RSS feeds, titles translated to Chinese",
    home: "https://www.bloomberg.com/",
    sub: {
      business: {
        title: "商业",
        type: "realtime",
        column: "finance",
      },
      markets: {
        title: "市场",
        type: "realtime",
        column: "finance",
      },
      economics: {
        title: "经济",
        type: "realtime",
        column: "finance",
      },
      politics: {
        title: "政治",
        type: "realtime",
        column: "world",
      },
      technology: {
        title: "科技",
        type: "realtime",
        column: "tech",
      },
    },
  },
  ft: {
    name: "金融时报",
    title: "首页",
    type: "realtime",
    column: "finance",
    color: "orange",
    interval: Time.Common,
    desc: "Financial Times home RSS, titles translated to Chinese",
    home: "https://ft.com/",
  },
  wsj: {
    name: "华尔街日报",
    color: "slate",
    interval: Time.Fast,
    desc: "Dow Jones public Wall Street Journal RSS feeds, titles translated to Chinese",
    home: "https://www.wsj.com/news/rss-news-and-feeds",
    sub: {
      news: {
        title: "新闻",
        type: "realtime",
        column: "world",
      },
      world: {
        title: "国际",
        type: "realtime",
        column: "world",
      },
      markets: {
        title: "市场",
        type: "realtime",
        column: "finance",
      },
    },
  },
  nikkei: {
    name: "日经亚洲",
    title: "综合",
    type: "realtime",
    column: "finance",
    color: "orange",
    interval: Time.Common,
    desc: "Nikkei Asia RSS, titles translated to Chinese",
    home: "https://asia.nikkei.com/",
  },
  dw: {
    name: "德国之声中文",
    type: "realtime",
    column: "world",
    color: "blue",
    interval: Time.Common,
    home: "https://www.dw.com/zh/",
  },
  france24: {
    name: "France 24",
    title: "国际",
    type: "realtime",
    column: "world",
    color: "blue",
    interval: Time.Common,
    desc: "France 24 English RSS, titles translated to Chinese",
    home: "https://www.france24.com/en/",
  },
  nhk: {
    name: "NHK World",
    title: "国际",
    type: "realtime",
    column: "world",
    color: "red",
    interval: Time.Common,
    desc: "NHK World English news JSON, titles translated to Chinese",
    home: "https://www3.nhk.or.jp/nhkworld/en/news/",
  },
  economist: {
    name: "经济学人",
    title: "最新",
    type: "realtime",
    column: "world",
    color: "red",
    interval: Time.Common,
    desc: "The Economist latest RSS, titles translated to Chinese",
    home: "https://www.economist.com/latest",
  },
  rfi: {
    name: "法广中文",
    type: "realtime",
    column: "world",
    color: "blue",
    interval: Time.Common,
    home: "https://www.rfi.fr/cn/",
  },
  unnews: {
    name: "联合国新闻",
    type: "realtime",
    column: "world",
    color: "blue",
    interval: Time.Common,
    desc: "联合国官方中文新闻",
    home: "https://news.un.org/zh/",
  },
  scmp: {
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
