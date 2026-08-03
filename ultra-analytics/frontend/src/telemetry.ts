/** Minimal client reliability reporting — no personal content. */

type ClientErrorPayload = {
  message: string;
  source?: string;
  url?: string;
  status?: number;
  stack?: string;
  code?: string;
};

const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || "").replace(/\/$/, "");

let hooked = false;

function post(payload: ClientErrorPayload): void {
  const body = JSON.stringify({
    message: (payload.message || "unknown").slice(0, 500),
    source: (payload.source || "client").slice(0, 80),
    url: (payload.url || window.location.pathname).slice(0, 300),
    status: payload.status,
    stack: payload.stack?.slice(0, 1500),
    code: payload.code?.slice(0, 64),
  });
  const url = `${API_BASE}/api/telemetry/client-error`;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* fall through */
  }
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    credentials: "include",
    keepalive: true,
  }).catch(() => undefined);
}

export function reportClientError(payload: ClientErrorPayload): void {
  post(payload);
}

export function installClientErrorReporting(): void {
  if (hooked || typeof window === "undefined") return;
  hooked = true;

  window.addEventListener("error", (ev) => {
    reportClientError({
      message: ev.message || "window.error",
      source: "window.onerror",
      stack: ev.error?.stack,
      url: window.location.pathname,
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "unhandledrejection";
    reportClientError({
      message,
      source: "unhandledrejection",
      stack: reason instanceof Error ? reason.stack : undefined,
      url: window.location.pathname,
    });
  });
}
