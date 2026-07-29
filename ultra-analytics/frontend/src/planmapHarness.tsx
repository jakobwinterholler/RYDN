/** Forensic harness: mount PlanMap with injected category markers. Not product UI. */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import PlanMap from "./components/plan/PlanMap";
import type { PlanMarker } from "./components/plan/planLayers";
import "./styles.css";

const MARKERS: PlanMarker[] = [
  {
    id: "area-node-water-1",
    lat: 48.137,
    lon: 11.575,
    kind: "area",
    group: "water",
    category: "Drinking water",
    status: "unreviewed",
    name: "Fountain",
    emphasize: true,
    distanceOffRouteM: 40,
  },
  {
    id: "area-node-market-1",
    lat: 48.138,
    lon: 11.576,
    kind: "area",
    group: "resupply",
    category: "Supermarket",
    status: "unreviewed",
    name: "REWE",
    emphasize: true,
    distanceOffRouteM: 60,
  },
  {
    id: "area-node-24h-1",
    lat: 48.136,
    lon: 11.574,
    kind: "area",
    group: "resupply",
    category: "24h Shop",
    status: "unreviewed",
    is24h: true,
    hasShop: true,
    name: "Shell Shop",
    emphasize: true,
    distanceOffRouteM: 80,
  },
  {
    id: "area-node-sleep-1",
    lat: 48.139,
    lon: 11.577,
    kind: "area",
    group: "sleep",
    category: "Hotel",
    status: "verified",
    name: "Hotel Test",
    emphasize: true,
    distanceOffRouteM: 100,
  },
];

const POINTS: number[][] = [
  [48.135, 11.573],
  [48.137, 11.575],
  [48.139, 11.577],
];

function Harness() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    (window as unknown as { __planMarkers: PlanMarker[] }).__planMarkers = MARKERS;
    // Expose map instance once PlanMap paints — poll canvas parent
    const t = window.setInterval(() => {
      const canvas = document.querySelector(".plan-map .maplibregl-canvas") as HTMLCanvasElement | null;
      if (!canvas) return;
      // MapLibre stores map on the container via internal; use global set by patched effect below
      const w = window as unknown as { __planMap?: unknown; __planMapReady?: boolean };
      if (w.__planMap) {
        w.__planMapReady = true;
        window.clearInterval(t);
      }
    }, 200);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <div
        style={{
          position: "absolute",
          zIndex: 20,
          top: 8,
          left: 8,
          background: "#fff",
          padding: "6px 10px",
          fontFamily: "system-ui",
          fontSize: 13,
        }}
        data-testid="selection"
      >
        selected: {selectedId || "(none)"}
      </div>
      <PlanMap
        points={POINTS}
        markers={MARKERS}
        selectedId={selectedId}
        fitKey="harness"
        focusIds={MARKERS.map((m) => m.id)}
        searching={false}
        onSelectMarker={(id) => {
          setSelectedId(id || null);
          (window as unknown as { __lastSelect?: string }).__lastSelect = id;
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
