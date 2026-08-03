import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const DELETE_WIDTH = 88;
const FULL_SWIPE_THRESHOLD = 72;

interface SwipeableRaceCardProps {
  children: ReactNode;
  disabled?: boolean;
  onDelete: () => void;
}

export default function SwipeableRaceCard({
  children,
  disabled = false,
  onDelete,
}: SwipeableRaceCardProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startOffsetRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const snapClosed = useCallback(() => {
    setOffset(0);
  }, []);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (disabled) {
        return;
      }
      startXRef.current = event.touches[0].clientX;
      startOffsetRef.current = offset;
      setDragging(true);
    },
    [disabled, offset],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (disabled || !dragging) {
        return;
      }
      const delta = event.touches[0].clientX - startXRef.current;
      const next = Math.min(0, Math.max(-DELETE_WIDTH, startOffsetRef.current + delta));
      setOffset(next);
    },
    [disabled, dragging],
  );

  const handleTouchEnd = useCallback(() => {
    setDragging(false);
    if (offset <= -FULL_SWIPE_THRESHOLD) {
      snapClosed();
      onDelete();
      return;
    }
    snapClosed();
  }, [offset, onDelete, snapClosed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) {
      return;
    }
    let touchStartY = 0;
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const deltaY = Math.abs((event.touches[0]?.clientY ?? touchStartY) - touchStartY);
      if (deltaY > 6 && offset !== 0) {
        snapClosed();
      }
    };
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
    };
  }, [disabled, offset, snapClosed]);

  const revealProgress = Math.min(1, Math.abs(offset) / DELETE_WIDTH);
  const showDeleteHint = offset < -8;

  return (
    <div ref={containerRef} className="swipe-race-card relative overflow-hidden rounded-2xl">
      <div
        className="swipe-race-card__actions absolute inset-y-0 right-0 flex w-[88px] items-center justify-center bg-red-500 transition-opacity duration-150"
        style={{ opacity: showDeleteHint ? revealProgress : 0 }}
        aria-hidden={!showDeleteHint}
      >
        <button
          type="button"
          disabled={disabled || !showDeleteHint}
          onClick={() => {
            snapClosed();
            onDelete();
          }}
          aria-label="Delete race"
          className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 text-xs font-semibold text-white"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Delete
        </button>
      </div>

      <div
        className={`swipe-race-card__content relative bg-[#0a0a0a] ${dragging ? "" : "transition-transform duration-300 ease-out"}`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
