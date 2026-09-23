import type { FixedColumnID, SourceID, SourceResponse } from "@shared/types"
import { useTitle } from "react-use"
import { createPortal } from "react-dom"
import { sources } from "@shared/sources"
import { metadata } from "@shared/metadata"
import { currentColumnIDAtom, currentSourcesAtom, focusSourcesAtom } from "~/atoms"
import { deskLayoutAtom, readArticlesAtom, savedArticlesAtom } from "~/atoms/desk"
import { useDeskCache, useSourceFeed } from "~/hooks/useSourceFeed"
import { articleKey, articleTime, groupSourcesByPublisher, matchesArticle, sourceCategory, sourceCategoryLabel, sourceKind, sourcePublisherName, sourceWarning, uniqueArticles } from "~/utils/desk"
import { readSourceSnapshot } from "~/utils/snapshots"
import { cacheSources } from "~/utils/data"
import type { DeskArticle, DeskCategory } from "~/utils/desk"
import "./style.css"

interface FeedState {
  data?: SourceResponse
  fetching: boolean
  error: boolean
}
const categories: { id: DeskCategory, name: string, icon: string }[] = [
  { id: "all", name: "全部动态", icon: "i-ph:squares-four" },
  { id: "world", name: "国际新闻", icon: "i-ph:globe-hemisphere-west" },
  { id: "tech", name: "AI 与科技", icon: "i-ph:cpu" },
  { id: "finance", name: "市场与金融", icon: "i-ph:chart-line-up" },
  { id: "weather", name: "天气与预警", icon: "i-ph:cloud-sun" },
  { id: "china", name: "中国资讯", icon: "i-ph:buildings" },
  { id: "saved", name: "稍后阅读", icon: "i-ph:bookmark-simple" },
]

export function DeskIcon({ name }: { name: string }) {
  return <span aria-hidden="true" className={`desk-icon ${name}`} />
}

function SourceLoader({ id, onChange }: { id: SourceID, onChange: (id: SourceID, state: FeedState) => void }) {
  const { data, isFetching, isError } = useSourceFeed(id)
  useEffect(() => onChange(id, { data, fetching: isFetching, error: isError || !!data?.refreshError }), [id, data, isFetching, isError, onChange])
  return null
}

function RelativeTime({ value }: { value?: number | string }) {
  const time = useRelativeTime(value || "")
  return <time title={value ? new Date(value).toLocaleString("zh-CN") : undefined}>{time || "时间未提供"}</time>
}

function SourceLogo({ id }: { id: SourceID }) {
  return (
    <img
      className="source-logo"
      src={`/icons/${id.split("-")[0]}.png`}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.src = "/pwa-192x192.png"
      }}
    />
  )
}

function ArticleRow({ article, onOpen, rank }: { article: DeskArticle, onOpen: (article: DeskArticle) => void, rank?: number }) {
  const [saved, setSaved] = useAtom(savedArticlesAtom)
  const read = useAtomValue(readArticlesAtom)
  const key = articleKey(article)
  const isSaved = saved.some(entry => articleKey(entry) === key)
  const isRead = Array.isArray(read) && read.includes(key)
  const { item, sourceId } = article
  return (
    <li className={`desk-article ${isRead ? "is-read" : ""}`}>
      {rank !== undefined && <span className="article-rank">{String(rank + 1).padStart(2, "0")}</span>}
      <button type="button" className="article-open" onClick={() => onOpen(article)}>
        <span className="article-title">{item.title}</span>
        <span className="article-meta">
          <span>{sources[sourceId].name}</span>
          <span><RelativeTime value={item.pubDate || item.extra?.date} /></span>
          {item.extra?.info && <span className="article-info">{item.extra.info}</span>}
        </span>
      </button>
      <button type="button" className={`desk-icon-button save-button ${isSaved ? "active" : ""}`} aria-label={isSaved ? "取消收藏" : "收藏文章"} title={isSaved ? "取消收藏" : "收藏文章"} aria-pressed={isSaved} onClick={() => setSaved(prev => isSaved ? prev.filter(entry => articleKey(entry) !== key) : [article, ...prev].slice(0, 300))}>
        <DeskIcon name={isSaved ? "i-ph:bookmark-simple-fill" : "i-ph:bookmark-simple"} />
      </button>
    </li>
  )
}

function SourcePanel({ ids, states, search, onOpen }: { ids: SourceID[], states: Partial<Record<SourceID, FeedState>>, search: string, onOpen: (article: DeskArticle) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [weatherTab, setWeatherTab] = useState("all")
  const [account, setAccount] = useState("all")
  const [selectedId, setSelectedId] = useState(ids[0])
  const id = ids.includes(selectedId) ? selectedId : ids[0]
  const state = states[id]
  const { isFocused, toggleFocus } = useFocusWith(id)
  const { refresh } = useRefetch()
  const data = state?.data
  const warning = data && sourceWarning(id, data.items)
  const items = (data?.items || []).map(item => ({ sourceId: id, item })).filter(article => matchesArticle(article, search)).filter(({ item }) => id !== "weather" || weatherTab === "all" || String(item.id).startsWith(weatherTab)).filter(({ item }) => id !== "twitter" || account === "all" || item.url.toLowerCase().includes(`/${account}/status/`))
  const isStale = data && Date.now() - new Date(data.updatedTime).getTime() > Math.max(sources[id].interval * 2, 15 * 60_000)
  if (search && data && !items.length) return null
  return (
    <section className={`source-panel ${id === "markets" || id === "weather" ? "data-panel" : ""}`} aria-label={sourcePublisherName(id)}>
      <header className="source-heading">
        <SourceLogo id={id} />
        <div className="source-heading-text">
          <h2>{sourcePublisherName(id)}</h2>
          <span className="source-subtitle">{ids.length > 1 ? sourceCategoryLabel(id) : sources[id].title || sourceKind(id)}</span>
        </div>
        <button type="button" className={`desk-icon-button ${isFocused ? "active" : ""}`} title={isFocused ? "取消关注来源" : "关注来源"} aria-label={`${isFocused ? "取消关注" : "关注"}${sources[id].name}`} aria-pressed={isFocused} onClick={toggleFocus}><DeskIcon name={isFocused ? "i-ph:star-fill" : "i-ph:star"} /></button>
        <button type="button" className="desk-icon-button" disabled={state?.fetching} title="刷新此来源" aria-label={`刷新${sources[id].name}`} onClick={() => refresh(id)}><DeskIcon name={`i-ph:arrow-clockwise ${state?.fetching ? "spin" : ""}`} /></button>
      </header>
      <div className={`source-status ${state?.error || isStale ? "warning" : ""}`}>
        <span className={`status-dot ${state?.fetching ? "busy" : ""}`} />
        {state?.error
          ? (data ? "更新失败 · 显示上次内容" : "来源暂时不可用")
          : state?.fetching
            ? "正在获取更新"
            : data
              ? (
                  <>
                    {isStale ? "缓存较旧 · " : "数据更新于 "}
                    <RelativeTime value={data.updatedTime} />
                  </>
                )
              : "等待加载"}
        <span className="source-kind">
          {sourceKind(id)}
          {data?.translationComplete === false ? " · 保留原文" : ""}
        </span>
      </div>
      {ids.length > 1 && (
        <div className="source-category-tabs" aria-label={`${sourcePublisherName(id)}内容分类`}>
          {ids.map(sourceId => (
            <button
              type="button"
              key={sourceId}
              aria-pressed={id === sourceId}
              onClick={() => {
                setSelectedId(sourceId)
                setExpanded(false)
              }}
            >
              {sourceCategoryLabel(sourceId)}
            </button>
          ))}
        </div>
      )}
      {id === "weather" && <div className="weather-tabs" aria-label="天气分类">{[["all", "概览"], ["weather-", "天气"], ["cyclone-", "台风"], ["earthquake-", "地震"]].map(([value, label]) => <button type="button" key={value} aria-pressed={weatherTab === value} onClick={() => setWeatherTab(value)}>{label}</button>)}</div>}
      {warning && <p className="source-warning">{warning}</p>}
      {id === "twitter" && <div className="weather-tabs" aria-label="关注账号">{[["all", "全部"], ["thsottiaux", "Tibo"], ["openai", "OpenAI 官方"]].map(([value, label]) => <button type="button" key={value} aria-pressed={account === value} onClick={() => setAccount(value)}>{label}</button>)}</div>}
      {items.length > 0
        ? <ol className="source-articles">{items.slice(0, expanded ? items.length : 5).map((article, index) => id === "markets" && article.item.extra?.quote ? <MarketRow key={articleKey(article)} article={article} onOpen={onOpen} /> : <ArticleRow key={articleKey(article)} article={article} onOpen={onOpen} rank={id === "github" ? index : undefined} />)}</ol>
        : state?.fetching || !state
          ? (
              <div className="desk-skeleton" aria-label="正在加载消息">
                <span />
                <span />
                <span />
                <span />
              </div>
            )
          : <div className="panel-empty">{state?.error ? "暂未取得内容，请稍后重试。" : search ? "没有匹配的消息" : "来源暂未返回消息"}</div>}
      <footer className="source-footer">
        <a href={sources[id].home} target="_blank" rel="noopener noreferrer">
          来源网站
          <DeskIcon name="i-ph:arrow-up-right" />
        </a>
        {items.length > 5 && (
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? "收起" : `更多消息 · ${items.length}`}
            <DeskIcon name={expanded ? "i-ph:caret-up" : "i-ph:caret-down"} />
          </button>
        )}
      </footer>
    </section>
  )
}

function MarketRow({ article, onOpen }: { article: DeskArticle, onOpen: (article: DeskArticle) => void }) {
  const quote = article.item.extra!.quote!
  return (
    <li className="desk-article market-row">
      <button type="button" className="article-open" onClick={() => onOpen(article)}>
        <span className="market-name">{quote.name}</span>
        <span className="market-value">{quote.value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span className="market-region">{quote.region}</span>
        <span className={`market-change ${quote.changePercent > 0 ? "up" : quote.changePercent < 0 ? "down" : ""}`}>
          {quote.changePercent > 0 ? "+" : ""}
          {quote.changePercent.toFixed(2)}
          %
        </span>
        <span className="article-meta">
          <span>{quote.status}</span>
          <span><RelativeTime value={article.item.pubDate} /></span>
        </span>
      </button>
    </li>
  )
}

function Reader({ article, onClose }: { article: DeskArticle, onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [saved, setSaved] = useAtom(savedArticlesAtom)
  const key = articleKey(article)
  const isSaved = saved.some(entry => articleKey(entry) === key)
  const { item, sourceId } = article
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return createPortal(
    <dialog
      ref={ref}
      className="desk-reader"
      aria-label="消息阅读面板"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="reader-inner">
        <header className="reader-header">
          <span>
            <SourceLogo id={sourceId} />
            {sources[sourceId].name}
          </span>
          <button type="button" className="desk-icon-button" aria-label="关闭阅读面板" title="关闭" onClick={onClose}><DeskIcon name="i-ph:x" /></button>
        </header>
        <div className="reader-body">
          <span className="reader-kicker">
            {sourceKind(sourceId)}
            <span> / </span>
            <RelativeTime value={item.pubDate || item.extra?.date} />
          </span>
          <h2>{item.title}</h2>
          {item.extra?.info && <p className="reader-info">{item.extra.info}</p>}
          {item.extra?.hover && (
            <div className="reader-original">
              <h3>原文与补充信息</h3>
              <p>{item.extra.hover}</p>
            </div>
          )}
          <div className="reader-provenance">
            <h3>来源</h3>
            <p>{sources[sourceId].desc || sources[sourceId].name}</p>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {(() => {
                try {
                  return new URL(item.url).hostname
                } catch {
                  return sources[sourceId].name
                }
              })()}
              <DeskIcon name="i-ph:arrow-up-right" />
            </a>
          </div>
        </div>
        <footer className="reader-footer">
          <button type="button" className="desk-button" aria-pressed={isSaved} onClick={() => setSaved(prev => isSaved ? prev.filter(entry => articleKey(entry) !== key) : [article, ...prev].slice(0, 300))}>
            <DeskIcon name={isSaved ? "i-ph:bookmark-simple-fill" : "i-ph:bookmark-simple"} />
            {isSaved ? "已收藏" : "稍后阅读"}
          </button>
          <a className="desk-button primary" href={item.mobileUrl || item.url} target="_blank" rel="noopener noreferrer">
            阅读完整原文
            <DeskIcon name="i-ph:arrow-up-right" />
          </a>
        </footer>
      </div>
    </dialog>,
    document.body,
  )
}

export function Desk({ id }: { id: FixedColumnID }) {
  const [currentId, setCurrentId] = useAtom(currentColumnIDAtom)
  const currentSources = useAtomValue(currentSourcesAtom)
  const focus = useAtomValue(focusSourcesAtom)
  const [saved] = useAtom(savedArticlesAtom)
  const [, setRead] = useAtom(readArticlesAtom)
  const [layout, setLayout] = useAtom(deskLayoutAtom)
  const [category, setCategory] = useState<DeskCategory>("all")
  const [search, setSearch] = useState("")
  const [states, setStates] = useState<Partial<Record<SourceID, FeedState>>>(() => Object.fromEntries(
    [...new Set([...metadata.realtime.sources, ...metadata.hottest.sources])].flatMap((sourceId) => {
      const data = cacheSources.get(sourceId) || readSourceSnapshot(sourceId)
      return data ? [[sourceId, { data, fetching: false, error: !!data.refreshError }]] : []
    }),
  ))
  const [selected, setSelected] = useState<DeskArticle | null>(null)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const read = useAtomValue(readArticlesAtom)
  const [limit, setLimit] = useState(60)
  const { refresh } = useRefetch()
  const { toggle: openSources } = useSearchBar()
  useTitle(`NewsNow | ${id === "hottest" ? "精选" : metadata[id].name}`)
  useEffect(() => {
    setCurrentId(id)
  }, [id, setCurrentId])
  useEffect(() => {
    setCategory("all")
    setSearch("")
    setLimit(60)
  }, [id])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])
  const ids = currentId === id ? currentSources : metadata[id].sources
  const cache = useDeskCache(ids)
  const onChange = useCallback((sourceId: SourceID, state: FeedState) => setStates(prev => ({ ...prev, [sourceId]: state })), [])
  const visibleIds = ids.filter(sourceId => category === "all" || sourceCategory(sourceId) === category)
  const visibleGroups = groupSourcesByPublisher(visibleIds)
  const loaded = ids.filter(sourceId => states[sourceId]?.data)
  const fetching = ids.filter(sourceId => states[sourceId]?.fetching)
  const failed = ids.filter(sourceId => states[sourceId]?.error)
  const stale = ids.filter((sourceId) => {
    const data = states[sourceId]?.data
    return data && Date.now() - new Date(data.updatedTime).getTime() > Math.max(sources[sourceId].interval * 2, 15 * 60_000)
  })
  const allArticles = visibleIds.flatMap(sourceId => (states[sourceId]?.data?.items || []).map(item => ({ sourceId, item })))
  const articles = uniqueArticles(category === "saved" ? saved : allArticles)
    .filter(article => matchesArticle(article, search) && (!onlyUnread || !Array.isArray(read) || !read.includes(articleKey(article))))
    .sort((a, b) => articleTime(b.item) - articleTime(a.item))
  const openArticle = useCallback((article: DeskArticle) => {
    setSelected(article)
    setRead(prev => [articleKey(article), ...(Array.isArray(prev) ? prev : []).filter(key => key !== articleKey(article))].slice(0, 1000))
  }, [setRead])
  const feedView = layout === "feed" || category === "saved" || !!search.trim() || onlyUnread
  const heading = category === "all" ? (id === "focus" ? "我的关注" : id === "hottest" ? "精选动态" : "全球动态") : categories.find(item => item.id === category)!.name
  const articleCount = ids.reduce((sum, sourceId) => sum + (states[sourceId]?.data?.items.length || 0), 0)

  return (
    <div className="news-desk">
      {cache.fetchStatus !== "fetching" && ids.map(sourceId => <SourceLoader key={sourceId} id={sourceId} onChange={onChange} />)}
      <aside className="desk-sidebar">
        <p className="sidebar-label">工作台</p>
        <nav aria-label="内容分类">
          {categories.map(item => (
            <button
              type="button"
              key={item.id}
              className={category === item.id ? "selected" : ""}
              aria-pressed={category === item.id}
              onClick={() => {
                setCategory(item.id)
                setLimit(60)
              }}
            >
              <DeskIcon name={item.icon} />
              <span>{item.name}</span>
              <small>{item.id === "saved" ? saved.length : item.id === "all" ? ids.length : ids.filter(sourceId => sourceCategory(sourceId) === item.id).length}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-label-row">
          <p className="sidebar-label">我的来源</p>
          <button type="button" className="desk-icon-button" title="管理来源" aria-label="管理来源" onClick={() => openSources(true)}><DeskIcon name="i-ph:plus" /></button>
        </div>
        {focus.slice(0, 6).map(sourceId => (
          <button
            type="button"
            className="sidebar-source"
            key={sourceId}
            onClick={() => {
              setCategory("all")
              setSearch(sources[sourceId].name)
            }}
          >
            <SourceLogo id={sourceId} />
            <span>{sources[sourceId].name}</span>
          </button>
        ))}
        {!focus.length && (
          <button type="button" className="desk-button sidebar-add" onClick={() => openSources(true)}>
            <DeskIcon name="i-ph:plus" />
            添加关注来源
          </button>
        )}
        <div className="sidebar-bottom">
          <span className={`status-dot ${!online ? "offline" : ""}`} />
          {online ? "已连接 · 自动更新" : "已离线"}
          <span>NEWSNOW / 全球信息台</span>
        </div>
      </aside>
      <div className="desk-main">
        <div className="desk-heading">
          <div>
            <p className="desk-date">
              {new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}
              <span>GLOBAL BRIEFING</span>
            </p>
            <h1>
              {heading}
              <span className="heading-dot">.</span>
            </h1>
          </div>
          <button type="button" className="desk-button" disabled={fetching.length > 0 || !online || !ids.length} onClick={() => refresh(...ids)}>
            <DeskIcon name={`i-ph:arrow-clockwise ${fetching.length ? "spin" : ""}`} />
            {fetching.length ? `更新中 ${fetching.length}` : "更新全部"}
          </button>
        </div>
        {!online && <div className="desk-notice" role="status">网络已断开，正在显示已加载的内容。恢复连接后自动更新。</div>}
        <div className="desk-summary">
          <span>
            <strong>{ids.length}</strong>
            {" "}
            个信息源
          </span>
          <span>
            <strong>{articleCount}</strong>
            {" "}
            条已载入
          </span>
          <button type="button" onClick={() => setHealthOpen(!healthOpen)} aria-expanded={healthOpen}>
            <span className={`status-dot ${failed.length || stale.length ? "offline" : ""}`} />
            {failed.length ? `${failed.length} 个来源异常` : stale.length ? `${stale.length} 个缓存较旧` : fetching.length ? "正在同步" : `${loaded.length} 个来源已载入`}
            <DeskIcon name="i-ph:caret-down" />
          </button>
        </div>
        {healthOpen && (
          <div className="desk-health">
            <div>
              <strong>来源状态</strong>
              <span>接口更新时间与消息发布时间分别显示</span>
            </div>
            {ids.map(sourceId => (
              <div key={sourceId}>
                <span>
                  {sources[sourceId].name}
                  {" "}
                  {sources[sourceId].title}
                </span>
                <span>{states[sourceId]?.fetching ? "更新中" : states[sourceId]?.error ? "暂时失败" : states[sourceId]?.data ? <RelativeTime value={states[sourceId]?.data?.updatedTime} /> : "等待加载"}</span>
              </div>
            ))}
            {failed.length > 0 && <button type="button" className="desk-button" onClick={() => refresh(...failed)}>重试异常来源</button>}
          </div>
        )}
        <div className="desk-toolbar">
          <label className="desk-search">
            <DeskIcon name="i-ph:magnifying-glass" />
            <input
              aria-label="搜索已载入的消息和来源"
              placeholder="搜索消息、来源或关键词"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setLimit(60)
              }}
            />
            {search && <button type="button" className="desk-icon-button" title="清除搜索" aria-label="清除搜索" onClick={() => setSearch("")}><DeskIcon name="i-ph:x" /></button>}
          </label>
          <label className="unread-toggle">
            <input type="checkbox" checked={onlyUnread} onChange={e => setOnlyUnread(e.target.checked)} />
            未读
          </label>
          <div className="desk-view-toggle" aria-label="显示方式">
            <button
              type="button"
              aria-label="按来源浏览"
              title="按来源浏览"
              aria-pressed={!feedView}
              onClick={() => {
                setLayout("grid")
                setOnlyUnread(false)
                setSearch("")
                if (category === "saved") setCategory("all")
              }}
            >
              <DeskIcon name="i-ph:squares-four" />
            </button>
            <button type="button" aria-label="按时间浏览" title="按时间浏览" aria-pressed={feedView} onClick={() => setLayout("feed")}><DeskIcon name="i-ph:list-bullets" /></button>
          </div>
        </div>
        {feedView
          ? (
              <div className="desk-feed">
                <div className="feed-heading">
                  <span>{search ? `“${search}” 的搜索结果` : "消息时间线"}</span>
                  <span>
                    {articles.length}
                    {" "}
                    条 · 按发布时间排序
                  </span>
                </div>
                <ol>{articles.slice(0, limit).map(article => <ArticleRow key={articleKey(article)} article={article} onOpen={openArticle} />)}</ol>
                {!articles.length && (
                  <div className="desk-empty">
                    <DeskIcon name={category === "saved" ? "i-ph:bookmark-simple" : "i-ph:magnifying-glass"} />
                    <h2>{category === "saved" ? "还没有收藏" : fetching.length ? "正在载入消息" : "暂无匹配消息"}</h2>
                    <p>{category === "saved" ? "收藏的文章会保存在这台设备上。" : search ? "可以尝试更短的关键词，或等待来源加载完成。" : "稍后回来查看更新。"}</p>
                  </div>
                )}
                {articles.length > limit && (
                  <button type="button" className="desk-button feed-more" onClick={() => setLimit(limit + 60)}>
                    加载更多
                    <DeskIcon name="i-ph:caret-down" />
                  </button>
                )}
              </div>
            )
          : (
              <div className="desk-grid">
                {visibleGroups.map(group => <SourcePanel key={group.name} ids={group.ids} states={states} search={search} onOpen={openArticle} />)}
                {!visibleIds.length && (
                  <div className="desk-empty">
                    <DeskIcon name="i-ph:star" />
                    <h2>{id === "focus" ? "关注你关心的来源" : "这个分类还没有来源"}</h2>
                    <button type="button" className="desk-button primary" onClick={() => openSources(true)}>
                      选择来源
                      <DeskIcon name="i-ph:plus" />
                    </button>
                  </div>
                )}
              </div>
            )}
        <div className="desk-bottom-note">
          NEWSNOW
          <span>消息来自标注来源 · 行情时效以原始数据标注为准</span>
        </div>
      </div>
      {selected && <Reader article={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
