/**
 * Elastic Groove Service Worker
 *
 * Strategy:
 *   - App shell + WASM + worklet: cache-first, pre-cached on install.
 *   - Hashed Vite assets (/assets/*.js|.css): cache-first (immutable), stored
 *     on first hit so the second load is instant + offline-capable.
 *   - /samples/ : cache-first but with an LRU eviction policy. Without
 *     this the samples cache grows unbounded as the user explores kits;
 *     a long-term user could end up with >1GB of audio in CacheStorage.
 *     Eviction runs after each new sample write and trims the oldest
 *     entries until the total stays under SAMPLE_CACHE_MAX_BYTES.
 *   - HTML / unhashed: network-first, fall back to cache when offline.
 *
 * Update flow:
 *   - Bump CACHE_VERSION → install fetches the new shell.
 *   - The new SW enters "waiting" state — the page detects this via
 *     `updatefound` and renders the "New version" pill.
 *   - User clicks → page postMessages SKIP_WAITING → activate → controllerchange
 *     → page reloads automatically.
 */

const CACHE_VERSION = "v4";
const CACHE_NAME = `elastic-drums-${CACHE_VERSION}`;
const SAMPLE_CACHE_NAME = `elastic-drums-samples-${CACHE_VERSION}`;
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

// LRU budget for the samples cache. 50 MB is generous enough for a few
// hundred factory + user samples (~150 KB each at 44.1k mono) and small
// enough that we never balloon the browser's storage quota.
const SAMPLE_CACHE_MAX_BYTES = 50 * 1024 * 1024;

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
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== SAMPLE_CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
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

/**
 * LRU eviction for the samples cache. Walks the cache in insertion order
 * (CacheStorage preserves insertion order for keys() and `caches.put` moves
 * the entry to the end when re-stored, so the front of the list IS the LRU
 * tail). Trims oldest entries until under-budget.
 *
 * Approximate size — uses Content-Length when available, falls back to a
 * 150 KB-per-entry estimate. Cheap and good enough for a soft cap.
 */
async function trimSampleCacheIfOverBudget() {
  try {
    const cache = await caches.open(SAMPLE_CACHE_NAME);
    const requests = await cache.keys();
    if (requests.length === 0) return;
    // Compute approximate sizes
    let totalBytes = 0;
    const sizes = [];
    for (const req of requests) {
      const res = await cache.match(req);
      const lenHeader = res?.headers?.get?.("content-length");
      const size = lenHeader ? parseInt(lenHeader, 10) : 150_000;
      sizes.push(size);
      totalBytes += size;
    }
    if (totalBytes <= SAMPLE_CACHE_MAX_BYTES) return;
    // Evict from the front of the list (= oldest insertion) until under-budget
    let i = 0;
    while (totalBytes > SAMPLE_CACHE_MAX_BYTES && i < requests.length) {
      await cache.delete(requests[i]);
      totalBytes -= sizes[i];
      i++;
    }
  } catch (err) {
    // Swallow — eviction is best-effort, browser quotas will save us if it fails
    console.warn("[SW] sample-cache eviction failed:", err);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!isCacheable(req)) return;
  const url = new URL(req.url);

  const isSample = url.pathname.includes("/samples/");
  const isImmutable =
    url.pathname.startsWith("/assets/") ||
    url.pathname.includes("/wasm/") ||
    isSample ||
    /\.(woff2?|ttf|otf|png|svg|ico)$/.test(url.pathname) ||
    url.pathname === "/drum-worklet.js";

  if (isImmutable) {
    // Samples get their own cache + LRU eviction; everything else lives
    // in the main shell cache.
    const cacheName = isSample ? SAMPLE_CACHE_NAME : CACHE_NAME;
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(cacheName).then(async (c) => {
            await c.put(req, clone);
            if (isSample) await trimSampleCacheIfOverBudget();
          });
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
