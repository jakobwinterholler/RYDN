import { useEffect, useRef } from "react";
import { HoldToConfirmButton } from "./HoldToConfirmButton";

export interface DeleteRaceDialogProps {
  open: boolean;
  raceName: string;
  distanceKm?: number | null;
  elevationGainM?: number | null;
  cloudSynced?: boolean | null;
  lastModified?: string | null;
  busy?: boolean;
  variant?: "light" | "dark";
  onClose: () => void;
  onConfirm: () => void;
}

function formatDistance(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) {
    return "—";
  }
  return `${Math.round(km)} km`;
}

function formatElevation(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) {
    return "—";
  }
  return `+${Math.round(m).toLocaleString()} m`;
}

function formatLastModified(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DeleteRaceDialog({
  open,
  raceName,
  distanceKm,
  elevationGainM,
  cloudSynced,
  lastModified,
  busy = false,
  variant = "light",
  onClose,
  onConfirm,
}: DeleteRaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dark = variant === "dark";

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

  const shell = dark
    ? "border-white/12 bg-[#141414] text-white backdrop:bg-black/60"
    : "border-line bg-card text-ink backdrop:bg-ink/40";
  const muted = dark ? "text-white/55" : "text-muted";
  const label = dark ? "text-white/40" : "text-muted";
  const value = dark ? "text-white/90" : "text-ink";
  const statBg = dark ? "bg-white/[0.04] border-white/8" : "bg-canvas/60 border-line/60";

  return (
    <dialog
      ref={dialogRef}
      className={`w-full max-w-md rounded-2xl border p-0 shadow-xl ${shell}`}
      onClose={onClose}
    >
      <div className="p-6">
        <h3 className="text-lg font-semibold">Delete race permanently?</h3>
        <p className={`mt-2 text-sm leading-relaxed ${muted}`}>
          This removes the race from Desktop, cloud sync, and any downloaded phone bundles.
          Verification data is deleted. This cannot be undone.
        </p>

        <div className={`mt-5 rounded-2xl border px-4 py-3 ${statBg}`}>
          <p className={`text-base font-semibold ${value}`}>{raceName}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className={`text-[11px] font-medium uppercase tracking-wide ${label}`}>Distance</dt>
              <dd className={`mt-0.5 tabular-nums ${value}`}>{formatDistance(distanceKm)}</dd>
            </div>
            <div>
              <dt className={`text-[11px] font-medium uppercase tracking-wide ${label}`}>Elevation</dt>
              <dd className={`mt-0.5 tabular-nums ${value}`}>{formatElevation(elevationGainM)}</dd>
            </div>
            <div>
              <dt className={`text-[11px] font-medium uppercase tracking-wide ${label}`}>Cloud synced</dt>
              <dd className={`mt-0.5 ${value}`}>
                {cloudSynced == null ? "—" : cloudSynced ? "Yes" : "No"}
              </dd>
            </div>
            <div>
              <dt className={`text-[11px] font-medium uppercase tracking-wide ${label}`}>Last modified</dt>
              <dd className={`mt-0.5 text-xs ${value}`}>{formatLastModified(lastModified)}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <HoldToConfirmButton
            label="Delete permanently"
            holdingLabel="Deleting…"
            disabled={busy}
            variant={variant}
            onConfirm={onConfirm}
          />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`min-h-[44px] rounded-xl border px-4 text-sm font-medium disabled:opacity-50 ${
              dark
                ? "border-white/15 text-white/85 hover:bg-white/5"
                : "border-line text-ink"
            }`}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
