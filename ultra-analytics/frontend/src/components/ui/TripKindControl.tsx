/** Segmented trip kind control — Race | Long ride | Bikepacking. */

import { ULTRA_KIND_OPTIONS, type UltraKind } from "../../trips/kind";

interface Props {
  value: UltraKind;
  onChange: (kind: UltraKind) => void;
  className?: string;
  id?: string;
}

export default function TripKindControl({ value, onChange, className = "", id }: Props) {
  return (
    <div
      id={id}
      className={`kind-toggle kind-toggle--secondary ${className}`.trim()}
      role="group"
      aria-label="Trip type"
    >
      {ULTRA_KIND_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={value === opt.id ? "active" : ""}
          aria-pressed={value === opt.id}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
