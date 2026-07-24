let shouldReloadClients = false

globalThis.addEventListener("install", () => {
  shouldReloadClients = Boolean(globalThis.registration.active)
})

globalThis.addEventListener("activate", (event) => {
  if (!shouldReloadClients) return

  event.waitUntil((async () => {
    await globalThis.clients.claim()
    const clients = await globalThis.clients.matchAll({
      includeUncontrolled: true,
      type: "window",
    })
    await Promise.all(clients.map(client => client.navigate(client.url)))
  })())
})
