import { useState } from "react";
import { computeStopConfidence, stopConfidenceBadgeClass } from "@shared/race/stopConfidence";
import { formatStopDistanceM } from "@shared/race/sortVerificationQueue";
import { haversineM } from "@shared/race/mapMatching";
import type { CompanionVerificationServices, CompanionVerificationUpdates } from "@shared/types/verification";
import type { CompanionStop } from "../types";
import { formatKm, googleMapsUrl } from "../lib/utils";
import { useStreetViewLink } from "@shared/race/useStreetViewLink";
import { serviceLabels, isVerifiedEverywhere, isVerifiedLocally, stopStatusLabel } from "../lib/raceExecution";
import { haptic } from "../lib/haptics";
import BottomSheet from "./BottomSheet";

/** Matches BottomSheet's exit duration so the parent unmounts after the slide-out. */
const CLOSE_ANIM_MS = 300;

interface StopDetailSheetProps {
  stop: CompanionStop;
  totalKm: number;
  gpsLat?: number | null;
  gpsLon?: number | null;
  routeCoordinates?: [number, number][];
  editable?: boolean;
  onClose: () => void;
  onVerify?: (updates: CompanionVerificationUpdates) => void;
  onReject?: () => void;
  onStartVerify?: () => void;
}

const SERVICE_FIELDS: { key: keyof CompanionVerificationServices; label: string }[] = [
  { key: "hasWater", label: "Water" },
  { key: "hasFood", label: "Food" },
  { key: "hasCoffee", label: "Coffee" },
  { key: "hasFuel", label: "Fuel" },
  { key: "hasToilet", label: "Toilet" },
  { key: "cardPayment", label: "Card payment" },
  { key: "bikeVisible", label: "Bike visible" },
];

function formatVerifiedDate(value: string | null | undefined): string {
  if (!value) {
    return "Never verified";
  }
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function StopDetailSheet({
  stop,
  totalKm,
  gpsLat = null,
  gpsLon = null,
  routeCoordinates,
  editable = false,
  onClose,
  onVerify,
  onReject,
  onStartVerify,
}: StopDetailSheetProps) {
  const [open, setOpen] = useState(true);
  const isVerified = isVerifiedEverywhere(stop.verificationStatus);
  const isPending = isVerifiedLocally(stop.verificationStatus);

  function requestClose() {
    setOpen(false);
    window.setTimeout(onClose, CLOSE_ANIM_MS);
  }
  const streetViewOptions = routeCoordinates
    ? { routeCoordinates, totalDistanceKm: totalKm }
    : undefined;
  const streetView = useStreetViewLink(
    {
      lat: stop.lat,
      lon: stop.lon,
      placeId: stop.placeId,
      routeKm: stop.km,
      name: stop.name,
    },
    streetViewOptions,
  );
  const confidence = computeStopConfidence({
    verificationStatus: stop.verificationStatus,
    verifiedAt: stop.verificationDate,
    poiScore: stop.confidenceScore,
    openingHours: stop.openingHours,
    website: stop.website,
    phone: stop.phone,
  });

  const distanceLabel =
    gpsLat != null && gpsLon != null
      ? formatStopDistanceM(haversineM(gpsLat, gpsLon, stop.lat, stop.lon))
      : null;

  const [openingHours, setOpeningHours] = useState(stop.openingHours ?? "");
  const [notes, setNotes] = useState(stop.notes ?? "");
  const [services, setServices] = useState<CompanionVerificationServices>(() => ({
    hasWater: stop.hasWater || undefined,
    hasFood: stop.hasFood || undefined,
    hasFuel: stop.hasFuel || undefined,
    hasCoffee: stop.hasCoffee || undefined,
  }));

  function toggleService(key: keyof CompanionVerificationServices) {
    setServices((prev) => ({
      ...prev,
      [key]: prev[key] ? undefined : true,
    }));
  }

  function submitVerified() {
    haptic("success");
    onVerify?.({
      status: "verified",
      services,
      openingHours: openingHours.trim() || stop.openingHours,
      notes: notes.trim() || null,
      category: stop.category,
    });
  }

  return (
    <BottomSheet open={open} onClose={requestClose}>
      <div className="space-y-4 pb-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-300">
            {stop.categoryLabel}
          </p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight text-white">
            {stop.icon} {stop.name}
          </h2>
          {distanceLabel ? <p className="mt-1 text-sm text-sky-200">{distanceLabel}</p> : null}
        </div>

        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-10 text-center">
          <span className="text-5xl leading-none" aria-hidden>
            {stop.icon}
          </span>
          <p className="mt-2 text-sm text-white/45">{stop.categoryLabel}</p>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-white/40">From start</dt>
            <dd className="tabular-nums text-white/90">{formatKm(stop.km)}</dd>
          </div>
          <div>
            <dt className="text-xs text-white/40">To finish</dt>
            <dd className="tabular-nums text-white/90">{formatKm(Math.max(0, totalKm - stop.km))}</dd>
          </div>
          <div>
            <dt className="text-xs text-white/40">Confidence</dt>
            <dd>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${stopConfidenceBadgeClass(confidence.level, true)}`}
              >
                {confidence.label} ({confidence.score})
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-white/40">Status</dt>
            <dd className="text-white/90">{stopStatusLabel(stop.verificationStatus)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-white/40">Last verified</dt>
            <dd className="text-white/90">{formatVerifiedDate(stop.verificationDate)}</dd>
          </div>
        </dl>

        {editable ? (
          <>
            <label className="block">
              <span className="text-xs text-white/40">Opening hours</span>
              <input
                type="text"
                value={openingHours}
                onChange={(event) => setOpeningHours(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-400/50"
              />
            </label>

            <div>
              <p className="text-xs text-white/40">Services</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SERVICE_FIELDS.map((field) => (
                  <button
                    key={field.key}
                    type="button"
                    onClick={() => toggleService(field.key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      services[field.key]
                        ? "bg-orange-500/25 text-orange-100 ring-1 ring-orange-400/40"
                        : "bg-white/8 text-white/60"
                    }`}
                  >
                    {field.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-xs text-white/40">Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-orange-400/50"
              />
            </label>
          </>
        ) : (
          <>
            <div>
              <p className="text-xs text-white/40">Opening hours</p>
              <p className="mt-1 text-sm text-white/90">{stop.openingHours ?? "Unknown"}</p>
            </div>
            <div>
              <p className="text-xs text-white/40">Services</p>
              <p className="mt-1 text-sm text-white/90">{serviceLabels(stop)}</p>
            </div>
            {stop.notes ? (
              <div>
                <p className="text-xs text-white/40">Notes</p>
                <p className="mt-1 text-sm text-white/80">{stop.notes}</p>
              </div>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <a
            href={googleMapsUrl(stop.lat, stop.lon, stop.placeId)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
          >
            Google Maps
          </a>
          {streetView.available === false ? (
            <div className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/60">
              <span>{streetView.unavailableMessage}</span>
              <a
                href={streetView.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-2 font-medium text-sky-300 underline"
              >
                Google Maps
              </a>
            </div>
          ) : (
            <a
              href={streetView.streetViewUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white"
            >
              {streetView.loading ? "Street View…" : "Street View"}
            </a>
          )}
          {stop.website ? (
            <a
              href={stop.website}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white"
            >
              Website
            </a>
          ) : null}
          {stop.phone ? (
            <a
              href={`tel:${stop.phone}`}
              className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white"
            >
              {stop.phone}
            </a>
          ) : null}
        </div>

        {isVerified ? (
          <p className="pt-1 text-center text-sm text-emerald-300/90">Verified everywhere</p>
        ) : isPending ? (
          <p className="pt-1 text-center text-sm text-sky-200/90">✓ Verified on this device</p>
        ) : editable && onVerify && onReject ? (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                haptic("light");
                onReject?.();
              }}
              className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-4 text-sm font-semibold text-red-200 transition active:scale-[0.98]"
            >
              Needs review
            </button>
            <button
              type="button"
              onClick={submitVerified}
              className="rounded-2xl bg-orange-500 px-4 py-4 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition active:scale-[0.98]"
            >
              Submit verified
            </button>
          </div>
        ) : onStartVerify ? (
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              onStartVerify();
            }}
            className="w-full rounded-2xl bg-orange-500 px-4 py-4 text-base font-semibold text-white shadow-lg shadow-orange-500/25 transition active:scale-[0.98]"
          >
            Verify this stop
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
}
