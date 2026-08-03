import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute("disabled") || el.tabIndex === -1) return false;
    // offsetParent is null for position:fixed and some clipped nodes — still focusable.
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

/**
 * Trap focus inside a dialog/sheet, restore prior focus on unmount,
 * lock body scroll, and close on Escape.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose?: () => void,
): void {
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const node = containerRef.current;
    const focusFirst = () => {
      const root = containerRef.current;
      if (!root) return;
      const items = listFocusable(root);
      const autofocus = root.querySelector<HTMLElement>("[autofocus], input, button");
      (autofocus && items.includes(autofocus) ? autofocus : items[0])?.focus();
    };
    // After paint so dialog content exists
    const t = window.setTimeout(focusFirst, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const items = listFocusable(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      const prev = previousFocus.current;
      if (prev && typeof prev.focus === "function") {
        prev.focus();
      }
      // silence unused when StrictMode double-invokes
      void node;
    };
  }, [active, containerRef, onClose]);
}
