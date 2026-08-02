/** Compact unlock gate — Race Pass hero for import; Account for Pro elsewhere. */

import { useEffect, useState } from "react";
import { createRacePassCheckout, getBillingStatus } from "../../api";
import Icon from "../ui/Icon";
import RydnMark from "../ui/RydnMark";

export type ProGateFeature = "planning" | "verify" | "rideMode" | "gpxExport";
/** import → Race Pass card; subscribe → Pro via Account. */
export type ProGateIntent = "import" | "subscribe";

const COPY: Record<ProGateFeature, { title: string; body: string }> = {
  planning: {
    title: "Unlock this course",
    body: "Import a GPX, search the corridor, and build your resupply plan.",
  },
  verify: {
    title: "Verify is Pro",
    body: "Confirm water and shops on Street View before you roll.",
  },
  rideMode: {
    title: "Ride mode is Pro",
    body: "Take your verified plan onto the bike with a calm, focused view.",
  },
  gpxExport: {
    title: "GPX export is Pro",
    body: "Export your course with verified water and shop waypoints.",
  },
};

/** Race Pass benefits — keep to 3 for short-phone fit. */
const RACE_PASS_PERKS = [
  "Unlock one planned route",
  "Full Pro planning on that course",
  "One-time — no subscription",
] as const;

interface Props {
  feature?: ProGateFeature;
  intent?: ProGateIntent;
  onBack?: () => void;
  onOpenAccount?: () => void;
}

export default function ProGate({
  feature = "planning",
  intent = "import",
  onBack,
  onOpenAccount,
}: Props) {
  const copy = COPY[feature] ?? COPY.planning;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [racePass, setRacePass] = useState("4,99 €");
  const [raceOk, setRaceOk] = useState(true);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const s = await getBillingStatus();
        if (s.pricing?.racePassLabel) setRacePass(s.pricing.racePassLabel);
        setRaceOk(Boolean(s.racePassConfigured ?? s.configured));
        setConfigured(Boolean(s.configured));
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  const sellRacePass = intent === "import" && raceOk;

  const buyRacePass = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await getBillingStatus();
      if (!status.racePassConfigured && !status.configured) {
        if (onOpenAccount) onOpenAccount();
        else setError("Billing isn’t ready yet — open Account to finish setup.");
        setBusy(false);
        return;
      }
      const { url } = await createRacePassCheckout();
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className={`pro-gate${sellRacePass ? " pro-gate--race" : " pro-gate--pro"}`}>
      <div className="pro-gate__card">
        <div className="pro-gate__chrome">
          {onOpenAccount ? (
            <button type="button" className="pro-gate__link pro-gate__link--muted" onClick={onOpenAccount}>
              Redeem
            </button>
          ) : (
            <span />
          )}
          {onBack ? (
            <button
              type="button"
              className="pro-gate__dismiss"
              onClick={onBack}
              aria-label="Close"
            >
              <Icon name="close" size={20} />
            </button>
          ) : (
            <span />
          )}
        </div>

        <RydnMark size={22} className="pro-gate__mark" />

        {sellRacePass ? (
          <>
            <p className="pro-gate__eyebrow">One-time · no subscription</p>
            <h1 className="pro-gate__title">Race Pass</h1>
            <p className="pro-gate__price">
              {racePass}
              <span className="pro-gate__price-unit"> once</span>
            </p>
            <p className="pro-gate__body">
              Unlock <strong>one</strong> planned GPX for a single race.
            </p>
            <ul className="pro-gate__perks">
              {RACE_PASS_PERKS.map((perk) => (
                <li key={perk}>
                  <Icon name="check" size={15} weight="semibold" className="pro-gate__perk-check" />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>

            {!configured && !raceOk ? (
              <p className="you-weight__error">
                Billing isn’t configured yet.
                {onOpenAccount ? " Open Account to retry setup." : ""}
              </p>
            ) : null}
            {error ? <p className="you-weight__error">{error}</p> : null}

            <button
              type="button"
              className="btn btn--primary pro-gate__cta"
              onClick={() => void buyRacePass()}
              disabled={busy}
            >
              {busy ? "Opening…" : `Buy Race Pass · ${racePass}`}
            </button>

            {onOpenAccount ? (
              <button type="button" className="pro-gate__account-link" onClick={onOpenAccount}>
                Or get RYDN Pro in Account
              </button>
            ) : null}
          </>
        ) : (
          <>
            <p className="pro-gate__eyebrow">RYDN Pro</p>
            <h1 className="pro-gate__title">{copy.title}</h1>
            <p className="pro-gate__body">{copy.body}</p>
            <ul className="pro-gate__perks">
              <li>
                <Icon name="check" size={15} weight="semibold" className="pro-gate__perk-check" />
                <span>Unlimited planned routes</span>
              </li>
              <li>
                <Icon name="check" size={15} weight="semibold" className="pro-gate__perk-check" />
                <span>Verify, Ride mode, GPX export</span>
              </li>
            </ul>

            {!configured ? (
              <p className="you-weight__error">
                Billing isn’t configured yet.
                {onOpenAccount ? " Open Account to finish setup." : ""}
              </p>
            ) : null}
            {error ? <p className="you-weight__error">{error}</p> : null}

            {onOpenAccount ? (
              <button
                type="button"
                className="btn btn--primary pro-gate__cta"
                onClick={onOpenAccount}
              >
                Go to Account for Pro
              </button>
            ) : null}

            {onBack ? (
              <button type="button" className="pro-gate__not-now" onClick={onBack}>
                Not now
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
