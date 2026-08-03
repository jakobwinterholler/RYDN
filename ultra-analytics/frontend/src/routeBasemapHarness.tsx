/** Visual QA — Bavaria-class inland loop on the local share basemap. */
import { createRoot } from "react-dom/client";
import RoutePreview from "./components/ui/RoutePreview";
import "./styles.css";

/** Rough ~90 km loop south-west of Munich (Ammersee / Starnberg corridor). */
function bavariaLoop(): number[][] {
  const pts: number[][] = [];
  const ring: [number, number][] = [
    [48.14, 11.28],
    [48.18, 11.22],
    [48.22, 11.15],
    [48.2, 11.05],
    [48.14, 11.0],
    [48.08, 11.02],
    [48.02, 11.08],
    [47.98, 11.18],
    [48.0, 11.28],
    [48.06, 11.35],
    [48.12, 11.32],
    [48.14, 11.28],
  ];
  for (let i = 0; i < ring.length - 1; i++) {
    const [aLat, aLon] = ring[i];
    const [bLat, bLon] = ring[i + 1];
    for (let s = 0; s < 18; s++) {
      const t = s / 18;
      pts.push([aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t]);
    }
  }
  pts.push(ring[ring.length - 1]);
  return pts;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <div style={{ maxWidth: 420, margin: "24px auto", padding: 16 }}>
      <p style={{ fontFamily: "Georgia, serif", marginBottom: 12 }}>Share basemap QA — Bavaria loop</p>
      <RoutePreview className="ride-share__map" points={bavariaLoop()} variant="detail" reveal={false} />
    </div>,
  );
}
