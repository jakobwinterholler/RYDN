import { useEffect, useRef } from "react";

interface CompanionDeleteRaceDialogProps {
  open: boolean;
  raceName: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function CompanionDeleteRaceDialog({
  open,
  raceName,
  busy = false,
  onClose,
  onConfirm,
}: CompanionDeleteRaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    function handleCancel(event: Event) {
      event.preventDefault();
      onClose();
    }
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="w-full max-w-sm rounded-2xl border border-white/12 bg-[#141414] p-0 text-white shadow-xl backdrop:bg-black/60"
      onClose={onClose}
    >
      <div className="p-6">
        <h3 className="text-lg font-semibold">Delete race?</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          This removes <span className="font-medium text-white/80">{raceName}</span> from this phone
          — local bundle, cloud race, verification data, and downloaded assets. This cannot be
          undone.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-[44px] rounded-xl bg-red-500/90 text-sm font-semibold text-white transition hover:bg-red-500 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] rounded-xl border border-white/15 text-sm font-medium text-white/85 transition hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
