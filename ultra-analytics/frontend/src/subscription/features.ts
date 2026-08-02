/** Central feature → tier map. Keep in sync with backend ``subscription/features.py``. */

export type SubscriptionTier = "guest" | "free" | "pro";

export type ProFeature = "planning" | "verify" | "rideMode" | "gpxExport";

export const PRO_FEATURES: readonly ProFeature[] = [
  "planning",
  "verify",
  "rideMode",
  "gpxExport",
] as const;

export function normalizeTier(raw: unknown): SubscriptionTier {
  const v = String(raw ?? "guest").trim().toLowerCase();
  if (v === "pro" || v === "free" || v === "guest") return v;
  return "guest";
}

/** Tier for a session user — logged-in defaults to free; null user is guest. */
export function tierFromUser(user: { subscriptionTier?: string | null } | null | undefined): SubscriptionTier {
  if (!user) return "guest";
  const t = normalizeTier(user.subscriptionTier ?? "free");
  return t === "guest" ? "free" : t;
}

export function canAccess(
  feature: ProFeature | string,
  tier: SubscriptionTier | string | null | undefined,
): boolean {
  const t = normalizeTier(tier ?? "guest");
  if (!(PRO_FEATURES as readonly string[]).includes(feature)) return false;
  return t === "pro";
}

export function canAccessUser(
  feature: ProFeature | string,
  user: { subscriptionTier?: string | null } | null | undefined,
): boolean {
  return canAccess(feature, tierFromUser(user));
}

/** Planned GPX import — Pro sub or an unused Race Pass credit. */
export function canImportPlannedRoute(
  user: { subscriptionTier?: string | null; racePassCredits?: number | null; billing?: { racePassCredits?: number } } | null | undefined,
): boolean {
  if (canAccessUser("planning", user)) return true;
  const credits = user?.racePassCredits ?? user?.billing?.racePassCredits ?? 0;
  return Number(credits) > 0;
}

export function tierLabel(tier: SubscriptionTier | string | null | undefined): string {
  const t = normalizeTier(tier ?? "guest");
  if (t === "pro") return "Pro";
  if (t === "free") return "Free";
  return "Guest";
}
