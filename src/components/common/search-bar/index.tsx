import { createPortal } from "react-dom"
import type { SourceID } from "@shared/types"
import { sources } from "@shared/sources"
import { metadata } from "@shared/metadata"
import { focusSourcesAtom } from "~/atoms"
import { DeskIcon } from "~/components/desk"
import { sourceKind } from "~/utils/desk"

export function SearchBar() {
  const { opened, toggle } = useSearchBar()
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [toggle])
  return opened ? <SourceManager onClose={() => toggle(false)} /> : null
}

function SourceManager({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [focus, setFocus] = useAtom(focusSourcesAtom)
  const [search, setSearch] = useState("")
  const [onlyFocused, setOnlyFocused] = useState(false)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  const ids = (onlyFocused ? focus : [...new Set([...metadata.realtime.sources, ...metadata.hottest.sources])])
    .filter(id => `${sources[id].name} ${sources[id].title || ""} ${sources[id].desc || ""}`.toLowerCase().includes(search.trim().toLowerCase()))
  const move = (id: SourceID, direction: number) => {
    setFocus((prev) => {
      const next = [...prev]
      const index = next.indexOf(id)
      if (index < 0 || index + direction < 0 || index + direction >= next.length) {
        return prev
      }
      const moved = next[index]
      next[index] = next[index + direction]
      next[index + direction] = moved
      return next
    })
  }
  return createPortal(
    <dialog ref={ref} className="source-manager" aria-label="管理信息来源" onCancel={onClose}>
      <header className="reader-header">
        <span>管理信息来源</span>
        <button type="button" className="desk-icon-button" aria-label="关闭来源管理" title="关闭" onClick={onClose}><DeskIcon name="i-ph:x" /></button>
      </header>
      <div className="manager-tools">
        <label className="desk-search">
          <DeskIcon name="i-ph:magnifying-glass" />
          <input aria-label="搜索信息来源" placeholder="搜索来源" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        <label className="unread-toggle">
          <input type="checkbox" checked={onlyFocused} onChange={e => setOnlyFocused(e.target.checked)} />
          已关注
          {" "}
          {focus.length}
        </label>
      </div>
      <ul className="manager-list">
        {ids.map(id => (
          <li key={id}>
            <img className="source-logo" src={`/icons/${id.split("-")[0]}.png`} alt="" />
            <div>
              <h3>
                {sources[id].name}
                {" "}
                <small>{sources[id].title || sourceKind(id)}</small>
              </h3>
              <p>{sources[id].desc || sources[id].home}</p>
            </div>
            {onlyFocused && (
              <div className="manager-reorder">
                <button type="button" className="desk-icon-button" aria-label={`上移${sources[id].name}`} title="上移" disabled={focus.indexOf(id) === 0} onClick={() => move(id, -1)}><DeskIcon name="i-ph:arrow-up" /></button>
                <button type="button" className="desk-icon-button" aria-label={`下移${sources[id].name}`} title="下移" disabled={focus.indexOf(id) === focus.length - 1} onClick={() => move(id, 1)}><DeskIcon name="i-ph:arrow-down" /></button>
              </div>
            )}
            <button type="button" className={`desk-icon-button ${focus.includes(id) ? "active" : ""}`} aria-label={`${focus.includes(id) ? "取消关注" : "关注"}${sources[id].name}`} title={focus.includes(id) ? "取消关注" : "关注"} aria-pressed={focus.includes(id)} onClick={() => setFocus(prev => prev.includes(id) ? prev.filter(entry => entry !== id) : [...prev, id])}><DeskIcon name={focus.includes(id) ? "i-ph:star-fill" : "i-ph:star"} /></button>
          </li>
        ))}
      </ul>
      {!ids.length && <div className="panel-empty">{onlyFocused ? "没有匹配的关注来源" : "没有找到匹配的来源"}</div>}
      <footer className="reader-footer">
        <span className="manager-count">
          {focus.length}
          {" "}
          个已关注来源
        </span>
        <button type="button" className="desk-button primary" onClick={onClose}>
          完成
          <DeskIcon name="i-ph:check" />
        </button>
      </footer>
    </dialog>,
    document.body,
  )
}
