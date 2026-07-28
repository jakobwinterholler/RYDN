import { useEffect, useState } from "react";
import { getAuthConfig } from "../api";
import type { AuthConfig, SetupStatus } from "../types";
import RydnMark from "./ui/RydnMark";

interface Props {
  config: AuthConfig | null;
  onGoogle: () => void;
  onDev: () => void;
  error?: string | null;
}

/** First launch. When credentials are missing, shows a live checklist that
 * updates the moment you save backend/.env — no restart, no hunting menus. */
export default function Welcome({ config, onGoogle, onDev, error }: Props) {
  const [live, setLive] = useState<AuthConfig | null>(config);

  useEffect(() => {
    setLive(config);
  }, [config]);

  // Poll while Google isn't ready — picks up .env saves automatically.
  useEffect(() => {
    if (live?.googleEnabled) return;
    const t = setInterval(() => {
      void getAuthConfig()
        .then(setLive)
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, [live?.googleEnabled]);

  const googleEnabled = live?.googleEnabled;
  const setup = live?.setup;
  const justBecameReady = googleEnabled && config && !config.googleEnabled;

  return (
    <div className="welcome">
      <div className="welcome__card welcome__card--wide">
        <div className="welcome__logo">
          <RydnMark size={28} className="welcome__mark" />
          <span className="welcome__word">RYDN</span>
        </div>
        <h1 className="welcome__headline">Plan with what you’ve ridden.</h1>

        {googleEnabled ? (
          <>
            {justBecameReady && (
              <p className="welcome__ready">Credentials detected. You’re ready.</p>
            )}
            <button className="google-btn" onClick={onGoogle}>
              <span className="google-btn__g">G</span>
              Continue with Google
            </button>
            <p className="connect__sub" style={{ marginTop: 18 }}>
              Next: Connect Strava → sync source days → Ultras.
            </p>
          </>
        ) : (
          <SetupPanel setup={setup} onDev={onDev} />
        )}

        {error && <div className="welcome__error">{error}</div>}
      </div>
    </div>
  );
}

function SetupPanel({ setup, onDev }: { setup?: SetupStatus; onDev: () => void }) {
  const reg = setup?.register;
  const phone = setup?.phoneUrl;

  return (
    <div className="setup-panel">
      <p className="setup-panel__lead">
        Paste four secrets into <code>ultra-analytics/.env</code> and save. RYDN reloads them
        automatically — no restart.
      </p>

      <div className="setup-checks">
        {(setup?.checks ?? []).map((c) => (
          <div key={c.id} className={`setup-check ${c.ok ? "ok" : "bad"}`}>
            <span className="setup-check__mark">{c.ok ? "✓" : "○"}</span>
            <div>
              <div className="setup-check__label">{c.label}</div>
              {c.fix ? <div className="setup-check__fix">{c.fix}</div> : null}
            </div>
          </div>
        ))}
      </div>

      {reg && (
        <div className="setup-copy">
          <h3>Register these (Google Cloud)</h3>
          <p className="setup-copy__hint">Authorized redirect URIs — paste both:</p>
          {reg.googleRedirectUris.map((u) => (
            <code key={u} className="setup-copy__uri">
              {u}
            </code>
          ))}

          <h3>Register this (Strava API)</h3>
          <p className="setup-copy__hint">
            Authorization Callback Domain (for phone):
          </p>
          <code className="setup-copy__uri">{reg.stravaCallbackDomain}</code>
        </div>
      )}

      {phone && (
        <p className="setup-panel__phone">
          {setup?.tunnelActive ? "Tunnel (open on phone)" : "Phone URL"}:{" "}
          <a href={phone} target="_blank" rel="noreferrer">
            {phone}
          </a>
        </p>
      )}

      <p className="setup-panel__next">{setup?.nextStep}</p>

      <button className="ghost-btn welcome__primary" onClick={onDev}>
        Continue in local mode
      </button>
    </div>
  );
}
