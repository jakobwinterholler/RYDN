import { useEffect } from "react";
import { Button } from "@shared/ui/Button";

export type SyncToastVariant = "success" | "error";

interface CompanionSyncToastProps {
  message: string;
  variant: SyncToastVariant;
  onDismiss: () => void;
  onRetry?: () => void;
  autoDismissMs?: number;
}

export default function CompanionSyncToast({
  message,
  variant,
  onDismiss,
  onRetry,
  autoDismissMs = 3500,
}: CompanionSyncToastProps) {
  useEffect(() => {
    if (variant !== "success") {
      return;
    }
    const timer = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [autoDismissMs, onDismiss, variant]);

  return (
    <div
      className={`fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-4 right-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur urp-animate-fade-up ${
        variant === "success"
          ? "border-emerald-400/25 bg-emerald-950/90"
          : "border-red-400/25 bg-[#1a1a1a]/95"
      }`}
      role="status"
      aria-live="polite"
    >
      <p
        className={`min-w-0 flex-1 text-sm ${
          variant === "success" ? "text-emerald-100" : "text-red-200"
        }`}
      >
        {message}
      </p>
      {variant === "error" && onRetry ? (
        <Button variant="secondary" size="sm" dark onClick={onRetry}>
          Retry
        </Button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 min-h-[44px] rounded-xl px-2 text-xs font-medium text-white/45 hover:text-white/80"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
