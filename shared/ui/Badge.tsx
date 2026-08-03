import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "accent" | "sync";

interface BadgeProps {
  children: ReactNode;
  dark?: boolean;
  tone?: BadgeTone;
  className?: string;
}

const lightTones: Record<BadgeTone, string> = {
  neutral: "bg-black/[0.04] text-ink/70",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-800",
  accent: "bg-accent/10 text-accent",
  sync: "bg-sky-50 text-sky-700",
};

const darkTones: Record<BadgeTone, string> = {
  neutral: "bg-white/8 text-white/60",
  success: "bg-emerald-500/15 text-emerald-300",
  warning: "bg-amber-500/15 text-amber-200",
  accent: "bg-emerald-500/15 text-emerald-200",
  sync: "bg-sky-500/15 text-sky-200",
};

export function Badge({ children, dark = false, tone = "neutral", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${dark ? darkTones[tone] : lightTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
