const CACHE_NAME = "omnidesk-v7";
const STATIC_ASSETS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Do not intercept WebSocket, downloadable binaries/zips, external origins, or non-GET requests
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    event.request.url.startsWith("ws") ||
    !event.request.url.startsWith(self.location.origin) ||
    url.pathname.startsWith("/downloads/")
  ) {
    return;
  }

  const isHtmlOrManifest =
    event.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname === "/manifest.json";

  if (isHtmlOrManifest) {
    // Network-First for HTML/navigation so deploys take effect immediately
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return (
              cached ||
              caches.match("/index.html") ||
              new Response("Offline - Recurso indisponível", { status: 503 })
            );
          });
        })
    );
    return;
  }

  // Cache-First for immutable hashed /assets/* files
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => new Response("Offline - Recurso indisponível", { status: 503 }));
    })
  );
});
