import FloatingCard from "./FloatingCard";

interface MapControlsProps {
  followGps: boolean;
  onRecenter: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  gpsActive: boolean;
}

export default function MapControls({
  followGps,
  onRecenter,
  onZoomIn,
  onZoomOut,
  onResetNorth,
  gpsActive,
}: MapControlsProps) {
  return (
    <div className="pointer-events-none absolute bottom-[max(7rem,calc(env(safe-area-inset-bottom,0px)+5.5rem))] right-4 z-20 flex flex-col items-end gap-2">
      <FloatingCard className="pointer-events-auto overflow-hidden">
        <button
          type="button"
          onClick={onRecenter}
          className="flex min-h-[44px] w-full min-w-[132px] items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-white/90 transition active:bg-white/8"
          aria-label="Recenter on GPS"
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
              followGps ? "bg-sky-500/25 text-sky-300" : "bg-white/10 text-white/55"
            }`}
            aria-hidden
          >
            ◎
          </span>
          <span>{followGps ? "Following GPS" : "Recenter"}</span>
        </button>
        {gpsActive ? (
          <p className="border-t border-white/8 px-3.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/35">
            {followGps ? "Auto-center on" : "Exploring map"}
          </p>
        ) : null}
      </FloatingCard>

      <FloatingCard className="pointer-events-auto flex flex-col overflow-hidden">
        <button
          type="button"
          onClick={onZoomIn}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-lg font-medium text-white/85 transition active:bg-white/8"
          aria-label="Zoom in"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center border-t border-white/10 text-lg font-medium text-white/85 transition active:bg-white/8"
          aria-label="Zoom out"
        >
          －
        </button>
      </FloatingCard>

      <FloatingCard className="pointer-events-auto overflow-hidden">
        <button
          type="button"
          onClick={onResetNorth}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-base text-white/80 transition active:bg-white/8"
          aria-label="Reset north"
        >
          🧭
        </button>
      </FloatingCard>
    </div>
  );
}
