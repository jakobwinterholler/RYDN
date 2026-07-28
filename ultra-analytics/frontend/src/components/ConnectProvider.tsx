import { useEffect, useState } from "react";
import { connectProviderUrl, getAuthConfig } from "../api";
import type { Provider, SetupStatus } from "../types";
import RydnMark from "./ui/RydnMark";

interface Props {
  provider: Provider;
  onSkip: () => void;
}

/** Shown once after Google login when Strava isn't connected. */
export default function ConnectProvider({ provider, onSkip }: Props) {
  const [setup, setSetup] = useState<SetupStatus | null>(null);

  useEffect(() => {
    void getAuthConfig()
      .then((c) => setSetup(c.setup ?? null))
      .catch(() => undefined);
  }, []);

  const domain = setup?.register?.stravaCallbackDomain;
  const redirect = setup?.register?.stravaFullRedirect;

  return (
    <div className="welcome">
      <div className="welcome__card welcome__card--wide">
        <div className="welcome__logo">
          <RydnMark size={28} className="welcome__mark" />
          <span className="welcome__word">RYDN</span>
        </div>
        <h1 className="welcome__headline">Connect your {provider.label} account</h1>
        <p className="connect__sub">Automatically import your rides and keep them synced.</p>

        {domain && (
          <div className="setup-copy" style={{ marginBottom: 18 }}>
            <h3>Before you connect — Strava setting</h3>
            <p className="setup-copy__hint">
              Authorization Callback Domain must be exactly (no https://):
            </p>
            <code className="setup-copy__uri">{domain}</code>
            {redirect && (
              <>
                <p className="setup-copy__hint">Ultra will send this redirect_uri:</p>
                <code className="setup-copy__uri">{redirect}</code>
              </>
            )}
          </div>
        )}

        <button
          className="strava-btn strava-btn--lg connect__cta"
          onClick={() => {
            window.location.href = connectProviderUrl(provider.id);
          }}
        >
          Connect {provider.label}
        </button>
        <button className="ghost-btn connect__skip" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
