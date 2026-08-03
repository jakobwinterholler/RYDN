/** Register / recover the RYDN service worker safely across deploys and Vite tunnel. */

const RELOAD_FLAG = "rydn-sw-reloaded";

async function clearRydnCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("rydn")).map((k) => caches.delete(k)));
}

async function hardResetServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  await clearRydnCaches();
}

/** Dev / tunnel: purge any leftover production SW so Vite CSS/JS aren't intercepted. */
export async function purgeServiceWorkersInDev(): Promise<void> {
  await hardResetServiceWorker();
}

/**
 * Production: register with updateViaCache none, activate new workers immediately,
 * and reload once when the controlling worker changes (new HTML ↔ new hashes).
 */
export async function registerProductionServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    void reg.update();

    const wake = (worker: ServiceWorker | null) => {
      worker?.postMessage({ type: "RYDN_SKIP_WAITING" });
    };
    wake(reg.waiting);

    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          wake(installing);
        }
      });
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      if (sessionStorage.getItem(RELOAD_FLAG) === "1") {
        sessionStorage.removeItem(RELOAD_FLAG);
        return;
      }
      refreshing = true;
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    });
  } catch {
    /* optional */
  }
}

/**
 * If a hashed CSS bundle fails to load (stale SW / missing hash after deploy),
 * unregister workers, clear caches, and hard-reload once.
 */
export function installStylesheetRecovery(): void {
  const recover = () => {
    if (sessionStorage.getItem("rydn-sw-recovery") === "1") return;
    sessionStorage.setItem("rydn-sw-recovery", "1");
    void hardResetServiceWorker().then(() => window.location.reload());
  };

  document.querySelectorAll('link[rel="stylesheet"][href*="/assets/"]').forEach((node) => {
    const link = node as HTMLLinkElement;
    link.addEventListener("error", recover);
  });

  window.addEventListener("load", () => {
    if (!navigator.serviceWorker?.controller) return;
    for (const node of document.querySelectorAll('link[rel="stylesheet"][href*="/assets/"]')) {
      const link = node as HTMLLinkElement;
      // Failed or empty same-origin stylesheet after load
      try {
        if (!link.sheet || link.sheet.cssRules.length === 0) {
          recover();
          return;
        }
      } catch {
        /* cross-origin — ignore */
      }
    }
  });
}
