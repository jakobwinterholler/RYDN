import type { Ultra } from "../types";
import { flagFromCode } from "./ui/countries";
import Icon, { type IconName } from "./ui/Icon";
import ScoreLine from "./ui/ScoreLine";
import { cleanUltraTitle } from "./ui/titles";

interface Props {
  ultra: Ultra;
  onOpen: (ultraId: string) => void;
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

function identityIcon(ultra: Ultra): IconName {
  const result = (ultra.result || ultra.finishPlace || "").toLowerCase();
  if (result.includes("winner") || result === "1st" || result === "1") return "trophy";
  if (result.includes("dnf") || result.includes("dns")) return "flag";
  if (ultra.area === "planning" || ultra.status === "draft" || ultra.status === "planning") return "mountain";
  if ((ultra.elevationGainM || 0) >= 8000) return "summit";
  if ((ultra.distanceKm || 0) >= 1000) return "road";
  return "trophy";
}

/** Cabinet collectible — recognition first, denser shelf of expeditions. */
export default function UltraCard({ ultra, onOpen }: Props) {
  const codes = countryCodesOf(ultra);
  const flags = codes.map(flagFromCode).filter(Boolean);
  const result = resultOf(ultra);
  const title = cleanUltraTitle(ultra.name);
  const mark = identityIcon(ultra);
  const year = ultra.year;

  return (
    <button
      type="button"
      className="ultra-card"
      onClick={() => onOpen(ultra.id)}
      aria-label={`${title}${year ? `, ${year}` : ""}`}
    >
      <div className="ultra-card__topline">
        <span className="ultra-card__mark" aria-hidden="true">
          <Icon name={mark} size={20} weight="semibold" />
        </span>
        {year != null && <span className="ultra-card__year">{year}</span>}
      </div>

      <h2 className="ultra-card__title">{title}</h2>

      {(flags.length > 0 || result) && (
        <div className="ultra-card__sub">
          {flags.length > 0 && (
            <div className="ultra-card__flags" aria-label={`Countries: ${codes.join(", ")}`}>
              {flags.map((f, i) => (
                <span key={codes[i]} className="ultra-card__flag" title={codes[i]}>
                  {f}
                </span>
              ))}
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
    </button>
  );
}
