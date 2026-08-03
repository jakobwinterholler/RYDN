import { useCallback, useEffect, useRef, useState } from "react";

const HOLD_MS = 1000;

interface HoldToConfirmButtonProps {
  label: string;
  holdingLabel?: string;
  disabled?: boolean;
  variant?: "light" | "dark";
  onConfirm: () => void;
}

export function HoldToConfirmButton({
  label,
  holdingLabel = "Keep holding…",
  disabled = false,
  variant = "light",
  onConfirm,
}: HoldToConfirmButtonProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const confirmedRef = useRef(false);

  const cancelHold = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    startRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => cancelHold, [cancelHold]);

  const tick = useCallback(
    (timestamp: number) => {
      if (startRef.current == null) {
        startRef.current = timestamp;
      }
      const elapsed = timestamp - startRef.current;
      const next = Math.min(1, elapsed / HOLD_MS);
      setProgress(next);
      if (next >= 1 && !confirmedRef.current) {
        confirmedRef.current = true;
        cancelHold();
        onConfirm();
        window.setTimeout(() => {
          confirmedRef.current = false;
        }, 500);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    },
    [cancelHold, onConfirm],
  );

  function startHold() {
    if (disabled || confirmedRef.current) {
      return;
    }
    setHolding(true);
    startRef.current = null;
    frameRef.current = requestAnimationFrame(tick);
  }

  const dark = variant === "dark";

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        startHold();
      }}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(event) => event.preventDefault()}
      className={`relative min-h-[48px] w-full overflow-hidden rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        dark
          ? "bg-red-500/90 text-white"
          : "bg-red-600 text-white"
      }`}
    >
      <span
        className="absolute inset-y-0 left-0 bg-red-900/35 transition-[width]"
        style={{ width: `${progress * 100}%` }}
        aria-hidden
      />
      <span className="relative z-10">
        {holding ? holdingLabel : label}
      </span>
      {!holding ? (
        <span className={`relative z-10 mt-0.5 block text-[10px] font-medium ${dark ? "text-white/70" : "text-white/80"}`}>
          Press and hold 1s to confirm
        </span>
      ) : null}
    </button>
  );
}
