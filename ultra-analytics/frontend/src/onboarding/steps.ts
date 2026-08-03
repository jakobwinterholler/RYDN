/** Copy + structure for the first-run / redeem onboarding arc.
 *
 * Red thread: Scout it. See it. Share it.
 * Use cases: roadbook → full-tour analysis → climbing → share shot.
 */

export type OnboardingDest = "library" | "planning";

export type OnboardingVisual =
  | "scout"
  | "ride"
  | "tour"
  | "climbs"
  | "share"
  | "finish";

export interface OnboardingStep {
  id: string;
  /** Short eyebrow above the headline — optional. */
  eyebrow?: string;
  title: string;
  body: string;
  /** Visual composition key rendered by Onboarding.tsx */
  visual: OnboardingVisual;
}

/** Product through-line — every step advances this. */
export const ONBOARDING_SPINE = "Scout it. See it. Share it.";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "scout",
    eyebrow: "Before you roll",
    title: "Make the roadbook.",
    body: "Find water fountains and shops on the route. Verify the good ones. Pin them on the map so you’re not hoping — you know.",
    visual: "scout",
  },
  {
    id: "ride",
    eyebrow: "Out on the bike",
    title: "Still thirsty? Check again.",
    body: "Mid-ride: open the map, hunt more water or shops, peek Google Street View. Confidence before you detour.",
    visual: "ride",
  },
  {
    id: "tour",
    eyebrow: "After a bikepack",
    title: "The whole tour. One view.",
    body: "Other apps leave each riding day in its own file. RYDN stitches Day 1, Day 2, Day 3… into one multi-day tour — stop times, how long you parked, Normalized Power, W/kg.",
    visual: "tour",
  },
  {
    id: "climbs",
    eyebrow: "Climbing receipts",
    title: "How fast did you go up?",
    body: "Height meters per hour. Per climb: watts, average speed, climbing rate, gradient. After the ride, see what you put down.",
    visual: "climbs",
  },
  {
    id: "share",
    eyebrow: "Flex time",
    title: "Screenshot the trip.",
    body: "A clean full-tour card for Instagram or Strava — the whole adventure, not a lonely day file.",
    visual: "share",
  },
  {
    id: "go",
    eyebrow: "You’re in",
    title: "Your rides are waiting.",
    body: "Open Library to explore tours, climbs, and share cards. Planning is Pro when you want to build a course — no rush.",
    visual: "finish",
  },
];
