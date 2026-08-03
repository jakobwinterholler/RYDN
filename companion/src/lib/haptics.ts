/**
 * Subtle haptic feedback for intentional interactions.
 *
 * Uses the Web Vibration API. It is a graceful no-op where unsupported —
 * notably iOS Safari / installed PWAs do not implement `navigator.vibrate`,
 * so this fires on Android and any future-supporting engine, and simply does
 * nothing elsewhere. Keep patterns short and rare so feedback feels premium,
 * not noisy.
 */

export type HapticPattern = "selection" | "light" | "medium" | "success" | "warning";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 20,
  success: [14, 40, 22],
  warning: [22, 60, 22],
};

export function haptic(pattern: HapticPattern = "light"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Ignore — feedback is a nicety, never required for the interaction.
  }
}
