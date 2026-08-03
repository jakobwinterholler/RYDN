import { useEffect } from "react";

/**
 * Keep the screen awake while a race is being executed so the rider can glance
 * down mid-effort without the display sleeping. The Screen Wake Lock is released
 * automatically by the browser when the tab is hidden, so we re-acquire it on
 * visibility change. All failures are non-fatal — a phone without wake-lock
 * support simply behaves as before.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") {
      return;
    }

    const wakeLockApi = (
      navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
      }
    ).wakeLock;

    if (!wakeLockApi) {
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      if (released || document.visibilityState !== "visible") {
        return;
      }
      try {
        sentinel = await wakeLockApi.request("screen");
        sentinel.addEventListener?.("release", () => {
          sentinel = null;
        });
      } catch {
        // Denied, low battery, or unsupported — ignore, tracking still works.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !sentinel) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [enabled]);
}
