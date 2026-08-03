import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  dark?: boolean;
  className?: string;
}

export function SectionHeader({
  title,
  subtitle,
  action,
  dark = false,
  className = "",
}: SectionHeaderProps) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2
          className={`text-xs font-semibold uppercase tracking-[0.14em] ${dark ? "text-white/40" : "text-muted"}`}
        >
          {title}
        </h2>
        {subtitle ? (
          <p className={`mt-1 text-sm ${dark ? "text-white/55" : "text-muted"}`}>{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
