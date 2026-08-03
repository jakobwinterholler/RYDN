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
    <div className="pointer-events-auto flex flex-col items-stretch gap-2">
      {resultMessage ? (
        <p className="animate-fade-in rounded-xl border border-white/12 bg-black/55 px-3 py-2 text-center text-xs font-medium text-white/85 shadow-lg backdrop-blur-xl">
          {resultMessage}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onFindStops}
        disabled={loading}
        className="min-h-[44px] rounded-2xl border border-white/12 bg-black/55 px-4 py-2.5 text-sm font-semibold text-white/90 shadow-lg backdrop-blur-xl transition hover:bg-white/8 disabled:opacity-60"
      >
        {loading ? "Searching…" : "🔍 Find Stops"}
      </button>
    </div>
  );
}
