import type { Climb } from "../../types";
import { fmtDuration } from "../ui/format";

export default function ClimbsSection({
  data,
}: {
  data: {
    question: string;
    climbs: Climb[];
    count: number;
    pctClimbingOnFoot?: number;
    insight: string | null;
  };
}) {
  const onFoot = data.pctClimbingOnFoot ?? 0;
  return (
    <section className="section">
      <div className="section__q">{data.question}</div>
      <h2 className="section__title">Climbs</h2>
      {onFoot >= 0.5 && (
        <div className="climb-onfoot">
          {onFoot}% of your total climbing was earned on foot (hike-a-bike).
        </div>
      )}
      <div className="card">
        {data.climbs.length === 0 ? (
          <div className="empty">
            No climbs met the significance threshold on this day. Steeper sustained rises show up after
            elevation is present in the activity stream.
          </div>
        ) : (
          data.climbs.map((c) => (
            <div className="climb-row" key={c.index}>
              <div className={`climb-badge${c.costRank === 1 ? " top" : ""}`}>{c.index}</div>
              <div className="climb-main">
                <div className="climb-main__title">
                  km {c.startKm}–{c.endKm} · {c.lengthKm} km at {c.avgGradient}%
                  {c.costRank === 1 && <span className="pill pill--long">costliest</span>}
                  {c.hasHike && <span className="pill pill--hike">{c.walkedPct}% on foot</span>}
                </div>
                <div className="climb-main__sub">
                  {c.gainM} m gain · max {c.maxGradient}%
                  {c.vam ? ` · ${c.vam} m/h VAM` : ""}
                  {c.avgPower ? ` · ${c.avgPower} W` : ""}
                  {c.avgHr ? ` · ${c.avgHr} bpm` : ""}
                  {c.hasHike ? ` · ${c.rideableKm} km ridden / ${c.walkedKm} km walked` : ""}
                </div>
              </div>
              <div className="climb-stats">
                <div>
                  <b>{fmtDuration(c.timeS)}</b>
                </div>
                <div>#{c.costRank} by time</div>
              </div>
            </div>
          ))
        )}
      </div>
      {data.insight && <div className="insight">{data.insight}</div>}
    </section>
  );
}
