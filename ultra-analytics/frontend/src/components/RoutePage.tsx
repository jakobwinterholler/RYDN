/** Planned Route — linear Plan sections + in-page Verify deck. */

import { useEffect, useMemo, useRef, useState } from "react";
import { deleteRoute, getRoute, getRouteAnalysis, patchRoute } from "../api";
import type {
  CriticalDecision,
  PlannedRouteDetail,
  RecommendedStop,
  RouteAnalysis,
  RouteClimb,
  RoutePreparation,
  RouteRemoteGap,
} from "../types";
import { fmtDuration } from "./ui/format";
import Icon from "./ui/Icon";
import RoutePreview from "./ui/RoutePreview";
import RydnLoader from "./ui/RydnLoader";
import ScoreLine from "./ui/ScoreLine";

interface Props {
  routeId: string;
  onBack: () => void;
  onDeleted?: () => void;
}

type Mode = "plan" | "ride";
type MapFilter = "all" | "stops" | "climbs" | "remote" | "sleep" | "stages" | "decisions";
type PlanSection = "critical" | "map" | "stops" | "climbs" | "stages" | "verify";

const PLAN_SECTIONS: { id: PlanSection; label: string }[] = [
  { id: "critical", label: "Critical" },
  { id: "map", label: "Map" },
  { id: "stops", label: "Stops" },
  { id: "climbs", label: "Climbs" },
  { id: "stages", label: "Stages" },
  { id: "verify", label: "Verify" },
];

const CHECKS: {
  key: keyof Omit<RoutePreparation, "notes">;
  label: string;
  doneHint: (a: RouteAnalysis | null) => string;
}[] = [
  {
    key: "routeUnderstood",
    label: "Route understood",
    doneHint: (a) =>
      a
        ? `${Math.round(a.summary.distanceKm)} km · ${a.summary.elevationGainM.toLocaleString("en-US")} m`
        : "Confirm the course shape and totals",
  },
  {
    key: "stopsVerified",
    label: "Stops reviewed",
    doneHint: (a) =>
      a
        ? `${a.summary.recommendedStopCount ?? 0} recommended · ${a.summary.verifiedStopCount ?? 0} verified`
        : "Review recommended stops",
  },
  {
    key: "keyClimbsReviewed",
    label: "Climbs reviewed",
    doneHint: (a) => (a ? `${a.summary.climbCount} climbs detected` : "Review major climbs"),
  },
  {
    key: "stagesPlanned",
    label: "Stages reviewed",
    doneHint: (a) => (a ? `${a.summary.stageCount} suggested days` : "Review stage breaks"),
  },
];

function stars(n: number) {
  return "★".repeat(Math.max(0, Math.min(5, n))) + "☆".repeat(Math.max(0, 5 - n));
}

function recommendWhy(stop: RecommendedStop): string {
  const parts: string[] = [];
  if (stop.qualityStars >= 5) parts.push("Top reliability for ultra resupply");
  else if (stop.qualityStars >= 4) parts.push("Strong reliability on this stretch");
  else parts.push(`${stop.qualityLabel} option where coverage is thin`);
  if (stop.is24h) parts.push("open around the clock");
  if (stop.distanceOffRouteM <= 80) parts.push("essentially on the course");
  else if (stop.distanceOffRouteM <= 250) parts.push("short detour off the line");
  if (stop.group === "water") parts.push("water coverage for the next gap");
  else if (stop.group === "sleep") parts.push("sleep option near a stage break");
  else if (stop.category === "Gas station") parts.push("fuel, water, and late hours in one stop");
  else if (stop.category === "Supermarket") parts.push("full resupply without hunting side streets");
  return `${parts.join(" · ")}.`;
}

function ElevSpark({ profile, highlightKm }: { profile: number[][]; highlightKm?: number | null }) {
  if (profile.length < 2) return null;
  const w = 640;
  const h = 72;
  const xs = profile.map((p) => p[0]);
  const ys = profile.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs) || 1;
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const span = Math.max(y1 - y0, 1);
  const d = profile
    .map((p, i) => {
      const x = ((p[0] - x0) / (x1 - x0)) * w;
      const y = h - ((p[1] - y0) / span) * (h - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const hx = highlightKm != null ? ((highlightKm - x0) / (x1 - x0)) * w : null;
  return (
    <svg className="route-elev" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Elevation profile">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {hx != null && <line x1={hx} x2={hx} y1={0} y2={h} stroke="var(--accent)" strokeWidth="1.5" />}
    </svg>
  );
}

function VerifyStopCard({
  stop,
  index,
  total,
  busy,
  onReview,
  onPrev,
  onNext,
}: {
  stop: RecommendedStop;
  index: number;
  total: number;
  busy: boolean;
  onReview: (status: "verified" | "rejected" | "skipped") => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <article
      className={`verify-card verify-card--${stop.reviewStatus}`}
      onTouchStart={(e) => {
        const t = e.changedTouches[0];
        touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        if (!touchStart.current) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStart.current.x;
        const dy = t.clientY - touchStart.current.y;
        touchStart.current = null;
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
        if (dx < 0) onNext();
        else onPrev();
      }}
    >
      <header className="verify-card__progress">
        <span>
          Stop {index + 1} of {total}
        </span>
        <span className={`verify-card__status verify-card__status--${stop.reviewStatus}`}>
          {stop.reviewStatus === "unreviewed" ? "Awaiting review" : stop.reviewStatus}
        </span>
      </header>

      <div className="verify-card__rating">
        <span className="verify-card__stars" aria-hidden>
          {stars(stop.qualityStars)}
        </span>
        <span className="verify-card__quality">{stop.qualityLabel}</span>
      </div>

      <h3 className="verify-card__title">{stop.name || stop.category}</h3>
      <p className="verify-card__type">
        {stop.category}
        {stop.is24h ? " · 24h" : ""}
        {" · "}km {stop.distanceAlongKm.toFixed(0)}
      </p>

      <div className="verify-card__why">
        <p className="verify-card__why-label">Why RYDN recommends this</p>
        <p className="verify-card__why-text">{recommendWhy(stop)}</p>
      </div>

      <dl className="verify-card__facts">
        <div>
          <dt>Opening hours</dt>
          <dd>{stop.openingHours || (stop.is24h ? "24h" : "Unknown")}</dd>
        </div>
        <div>
          <dt>Off route</dt>
          <dd>{stop.distanceOffRouteM} m</dd>
        </div>
        <div>
          <dt>Since previous</dt>
          <dd>
            {stop.distanceSincePreviousKm != null ? `${stop.distanceSincePreviousKm} km` : "—"}
          </dd>
        </div>
        <div>
          <dt>ETA</dt>
          <dd>{stop.estimatedArrivalS != null ? `~${fmtDuration(stop.estimatedArrivalS)}` : "—"}</dd>
        </div>
      </dl>

      <div className="verify-card__preview">
        <p className="verify-card__preview-label">Street View</p>
        <p className="verify-card__preview-hint">
          Confirm the entrance still looks open — then verify or reject.
        </p>
        {stop.streetViewUrl ? (
          <a className="btn btn--ghost" href={stop.streetViewUrl} target="_blank" rel="noreferrer">
            Open Street View
          </a>
        ) : (
          <p className="verify-card__preview-missing">Street View link unavailable for this stop.</p>
        )}
      </div>

      <div className="verify-card__links">
        {stop.googleMapsUrl && (
          <a href={stop.googleMapsUrl} target="_blank" rel="noreferrer">
            Google Maps
          </a>
        )}
        {stop.website && (
          <a href={stop.website} target="_blank" rel="noreferrer">
            Website
          </a>
        )}
      </div>

      <div className="verify-card__actions">
        <button type="button" className="btn" disabled={busy} onClick={() => onReview("verified")}>
          Verify
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onReview("rejected")}>
          Reject
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onReview("skipped")}>
          Skip
        </button>
      </div>

      <div className="verify-card__nav">
        <button type="button" className="btn btn--ghost" disabled={index <= 0 || busy} onClick={onPrev}>
          Previous
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={index >= total - 1 || busy}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </article>
  );
}

type PeekPayload =
  | { kind: "climb"; climb: RouteClimb }
  | { kind: "remote"; gap: RouteRemoteGap }
  | { kind: "decision"; decision: CriticalDecision };

export default function RoutePage({ routeId, onBack, onDeleted }: Props) {
  const [route, setRoute] = useState<PlannedRouteDetail | null>(null);
  const [analysis, setAnalysis] = useState<RouteAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(true);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [mode, setMode] = useState<Mode>("plan");
  const [mapFilter, setMapFilter] = useState<MapFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verifyIndex, setVerifyIndex] = useState(0);
  const [verifyMapOpen, setVerifyMapOpen] = useState(true);
  const [planSection, setPlanSection] = useState<PlanSection>("critical");
  const [targetKm, setTargetKm] = useState(250);
  const [rideKm, setRideKm] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setAnalyzing(true);
    Promise.all([getRoute(routeId), getRouteAnalysis(routeId)])
      .then(([r, a]) => {
        if (cancelled) return;
        setRoute(r);
        setName(r.name);
        setNotes(r.preparation?.notes || "");
        setDateStart(r.dateStart || "");
        setDateEnd(r.dateEnd || "");
        setAnalysis(a);
        if (a.targetStageKm) setTargetKm(Math.round(a.targetStageKm));
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setAnalyzing(false));
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const loadAnalysis = async (opts: { refresh?: boolean; targetStageKm?: number } = {}) => {
    setAnalyzing(true);
    setError(null);
    try {
      const a = await getRouteAnalysis(routeId, {
        refresh: opts.refresh,
        targetStageKm: opts.targetStageKm ?? targetKm,
      });
      setAnalysis(a);
      if (a.targetStageKm) setTargetKm(Math.round(a.targetStageKm));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const saveName = async () => {
    if (!route || !name.trim() || name.trim() === route.name) return;
    setBusy(true);
    try {
      setRoute(await patchRoute(route.id, { name: name.trim() }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveDates = async () => {
    if (!route) return;
    const nextStart = dateStart || null;
    const nextEnd = dateEnd || null;
    if ((route.dateStart || null) === nextStart && (route.dateEnd || null) === nextEnd) return;
    setBusy(true);
    try {
      setRoute(await patchRoute(route.id, { dateStart: nextStart, dateEnd: nextEnd }));
      await loadAnalysis({ refresh: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    if (!route) return;
    if ((route.preparation?.notes || "") === notes) return;
    setBusy(true);
    try {
      setRoute(await patchRoute(route.id, { notes }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleCheck = async (key: keyof Omit<RoutePreparation, "notes">) => {
    if (!route) return;
    setBusy(true);
    try {
      setRoute(await patchRoute(route.id, { preparation: { [key]: !route.preparation[key] } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reviewStop = async (stopId: string, status: "verified" | "rejected" | "skipped") => {
    if (!route) return;
    setBusy(true);
    try {
      const currentIdx = (analysis?.recommendedStops || []).findIndex((s) => s.id === stopId);
      const updated = await patchRoute(route.id, { stopReviews: { [stopId]: status } });
      setRoute(updated);
      const a = await getRouteAnalysis(routeId, { targetStageKm: targetKm });
      setAnalysis(a);
      const nextList = a.recommendedStops || [];
      const advanceTo = Math.min(Math.max(currentIdx, 0) + 1, Math.max(0, nextList.length - 1));
      setVerifyIndex(advanceTo);
      setSelectedId(nextList[advanceTo]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!route) return;
    if (!window.confirm("Delete this planned route? Completed rides are unaffected.")) return;
    setBusy(true);
    try {
      await deleteRoute(route.id);
      (onDeleted || onBack)();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const recommended = analysis?.recommendedStops || [];
  const decisions = analysis?.criticalDecisions || [];
  const verifiedCount = recommended.filter((s) => s.reviewStatus === "verified").length;
  const pendingCount = recommended.filter(
    (s) => s.reviewStatus === "unreviewed" || s.reviewStatus === "skipped",
  ).length;

  useEffect(() => {
    if (verifyIndex >= recommended.length && recommended.length > 0) {
      setVerifyIndex(recommended.length - 1);
    }
  }, [recommended.length, verifyIndex]);

  const verifyStop = recommended[Math.min(verifyIndex, Math.max(0, recommended.length - 1))] || null;

  useEffect(() => {
    if (planSection === "verify" && verifyStop) {
      setSelectedId(verifyStop.id);
      setMapFilter("stops");
    }
  }, [planSection, verifyStop?.id]);

  const peek: PeekPayload | null = useMemo(() => {
    if (!selectedId || !analysis) return null;
    if (recommended.some((s) => s.id === selectedId)) return null;
    const climb = analysis.climbs.find((c) => c.id === selectedId);
    if (climb) return { kind: "climb", climb };
    const gap = analysis.remoteGaps.find((g) => g.id === selectedId);
    if (gap) return { kind: "remote", gap };
    const decision = decisions.find((d) => d.id === selectedId);
    if (decision) {
      if (decision.relatedStopId) return null;
      return { kind: "decision", decision };
    }
    return null;
  }, [selectedId, analysis, recommended, decisions]);

  const markers = useMemo(() => {
    if (!analysis) return [];
    const out: {
      id: string;
      lat: number;
      lon: number;
      kind: "climb" | "poi" | "sleep" | "remote" | "stage" | "decision";
      status?: string;
    }[] = [];
    const show = (f: MapFilter) => mapFilter === "all" || mapFilter === f;
    if (show("stops") || show("decisions") || planSection === "verify") {
      for (const s of recommended) {
        out.push({
          id: s.id,
          lat: s.lat,
          lon: s.lon,
          kind: s.group === "sleep" ? "sleep" : "poi",
          status: s.reviewStatus,
        });
      }
    }
    if (show("climbs") && planSection !== "verify") {
      for (const c of analysis.climbs) {
        if (c.startLat != null && c.startLon != null) {
          out.push({ id: c.id, lat: c.startLat, lon: c.startLon, kind: "climb" });
        }
      }
    }
    if (show("remote") && planSection !== "verify") {
      for (const g of analysis.remoteGaps) {
        if (g.midLat != null && g.midLon != null) {
          out.push({ id: g.id, lat: g.midLat, lon: g.midLon, kind: "remote" });
        }
      }
    }
    if (show("sleep") && planSection !== "verify") {
      for (const s of (analysis.sleep || []).slice(0, 30)) {
        out.push({ id: `sleep-${s.osmId}`, lat: s.lat, lon: s.lon, kind: "sleep" });
      }
    }
    if (show("stages") && planSection !== "verify") {
      for (const st of analysis.stages.slice(0, -1)) {
        const sleep = analysis.sleepPlan?.find((p) => p.stageIndex === st.index)?.suggestion;
        if (sleep) out.push({ id: `stage-${st.index}`, lat: sleep.lat, lon: sleep.lon, kind: "stage" });
      }
    }
    if (show("decisions") && planSection !== "verify") {
      for (const d of decisions) {
        if (d.lat != null && d.lon != null && !out.some((m) => m.id === d.id)) {
          out.push({ id: d.id, lat: d.lat, lon: d.lon, kind: "decision" });
        }
      }
    }
    return out;
  }, [analysis, recommended, decisions, mapFilter, planSection]);

  const selectedKm = useMemo(() => {
    if (verifyStop && (planSection === "verify" || selectedId === verifyStop.id)) {
      return verifyStop.distanceAlongKm;
    }
    if (!peek) {
      const stop = recommended.find((s) => s.id === selectedId);
      return stop?.distanceAlongKm ?? null;
    }
    if (peek.kind === "climb") return peek.climb.startKm;
    if (peek.kind === "remote") return (peek.gap.startKm + peek.gap.endKm) / 2;
    return peek.decision.km;
  }, [peek, recommended, selectedId, verifyStop, planSection]);

  const openVerifyAt = (stopId: string) => {
    const idx = recommended.findIndex((s) => s.id === stopId);
    if (idx >= 0) setVerifyIndex(idx);
    setSelectedId(stopId);
    setPlanSection("verify");
    setMapFilter("stops");
    requestAnimationFrame(() => {
      document.getElementById("verify")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const jumpToSection = (id: PlanSection) => {
    setPlanSection(id);
    if (id === "verify" && recommended.length) {
      const firstPending = recommended.findIndex(
        (s) => s.reviewStatus === "unreviewed" || s.reviewStatus === "skipped",
      );
      if (firstPending >= 0) {
        setVerifyIndex(firstPending);
        setSelectedId(recommended[firstPending].id);
      } else if (verifyStop) {
        setSelectedId(verifyStop.id);
      }
      setMapFilter("stops");
    }
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const onSelectMarker = (id: string) => {
    const stop = recommended.find((s) => s.id === id);
    if (stop) {
      openVerifyAt(stop.id);
      return;
    }
    const decision = decisions.find((d) => d.id === id);
    if (decision?.relatedStopId) {
      openVerifyAt(decision.relatedStopId);
      return;
    }
    setSelectedId(id);
  };

  const rideGlance = useMemo(() => {
    const verified = recommended.filter((s) => s.reviewStatus === "verified");
    const ahead = (pred: (s: RecommendedStop) => boolean) => {
      const list = verified.filter((s) => pred(s) && s.distanceAlongKm >= rideKm - 0.5);
      return list.sort((a, b) => a.distanceAlongKm - b.distanceAlongKm)[0] || null;
    };
    return {
      water: ahead((s) => s.group === "water"),
      gas24: ahead((s) => s.category === "Gas station" && !!s.is24h),
      supermarket: ahead((s) => s.category === "Supermarket"),
      pharmacy: ahead((s) => s.category === "Pharmacy"),
      bike: ahead((s) => s.category === "Bike shop"),
    };
  }, [recommended, rideKm]);

  if (error && !route) {
    return (
      <div className="ultra-page">
        <header className="ultra-page__nav">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="chevronLeft" size={22} />
          </button>
        </header>
        <div className="space-loading">{error}</div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="app-loading">
        <RydnLoader label="Opening route…" />
      </div>
    );
  }

  const prep = route.preparation;
  const done = CHECKS.filter((c) => prep[c.key]).length;
  const weather = analysis?.weather;
  const empty = analysis?.emptyReasons;

  return (
    <div className="ultra-page route-page">
      <header className="ultra-page__nav">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to Ultras">
          <Icon name="chevronLeft" size={22} />
        </button>
        <div className="route-page__nav-actions">
          <div className="route-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={`chip${mode === "plan" ? " is-on" : ""}`}
              aria-selected={mode === "plan"}
              onClick={() => setMode("plan")}
            >
              Plan
            </button>
            <button
              type="button"
              role="tab"
              className={`chip${mode === "ride" ? " is-on" : ""}`}
              aria-selected={mode === "ride"}
              onClick={() => setMode("ride")}
            >
              Ride
            </button>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void loadAnalysis({ refresh: true })}
            disabled={analyzing}
          >
            {analyzing ? "Analysing…" : "Refresh"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void onDelete()} disabled={busy}>
            Delete
          </button>
        </div>
      </header>

      <div className="ultra-page__hero">
        <p className="route-page__eyebrow">{mode === "ride" ? "Ride mode" : "Planned route"}</p>
        <label className="route-page__name-field">
          <span className="visually-hidden">Route name</span>
          <input
            className="route-page__name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            disabled={busy}
          />
        </label>
        <p className="ultra-page__range">
          {mode === "ride"
            ? "Nearest verified services ahead"
            : "Review the course, then verify stops one by one"}
        </p>
      </div>

      {mode === "ride" ? (
        <section className="ua-block ride-mode">
          <label className="field ride-mode__pos">
            <span>Your position · km {rideKm.toFixed(0)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, route.distanceKm)}
              step={1}
              value={rideKm}
              onChange={(e) => setRideKm(Number(e.target.value))}
            />
          </label>
          <div className="ride-glance">
            {(
              [
                ["Water", rideGlance.water],
                ["24h gas", rideGlance.gas24],
                ["Supermarket", rideGlance.supermarket],
                ["Pharmacy", rideGlance.pharmacy],
                ["Bike shop", rideGlance.bike],
              ] as const
            ).map(([label, stop]) => (
              <div className="ride-glance__row" key={label}>
                <span className="ride-glance__label">{label}</span>
                {stop ? (
                  <span className="ride-glance__val">
                    <strong>{(stop.distanceAlongKm - rideKm).toFixed(0)} km ahead</strong>
                    <span>
                      {stop.name || stop.category} · {stop.distanceOffRouteM} m off
                      {stop.openingHours ? ` · ${stop.openingHours}` : ""} · verified
                    </span>
                  </span>
                ) : (
                  <span className="ride-glance__val ride-glance__val--empty">None verified ahead</span>
                )}
              </div>
            ))}
          </div>
          <p className="space__hint">Verify stops in Plan first — Ride only shows what you confirmed.</p>
        </section>
      ) : (
        <>
          <div className="ultra-page__score">
            <ScoreLine
              distanceKm={route.distanceKm}
              elevationGainM={route.elevationGainM}
              durationS={0}
              hideDuration
            />
          </div>

          {analysis && (
            <nav className="plan-section-nav" aria-label="Planning sections">
              {PLAN_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`chip${planSection === s.id ? " is-on" : ""}`}
                  onClick={() => jumpToSection(s.id)}
                >
                  {s.label}
                  {s.id === "verify" && recommended.length > 0
                    ? ` · ${verifiedCount}/${recommended.length}`
                    : ""}
                </button>
              ))}
            </nav>
          )}

          {analyzing && !analysis && (
            <div className="space-loading space-loading--visual">
              <RydnLoader label="Analysing course…" />
            </div>
          )}

          {analysis && (
            <>
              {/* 1. Critical Decisions */}
              <section className="ua-block" id="critical">
                <h2 className="ua-block__title">Critical decisions</h2>
                <p className="ua-block__lead">
                  Moments where a rider can make a mistake. Tap one to inspect it on the map — or jump
                  straight into Verify for related stops.
                </p>
                {decisions.length === 0 ? (
                  <p className="space__hint">{empty?.decisions || "No critical decisions yet."}</p>
                ) : (
                  <div className="plan-list">
                    {decisions.map((d: CriticalDecision) => (
                      <button
                        type="button"
                        key={d.id}
                        className={`plan-row plan-row--click${selectedId === d.id || selectedId === d.relatedStopId ? " is-selected" : ""}`}
                        onClick={() => {
                          if (d.relatedStopId) openVerifyAt(d.relatedStopId);
                          else {
                            setSelectedId(d.id);
                            jumpToSection("map");
                          }
                        }}
                      >
                        <div className="plan-row__main">
                          <span className="plan-row__title">
                            {d.title}
                            {d.riskLevel ? <span className="plan-pill plan-pill--quiet">{d.riskLevel}</span> : null}
                          </span>
                          <span className="plan-row__meta">
                            km {d.km.toFixed(0)} · {d.detail}
                            {d.advice ? ` — ${d.advice}` : ""}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* 2. Interactive Map */}
              <section className="ua-block ua-block--map" id="map">
                <h2 className="ua-block__title">Route map</h2>
                <p className="ua-block__lead">
                  Tap a stop marker to open Verify. Climbs and remote gaps show a short peek below.
                </p>
                <RoutePreview
                  points={route.points}
                  markers={markers}
                  selectedId={selectedId}
                  onSelectMarker={onSelectMarker}
                />
                <div className="plan-filters plan-filters--map">
                  {(
                    [
                      ["all", "All"],
                      ["decisions", "Decisions"],
                      ["stops", "Stops"],
                      ["climbs", "Climbs"],
                      ["remote", "Remote"],
                      ["sleep", "Sleep"],
                      ["stages", "Stages"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`chip${mapFilter === id ? " is-on" : ""}`}
                      onClick={() => setMapFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {analysis.profile.length > 1 && (
                  <div className="route-elev-wrap">
                    <ElevSpark profile={analysis.profile} highlightKm={selectedKm} />
                  </div>
                )}

                {peek && (
                  <div className="plan-peek">
                    <div className="plan-peek__bar">
                      <button type="button" className="btn btn--ghost" onClick={() => setSelectedId(null)}>
                        Clear
                      </button>
                    </div>
                    {peek.kind === "climb" && (
                      <div className="plan-row plan-row--hard">
                        <div className="plan-row__main">
                          <span className="plan-row__title">
                            {peek.climb.name || `Climb · km ${peek.climb.startKm.toFixed(0)}`}
                            {peek.climb.difficultyLabel ? (
                              <span className="plan-pill">{peek.climb.difficultyLabel}</span>
                            ) : null}
                          </span>
                          <span className="plan-row__meta">
                            km {peek.climb.startKm.toFixed(0)}–{peek.climb.endKm.toFixed(0)} ·{" "}
                            {peek.climb.lengthKm.toFixed(1)} km · {peek.climb.elevationGainM} m · avg{" "}
                            {peek.climb.avgGradientPct}% · max {peek.climb.maxGradientPct ?? "—"}%
                            {peek.climb.estimatedClimbTimeS
                              ? ` · ~${fmtDuration(peek.climb.estimatedClimbTimeS)}`
                              : ""}
                          </span>
                        </div>
                      </div>
                    )}
                    {peek.kind === "remote" && (
                      <div className={`plan-row plan-row--risk-${peek.gap.riskLevel}`}>
                        <div className="plan-row__main">
                          <span className="plan-row__title">{peek.gap.label}</span>
                          <span className="plan-row__meta">
                            {peek.gap.preparation}
                            {peek.gap.estimatedRideTimeS
                              ? ` · ~${fmtDuration(peek.gap.estimatedRideTimeS)}`
                              : ""}
                          </span>
                        </div>
                      </div>
                    )}
                    {peek.kind === "decision" && (
                      <div className="plan-row">
                        <div className="plan-row__main">
                          <span className="plan-row__title">{peek.decision.title}</span>
                          <span className="plan-row__meta">
                            {peek.decision.detail} — {peek.decision.advice}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* 3. Recommended Stops */}
              <section className="ua-block" id="stops">
                <h2 className="ua-block__title">Recommended stops</h2>
                <p className="ua-block__lead">
                  {recommended.length
                    ? `${recommended.length} intentional stops · ${verifiedCount} verified · ${pendingCount} left to review. Tap any stop to open Verify.`
                    : empty?.stops || "No recommendations yet."}
                </p>
                <div className="plan-list plan-list--compact">
                  {recommended.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className={`plan-row plan-row--click plan-row--${s.reviewStatus}${
                        selectedId === s.id ? " is-selected" : ""
                      }`}
                      onClick={() => openVerifyAt(s.id)}
                    >
                      <div className="plan-row__main">
                        <span className="plan-row__title">
                          {s.name || s.category}
                          <span className="plan-pill plan-pill--quiet">{stars(s.qualityStars)}</span>
                          <span className="plan-pill plan-pill--quiet">{s.reviewStatus}</span>
                        </span>
                        <span className="plan-row__meta">
                          km {s.distanceAlongKm.toFixed(0)} · {s.category}
                          {s.is24h ? " · 24h" : ""} · {s.qualityLabel}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {/* 4. Major Climbs */}
              <section className="ua-block" id="climbs">
                <h2 className="ua-block__title">Major climbs</h2>
                <p className="ua-block__lead">Hardest efforts first — plan fuel and pacing around them.</p>
                {analysis.climbs.length === 0 ? (
                  <p className="space__hint">{empty?.climbs || "No significant climbs detected."}</p>
                ) : (
                  <div className="plan-list">
                    {analysis.climbs.map((c: RouteClimb) => (
                      <button
                        type="button"
                        key={c.id}
                        className={`plan-row plan-row--click${c.hard ? " plan-row--hard" : ""}${
                          selectedId === c.id ? " is-selected" : ""
                        }`}
                        onClick={() => {
                          setSelectedId(c.id);
                          jumpToSection("map");
                        }}
                      >
                        <div className="plan-row__main">
                          <span className="plan-row__title">
                            {c.name || `Climb · km ${c.startKm.toFixed(0)}`}
                            {c.hard ? <span className="plan-pill">Hardest</span> : null}
                            {c.difficultyLabel ? (
                              <span className="plan-pill plan-pill--quiet">
                                {c.difficultyLabel}
                                {c.difficultyScore != null ? ` ${c.difficultyScore}` : ""}
                              </span>
                            ) : null}
                          </span>
                          <span className="plan-row__meta">
                            km {c.startKm.toFixed(0)}–{c.endKm.toFixed(0)} · {c.lengthKm.toFixed(1)} km ·{" "}
                            {c.elevationGainM} m · avg {c.avgGradientPct}% · max {c.maxGradientPct ?? "—"}%
                            {c.estimatedClimbTimeS ? ` · ~${fmtDuration(c.estimatedClimbTimeS)}` : ""}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* 5. Remote */}
              <section className="ua-block" id="remote">
                <h2 className="ua-block__title">Remote sections</h2>
                <p className="ua-block__lead">Only gaps that actually need preparation (≥40 km without resupply).</p>
                {analysis.remoteGaps.length === 0 ? (
                  <p className="space__hint">{empty?.remote || "No meaningful remote sections."}</p>
                ) : (
                  <div className="plan-list">
                    {analysis.remoteGaps.map((g) => (
                      <button
                        type="button"
                        key={g.id}
                        className={`plan-row plan-row--click plan-row--risk-${g.riskLevel}${
                          selectedId === g.id ? " is-selected" : ""
                        }`}
                        onClick={() => {
                          setSelectedId(g.id);
                          jumpToSection("map");
                        }}
                      >
                        <div className="plan-row__main">
                          <span className="plan-row__title">{g.label}</span>
                          <span className="plan-row__meta">
                            Risk: {g.riskLevel}
                            {g.estimatedRideTimeS ? ` · ~${fmtDuration(g.estimatedRideTimeS)}` : ""}
                            {g.preparation ? ` — ${g.preparation}` : ""}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* 6. Stages */}
              <section className="ua-block" id="stages">
                <h2 className="ua-block__title">Stage plan</h2>
                <p className="ua-block__lead">
                  Optimised for sleep, resupply, and hard climbs — distance is only one factor.
                </p>
                <div className="plan-stage-controls">
                  <label className="field">
                    <span>Target km / day</span>
                    <input
                      type="number"
                      min={60}
                      max={400}
                      step={10}
                      value={targetKm}
                      onChange={(e) => setTargetKm(Number(e.target.value) || 250)}
                      disabled={analyzing}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={analyzing}
                    onClick={() => void loadAnalysis({ targetStageKm: targetKm })}
                  >
                    Recalculate
                  </button>
                </div>
                <div className="plan-list">
                  {analysis.stages.map((s) => (
                    <div className="plan-row" key={s.index}>
                      <div className="plan-row__main">
                        <span className="plan-row__title">
                          {s.label}
                          <span className="plan-pill plan-pill--quiet">{s.distanceKm} km</span>
                        </span>
                        <span className="plan-row__meta">
                          km {s.startKm.toFixed(0)}–{s.endKm.toFixed(0)} ·{" "}
                          {s.elevationGainM.toLocaleString("en-US")} m · {s.reason}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 7. Verify — in-page deck, no modal */}
              <section className="ua-block route-page__verify-deck" id="verify">
                <h2 className="ua-block__title">Verify</h2>
                <p className="ua-block__lead">
                  One recommendation at a time. Map stays with you — swipe or use Next to move through the
                  deck.
                </p>
                {recommended.length === 0 ? (
                  <p className="space__hint">{empty?.stops || "No recommendations to verify yet."}</p>
                ) : (
                  <>
                    <div className="verify-progress">
                      <div className="verify-progress__track">
                        <div
                          className="verify-progress__bar"
                          style={{
                            width: `${recommended.length ? (verifiedCount / recommended.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <p className="verify-progress__label">
                        {verifiedCount} verified · {pendingCount} remaining ·{" "}
                        {recommended.filter((s) => s.reviewStatus === "rejected").length} rejected
                      </p>
                    </div>

                    <div className="verify-map">
                      <button
                        type="button"
                        className="verify-map__toggle"
                        onClick={() => setVerifyMapOpen((o) => !o)}
                        aria-expanded={verifyMapOpen}
                      >
                        {verifyMapOpen ? "Hide map" : "Show map"}
                      </button>
                      {verifyMapOpen && (
                        <>
                          <RoutePreview
                            points={route.points}
                            markers={markers}
                            selectedId={verifyStop?.id || selectedId}
                            onSelectMarker={onSelectMarker}
                          />
                          {analysis.profile.length > 1 && (
                            <div className="route-elev-wrap">
                              <ElevSpark
                                profile={analysis.profile}
                                highlightKm={verifyStop?.distanceAlongKm ?? null}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {verifyStop && (
                      <VerifyStopCard
                        stop={verifyStop}
                        index={Math.min(verifyIndex, recommended.length - 1)}
                        total={recommended.length}
                        busy={busy}
                        onReview={(status) => void reviewStop(verifyStop.id, status)}
                        onPrev={() => {
                          const next = Math.max(0, verifyIndex - 1);
                          setVerifyIndex(next);
                          setSelectedId(recommended[next]?.id ?? null);
                        }}
                        onNext={() => {
                          const next = Math.min(recommended.length - 1, verifyIndex + 1);
                          setVerifyIndex(next);
                          setSelectedId(recommended[next]?.id ?? null);
                        }}
                      />
                    )}
                  </>
                )}
              </section>

              {/* 8. Weather */}
              {weather?.hasDecisionWeather && weather.decisionAlerts && weather.decisionAlerts.length > 0 && (
                <section className="ua-block" id="weather">
                  <h2 className="ua-block__title">Weather</h2>
                  <p className="ua-block__lead">Only days that change decisions.</p>
                  <div className="plan-list plan-list--compact">
                    {weather.decisionAlerts.map((d) => (
                      <div className="plan-row" key={d.date}>
                        <div className="plan-row__main">
                          <span className="plan-row__title">
                            {d.date}
                            <span className="plan-pill">{(d.decisionReasons || []).join(" · ")}</span>
                          </span>
                          <span className="plan-row__meta">
                            {d.tempMinC != null && d.tempMaxC != null
                              ? `${Math.round(d.tempMinC)}–${Math.round(d.tempMaxC)}°C`
                              : ""}
                            {d.precipMm != null ? ` · ${d.precipMm} mm` : ""}
                            {d.windMaxKmh != null ? ` · wind ${Math.round(d.windMaxKmh)} km/h` : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 9. Notes */}
              <section className="ua-block" id="notes">
                <h2 className="ua-block__title">Manual notes</h2>
                <div className="plan-dates">
                  <label className="field">
                    <span>Start</span>
                    <input
                      type="date"
                      value={dateStart}
                      onChange={(e) => setDateStart(e.target.value)}
                      onBlur={() => void saveDates()}
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span>End</span>
                    <input
                      type="date"
                      value={dateEnd}
                      onChange={(e) => setDateEnd(e.target.value)}
                      onBlur={() => void saveDates()}
                      disabled={busy}
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="visually-hidden">Notes</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => void saveNotes()}
                    placeholder="Hotel bookings, customs, shops you already trust…"
                    rows={4}
                    disabled={busy}
                  />
                </label>
              </section>

              {/* 10. Checklist */}
              <section className="ua-block route-page__verify">
                <h2 className="ua-block__title">Preparation checklist</h2>
                <p className="ua-block__lead">
                  Confirm you reviewed RYDN’s suggestions. {done}/{CHECKS.length}.
                </p>
                <ul className="verify-list">
                  {CHECKS.map((c) => (
                    <li key={c.key}>
                      <label className={`verify-row${prep[c.key] ? " is-done" : ""}`}>
                        <input
                          type="checkbox"
                          checked={!!prep[c.key]}
                          disabled={busy}
                          onChange={() => void toggleCheck(c.key)}
                        />
                        <span>
                          <span className="verify-row__label">{c.label}</span>
                          <span className="verify-row__hint">{c.doneHint(analysis)}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}

      {error && <div className="banner banner--err">{error}</div>}
    </div>
  );
}
