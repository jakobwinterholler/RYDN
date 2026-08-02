import { describe, expect, it } from "vitest";
import { ONBOARDING_SPINE, ONBOARDING_STEPS } from "./steps";
import { normalizeRedeemCode, ONBOARD_CODE } from "./persistence";

describe("onboarding steps", () => {
  it("has a short scannable arc", () => {
    expect(ONBOARDING_STEPS.length).toBeGreaterThanOrEqual(5);
    expect(ONBOARDING_STEPS.length).toBeLessThanOrEqual(7);
    for (const step of ONBOARDING_STEPS) {
      expect(step.title.length).toBeLessThan(80);
      expect(step.body.length).toBeLessThan(280);
    }
  });

  it("carries Scout → See → Share as the red thread", () => {
    expect(ONBOARDING_SPINE).toMatch(/Scout it/i);
    expect(ONBOARDING_SPINE).toMatch(/See it/i);
    expect(ONBOARDING_SPINE).toMatch(/Share it/i);
    expect(ONBOARDING_SPINE).not.toMatch(/Know the route/i);
  });

  it("opens on roadbook scouting, not abstract pain", () => {
    const scout = ONBOARDING_STEPS[0];
    expect(scout?.id).toBe("scout");
    expect(scout?.visual).toBe("scout");
    expect(scout?.title).toMatch(/roadbook/i);
    expect(scout?.body).toMatch(/water|fountain/i);
  });

  it("covers mid-ride Street View confidence", () => {
    const ride = ONBOARDING_STEPS.find((s) => s.id === "ride");
    expect(ride?.visual).toBe("ride");
    expect(ride?.body).toMatch(/Street View/i);
    expect(ride?.body).toMatch(/water|shop/i);
  });

  it("shows full-tour analysis with effort metrics", () => {
    const tour = ONBOARDING_STEPS.find((s) => s.id === "tour");
    expect(tour?.visual).toBe("tour");
    expect(tour?.body).toMatch(/Normalized Power|W\/kg/i);
    expect(tour?.body).toMatch(/stop/i);
    expect(tour?.body).toMatch(/Day 1|multi-day/i);
    expect(tour?.title).toMatch(/whole tour|one view/i);
  });

  it("covers climbing performance detail", () => {
    const climbs = ONBOARDING_STEPS.find((s) => s.id === "climbs");
    expect(climbs?.visual).toBe("climbs");
    expect(climbs?.body).toMatch(/watt|gradient|climbing rate|meters per hour/i);
  });

  it("ends with share + a soft Library welcome", () => {
    const share = ONBOARDING_STEPS.find((s) => s.id === "share");
    expect(share?.visual).toBe("share");
    expect(share?.body).toMatch(/Instagram|Strava/i);

    const go = ONBOARDING_STEPS.find((s) => s.id === "go");
    expect(go?.visual).toBe("finish");
    expect(go?.title).toMatch(/rides are waiting|welcome|library/i);
    expect(go?.title).not.toMatch(/Scout it/i);
    expect(go?.body).toMatch(/Library/i);
    expect(go?.body).not.toMatch(/Try Planning/i);
    expect(go?.title.toLowerCase()).not.toMatch(/bring your rides home/);
  });

  it("rejects the old Know-the-route spine copy", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.title).not.toMatch(/Know the route/i);
      expect(step.body).not.toMatch(/Three spaces/i);
      expect(step.body).not.toMatch(/Race\. Bikepack\. Long day/i);
    }
  });

  it("normalizes the onboard redeem code", () => {
    expect(normalizeRedeemCode("  rydn-onboard  ")).toBe(ONBOARD_CODE);
  });
});
