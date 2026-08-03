import { useEffect, useState } from "react";
import type { RedeemResult } from "../../api";
import { connectProviderUrl } from "../../api";
import type { Provider, User } from "../../types";
import {
  loadQuickResumeEnabled,
  saveQuickResumeEnabled,
} from "../../prefs/quickResume";
import { tierFromUser, tierLabel } from "../../subscription/features";

export function YouSpace({
  user,
  providers,
  syncing,
  onSync,
  onUpload,
  onSignOut,
  onUpdateProfile,
  onRedeemCode,
  onRefreshUser,
  onShowOnboarding,
}: {
  user: User;
  providers: Provider[];
  syncing: boolean;
  onSync: () => void;
  onUpload: () => void;
  onSignOut: () => void;
  onUpdateProfile: (patch: { weightKg?: number | null }) => Promise<User>;
  onRedeemCode: (code: string) => Promise<RedeemResult>;
  onRefreshUser?: () => Promise<void>;
  onShowOnboarding: () => void;
}) {
  const connected = providers.find((p) => p.connected);
  const connectable = providers.find((p) => p.enabled && !p.connected);
  const savedWeight =
    user.weightKg != null && Number.isFinite(user.weightKg) ? String(user.weightKg) : "";
  const [weightDraft, setWeightDraft] = useState(savedWeight);
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [weightNotice, setWeightNotice] = useState<string | null>(null);
  const [redeemDraft, setRedeemDraft] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemNotice, setRedeemNotice] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingConfigured, setBillingConfigured] = useState<boolean | null>(null);
  const [quickResume, setQuickResume] = useState(() => loadQuickResumeEnabled());
  const [pricing, setPricing] = useState<{
    monthlyLabel: string;
    yearlyLabel: string;
    racePassLabel?: string;
  } | null>(null);
  const tierKey = tierFromUser(user);
  const tier = tierLabel(tierKey);
  const isPro = tierKey === "pro";
  const hasStripeCustomer = Boolean(user.billing?.hasStripeCustomer);
  const racePassCredits = user.racePassCredits ?? user.billing?.racePassCredits ?? 0;

  useEffect(() => {
    setWeightDraft(savedWeight);
  }, [savedWeight]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getBillingStatus } = await import("../../api");
        const s = await getBillingStatus();
        if (!cancelled) {
          setBillingConfigured(s.configured);
          if (s.pricing) {
            setPricing({
              monthlyLabel: s.pricing.monthlyLabel,
              yearlyLabel: s.pricing.yearlyLabel,
              racePassLabel: s.pricing.racePassLabel,
            });
          }
        }
      } catch {
        if (!cancelled) setBillingConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (billing !== "success" && billing !== "race_pass_success") return;
    if (billing === "success") {
      setRedeemNotice("You’re on Pro. Planning, Verify, Ride mode, and GPX export are unlocked.");
    } else {
      setRedeemNotice("Race Pass ready — import one planned GPX to unlock that route.");
    }
    params.delete("billing");
    const next = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
    // Webhook may land slightly after redirect — refresh a few times.
    void (async () => {
      for (let i = 0; i < 5; i++) {
        await onRefreshUser?.();
        await new Promise((r) => setTimeout(r, 800));
      }
    })();
  }, [onRefreshUser]);

  const redeem = async () => {
    const code = redeemDraft.trim();
    if (!code) {
      setRedeemError("Enter a redeem code.");
      return;
    }
    setRedeemBusy(true);
    setRedeemError(null);
    setRedeemNotice(null);
    try {
      const result = await onRedeemCode(code);
      setRedeemDraft("");
      if (result.redeemAction === "onboarding") {
        setRedeemNotice("Opening a quick tour of RYDN…");
        onShowOnboarding();
      } else if (tierFromUser(result) === "free") {
        setRedeemNotice("Account set to Free.");
      } else {
        setRedeemNotice("Pro unlocked. Planning, Verify, Ride mode, and GPX export are available.");
      }
    } catch (e) {
      setRedeemError((e as Error).message);
    } finally {
      setRedeemBusy(false);
    }
  };

  const startCheckout = async (interval: "month" | "year" = "month") => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { createBillingCheckoutSession } = await import("../../api");
      const { url } = await createBillingCheckoutSession(interval);
      window.location.href = url;
    } catch (e) {
      setBillingError((e as Error).message);
      setBillingBusy(false);
    }
  };

  const openPortal = async () => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { createBillingPortalSession } = await import("../../api");
      const { url } = await createBillingPortalSession();
      window.location.href = url;
    } catch (e) {
      setBillingError((e as Error).message);
      setBillingBusy(false);
    }
  };

  const retryBillingSetup = async () => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { bootstrapBilling, getBillingStatus } = await import("../../api");
      await bootstrapBilling();
      const s = await getBillingStatus();
      setBillingConfigured(s.configured);
      if (s.configured) {
        setRedeemNotice("Billing is ready. You can upgrade to Pro.");
      } else {
        setBillingError("Still not ready — add STRIPE_SECRET_KEY in Railway, then retry.");
      }
    } catch (e) {
      setBillingError((e as Error).message);
    } finally {
      setBillingBusy(false);
    }
  };

  const saveWeight = async () => {
    setWeightBusy(true);
    setWeightError(null);
    setWeightNotice(null);
    const trimmed = weightDraft.trim().replace(",", ".");
    try {
      if (!trimmed) {
        await onUpdateProfile({ weightKg: null });
        setWeightNotice("Weight cleared.");
      } else {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 30 || n > 200) {
          setWeightError("Enter a weight between 30 and 200 kg.");
          return;
        }
        await onUpdateProfile({ weightKg: Math.round(n * 10) / 10 });
        setWeightNotice("Weight saved — used for W/kg (Normalized Power).");
      }
    } catch (e) {
      setWeightError((e as Error).message);
    } finally {
      setWeightBusy(false);
    }
  };

  const clearWeight = async () => {
    setWeightDraft("");
    setWeightBusy(true);
    setWeightError(null);
    setWeightNotice(null);
    try {
      await onUpdateProfile({ weightKg: null });
      setWeightNotice("Weight cleared.");
    } catch (e) {
      setWeightError((e as Error).message);
    } finally {
      setWeightBusy(false);
    }
  };

  const weightDirty = weightDraft.trim() !== savedWeight;

  return (
    <div className="space space--narrow">
      <header className="space__head">
        <h1 className="space__title">Account</h1>
        <p className="space__sub">Profile, subscription, and connections.</p>
      </header>

      <div className="you-card">
        <div className="you-card__name">{user.name || "Rider"}</div>
        <div className="you-card__email">{user.email || "No email on file"}</div>
        <div className="you-card__tier">
          <span className="you-card__tier-label">Current plan</span>
          <span className={`you-tier you-tier--${tierKey}`}>{tier}</span>
        </div>
      </div>

      <section className="you-section you-section--subscription" aria-labelledby="you-subscription-heading">
        <h2 id="you-subscription-heading" className="space__label">
          Subscription
        </h2>
        <div className="you-plan">
          <div className="you-plan__title">
            {tier} plan
            <span className={`you-tier you-tier--${tierKey}`}>{tier}</span>
          </div>
          <p className="you-plan__meta">
            {isPro
              ? "Planning, Verify, Ride mode, and GPX export unlocked on every route."
              : "Library, Analytics, Certificates, and Trips included. Subscribe to Pro for unlimited Planning."}
          </p>
        </div>
        {billingError ? <p className="you-weight__error">{billingError}</p> : null}
        {redeemNotice ? <p className="space__hint">{redeemNotice}</p> : null}
        <div className="you-billing-actions">
          {!isPro && billingConfigured ? (
            <>
              <button
                type="button"
                className="btn btn--primary"
                disabled={billingBusy}
                onClick={() => void startCheckout("month")}
              >
                {billingBusy ? "Opening…" : `Pro · ${pricing?.monthlyLabel ?? "8,99 €"} / month`}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={billingBusy}
                onClick={() => void startCheckout("year")}
              >
                {billingBusy
                  ? "Opening…"
                  : `Pro · ${pricing?.yearlyLabel ?? "59,99 €"} / year · best value`}
              </button>
            </>
          ) : null}
          {billingConfigured === false ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={billingBusy}
              onClick={() => void retryBillingSetup()}
            >
              {billingBusy ? "Setting up…" : "Retry billing setup"}
            </button>
          ) : null}
          {hasStripeCustomer ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={billingBusy}
              onClick={() => void openPortal()}
            >
              Manage billing
            </button>
          ) : null}
        </div>
        {!isPro && billingConfigured ? (
          <div className="you-race-pass">
            <h3 className="you-race-pass__title">Race Pass</h3>
            <p className="you-race-pass__meta">
              One-time purchase — unlock a single planned GPX (not a subscription).
              {racePassCredits > 0
                ? racePassCredits === 1
                  ? " You have 1 pass ready to use."
                  : ` You have ${racePassCredits} passes ready.`
                : ""}
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={billingBusy}
              onClick={() => {
                void (async () => {
                  setBillingBusy(true);
                  setBillingError(null);
                  try {
                    const { createRacePassCheckout } = await import("../../api");
                    const { url } = await createRacePassCheckout();
                    window.location.href = url;
                  } catch (e) {
                    setBillingError((e as Error).message);
                    setBillingBusy(false);
                  }
                })();
              }}
            >
              {billingBusy
                ? "Opening…"
                : `Buy Race Pass · ${pricing?.racePassLabel ?? "4,99 €"}`}
            </button>
          </div>
        ) : null}
        <form
          className="you-redeem"
          onSubmit={(e) => {
            e.preventDefault();
            void redeem();
          }}
        >
          <label className="field" htmlFor="you-redeem-code">
            <span>Redeem code</span>
            <div className="you-redeem__row">
              <input
                id="you-redeem-code"
                type="text"
                name="redeemCode"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. RYDN-ONBOARD"
                value={redeemDraft}
                onChange={(e) => {
                  setRedeemDraft(e.target.value);
                  setRedeemError(null);
                  setRedeemNotice(null);
                }}
                disabled={redeemBusy}
                aria-describedby="you-redeem-hint"
              />
              <button
                type="submit"
                className="btn btn--ghost"
                disabled={redeemBusy || !redeemDraft.trim()}
              >
                {redeemBusy ? "Redeeming…" : "Redeem"}
              </button>
            </div>
          </label>
          <p id="you-redeem-hint" className="field__hint">
            {billingConfigured
              ? "Have a code? Redeem it here. Or upgrade with Apple Pay, Google Pay, or card."
              : "Valid codes unlock Pro. Card checkout appears here once billing is configured."}
          </p>
          {redeemError ? <p className="you-weight__error">{redeemError}</p> : null}
        </form>
      </section>

      <section className="you-section">
        <h2 className="space__label">Profile</h2>
        <div className="you-row">
          <div>
            <div className="you-row__title">Email</div>
            <div className="you-row__meta">{user.email || "—"}</div>
          </div>
        </div>
      </section>

      <section className="you-section" aria-labelledby="you-prefs-heading">
        <h2 id="you-prefs-heading" className="space__label">
          Preferences
        </h2>
        <label className="you-toggle">
          <span className="you-toggle__copy">
            <span className="you-toggle__title">Quick Resume</span>
            <span className="you-toggle__meta">
              Open RYDN straight into your active Ride. Turn off anytime.
            </span>
          </span>
          <input
            type="checkbox"
            checked={quickResume}
            onChange={(e) => {
              const on = e.target.checked;
              setQuickResume(on);
              saveQuickResumeEnabled(on);
            }}
          />
        </label>
      </section>

      <section className="you-section">
        <h2 className="space__label">Body weight</h2>
        <p className="space__hint">
          Used for W/kg (Normalized Power ÷ weight) on the shareable ride screen. Overrides Strava athlete weight when set.
        </p>
        <label className="field you-weight">
          <span>Weight (kg)</span>
          <div className="you-weight__row">
            <input
              type="number"
              inputMode="decimal"
              min={30}
              max={200}
              step={0.1}
              placeholder="e.g. 72"
              value={weightDraft}
              onChange={(e) => {
                setWeightDraft(e.target.value);
                setWeightError(null);
                setWeightNotice(null);
              }}
              disabled={weightBusy}
              aria-describedby="you-weight-hint"
            />
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void saveWeight()}
              disabled={weightBusy || !weightDirty}
            >
              {weightBusy ? "Saving…" : "Save"}
            </button>
            {savedWeight ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void clearWeight()}
                disabled={weightBusy}
              >
                Clear
              </button>
            ) : null}
          </div>
        </label>
        <p id="you-weight-hint" className="field__hint">
          {savedWeight
            ? `Current: ${savedWeight} kg`
            : "Not set — W/kg uses Strava weight when available."}
        </p>
        {weightError ? <p className="you-weight__error">{weightError}</p> : null}
        {weightNotice ? <p className="space__hint">{weightNotice}</p> : null}
      </section>

      <section className="you-section">
        <h2 className="space__label">Connections</h2>
        {connected ? (
          <div className="you-row">
            <div>
              <div className="you-row__title">{connected.label}</div>
              <div className="you-row__meta">Connected</div>
            </div>
            <button type="button" className="btn btn--strava" onClick={onSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync"}
            </button>
          </div>
        ) : connectable ? (
          <div className="you-row">
            <div>
              <div className="you-row__title">{connectable.label}</div>
              <div className="you-row__meta">Not connected</div>
            </div>
            <button
              type="button"
              className="btn btn--strava"
              onClick={() => {
                window.location.href = connectProviderUrl(connectable.id);
              }}
            >
              Connect
            </button>
          </div>
        ) : (
          <p className="space__hint">No ride providers configured.</p>
        )}
      </section>

      <section className="you-section">
        <h2 className="space__label">Files</h2>
        <button type="button" className="btn btn--tertiary" onClick={onUpload}>
          Import file
        </button>
      </section>

      <section className="you-section">
        <h2 className="space__label">Privacy</h2>
        <p className="space__hint">Privacy controls will live here. Coming soon.</p>
      </section>

      <section className="you-section">
        <h2 className="space__label">Danger zone</h2>
        <button type="button" className="btn btn--ghost" disabled title="Coming soon">
          Delete account
        </button>
        <p className="space__hint">Account deletion is not available yet.</p>
      </section>

      <section className="you-section">
        <button type="button" className="btn btn--ghost" onClick={onSignOut}>
          Log out
        </button>
      </section>
    </div>
  );
}
