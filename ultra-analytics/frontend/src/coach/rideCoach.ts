/** Rule-based Ride Coach — practical tips from real library metrics. */

import type { RideSummary } from "../types";

export type CoachTip = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "watch" | "act";
};

function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function loadScore(r: RideSummary): number {
  const hours = Math.max(0.25, (r.movingTimeS || r.durationS || 1) / 3600);
  const elevFactor = 1 + (r.elevationGainM || 0) / 1200;
  return (r.distanceKm || 0) * elevFactor / hours;
}

function movingKmh(r: RideSummary): number | null {
  const s = r.movingTimeS || r.durationS;
  if (!s || s < 600 || !r.distanceKm) return null;
  return (r.distanceKm / s) * 3600;
}

function elevPerKm(r: RideSummary): number {
  if (!r.distanceKm || r.distanceKm < 5) return 0;
  return (r.elevationGainM || 0) / r.distanceKm;
}

/** Tips from recent Library rides — no LLM, no fluff. */
export function coachFromLibrary(rides: RideSummary[], now = Date.now()): CoachTip[] {
  const tips: CoachTip[] = [];
  const recent = [...rides]
    .filter((r) => r.date && r.distanceKm > 0)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 21);

  if (recent.length < 2) {
    if (recent.length === 1) {
      tips.push({
        id: "start",
        title: "Build a baseline",
        body: "One more easy ride this week gives the coach something to compare — keep Z2 volume visible.",
        severity: "info",
      });
    }
    return tips;
  }

  const weekMs = 7 * 24 * 3600 * 1000;
  const thisWeek = recent.filter((r) => {
    const t = Date.parse(r.date || "");
    return Number.isFinite(t) && now - t <= weekMs;
  });
  const lastWeek = recent.filter((r) => {
    const t = Date.parse(r.date || "");
    return Number.isFinite(t) && now - t > weekMs && now - t <= 2 * weekMs;
  });

  const weekLoad = thisWeek.reduce((s, r) => s + loadScore(r), 0);
  const prevLoad = lastWeek.reduce((s, r) => s + loadScore(r), 0);
  const weekKm = thisWeek.reduce((s, r) => s + r.distanceKm, 0);
  const weekElev = thisWeek.reduce((s, r) => s + (r.elevationGainM || 0), 0);

  // Recovery after stacked hard days
  const last3 = recent.slice(0, 3);
  const hard3 = last3.filter((r) => loadScore(r) >= 18 || r.distanceKm >= 80 || (r.elevationGainM || 0) >= 1500);
  if (hard3.length >= 2 && last3.length >= 2) {
    const newest = last3[0];
    const newestKey = dayKey(newest.date);
    const todayKey = new Date(now).toISOString().slice(0, 10);
    if (newestKey === todayKey || hard3.length >= 3) {
      tips.push({
        id: "recovery",
        title: "Protect recovery",
        body: `You stacked ${hard3.length} hard days recently. Keep the next session ≤60% of last effort — short Z2, no surges.`,
        severity: "act",
      });
    } else {
      tips.push({
        id: "recovery-watch",
        title: "Recovery window",
        body: "Two hard days close together — insert one easy spin before the next long effort.",
        severity: "watch",
      });
    }
  }

  // Load spike week-over-week
  if (prevLoad > 20 && weekLoad > prevLoad * 1.35) {
    tips.push({
      id: "load-spike",
      title: "Load jumped this week",
      body: `This week’s load is ~${Math.round(((weekLoad - prevLoad) / prevLoad) * 100)}% above last week. Cap tomorrow’s ride at easy pace if legs feel flat.`,
      severity: "watch",
    });
  }

  // Z2 volume — if most rides are short/hard-looking
  const shortHard = thisWeek.filter(
    (r) => r.distanceKm < 45 && loadScore(r) >= 16 && elevPerKm(r) < 12,
  );
  if (thisWeek.length >= 3 && shortHard.length >= 2 && weekKm < 120) {
    tips.push({
      id: "z2",
      title: "Add a true Z2 block",
      body: "Recent rides look punchy and short. Schedule 2–3 h conversational pace — nose breathing, steady cadence.",
      severity: "info",
    });
  }

  // Climbing focus
  if (weekElev >= 2500 || (weekKm > 0 && weekElev / weekKm >= 18)) {
    tips.push({
      id: "climbing",
      title: "Climbing load is high",
      body: `${Math.round(weekElev).toLocaleString("en-US")} m this week. Prioritize seated rhythm and food before the last climb — don’t empty the tank early.`,
      severity: "info",
    });
  }

  // Fade / fatigue proxy — similar distance, slower moving speed
  const longish = recent.filter((r) => r.distanceKm >= 60);
  if (longish.length >= 2) {
    const a = longish[0];
    const b = longish[1];
    const sa = movingKmh(a);
    const sb = movingKmh(b);
    if (
      sa != null &&
      sb != null &&
      Math.abs(a.distanceKm - b.distanceKm) / Math.max(a.distanceKm, b.distanceKm) < 0.2 &&
      sa < sb * 0.92
    ) {
      tips.push({
        id: "fatigue",
        title: "Pace looks softer",
        body: `Latest long ride averaged ${sa.toFixed(1)} km/h vs ${sb.toFixed(1)} on a similar distance. Check sleep and carbs before pushing intensity.`,
        severity: "watch",
      });
    }
  }

  // Cadence-ish proxy via very stop-heavy rides (elapsed >> moving)
  const stopHeavy = recent.find((r) => {
    if (!r.durationS || !r.movingTimeS || r.distanceKm < 40) return false;
    return r.movingTimeS / r.durationS < 0.72;
  });
  if (stopHeavy) {
    tips.push({
      id: "stops",
      title: "Stop time ate the day",
      body: `"${stopHeavy.name}" spent a lot of time not moving. For the next long day, pre-plan water/shop stops and keep transitions under 10 minutes.`,
      severity: "info",
    });
  }

  // Unusual HR isn't in summary — skip. Cap tips.
  const order = { act: 0, watch: 1, info: 2 } as const;
  tips.sort((a, b) => order[a.severity] - order[b.severity]);
  return tips.slice(0, 3);
}

/** Tips from a single ride report — used on Review. */
export function coachFromReport(input: {
  distanceKm: number;
  elevationGainM: number;
  movingPct: number;
  avgHr?: number | null;
  avgCadence?: number | null;
  hrDriftPct?: number | null;
  fadePct?: number | null;
  fatigueInsight?: string | null;
  climbWalkPct?: number | null;
}): CoachTip[] {
  const tips: CoachTip[] = [];

  if (input.movingPct < 70 && input.distanceKm >= 80) {
    tips.push({
      id: "moving",
      title: "Too much stopped time",
      body: `Only ${Math.round(input.movingPct)}% moving on a long day. Aim for shorter, purposeful stops — resupply and go.`,
      severity: "act",
    });
  }

  if (input.hrDriftPct != null && input.hrDriftPct >= 6) {
    tips.push({
      id: "hr-drift",
      title: "Heart rate drifted up",
      body: `HR drift ~${input.hrDriftPct.toFixed(0)}%. Next similar ride: start 5–8% easier, eat earlier, and cool the core on climbs.`,
      severity: "watch",
    });
  }

  if (input.fadePct != null && input.fadePct <= -8) {
    tips.push({
      id: "fade",
      title: "Second-half fade",
      body: `Pace dropped ~${Math.abs(Math.round(input.fadePct))}% after halfway. Practice even pacing — hold back the first third.`,
      severity: "watch",
    });
  }

  if (input.avgCadence != null && input.avgCadence > 0 && input.avgCadence < 70 && input.distanceKm >= 50) {
    tips.push({
      id: "cadence",
      title: "Cadence ran low",
      body: `Avg cadence ~${Math.round(input.avgCadence)} rpm. On the next long day, spin lighter on flats — saves knees when fatigue hits.`,
      severity: "info",
    });
  }

  if (input.climbWalkPct != null && input.climbWalkPct >= 15) {
    tips.push({
      id: "hike-a-bike",
      title: "Lots of hike-a-bike",
      body: `${Math.round(input.climbWalkPct)}% of climb distance on foot. That’s fine for ultra — just budget time and keep shoes/push technique ready.`,
      severity: "info",
    });
  }

  if (input.fatigueInsight) {
    tips.push({
      id: "fatigue-curve",
      title: "Fatigue showed up",
      body: input.fatigueInsight,
      severity: "watch",
    });
  }

  if (
    input.avgHr != null &&
    input.avgHr >= 165 &&
    input.distanceKm >= 60 &&
    input.elevationGainM < 800
  ) {
    tips.push({
      id: "hr-high",
      title: "HR unusually high for the terrain",
      body: `Avg ${Math.round(input.avgHr)} bpm on rolling terrain. Check heat, caffeine, and whether you actually rode Z2.`,
      severity: "watch",
    });
  }

  const order = { act: 0, watch: 1, info: 2 } as const;
  tips.sort((a, b) => order[a.severity] - order[b.severity]);
  return tips.slice(0, 3);
}
