import { useEffect, useRef, useState, type RefObject } from "react";
import type { Ultra } from "../types";
import { selectTripBadges } from "../trips/badges";
import { normalizeUltraKind, ultraKindLabel, type UltraKind } from "../trips/kind";
import { acquirePaintSlot } from "../trips/paintGate";
import { flagFromCode } from "./ui/countries";
import Icon, { type IconName } from "./ui/Icon";
import RoutePreview from "./ui/RoutePreview";
import ScoreLine from "./ui/ScoreLine";
import { cleanUltraTitle } from "./ui/titles";

interface Props {
  ultra: Ultra;
  onOpen: (ultraId: string) => void;
  /** Show map thumb + traits (Trips shelf). Planning cards stay compact. */
  showShelfExtras?: boolean;
}

function countryCodesOf(ultra: Ultra): string[] {
  if (ultra.countryCodes && ultra.countryCodes.length > 0) {
    return ultra.countryCodes.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  }
  if (ultra.countryCode && /^[A-Za-z]{2}$/.test(ultra.countryCode)) {
    return [ultra.countryCode.toUpperCase()];
  }
  return [];
}

function resultOf(ultra: Ultra): string | null {
  const r = (ultra.result || ultra.finishPlace || "").trim();
  return r || null;
}

function kindIcon(kind: UltraKind): IconName {
  if (kind === "bikepacking") return "tent";
  if (kind === "race") return "trophy";
  return "road";
}

function fallbackIcon(ultra: Ultra): IconName {
  const kind = normalizeUltraKind(ultra.kind);
  if (kind === "bikepacking" || kind === "race") return kindIcon(kind);
  if (ultra.area === "planning" || ultra.status === "draft" || ultra.status === "planning") return "mountain";
  if ((ultra.elevationGainM || 0) >= 8000) return "summit";
  return "road";
}

/** Preload thumbs before they enter the viewport (year-grouped oldest sit at bottom). */
const THUMB_ROOT_MARGIN = "640px 0px";
/** Never hold a paint slot forever — release after ready or this safety timeout. */
const PAINT_SLOT_TIMEOUT_MS = 3500;

function useLazyVisible(rootMargin = THUMB_ROOT_MARGIN): [RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null!);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return [ref, visible];
}

function CardThumb({ ultra, codes }: { ultra: Ultra; codes: string[] }) {
  const [hostRef, inView] = useLazyVisible();
  const [canPaint, setCanPaint] = useState(false);
  const points = ultra.previewPoints;
  const releaseRef = useRef<(() => void) | null>(null);
  const onMapReady = useRef(() => {
    const rel = releaseRef.current;
    if (!rel) return;
    releaseRef.current = null;
    rel();
  }).current;

  const pointsLen = Array.isArray(points) ? points.length : 0;

  useEffect(() => {
    if (!inView || pointsLen < 2) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void acquirePaintSlot().then((rel) => {
      if (cancelled) {
        rel();
        return;
      }
      releaseRef.current = rel;
      setCanPaint(true);
      // Safety: if RoutePreview never settles, free the queue for older cards.
      timer = setTimeout(() => {
        onMapReady();
      }, PAINT_SLOT_TIMEOUT_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      const rel = releaseRef.current;
      releaseRef.current = null;
      rel?.();
      setCanPaint(false);
    };
  }, [inView, pointsLen, onMapReady, ultra.id]);

  const hasGps = pointsLen >= 2;
  const flags = codes.map(flagFromCode).filter(Boolean);

  return (
    <div ref={hostRef} className="ultra-card__media" aria-hidden={!hasGps || undefined}>
      <div className="ultra-card__thumb">
        {!hasGps && (
          <div className="ultra-card__thumb-fallback">
            <Icon name={fallbackIcon(ultra)} size={22} weight="medium" />
          </div>
        )}
        {hasGps && (!inView || !canPaint) && <div className="ultra-card__thumb-skel skeleton skeleton--block" />}
        {hasGps && inView && canPaint && (
          <RoutePreview
            className="ultra-card__map"
            points={points}
            variant="thumb"
            countryCount={Math.max(codes.length, 1)}
            distanceKm={ultra.distanceKm || 0}
            onReady={onMapReady}
          />
        )}
      </div>
      {/* Flags live in chrome below the map — never over the polyline. */}
      {flags.length > 0 && (
        <div className="ultra-card__geo" aria-label={`Countries: ${codes.join(", ")}`}>
          {flags.map((f, i) => (
            <span key={codes[i]} className="ultra-card__flag" title={codes[i]}>
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cabinet collectible — map = where, kind = what, traits = character, metrics clean. */
export default function UltraCard({ ultra, onOpen, showShelfExtras = false }: Props) {
  const codes = countryCodesOf(ultra);
  const kind = normalizeUltraKind(ultra.kind);
  const kindLabel = ultraKindLabel(kind);
  const result = kind === "race" ? resultOf(ultra) : null;
  const title = cleanUltraTitle(ultra.name);
  const year = ultra.year;
  const traits = showShelfExtras ? selectTripBadges(ultra, 3) : [];

  return (
    <button
      type="button"
      className={`ultra-card${showShelfExtras ? " ultra-card--shelf" : ""}`}
      onClick={() => onOpen(ultra.id)}
      aria-label={`${title}${year ? `, ${year}` : ""}, ${kindLabel}`}
    >
      {showShelfExtras && <CardThumb ultra={ultra} codes={codes} />}

      {!showShelfExtras && (
        <div className="ultra-card__topline">
          <span className="ultra-card__mark" aria-hidden="true">
            <Icon name={fallbackIcon(ultra)} size={20} weight="semibold" />
          </span>
          {year != null && <span className="ultra-card__year">{year}</span>}
        </div>
      )}

      {showShelfExtras ? (
        <div className="ultra-card__body">
          <div className="ultra-card__identity">
            <span className="ultra-card__kind" data-kind={kind}>
              <Icon name={kindIcon(kind)} size={13} weight="semibold" />
              {kindLabel}
            </span>
            {year != null && <span className="ultra-card__year">{year}</span>}
          </div>

          <h2 className="ultra-card__title">{title}</h2>

          {result && <p className="ultra-card__result">{result}</p>}

          {traits.length > 0 && (
            <ul className="ultra-card__traits" aria-label="Route character">
              {traits.map((b) => (
                <li key={b.id} className="ultra-card__trait" title={b.label}>
                  <Icon name={b.icon} size={12} weight="medium" />
                  <span>{b.label}</span>
                </li>
              ))}
            </ul>
          )}

          <ScoreLine
            className="ultra-card__score"
            distanceKm={ultra.distanceKm}
            elevationGainM={ultra.elevationGainM}
            durationS={ultra.durationS}
          />
        </div>
      ) : (
        <>
          <h2 className="ultra-card__title">{title}</h2>
          {(codes.length > 0 || result) && (
            <div className="ultra-card__sub">
              {codes.length > 0 && (
                <div className="ultra-card__flags" aria-label={`Countries: ${codes.join(", ")}`}>
                  {codes.map((c) => {
                    const f = flagFromCode(c);
                    return f ? (
                      <span key={c} className="ultra-card__flag" title={c}>
                        {f}
                      </span>
                    ) : null;
                  })}
                </div>
              )}
              {result && <span className="ultra-card__result">{result}</span>}
            </div>
          )}
          <ScoreLine
            className="ultra-card__score"
            distanceKm={ultra.distanceKm}
            elevationGainM={ultra.elevationGainM}
            durationS={ultra.durationS}
          />
        </>
      )}
    </button>
  );
}
