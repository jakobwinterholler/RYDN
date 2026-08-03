interface DiscoverStopsControlsProps {
  loading: boolean;
  resultMessage: string | null;
  onFindStops: () => void;
}

export default function DiscoverStopsControls({
  loading,
  resultMessage,
  onFindStops,
}: DiscoverStopsControlsProps) {
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      {resultMessage ? (
        <p className="animate-fade-in rounded-xl border border-line/70 bg-card/95 px-3 py-2 text-xs font-medium text-ink shadow-card">
          {resultMessage}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onFindStops}
        disabled={loading}
        className="rounded-2xl border border-line/70 bg-card/95 px-4 py-2.5 text-sm font-semibold text-ink shadow-card transition hover:bg-canvas disabled:opacity-60"
      >
        {loading ? "Searching…" : "🔍 Find Stops"}
      </button>
    </div>
  );
}
