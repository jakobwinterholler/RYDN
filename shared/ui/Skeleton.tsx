interface SkeletonProps {
  dark?: boolean;
  className?: string;
}

export function Skeleton({ dark = false, className = "h-4 w-full rounded-lg" }: SkeletonProps) {
  return <div className={`${dark ? "urp-skeleton-dark" : "urp-skeleton"} ${className}`} aria-hidden />;
}

export function RaceCardSkeleton({ dark = false }: { dark?: boolean }) {
  return (
    <div
      className={`rounded-2xl p-5 ${dark ? "bg-white/[0.03] ring-1 ring-white/10" : "bg-card ring-1 ring-black/[0.04]"}`}
    >
      <Skeleton dark={dark} className="h-5 w-2/3 rounded-lg" />
      <Skeleton dark={dark} className="mt-3 h-4 w-1/3 rounded-lg" />
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Skeleton dark={dark} className="h-12 rounded-xl" />
        <Skeleton dark={dark} className="h-12 rounded-xl" />
        <Skeleton dark={dark} className="h-12 rounded-xl" />
      </div>
    </div>
  );
}
