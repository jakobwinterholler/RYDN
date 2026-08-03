import type {
  CompanionBundle,
  CompanionDiscoverPoi,
  CompanionStop,
  CompanionStopAlternative,
} from "../types/sync";
import type { CompanionVerificationSubmission } from "../types/verification";
import { findDiscoverPoiInBundle, insertPromotedDiscoverStop } from "./promoteDiscoverStop";
import { sameStop, stopIdentity, stopMatchesSubmission } from "./stopMatching";

function stopStatusFromSubmission(
  updates: CompanionVerificationSubmission["updates"],
): CompanionStop["verificationStatus"] {
  if (updates.status === "verified") {
    return "pending";
  }
  return "needs_review";
}

function alternativeStatusFromSubmission(
  updates: CompanionVerificationSubmission["updates"],
): CompanionStopAlternative["verificationStatus"] {
  if (updates.status === "verified") {
    return "pending";
  }
  return "needs_review";
}

function patchStop(
  stop: CompanionStop,
  submission: CompanionVerificationSubmission,
): CompanionStop {
  const { updates } = submission;
  const status = stopStatusFromSubmission(updates);
  const services = updates.services;
  return {
    ...stop,
    verificationStatus: status,
    verificationDate: null,
    notes: updates.notes?.trim() || stop.notes,
    openingHours:
      updates.openingHours?.trim() ||
      (updates.services ? stop.openingHours : stop.openingHours),
    hasWater: services?.hasWater ?? stop.hasWater,
    hasFood: services?.hasFood ?? stop.hasFood,
    hasFuel: services?.hasFuel ?? stop.hasFuel,
    hasCoffee: services?.hasCoffee ?? stop.hasCoffee,
  };
}

function patchAlternative(
  alternative: CompanionStopAlternative,
  submission: CompanionVerificationSubmission,
): CompanionStopAlternative {
  const { updates } = submission;
  const status = alternativeStatusFromSubmission(updates);
  const services = updates.services;
  return {
    ...alternative,
    verificationStatus: status,
    openingHours:
      updates.openingHours?.trim() ||
      (updates.services ? alternative.openingHours : alternative.openingHours),
    hasWater: services?.hasWater ?? alternative.hasWater,
    hasFood: services?.hasFood ?? alternative.hasFood,
    hasFuel: services?.hasFuel ?? alternative.hasFuel,
  };
}

function alternativeMatchesSubmission(
  alternative: CompanionStopAlternative,
  submission: CompanionVerificationSubmission,
): boolean {
  const altPoiId = alternative.poiId ?? (alternative.osmId != null ? `poi_${alternative.osmId}` : null);
  return stopMatchesSubmission({ poiId: altPoiId ?? undefined, zoneId: 0 }, submission);
}

function patchStopAlternatives(
  stop: CompanionStop,
  submission: CompanionVerificationSubmission,
): CompanionStop {
  const patchList = (list: CompanionStopAlternative[] | undefined) => {
    if (!list?.length) {
      return list;
    }
    return list.map((alternative) =>
      alternativeMatchesSubmission(alternative, submission)
        ? patchAlternative(alternative, submission)
        : alternative,
    );
  };

  return {
    ...stop,
    alternatives: patchList(stop.alternatives),
    nearbyAlternatives: patchList(stop.nearbyAlternatives),
  };
}

function patchStopTree(
  stop: CompanionStop,
  submission: CompanionVerificationSubmission,
): CompanionStop {
  const withAlternatives = patchStopAlternatives(stop, submission);
  return stopMatchesSubmission(withAlternatives, submission)
    ? patchStop(withAlternatives, submission)
    : withAlternatives;
}

function recountDashboardStats(bundle: CompanionBundle): CompanionBundle["dashboardStats"] {
  const total = bundle.stops.length;
  const verified = bundle.stops.filter(
    (stop) => stop.verificationStatus === "verified" || stop.verificationStatus === "pending",
  ).length;
  const unverified = total - verified;
  const existing = bundle.dashboardStats;
  return {
    verifiedStops: verified,
    unverifiedStops: unverified,
    remainingStops: unverified,
    remainingUnsupportedKm: existing?.remainingUnsupportedKm ?? 0,
    readinessScore: existing
      ? Math.round((verified / Math.max(total, 1)) * existing.readinessScore)
      : Math.round((verified / Math.max(total, 1)) * 100),
    readinessReasons: existing?.readinessReasons ?? [],
  };
}

/** Promote a discovered POI into the primary stop list before applying verification. */
export function applyDiscoverVerificationToBundle(
  bundle: CompanionBundle,
  submission: CompanionVerificationSubmission,
  discoverPoi: CompanionDiscoverPoi,
): CompanionBundle {
  if (findDiscoverPoiInBundle(bundle, discoverPoi.osmId, discoverPoi.osmType)) {
    return applyVerificationToBundle(bundle, submission);
  }

  const stops = insertPromotedDiscoverStop(bundle, discoverPoi);
  return applyVerificationToBundle({ ...bundle, stops }, submission);
}

/** Optimistically patch companion bundle after a verification submission. */
export function applyVerificationToBundle(
  bundle: CompanionBundle,
  submission: CompanionVerificationSubmission,
): CompanionBundle {
  const stops = bundle.stops.map((stop) => patchStopTree(stop, submission));
  const next: CompanionBundle = {
    ...bundle,
    stops,
    syncedAt: new Date().toISOString(),
    revision: (bundle.revision ?? 0) + 1,
  };
  next.dashboardStats = recountDashboardStats(next);
  return next;
}

/** Revert a verification by restoring the prior stop snapshot. */
export function revertVerificationOnBundle(
  bundle: CompanionBundle,
  priorStop: CompanionStop,
): CompanionBundle {
  const priorKey = stopIdentity(priorStop);
  const stops = bundle.stops.map((stop) => {
    if (sameStop(stop, priorStop)) {
      return priorStop;
    }
    const alternatives = stop.alternatives?.map((alternative) => {
      const altKey =
        alternative.poiId ??
        (alternative.osmId != null ? `poi_${alternative.osmId}` : `${priorKey}-alt-${alternative.name}`);
      if (altKey === priorKey) {
        const priorAlt = priorStop.alternatives?.find(
          (item) =>
            (item.poiId ?? (item.osmId != null ? `poi_${item.osmId}` : null)) === altKey,
        );
        return priorAlt ?? alternative;
      }
      return alternative;
    });
    const nearbyAlternatives = stop.nearbyAlternatives?.map((alternative) => {
      const altKey =
        alternative.poiId ??
        (alternative.osmId != null ? `poi_${alternative.osmId}` : `${priorKey}-alt-${alternative.name}`);
      if (altKey === priorKey) {
        const priorAlt = priorStop.nearbyAlternatives?.find(
          (item) =>
            (item.poiId ?? (item.osmId != null ? `poi_${item.osmId}` : null)) === altKey,
        );
        return priorAlt ?? alternative;
      }
      return alternative;
    });
    return {
      ...stop,
      alternatives,
      nearbyAlternatives,
    };
  });
  const next: CompanionBundle = { ...bundle, stops };
  next.dashboardStats = recountDashboardStats(next);
  return next;
}

function isCountedVerified(status: CompanionStop["verificationStatus"]): boolean {
  return status === "verified" || status === "pending";
}

export function verificationStatsLine(bundle: CompanionBundle): string {
  const total = bundle.stops.length;
  const verified = bundle.stops.filter((stop) => isCountedVerified(stop.verificationStatus)).length;
  const remaining = total - verified;
  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
  return `${total} stops · ${verified} verified · ${remaining} remaining · ${pct}%`;
}

function syncAlternativeFromSubmission(
  alternative: CompanionStopAlternative,
): CompanionStopAlternative {
  if (alternative.verificationStatus !== "pending") {
    return alternative;
  }
  return {
    ...alternative,
    verificationStatus: "verified",
  };
}

function syncStopTreeFromSubmissions(
  stop: CompanionStop,
  syncedByPoi: Map<string, CompanionVerificationSubmission>,
): CompanionStop {
  const syncList = (list: CompanionStopAlternative[] | undefined) => {
    if (!list?.length) {
      return list;
    }
    return list.map((alternative) => {
      const altPoiId =
        alternative.poiId ?? (alternative.osmId != null ? `poi_${alternative.osmId}` : null);
      const submission =
        (altPoiId ? syncedByPoi.get(altPoiId) : undefined) ??
        syncedByPoi.get(`zone-${stop.zoneId}`);
      if (!submission || alternative.verificationStatus !== "pending") {
        return alternative;
      }
      return syncAlternativeFromSubmission(alternative);
    });
  };

  const submission =
    (stop.poiId ? syncedByPoi.get(stop.poiId) : undefined) ??
    syncedByPoi.get(`zone-${stop.zoneId}`);

  let next = {
    ...stop,
    alternatives: syncList(stop.alternatives),
    nearbyAlternatives: syncList(stop.nearbyAlternatives),
  };

  if (submission && next.verificationStatus === "pending") {
    next = {
      ...next,
      verificationStatus: "verified",
      verificationDate: submission.submittedAt,
    };
  }

  return next;
}

/** Promote locally verified stops to cloud-verified after successful sync. */
export function applySyncedVerificationsToBundle(
  bundle: CompanionBundle,
  synced: CompanionVerificationSubmission[],
): CompanionBundle {
  if (synced.length === 0) {
    return bundle;
  }
  const syncedByPoi = new Map(
    synced
      .filter((item) => item.updates.status === "verified")
      .map((item) => [item.poiId ?? `zone-${item.zoneId}`, item] as const),
  );
  if (syncedByPoi.size === 0) {
    return bundle;
  }

  const stops = bundle.stops.map((stop) => syncStopTreeFromSubmissions(stop, syncedByPoi));

  const next: CompanionBundle = {
    ...bundle,
    stops,
    syncedAt: new Date().toISOString(),
    revision: (bundle.revision ?? 0) + 1,
  };
  next.dashboardStats = recountDashboardStats(next);
  return next;
}
