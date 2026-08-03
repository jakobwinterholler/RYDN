import { collectAllBundlePois } from "@shared/race/bundlePois";
import type { CompanionBundle, CompanionStop } from "@shared/types/sync";
import {
  sortVerificationQueue,
  type SortVerificationOptions,
} from "@shared/race/sortVerificationQueue";

export function stopsNeedingVerification(bundle: CompanionBundle): CompanionStop[] {
  return collectAllBundlePois(bundle)
    .map((entry) => entry.stop)
    .filter((stop) => stop.verificationStatus === "unverified");
}

export function sortedVerificationQueue(
  bundle: CompanionBundle,
  options: SortVerificationOptions,
): CompanionStop[] {
  return sortVerificationQueue(stopsNeedingVerification(bundle), options);
}
