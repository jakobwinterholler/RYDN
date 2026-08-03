import type { CompanionBundle } from "../types";

/** Latest in-memory bundle — used by async verification sync to avoid stale closures. */
export const liveBundleRef: { current: CompanionBundle | null } = { current: null };
