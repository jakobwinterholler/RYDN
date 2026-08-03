import type { PlannedRouteSummary, Ultra } from "../../types";
import ScoreLine from "../ui/ScoreLine";
import UltraCard from "../UltraCard";
import { RydnPlanIcon } from "../plan/icons";

export function PlanningSpace({
  upcoming,
  routes,
  onOpenUltra,
  onOpenRoute,
  onImportRoute,
  canImportPlanned = true,
}: {
  upcoming: Ultra[];
  routes: PlannedRouteSummary[];
  onOpenUltra: (id: string) => void;
  onOpenRoute: (id: string) => void;
  onImportRoute: () => void;
  canImportPlanned?: boolean;
}) {
  const empty = upcoming.length === 0 && routes.length === 0;
  const lock = !canImportPlanned ? (
    <span className="btn__lock" aria-hidden>
      Pro
    </span>
  ) : null;

  return (
    <div className="space">
      <header className="space__head">
        <h1 className="space__title">Planning</h1>
        <div className="space__actions">
          <button type="button" className="btn btn--secondary" onClick={onImportRoute}>
            Import GPX{lock}
          </button>
        </div>
      </header>

      {empty ? (
        <p className="space__hint">Import a planned route GPX to start building your resupply plan.</p>
      ) : (
        <section className="space__section">
          {routes.length > 0 && (
            <div className="route-list">
              {routes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="route-card"
                  onClick={() => onOpenRoute(r.id)}
                >
                  <div className="route-card__eyebrow">Planned route</div>
                  <div className="route-card__title">{r.name}</div>
                  <ScoreLine
                    className="route-card__score"
                    distanceKm={r.distanceKm}
                    elevationGainM={r.elevationGainM}
                    durationS={0}
                    hideDuration
                  />
                  <div className="route-card__meta route-card__meta--counts">
                    {r.verifiedCounts &&
                    (r.verifiedCounts.water > 0 || r.verifiedCounts.shop > 0) ? (
                      <span className="route-card__verified" aria-label="Verified stops">
                        <span className="route-card__vchip" title="Verified water">
                          <RydnPlanIcon id="waterFountain" size={14} />
                          {r.verifiedCounts.water}
                        </span>
                        <span className="route-card__vchip" title="Verified shops">
                          <RydnPlanIcon id="supermarket" size={14} />
                          {r.verifiedCounts.shop}
                        </span>
                      </span>
                    ) : r.verifiedCounts && r.verifiedCounts.total > 0 ? (
                      <span>{r.verifiedCounts.total} verified</span>
                    ) : (
                      <span>Verify water &amp; shops</span>
                    )}
                    {r.status === "ready" ? (
                      <span className="route-card__ready">Ready</span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="ultra-grid" style={{ marginTop: routes.length ? 16 : 0 }}>
              {upcoming.map((u) => (
                <UltraCard key={u.id} ultra={u} onOpen={onOpenUltra} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
