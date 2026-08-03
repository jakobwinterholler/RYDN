import type { ReactNode } from "react";

interface EmptyStateProps {
  illustration: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  dark?: boolean;
  className?: string;
}

export function EmptyState({
  illustration,
  title,
  description,
  action,
  dark = false,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center px-6 py-14 text-center urp-animate-fade-up ${className}`}
    >
      <div className={dark ? "text-white/25" : "text-ink/20"}>{illustration}</div>
      <h3 className={`mt-6 text-lg font-semibold tracking-tight ${dark ? "text-white" : "text-ink"}`}>
        {title}
      </h3>
      <p className={`mt-2 max-w-sm text-sm leading-relaxed ${dark ? "text-white/50" : "text-muted"}`}>
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
