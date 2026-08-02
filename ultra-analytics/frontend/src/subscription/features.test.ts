import { describe, expect, it } from "vitest";
import {
  canAccess,
  canAccessUser,
  canImportPlannedRoute,
  normalizeTier,
  tierFromUser,
  tierLabel,
} from "./features";

describe("subscription features", () => {
  it("gates Pro features", () => {
    expect(canAccess("planning", "guest")).toBe(false);
    expect(canAccess("planning", "free")).toBe(false);
    expect(canAccess("verify", "free")).toBe(false);
    expect(canAccess("rideMode", "free")).toBe(false);
    expect(canAccess("gpxExport", "free")).toBe(false);
    expect(canAccess("planning", "pro")).toBe(true);
    expect(canAccess("gpxExport", "pro")).toBe(true);
  });

  it("reads tier from user", () => {
    expect(tierFromUser(null)).toBe("guest");
    expect(tierFromUser({ subscriptionTier: "pro" })).toBe("pro");
    expect(tierFromUser({ subscriptionTier: null })).toBe("free");
    expect(canAccessUser("planning", { subscriptionTier: "free" })).toBe(false);
    expect(canAccessUser("planning", { subscriptionTier: "pro" })).toBe(true);
  });

  it("allows planned import with Race Pass credit", () => {
    expect(canImportPlannedRoute({ subscriptionTier: "free", racePassCredits: 0 })).toBe(false);
    expect(canImportPlannedRoute({ subscriptionTier: "free", racePassCredits: 1 })).toBe(true);
    expect(
      canImportPlannedRoute({ subscriptionTier: "free", billing: { racePassCredits: 2 } }),
    ).toBe(true);
    expect(canImportPlannedRoute({ subscriptionTier: "pro", racePassCredits: 0 })).toBe(true);
  });

  it("normalizes labels", () => {
    expect(normalizeTier("PRO")).toBe("pro");
    expect(tierLabel("pro")).toBe("Pro");
    expect(tierLabel("free")).toBe("Free");
    expect(tierLabel("guest")).toBe("Guest");
    expect(tierLabel(tierFromUser({}))).toBe("Free");
  });
});

