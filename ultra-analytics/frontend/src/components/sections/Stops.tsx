import type { ResupplyCadence, Stop } from "../../types";
import { fmtDuration } from "../ui/format";

const ICONS: Record<string, string> = {
  sleep: "😴",
  hotel: "🏨",
  scenic: "🏞️",
  restaurant: "🍽️",
  cafe: "☕",
  water: "💧",
  resupply: "🛒",
  supermarket: "🛒",
  "gas station": "⛽",
  mechanical: "🔧",
  traffic: "🚦",
  unknown: "❓",
};

const LABELS: Record<string, string> = {
  sleep: "Sleep",
  hotel: "Hotel / rest",
  scenic: "Scenic stop",
  restaurant: "Restaurant",
  cafe: "Café",
  water: "Water",
  resupply: "Resupply",
  supermarket: "Supermarket",
  "gas station": "Gas station",
  mechanical: "Mechanical",
  traffic: "Brief stop",
};

function label(stop: Stop): string {
  if (stop.category === "unknown") return "Unclassified stop";
  return LABELS[stop.category] ?? stop.category;
}

function confClass(c: number): string {
  if (c >= 0.75) return "high";
  if (c >= 0.5) return "medium";
  return "low";
}

export default function StopsSection({
  data,
}: {
  data: {
    question: string;
    stops: Stop[];
    count: number;
    totalStoppedS: number;
    insight: string | null;
    cadence: ResupplyCadence;
  };
}) {
  const cad = data.cadence;
  return (
    <section className="section">
      <div className="section__q">{data.question}</div>
      <h2 className="section__title">
        Stops <span style={{ color: "var(--text-faint)", fontSize: 16, fontWeight: 400 }}>
          · {data.count}, {fmtDuration(data.totalStoppedS)} total
        </span>
      </h2>

      {cad && cad.available && (
        <div className="cadence">
          <div className="cadence__label">Resupply cadence</div>
          <div className="cadence__stats">
            <div className="cadence__stat">
              <div className="cadence__val">
                {cad.avgDistanceKm}
                <span className="cadence__unit">km</span>
              </div>
              <div className="cadence__cap">avg between resupplies</div>
            </div>
            <div className="cadence__stat">
              <div className="cadence__val">
                {cad.avgGainM}
                <span className="cadence__unit">m</span>
              </div>
              <div className="cadence__cap">avg climbing between</div>
            </div>
            <div className="cadence__stat">
              <div className="cadence__val">{cad.resupplyCount}</div>
              <div className="cadence__cap">resupply stops</div>
            </div>
            {cad.briefBreaksExcluded > 0 && (
              <div className="cadence__stat">
                <div className="cadence__val cadence__val--muted">{cad.briefBreaksExcluded}</div>
                <div className="cadence__cap">brief breaks excluded</div>
              </div>
            )}
          </div>
          <div className="cadence__insight">{cad.insight}</div>
        </div>
      )}

      <div className="card">
        {data.stops.length === 0 ? (
          <div className="empty">
            No significant stops were classified. Short pauses under the detection threshold stay folded
            into moving time — longer rests appear here after analysis.
          </div>
        ) : (
          data.stops.map((s) => (
            <div className="stop-row" key={s.index}>
              <div className="stop-icon">{ICONS[s.category] ?? "❓"}</div>
              <div className="stop-main">
                <div className="stop-main__title">
                  {label(s)}
                  <span className={`pill pill--conf-${confClass(s.confidence)}`}>
                    {Math.round(s.confidence * 100)}% confident
                  </span>
                  {s.partOfDay === "night" && <span className="pill pill--night">night</span>}
                  {s.efficiency && (
                    <span className={`pill pill--${s.efficiency}`}>{s.efficiency}</span>
                  )}
                </div>
                <div className="stop-main__sub">
                  km {s.km} · at {s.atElapsed}
                </div>
                {s.reasons.length > 0 && (
                  <ul className="stop-reasons">
                    {s.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="stop-dur">
                <div className="stop-dur__t">{s.durationLabel}</div>
              </div>
            </div>
          ))
        )}
      </div>
      {data.insight && <div className="insight">{data.insight}</div>}
    </section>
  );
}
