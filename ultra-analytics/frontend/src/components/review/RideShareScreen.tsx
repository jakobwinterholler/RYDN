/** Shareable first screen for a single training/race day — Ultra Overview rhythm. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Report } from "../../types";
import { cleanDayTitle } from "../ui/titles";
import { fmtDate } from "../ui/format";
import ScoreLine, { fmtElapsed } from "../ui/ScoreLine";
import UltraElevProfile from "../ui/UltraElevProfile";
import RydnMark from "../ui/RydnMark";
import RideShareMap from "./RideShareMap";

type IntroReveal = "hold" | "play" | false;

function fmtMetric(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (digits <= 0) return Math.round(n).toLocaleString("en-US");
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function sourceLabel(report: Report): string {
  const src = (report.source || "").toLowerCase();
  if (src === "strava" || (report.race.sources || []).some((s) => String(s).startsWith("strava:"))) {
    return "Strava";
  }
  if (src === "upload") return "Upload";
  return report.race.kind === "race" ? "Race" : "Training";
}

function sportLabel(report: Report): string {
  return report.race.kind === "race" ? "Race" : "Ride";
}

interface Props {
  report: Report;
  /** When true, skip intro hold/draw so a screenshot is immediately complete. */
  staticReveal?: boolean;
  /** Compact certificate chrome for the share overlay. */
  shareSurface?: boolean;
}

export default function RideShareScreen({
  report,
  staticReveal = false,
  shareSurface = false,
}: Props) {
  const { race, overview, performance } = report;
  const title = cleanDayTitle(race.name) || race.name || "Ride";

  const [introReveal, setIntroReveal] = useState<IntroReveal>(() => {
    if (staticReveal) return false;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return false;
    }
    return "hold";
  });
  const introStarted = useRef(false);
  const introRaf = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      introRaf.current.forEach((id) => cancelAnimationFrame(id));
      introRaf.current = [];
    };
  }, []);

  useEffect(() => {
    if (!staticReveal) return;
    setIntroReveal(false);
    introStarted.current = true;
  }, [staticReveal]);

  const startIntroReveal = useCallback(() => {
    if (staticReveal || introStarted.current) return;
    introStarted.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIntroReveal(false);
      return;
    }
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setIntroReveal("play"));
      introRaf.current.push(raf2);
    });
    introRaf.current.push(raf1);
  }, [staticReveal]);

  const elev = useMemo(() => {
    const axisKm = performance?.axisKm || [];
    const series = performance?.elevation?.series || [];
    if (axisKm.length < 2 || series.length < 2) return null;
    const n = Math.min(axisKm.length, series.length);
    return {
      axisKm: axisKm.slice(0, n),
      elevationM: series.slice(0, n) as (number | null)[],
    };
  }, [performance]);

  const hasPower = overview.hasPower && overview.npW != null && overview.npW > 0;
  const npW = hasPower ? overview.npW : null;
  const weightKg =
    report.athleteWeightKg != null && report.athleteWeightKg > 0
      ? report.athleteWeightKg
      : null;
  // W/kg is NP-based (Normalized Power / weight), never average power.
  const npWPerKg = npW != null && weightKg != null ? npW / weightKg : null;
  const avgHr =
    performance?.hr?.avg != null && performance.hr.avg > 0
      ? Math.round(performance.hr.avg)
      : null;

  const secondary: string[] = [];
  secondary.push(`Moving ${fmtElapsed(overview.movingTimeS)}`);
  if (overview.avgSpeedMovingKmh > 0) {
    secondary.push(`${overview.avgSpeedMovingKmh.toFixed(1)} km/h`);
  }
  if (npWPerKg != null) secondary.push(`${fmtMetric(npWPerKg, 1)} W/kg`);
  if (avgHr != null) secondary.push(`${avgHr} bpm`);

  const points = report.route?.points;

  return (
    <section
      className={`ride-share${shareSurface ? " ride-share--surface" : ""}`}
      aria-label="Ride summary"
    >
      <div className="ride-share__hero">
        <p className="ride-share__eyebrow">
          {sportLabel(report)} · {sourceLabel(report)} · {fmtDate(race.startTime)}
        </p>
        <h1 className="ride-share__title">{title}</h1>
      </div>

      <div className="ride-share__certificate">
        <RideShareMap
          className="ride-share__map"
          points={points}
          reveal={introReveal}
          onReady={startIntroReveal}
        />

        {elev ? (
          <UltraElevProfile
            axisKm={elev.axisKm}
            elevationM={elev.elevationM}
            reveal={introReveal}
          />
        ) : null}

        <div className="ride-share__score" aria-label="Primary ride metrics">
          <ScoreLine
            distanceKm={overview.distanceKm}
            elevationGainM={overview.elevationGainM}
            durationS={overview.elapsedTimeS}
            showNp={hasPower}
            npW={npW}
          />

          {secondary.length > 0 && (
            <p className="ride-share__secondary" aria-label="Secondary ride metrics">
              {secondary.map((part, i) => (
                <span key={part}>
                  {i > 0 && (
                    <span className="ride-share__sec-sep" aria-hidden>
                      ·
                    </span>
                  )}
                  <span>{part}</span>
                </span>
              ))}
            </p>
          )}
        </div>

        {shareSurface && (
          <footer className="ride-share__foot" aria-hidden="true">
            <RydnMark size={14} />
            <span>RYDN</span>
          </footer>
        )}
      </div>
    </section>
  );
}
