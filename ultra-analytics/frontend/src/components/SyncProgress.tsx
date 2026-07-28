import { useEffect, useRef, useState } from "react";
import { listRides, syncProvider } from "../api";
import RydnMark from "./ui/RydnMark";

interface Props {
  providerId: string;
  providerLabel: string;
  /** Called after a successful sync reveal. */
  onDone: () => void;
  /** Called when the user skips after a failed sync (still finishes onboarding). */
  onSkip?: () => void;
}

/** After Strava authorizes: automatic import with rides checking in one by one. */
export default function SyncProgress({ providerId, providerLabel, onDone, onSkip }: Props) {
  const [phase, setPhase] = useState<"connecting" | "revealing" | "done">("connecting");
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [names, setNames] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const started = useRef(false);
  const onDoneRef = useRef(onDone);
  const onSkipRef = useRef(onSkip);
  onDoneRef.current = onDone;
  onSkipRef.current = onSkip;

  const runSync = async () => {
    setError(null);
    setPhase("connecting");
    setRevealed(0);
    setNames([]);
    try {
      const res = await syncProvider(providerId);
      setCount(res.added);
      setTotal(res.fetched);
      let show = res.names ?? [];
      if (show.length === 0) {
        const rides = await listRides();
        show = rides.slice(0, 6).map((r) => r.name);
      }
      setNames(show.slice(0, 8));
      setPhase("revealing");
    } catch (e) {
      setError((e as Error).message);
      setPhase("connecting");
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  useEffect(() => {
    if (phase !== "revealing") return;
    if (revealed < names.length) {
      const t = setTimeout(() => setRevealed((r) => r + 1), 280);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setPhase("done");
      onDoneRef.current();
    }, 850);
    return () => clearTimeout(t);
  }, [phase, revealed, names.length]);

  const headline =
    phase === "connecting"
      ? "Syncing your rides…"
      : count > 0
        ? `${count} new rides imported`
        : `${total} rides ready`;

  return (
    <div className="welcome">
      <div className="welcome__card sync">
        <div className="welcome__logo">
          <RydnMark size={28} className="welcome__mark" />
          <span className="welcome__word">RYDN</span>
        </div>

        {error ? (
          <>
            <h1 className="welcome__headline">Couldn’t sync {providerLabel}</h1>
            <p className="connect__sub">{error}</p>
            <p className="connect__sub">
              Your account is connected — you can retry now or continue and sync later from You.
            </p>
            <div className="empty__actions" style={{ justifyContent: "center" }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  void runSync();
                }}
              >
                {retrying ? "Retrying…" : "Retry sync"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => (onSkipRef.current || onDoneRef.current)()}
              >
                Continue without syncing
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="welcome__headline">{headline}</h1>
            <p className="connect__sub">
              {phase === "connecting"
                ? "Importing activities from Strava…"
                : "Newest rides first. Opening your library…"}
            </p>
            <div className="sync__list" role="status" aria-live="polite">
              {phase === "connecting" && <div className="sync__spinner" aria-hidden />}
              {names.slice(0, revealed).map((n, i) => (
                <div className="sync__row" key={`${n}-${i}`}>
                  <span className="sync__check" aria-hidden>
                    ✓
                  </span>
                  <span className="sync__name">{n}</span>
                </div>
              ))}
              {phase === "revealing" && revealed < names.length && (
                <div className="sync__row sync__row--pending">
                  <span className="sync__spinner sync__spinner--sm" aria-hidden />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
