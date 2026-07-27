globalThis.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await globalThis.clients.claim()
    const clients = await globalThis.clients.matchAll({
      includeUncontrolled: true,
      type: "window",
    })
    await Promise.all(clients.map(client => client.navigate(client.url)))
  })())
})
