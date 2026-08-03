import { useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "../lib/haptics";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const ANIM_MS = 300;
/** Drag distance past which release dismisses the sheet. */
const CLOSE_DRAG_PX = 120;
/** iOS-like decelerating spring. */
const EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

export default function BottomSheet({ open, onClose, children }: BottomSheetProps) {
  const [visible, setVisible] = useState(open);
  const [animating, setAnimating] = useState(false);
  const [drag, setDrag] = useState(0);
  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setDrag(0);
      requestAnimationFrame(() => setAnimating(true));
    } else {
      setAnimating(false);
      const timer = window.setTimeout(() => setVisible(false), ANIM_MS);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  if (!visible) {
    return null;
  }

  function onHandlePointerDown(event: React.PointerEvent) {
    startYRef.current = event.clientY;
    draggingRef.current = true;
    try {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  function onHandlePointerMove(event: React.PointerEvent) {
    if (startYRef.current === null) {
      return;
    }
    setDrag(Math.max(0, event.clientY - startYRef.current));
  }

  function onHandlePointerUp() {
    if (startYRef.current === null) {
      return;
    }
    const shouldClose = drag > CLOSE_DRAG_PX;
    startYRef.current = null;
    draggingRef.current = false;
    if (shouldClose) {
      haptic("light");
      onClose();
    } else {
      setDrag(0);
    }
  }

  const backdropOpacity = animating ? Math.max(0, 1 - drag / 420) : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        style={{
          opacity: backdropOpacity,
          transition: draggingRef.current ? "none" : `opacity ${ANIM_MS}ms ease`,
        }}
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`relative max-h-[85vh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0f0f0f] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl will-change-transform ${
          animating ? "" : "translate-y-full"
        }`}
        style={{
          transform: animating ? `translateY(${drag}px)` : undefined,
          transition: draggingRef.current ? "none" : `transform ${ANIM_MS}ms ${EASING}`,
        }}
      >
        <div
          className="mx-auto flex w-full touch-none cursor-grab justify-center py-2 active:cursor-grabbing"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <div className="h-1 w-10 rounded-full bg-white/25" aria-hidden />
        </div>
        {children}
      </div>
    </div>
  );
}
