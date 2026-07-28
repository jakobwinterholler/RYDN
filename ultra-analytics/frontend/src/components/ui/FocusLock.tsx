import { useRef, type ReactNode } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface Props {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  /** "sheet" = fullscreen bottom sheet; "modal" = centered dialog */
  variant?: "sheet" | "modal";
  className?: string;
}

/** Accessible overlay: focus trap, Esc, aria-modal, restore focus. */
export default function FocusLock({
  open,
  onClose,
  labelledBy,
  children,
  variant = "sheet",
  className = "",
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef, onClose);
  if (!open) return null;

  if (variant === "modal") {
    return (
      <div className={`modal ${className}`.trim()} onClick={onClose} role="presentation">
        <div
          ref={panelRef}
          className="modal__panel"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={`sheet sheet--fullscreen ${className}`.trim()} role="presentation">
      <div
        ref={panelRef}
        className="sheet__panel sheet__panel--screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}
