import { useRegisterSW } from "virtual:pwa-register/react"
import { useMount } from "react-use"
import { useToast } from "./useToast"

export function usePWA() {
  const toaster = useToast()
  const { updateServiceWorker, needRefresh: [needRefresh] } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      registration?.update().catch(() => {})
    },
  })

  useEffect(() => {
    if (!needRefresh) return

    localStorage.setItem("updated", "1")
    updateServiceWorker(true).catch(() => {
      localStorage.removeItem("updated")
    })
  }, [needRefresh, updateServiceWorker])

  useMount(() => {
    if (localStorage.getItem("updated")) {
      localStorage.removeItem("updated")
      toaster("更新成功，赶快体验吧", {
        action: {
          label: "查看更新",
          onClick: () => {
            window.open(`${Homepage}/releases/tag/v${Version}`)
          },
        },
      })
    }
  })
}
