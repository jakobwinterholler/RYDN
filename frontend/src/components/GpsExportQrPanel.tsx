import { useEffect, useRef } from "react";
import { companionGpxExportUrl } from "../lib/companionUrl";

interface GpsExportQrPanelProps {
  raceId: string;
  raceName: string;
  device?: "coros" | "garmin" | "wahoo";
}

export default function GpsExportQrPanel({
  raceId,
  raceName,
  device = "coros",
}: GpsExportQrPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exportUrl = companionGpxExportUrl(raceId, device);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then((QRCode) => {
      if (cancelled || !canvasRef.current) {
        return;
      }
      void QRCode.toCanvas(canvasRef.current, exportUrl, {
        width: 200,
        margin: 2,
        color: { dark: "#111111", light: "#ffffff" },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [exportUrl]);

  return (
    <div className="mt-4 rounded-xl border border-line bg-canvas px-4 py-4">
      <p className="text-sm font-semibold text-ink">Open on iPhone</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Scan with your iPhone camera to open <span className="font-medium text-ink">{raceName}</span>{" "}
        in Companion, then share the GPX to Coros.
      </p>
      <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <canvas ref={canvasRef} className="rounded-lg border border-line bg-white" aria-hidden />
        <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
          <li>Scan QR code with iPhone Camera</li>
          <li>Open in Companion (Safari or installed app)</li>
          <li>Tap Share GPX → Coros</li>
        </ol>
      </div>
      <a
        href={exportUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block truncate text-xs text-accent underline-offset-2 hover:underline"
      >
        {exportUrl}
      </a>
    </div>
  );
}
