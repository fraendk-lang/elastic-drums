/**
 * Elastic Groove Service Worker
 *
 * Strategy:
 *   - App shell + WASM + worklet: cache-first, pre-cached on install.
 *   - Hashed Vite assets (/assets/*.js|.css): cache-first (immutable), stored
 *     on first hit so the second load is instant + offline-capable.
 *   - HTML / unhashed: network-first, fall back to cache when offline.
 *
 * Update flow:
 *   - Bump CACHE_VERSION → install fetches the new shell.
 *   - The new SW enters "waiting" state — the page detects this via
 *     `updatefound` and renders the "New version" pill.
 *   - User clicks → page postMessages SKIP_WAITING → activate → controllerchange
 *     → page reloads automatically.
 */

const CACHE_VERSION = "v3";
const CACHE_NAME = `elastic-drums-${CACHE_VERSION}`;
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/wasm/elastic-drums-wasm.wasm",
  "/drum-worklet.js",
];

// Install: pre-cache app shell (best-effort — missing files don't block install)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL_ASSETS.map((url) =>
        cache.add(url).catch(() => { /* ignore individual failures */ })
      ))
    )
  );
  // Don't auto-skipWaiting — let the page decide when to switch versions
  // so we can ask the user via the update banner.
});

// Activate: clean old caches, take control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// SKIP_WAITING — sent by the page when the user accepts the update
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isCacheable(req) {
  if (req.method !== "GET") return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!isCacheable(req)) return;
  const url = new URL(req.url);

  // Hashed Vite assets + WASM + worklet + icons → cache-first (immutable)
  const isImmutable =
    url.pathname.startsWith("/assets/") ||
    url.pathname.includes("/wasm/") ||
    url.pathname.includes("/samples/") ||
    /\.(woff2?|ttf|otf|png|svg|ico)$/.test(url.pathname) ||
    url.pathname === "/drum-worklet.js";

  if (isImmutable) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => cached))
    );
    return;
  }

  // HTML / everything else → network-first, cache fallback
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req).then((c) => c || caches.match("/index.html")))
  );
});
