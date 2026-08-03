import type { RaceDashboardStats } from "../race/readiness";

export interface RaceCardMetrics {
  verificationPercent: number | null;
  suggestedStops: number | null;
  corosReady: boolean;
}

export function metricsFromDashboardStats(
  stats: RaceDashboardStats | null | undefined,
  hasAnalysis: boolean,
): RaceCardMetrics {
  if (!hasAnalysis || !stats) {
    return { verificationPercent: null, suggestedStops: null, corosReady: false };
  }
  const total = stats.verified_stops + stats.unverified_stops;
  const verificationPercent =
    total > 0 ? Math.round((stats.verified_stops / total) * 100) : 0;
  return {
    verificationPercent,
    suggestedStops: total > 0 ? total : null,
    corosReady: stats.verified_stops > 0,
  };
}

export function metricsFromCompanion(
  verifiedPercent: number | null | undefined,
  suggestedStops: number | null | undefined,
  verifiedCount: number | null | undefined,
  hasAnalysis: boolean,
): RaceCardMetrics {
  if (!hasAnalysis) {
    return { verificationPercent: null, suggestedStops: null, corosReady: false };
  }
  return {
    verificationPercent: verifiedPercent ?? null,
    suggestedStops: suggestedStops ?? null,
    corosReady: (verifiedCount ?? 0) > 0,
  };
}

export function formatRelativeUpdated(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
