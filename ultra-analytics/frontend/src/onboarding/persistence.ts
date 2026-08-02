/** Client persistence for product onboarding (per login session + redeem QA). */

const SEEN_KEY = "rydn.onboardingSeen";

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode / blocked storage */
  }
}

/** Clear on logout so the next login shows the product tour again. */
export function clearOnboardingSeen(): void {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* private mode / blocked storage */
  }
}

/** Normalize redeem codes the same way the backend does (trim + upper). */
export function normalizeRedeemCode(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

export const ONBOARD_CODE = "RYDN-ONBOARD";
