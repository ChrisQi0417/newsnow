import { Link } from "@tanstack/react-router"
import { currentColumnIDAtom } from "~/atoms"

export function NavBar() {
  const currentId = useAtomValue(currentColumnIDAtom)
  return (
    <nav className="desk-primary-nav" aria-label="主导航">
      {([
        ["realtime", "实时"],
        ["hottest", "精选"],
        ["focus", "我的关注"],
      ] as const).map(([id, name]) => <Link key={id} to="/c/$column" params={{ column: id }} className={currentId === id ? "active" : ""} aria-current={currentId === id ? "page" : undefined}>{name}</Link>)}
    </nav>
  )
}
