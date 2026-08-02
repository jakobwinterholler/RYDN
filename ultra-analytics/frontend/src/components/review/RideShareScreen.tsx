/** Shareable first screen for a single training/race day — Ultra Overview rhythm. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Report } from "../../types";
import { cleanDayTitle } from "../ui/titles";
import { fmtDate } from "../ui/format";
import { fmtElapsed } from "../ui/ScoreLine";
import UltraElevProfile from "../ui/UltraElevProfile";
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
  return report.race.kind === "race" ? "Race" : "Training Ride";
}

function sportLabel(report: Report): string {
  return report.race.kind === "race" ? "Race" : "Ride";
}

export default function RideShareScreen({ report }: { report: Report }) {
  const { race, overview, performance } = report;
  const title = cleanDayTitle(race.name) || race.name || "Ride";

  const [introReveal, setIntroReveal] = useState<IntroReveal>(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? false
      : "hold",
  );
  const introStarted = useRef(false);
  const introRaf = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      introRaf.current.forEach((id) => cancelAnimationFrame(id));
      introRaf.current = [];
    };
  }, []);

  const startIntroReveal = useCallback(() => {
    if (introStarted.current) return;
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
  }, []);

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

  const npW = overview.npW != null && overview.npW > 0 ? overview.npW : null;
  const avgPowerW =
    overview.avgPowerW != null && overview.avgPowerW > 0 ? overview.avgPowerW : null;
  const weightKg =
    report.athleteWeightKg != null && report.athleteWeightKg > 0
      ? report.athleteWeightKg
      : null;
  const avgWPerKg =
    avgPowerW != null && weightKg != null ? avgPowerW / weightKg : null;
  const avgHr =
    performance?.hr?.avg != null && performance.hr.avg > 0
      ? Math.round(performance.hr.avg)
      : null;

  const points = report.route?.points;

  return (
    <section className="ride-share" aria-label="Ride summary">
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
          <div className="ride-score">
            <span className="ride-score__item">
              <span className="ride-score__v">{fmtMetric(overview.distanceKm)}</span>
              <span className="ride-score__u">km</span>
            </span>
            <span className="ride-score__sep" aria-hidden>
              ·
            </span>
            <span className="ride-score__item">
              <span className="ride-score__v">{fmtMetric(overview.elevationGainM)}</span>
              <span className="ride-score__u">m</span>
            </span>
            <span className="ride-score__sep" aria-hidden>
              ·
            </span>
            <span className="ride-score__item">
              <span className="ride-score__v">{fmtMetric(npW)}</span>
              <span className="ride-score__u">W NP</span>
            </span>
            <span className="ride-score__sep" aria-hidden>
              ·
            </span>
            <span className="ride-score__item">
              <span className="ride-score__v">{fmtMetric(avgWPerKg, 1)}</span>
              <span className="ride-score__u">W/kg</span>
            </span>
            <span className="ride-score__sep" aria-hidden>
              ·
            </span>
            <span className="ride-score__item">
              <span className="ride-score__v">{fmtMetric(avgHr)}</span>
              <span className="ride-score__u">bpm</span>
            </span>
          </div>

          <p className="ride-share__secondary" aria-label="Secondary ride metrics">
            <span>Moving {fmtElapsed(overview.movingTimeS)}</span>
            <span className="ride-share__sec-sep" aria-hidden>
              ·
            </span>
            <span>Elapsed {fmtElapsed(overview.elapsedTimeS)}</span>
            <span className="ride-share__sec-sep" aria-hidden>
              ·
            </span>
            <span>{overview.avgSpeedMovingKmh.toFixed(1)} km/h avg</span>
          </p>
        </div>
      </div>
    </section>
  );
}
