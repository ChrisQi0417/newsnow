export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store")
  setHeader(event, "Content-Type", "text/html; charset=utf-8")
  setHeader(event, "Referrer-Policy", "no-referrer")

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NewsNow 更新中</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; color: #1f2937; background: #f8fafc; }
    main { text-align: center; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 20px; letter-spacing: 0; }
    p { margin: 0; color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>正在更新 NewsNow</h1>
    <p>完成后将自动打开实时页面</p>
  </main>
  <script>
    const destination = "/c/realtime?updated=" + Date.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      location.replace(destination);
    };

    (async () => {
      if (!("serviceWorker" in navigator)) return finish();
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return finish();

      navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
      await registration.update();
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      if (!registration.installing && !registration.waiting) return finish();
      setTimeout(finish, 8000);
    })().catch(finish);
  </script>
</body>
</html>`
})
