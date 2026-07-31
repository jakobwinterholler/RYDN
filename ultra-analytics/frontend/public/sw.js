/* RYDN service worker — versioned, never serve stale HTML with new asset hashes.
 *
 * Strategy:
 * - Navigations / HTML: network-only (never cache documents)
 * - /assets/* (hashed Vite bundles): cache-first after a successful typed response
 * - Everything else (icons, manifest): stale-while-revalidate
 * - /api/*: bypass (browser network)
 * - On activate: delete every cache that is not this build's cache
 *
 * VERSION placeholder is replaced at build time by Vite.
 */
const VERSION = "__RYDN_SW_VERSION__";
const CACHE = `rydn-${VERSION}`;

self.addEventListener("install", (event) => {
  // Activate immediately — don't wait for old tabs to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isNavigate(req) {
  return req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
}

function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/") && /\.[a-z0-9]+\.(js|css)$/i.test(url.pathname);
}

function isImmutableOk(res, url) {
  if (!res || !res.ok) return false;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  // Never cache HTML disguised as an asset (SPA fallback poison).
  if (ct.includes("text/html")) return false;
  if (url.pathname.endsWith(".css")) {
    return ct.includes("text/css") || ct.includes("stylesheet") || ct === "";
  }
  if (url.pathname.endsWith(".js")) {
    return (
      ct.includes("javascript") ||
      ct.includes("ecmascript") ||
      ct.includes("text/js") ||
      ct === ""
    );
  }
  return false;
}

async function networkOnly(req) {
  return fetch(req);
}

async function cacheFirstAsset(req, url) {
  const cached = await caches.match(req);
  if (cached) {
    // Revalidate in background; hashed filenames are content-addressed.
    void fetch(req)
      .then(async (res) => {
        if (isImmutableOk(res, url)) {
          const cache = await caches.open(CACHE);
          await cache.put(req, res.clone());
        }
      })
      .catch(() => undefined);
    return cached;
  }
  const res = await fetch(req);
  if (isImmutableOk(res, url)) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  }
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then(async (res) => {
      if (res.ok) {
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("text/html")) {
          await cache.put(req, res.clone());
        }
      }
      return res;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Never intercept Vite/dev module graph or HMR — critical if a SW lingers on the tunnel.
  if (url.pathname.startsWith("/src/") || url.pathname.startsWith("/@") || url.pathname.includes("node_modules")) {
    return;
  }
  // Always get a fresh worker script.
  if (url.pathname === "/sw.js") return;

  if (isNavigate(req) || url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(networkOnly(req));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirstAsset(req, url));
    return;
  }

  // Icons / manifest — optional offline nicety
  if (
    url.pathname.startsWith("/icon") ||
    url.pathname.startsWith("/apple-touch") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/browserconfig.xml"
  ) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Default: network only (no silent stale fallbacks)
  event.respondWith(networkOnly(req));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "RYDN_SKIP_WAITING") {
    void self.skipWaiting();
  }
  if (event.data && event.data.type === "RYDN_CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    );
  }
});
