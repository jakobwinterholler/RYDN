import { useMemo } from "react";
import type { RoadbookResult } from "../api";
import ExportSection from "../components/ExportSection";
import { formatKm } from "../components/routeInsights";
import { useRace } from "../races/RaceContext";

interface ExportPageProps {
  result: RoadbookResult;
  raceId: string;
}

/** Answers one question: "Is my device ready?" — send the route to a GPS device. */
export default function ExportPage({ result, raceId }: ExportPageProps) {
  const { activeRace, refreshRaces, verifiedStops } = useRace();

  const verifiedCount = useMemo(
    () => Object.values(verifiedStops).filter((record) => record.status === "verified").length,
    [verifiedStops],
  );
  const suggestedCount = result.resupply_zones.length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Export</h1>
        <p className="mt-2 text-base text-muted">Is my device ready?</p>
      </header>

      <section className="mb-8 rounded-2xl border border-line bg-card p-6 shadow-card">
        <p className="text-lg font-medium tracking-tight text-ink">{result.summary.route_name}</p>
        <p className="mt-1 text-sm text-muted">
          {formatKm(result.summary.distance_km, 0)}
          <span className="mx-2 text-line">·</span>
          +{Math.round(result.summary.elevation_gain_m)} m
          <span className="mx-2 text-line">·</span>
          {verifiedCount} of {suggestedCount} stops verified
        </p>
      </section>

      <ExportSection
        raceId={raceId}
        raceName={activeRace?.name ?? "race"}
        result={result}
        verifiedStops={verifiedStops}
        onExported={() => void refreshRaces()}
      />
    </div>
  );
}
