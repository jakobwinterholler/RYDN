export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${m.toString().padStart(2, "0")}m`;
  }
  if (h >= 1) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

/** Friendly ride date: "Today", "Yesterday", or "Mon 12 Jul 2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
