import { useMemo } from "react";
import type { ResupplyZone, RouteVisualization } from "../../api";
import type { UnsupportedSection } from "../../planning/unsupportedSections";
import {
  availabilityLabel,
  riskTierForSection,
  zoneHasReliableFood,
  zoneHasReliableWater,
} from "../../planning/unsupportedSections";
import RouteContextMiniMap from "../planning/RouteContextMiniMap";

interface SectionStopRow {
  zone: ResupplyZone;
  hiddenFromPlanning: boolean;
  reliableFood: boolean;
  reliableWater: boolean;
}

interface UnsupportedSectionDetailContentProps {
  section: UnsupportedSection;
  route: RouteVisualization;
  allZones: ResupplyZone[];
  suggestedStopIds: Set<number>;
}

function stopLabel(stop: { name: string; km: number } | null, fallback: string): string {
  if (!stop) {
    return fallback;
  }
  return `${stop.name} · km ${Math.round(stop.km)}`;
}

export default function UnsupportedSectionDetailContent({
  section,
  route,
  allZones,
  suggestedStopIds,
}: UnsupportedSectionDetailContentProps) {
  const tier = riskTierForSection(section);

  const stopsInside = useMemo<SectionStopRow[]>(() => {
    return allZones
      .filter(
        (zone) =>
          zone.distance_along_km > section.startKm && zone.distance_along_km < section.endKm,
      )
      .sort((left, right) => left.distance_along_km - right.distance_along_km)
      .map((zone) => ({
        zone,
        hiddenFromPlanning: !suggestedStopIds.has(zone.zone_id),
        reliableFood: zoneHasReliableFood(zone),
        reliableWater: zoneHasReliableWater(zone),
      }));
  }, [allZones, suggestedStopIds, section.endKm, section.startKm]);

  const mapMarkers = useMemo(() => {
    const markers = [];
    const before = section.reliableWaterBefore ?? section.stopBefore;
    const after = section.reliableWaterAfter ?? section.stopAfter;

    if (before) {
      const zone = allZones.find((item) => item.zone_id === before.zoneId);
      if (zone) {
        markers.push({ lat: zone.lat, lon: zone.lon, emoji: "✅", label: before.name });
      }
    }
    if (after) {
      const zone = allZones.find((item) => item.zone_id === after.zoneId);
      if (zone) {
        markers.push({ lat: zone.lat, lon: zone.lon, emoji: "✅", label: after.name });
      }
    }
    for (const stop of stopsInside) {
      markers.push({
        lat: stop.zone.lat,
        lon: stop.zone.lon,
        emoji: stop.hiddenFromPlanning ? "⚠️" : "📍",
        label: stop.zone.name,
        active: !stop.hiddenFromPlanning,
      });
    }
    return markers;
  }, [allZones, section, stopsInside]);

  return (
    <div className="space-y-5">
      <RouteContextMiniMap
        route={route}
        highlightRange={{ startKm: section.startKm, endKm: section.endKm }}
        markers={mapMarkers}
        fitToHighlight
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Distance</dt>
          <dd className="font-semibold tabular-nums text-ink">{section.distanceKm.toFixed(0)} km</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Elevation gain</dt>
          <dd className="font-semibold tabular-nums text-ink">
            +{section.elevationGainM.toLocaleString()} m
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Gravel</dt>
          <dd className="font-semibold tabular-nums text-ink">{section.gravelPct}%</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Risk</dt>
          <dd className="font-semibold text-ink">
            {tier.label} ({section.riskScore}/100)
          </dd>
        </div>
      </dl>

      <div className="space-y-3 rounded-xl bg-canvas/70 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Last reliable stop before
          </p>
          <p className="mt-1 text-sm font-medium text-ink">
            {stopLabel(
              section.reliableWaterBefore ?? section.reliableFoodBefore ?? section.stopBefore,
              "Route start",
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            First reliable stop after
          </p>
          <p className="mt-1 text-sm font-medium text-ink">
            {stopLabel(
              section.reliableWaterAfter ?? section.reliableFoodAfter ?? section.stopAfter,
              "Route finish",
            )}
          </p>
        </div>
      </div>

      {stopsInside.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Stops inside section
          </p>
          <ul className="mt-2 space-y-2">
            {stopsInside.map(({ zone, hiddenFromPlanning, reliableFood, reliableWater }) => (
              <li
                key={zone.zone_id}
                className="rounded-lg border border-line/60 bg-white px-3 py-2 text-sm"
              >
                <p className="font-medium text-ink">{zone.name}</p>
                <p className="mt-0.5 text-xs text-muted">
                  km {Math.round(zone.distance_along_km)}
                  <span className="mx-1.5 text-line">·</span>
                  Water: {reliableWater ? "Reliable" : "Limited"}
                  <span className="mx-1.5 text-line">·</span>
                  Food: {reliableFood ? "Reliable" : "Limited"}
                </p>
                {hiddenFromPlanning && (
                  <p className="mt-1 text-xs font-medium text-amber-800">
                    Hidden from planning view — still in full dataset
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {section.whyBadges.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Why this section is difficult
          </p>
          <ul className="mt-2 space-y-1.5">
            {section.whyBadges.map((badge) => (
              <li key={badge.id} className="text-sm font-medium text-ink">
                {badge.emoji} {badge.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs text-muted">
        <span>Water: {availabilityLabel(section.waterAvailability)}</span>
        <span>Food: {availabilityLabel(section.foodAvailability)}</span>
      </div>
    </div>
  );
}
