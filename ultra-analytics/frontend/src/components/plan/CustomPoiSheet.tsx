/** Compact sheet — name + curated icon for a custom POI. */

import { useEffect, useId, useState } from "react";
import { RydnPlanIcon } from "./icons";
import {
  CUSTOM_POI_KINDS,
  type CustomPoiKind,
  sanitizeCustomName,
} from "./customPoi";

type Props = {
  mode: "create" | "edit";
  initialName?: string;
  initialKind?: CustomPoiKind;
  distanceOffRouteM?: number | null;
  distanceAlongKm?: number | null;
  saving?: boolean;
  onSave: (name: string, kind: CustomPoiKind) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onMove?: () => void;
};

export default function CustomPoiSheet({
  mode,
  initialName = "",
  initialKind = "checkpoint",
  distanceOffRouteM,
  distanceAlongKm,
  saving = false,
  onSave,
  onCancel,
  onDelete,
  onMove,
}: Props) {
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<CustomPoiKind>(initialKind);

  useEffect(() => {
    setName(initialName);
    setKind(initialKind);
  }, [initialName, initialKind]);

  const meta = CUSTOM_POI_KINDS.find((k) => k.kind === kind) || CUSTOM_POI_KINDS[0];
  const title = mode === "create" ? "Add custom POI" : "Edit custom POI";

  return (
    <div
      className="plan-sheet plan-sheet--compact plan-sheet--custom"
      role="dialog"
      aria-label={title}
      data-testid="custom-poi-sheet"
    >
      <div className="plan-sheet__handle" aria-hidden />
      <button
        type="button"
        className="plan-sheet__close"
        aria-label="Cancel"
        onClick={onCancel}
      >
        ×
      </button>

      <p className="plan-sheet__eyebrow">
        <span className="plan-sheet__cat-chip" aria-hidden>
          <RydnPlanIcon id={meta.icon} size={14} className="plan-sheet__eyebrow-icon" />
        </span>
        Custom · {meta.label}
      </p>
      <h2 className="plan-sheet__title">{title}</h2>
      <p className="plan-sheet__rating">
        {[
          distanceAlongKm != null && Number.isFinite(distanceAlongKm)
            ? `km ${distanceAlongKm.toFixed(0)}`
            : null,
          distanceOffRouteM != null
            ? distanceOffRouteM <= 25
              ? "On route"
              : `${distanceOffRouteM} m off route`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <label className="plan-custom__label" htmlFor={nameId}>
        Name
      </label>
      <input
        id={nameId}
        className="plan-custom__input"
        type="text"
        maxLength={80}
        placeholder={meta.label}
        value={name}
        autoFocus
        disabled={saving}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave(sanitizeCustomName(name, meta.label), kind);
          }
        }}
      />

      <p className="plan-custom__label" id={`${nameId}-icons`}>
        Icon
      </p>
      <div
        className="plan-custom__icons"
        role="radiogroup"
        aria-labelledby={`${nameId}-icons`}
      >
        {CUSTOM_POI_KINDS.map((k) => {
          const on = kind === k.kind;
          return (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={on}
              className={`plan-custom__icon-btn${on ? " is-on" : ""}`}
              disabled={saving}
              title={k.label}
              onClick={() => setKind(k.kind)}
            >
              <RydnPlanIcon id={k.icon} size={22} variant={on ? "selected" : "outlined"} />
              <span>{k.label}</span>
            </button>
          );
        })}
      </div>

      <div className="plan-sheet__cta plan-custom__cta">
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={saving}
          aria-busy={saving || undefined}
          data-testid="custom-poi-save"
          onClick={() => onSave(sanitizeCustomName(name, meta.label), kind)}
        >
          {saving ? "Saving…" : mode === "create" ? "Add POI" : "Save"}
        </button>
        {mode === "edit" ? (
          <div className="plan-custom__secondary" role="group" aria-label="Edit actions">
            {onMove ? (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={saving}
                onClick={onMove}
              >
                Move
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="btn btn--secondary plan-custom__delete"
                disabled={saving}
                data-testid="custom-poi-delete"
                onClick={onDelete}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
