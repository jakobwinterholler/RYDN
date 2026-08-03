import type { NearbyAlternativeStop } from "../../planning/stopVerification/nearbyAlternatives";

interface StopVerificationActionsProps {
  saving: boolean;
  currentPending: boolean;
  canUndo: boolean;
  showAlternatives: boolean;
  inAlternativeBranch: boolean;
  onVerify: () => void;
  onSkip: () => void;
  onUndo: () => void;
  onVerifyAndAlternatives: () => void;
  onDontVerifyAndAlternatives: () => void;
}

export default function StopVerificationActions({
  saving,
  currentPending,
  canUndo,
  showAlternatives,
  inAlternativeBranch,
  onVerify,
  onSkip,
  onUndo,
  onVerifyAndAlternatives,
  onDontVerifyAndAlternatives,
}: StopVerificationActionsProps) {
  const disabled = saving || !currentPending;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={onVerify}
          disabled={disabled}
          className="rounded-2xl bg-emerald-600 px-5 py-4 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          ✓ Verify
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={disabled}
          className="rounded-2xl border border-line bg-card px-5 py-4 text-base font-semibold text-muted transition hover:border-red-200 hover:bg-red-50 hover:text-red-800 disabled:opacity-60"
        >
          ✕ Skip
        </button>
      </div>

      {canUndo && (
        <button
          type="button"
          onClick={onUndo}
          disabled={saving}
          className="w-full rounded-2xl border border-line bg-canvas px-4 py-3 text-sm font-semibold text-ink transition hover:bg-card disabled:opacity-60"
        >
          Undo last decision
        </button>
      )}

      {showAlternatives && !inAlternativeBranch && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onVerifyAndAlternatives}
            disabled={disabled}
            className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-60"
          >
            ✓ Verify &amp; view alternatives
          </button>
          <button
            type="button"
            onClick={onDontVerifyAndAlternatives}
            disabled={disabled}
            className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm font-semibold text-amber-950 transition hover:bg-amber-100 disabled:opacity-60"
          >
            ✕ Skip &amp; view alternatives
          </button>
        </div>
      )}

      <p className="text-center text-xs text-muted">
        {inAlternativeBranch
          ? "← → navigate · Enter verify · Delete skip · Undo reverses last decision"
          : "← → navigate · Enter verify · Delete skip"}
      </p>
    </div>
  );
}

export function formatAlternativeListPreview(alternatives: NearbyAlternativeStop[]): string {
  return alternatives.map((item) => `• ${item.displayName} (${item.positionLabel})`).join(" · ");
}
