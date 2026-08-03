/** Opens Google Street View in a new tab — no embedded panorama API. */

type Props = {
  latitude: number;
  longitude: number;
  /** Called when rider verifies without needing Street View coverage. */
  onVerifyAnyway?: () => void;
  verifyDisabled?: boolean;
  verifyLabel?: string;
};

/** Pegman-style mark — recognizable Street View cue without Maps JS. */
function StreetViewMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className="street-view-link__mark"
    >
      <circle cx="12" cy="6.2" r="2.6" fill="#F9C74F" stroke="#1a1a18" strokeWidth="0.9" />
      <path
        d="M12 9.2c-2.2 0-3.8 1.4-3.8 3.6v2.2l-1.4 5.4h2.2l1.1-4.2h1.8l1.1 4.2h2.2l-1.4-5.4v-2.2c0-2.2-1.6-3.6-3.8-3.6z"
        fill="#F9C74F"
        stroke="#1a1a18"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function StreetViewLink({
  latitude,
  longitude,
  onVerifyAnyway,
  verifyDisabled,
  verifyLabel = "Verify anyway",
}: Props) {
  const href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude},${longitude}`;

  return (
    <div className="street-view-link" data-testid="street-view-link">
      <a
        className="street-view-link__btn"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        <StreetViewMark size={22} />
        <span>Open in Google Street View</span>
      </a>
      <p className="street-view-link__hint">
        Confirm the stop in Street View, then verify here.
      </p>
      {onVerifyAnyway ? (
        <button
          type="button"
          className="btn btn--ghost street-view-link__verify"
          disabled={verifyDisabled}
          onClick={onVerifyAnyway}
        >
          {verifyLabel}
        </button>
      ) : null}
    </div>
  );
}
