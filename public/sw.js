/*
 * Projector shell worker.
 *
 * The app is a local server: files, Git, terminals and chats live behind /api and WebSocket,
 * so there is nothing useful to cache. This worker never stores responses: navigations always
 * go to the network, and an unreachable server gets an honest offline page. The client
 * registers it in prod only and removes the registration in dev, so HMR never sees stale HTML.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Older builds of this worker could leave a shell cache; drop it on activation.
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("projector-shell-")).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API, auth, terminals and dev-server modules are never intercepted.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/@vite") ||
    url.pathname.startsWith("/@id/") ||
    url.pathname.startsWith("/node_modules/") ||
    url.pathname.startsWith("/packages/")
  )
    return;
  if (request.mode === "navigate") event.respondWith(navigation(request));
});

async function navigation(request) {
  try {
    return await fetch(request);
  } catch {
    return offline();
  }
}

function offline() {
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Projector недоступен</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #10100f; color: #ecece6; font: 15px/1.45 system-ui, sans-serif; }
main { max-width: 32rem; padding: 2rem; }
h1 { margin: 0 0 .75rem; font-size: 1.25rem; font-weight: 600; letter-spacing: .02em; }
p { margin: 0 0 .75rem; color: #9a9a92; }
code { color: #ecece6; }
</style>
</head>
<body>
<main>
<h1>Projector не отвечает</h1>
<p>Сервер выключен или недоступен по этой сети. Запустите его на машине с проектами.</p>
<p>Интерфейс, файлы и терминалы работают только вместе с сервером — офлайн-режима нет.</p>
<p><code>./bin/projector</code></p>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
