import { Link } from "@tanstack/react-router"
import { NavBar } from "../navbar"
import { DeskIcon } from "../desk"

export function Header() {
  const { isDark, toggleDark } = useDark()
  const { toggle } = useSearchBar()
  const { enableLogin, loggedIn, login, logout } = useLogin()
  return (
    <>
      <Link to="/" className="desk-brand">
        <img src="/pwa-192x192.png" alt="" />
        <span>
          News
          <span>Now</span>
        </span>
        <small>全球信息台</small>
      </Link>
      <NavBar />
      <div className="desk-header-actions">
        <button type="button" className="desk-icon-button" title="管理来源" aria-label="管理来源" onClick={() => toggle(true)}><DeskIcon name="i-ph:sliders-horizontal" /></button>
        <button type="button" className="desk-icon-button" title={isDark ? "切换浅色模式" : "切换深色模式"} aria-label={isDark ? "切换浅色模式" : "切换深色模式"} onClick={toggleDark}><DeskIcon name={isDark ? "i-ph:sun" : "i-ph:moon"} /></button>
        {enableLogin && <button type="button" className="desk-icon-button" title={loggedIn ? "退出登录" : "登录"} aria-label={loggedIn ? "退出登录" : "登录"} onClick={loggedIn ? logout : login}><DeskIcon name="i-ph:user-circle" /></button>}
      </div>
    </>
  )
}
