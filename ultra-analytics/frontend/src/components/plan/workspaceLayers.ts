/** Pure helpers for temporary search vs permanent verified layers. */

export type WorkspaceLayer = "temp" | "verified";

export interface WorkspaceStop {
  id: string;
  reviewStatus?: string;
}

/**
 * New search replaces temporary results entirely.
 * Verified IDs never appear in the temp list.
 */
export function replaceSearchResults<T extends WorkspaceStop>(
  nextBatch: T[],
  verifiedIds: Set<string>,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of nextBatch) {
    if (verifiedIds.has(s.id) || s.reviewStatus === "verified") continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** Promote a temp find into the permanent verified layer. */
export function promoteToVerified<T extends WorkspaceStop>(
  stop: T,
  verified: T[],
): T[] {
  const promoted = { ...stop, reviewStatus: "verified" as const };
  const without = verified.filter((s) => s.id !== stop.id);
  return [...without, promoted as T];
}

/** Remove a stop from temporary search results (after verify or clear). */
export function removeFromSearchResults<T extends WorkspaceStop>(
  searchResults: T[],
  stopId: string,
): T[] {
  return searchResults.filter((s) => s.id !== stopId);
}

export function verifiedIdSet<T extends WorkspaceStop>(verified: T[]): Set<string> {
  return new Set(verified.map((s) => s.id));
}
