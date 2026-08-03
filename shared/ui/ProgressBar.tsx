interface ProgressBarProps {
  value: number;
  max?: number;
  dark?: boolean;
  className?: string;
}

export function ProgressBar({ value, max = 100, dark = false, className = "" }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full ${dark ? "bg-white/10" : "bg-line/60"} ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ease-out ${dark ? "bg-emerald-400" : "bg-accent"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
