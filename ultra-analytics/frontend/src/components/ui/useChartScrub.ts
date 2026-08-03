import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

type ScrubFn = (clientX: number, surface: HTMLElement) => void;

/**
 * Reliable timeline scrubbing for charts.
 *
 * Why SVG-only handlers failed on phones: iOS Safari hit-tests SVG sparsely
 * (transparent fills / strokes), often loses pointer capture on <svg>, and
 * still allows vertical scroll to cancel the gesture. An HTML overlay with
 * touch-action:none + setPointerCapture is the Strava-style fix.
 */
export function useChartScrub(onScrub: ScrubFn) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const activePointer = useRef<number | null>(null);
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;

  const pick = useCallback((clientX: number, surface: HTMLElement) => {
    onScrubRef.current(clientX, surface);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging.current = true;
      activePointer.current = e.pointerId;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      e.preventDefault();
      pick(e.clientX, e.currentTarget);
    },
    [pick],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) {
        if (e.pointerType === "mouse") pick(e.clientX, e.currentTarget);
        return;
      }
      if (activePointer.current != null && e.pointerId !== activePointer.current) return;
      e.preventDefault();
      pick(e.clientX, e.currentTarget);
    },
    [pick],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current != null && e.pointerId !== activePointer.current) return;
    dragging.current = false;
    activePointer.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  }, []);

  return {
    surfaceRef,
    scrubHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}

/** Map clientX → viewBox x using the scrub surface's box (matches SVG viewBox width W). */
export function clientXToViewBoxX(
  clientX: number,
  el: HTMLElement,
  viewBoxW: number,
): number | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return null;
  return ((clientX - rect.left) / rect.width) * viewBoxW;
}
