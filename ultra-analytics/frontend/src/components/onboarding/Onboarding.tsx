import { useCallback, useEffect, useId, useRef, useState } from "react";
import Icon from "../ui/Icon";
import RydnMark from "../ui/RydnMark";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { markOnboardingSeen } from "../../onboarding/persistence";
import {
  ONBOARDING_STEPS,
  type OnboardingDest,
  type OnboardingStep,
} from "../../onboarding/steps";

interface Props {
  open: boolean;
  onClose: () => void;
  onFinish: (dest: OnboardingDest) => void;
}

const TOUR_METRICS = [
  { id: "stop", label: "Stop", value: "14 min", tone: "amber" },
  { id: "np", label: "NP", value: "248 W", tone: "green" },
  { id: "wkg", label: "W/kg", value: "3.4", tone: "sky" },
] as const;

const CLIMB_CARDS = [
  { id: "a", name: "Col A", watts: "220 W", rate: "820 m/h", grade: "7.2%" },
  { id: "b", name: "Col B", watts: "198 W", rate: "640 m/h", grade: "5.8%" },
] as const;

export default function Onboarding({ open, onClose, onFinish }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const total = ONBOARDING_STEPS.length;
  const current = ONBOARDING_STEPS[step] ?? ONBOARDING_STEPS[0];
  const last = step >= total - 1;

  const finish = useCallback(
    (dest: OnboardingDest, skipped = false) => {
      markOnboardingSeen();
      if (skipped) onClose();
      else onFinish(dest);
    },
    [onClose, onFinish],
  );

  useFocusTrap(open, panelRef, () => finish("library", true));

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDir(1);
  }, [open]);

  if (!open) return null;

  const go = (next: number) => {
    if (next < 0 || next >= total) return;
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  return (
    <div
      className={`onboarding onboarding--${current.visual}`}
      data-step={current.id}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="onboarding__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="onboarding__chrome">
          {last ? (
            <span className="onboarding__skip onboarding__skip--spacer" aria-hidden />
          ) : (
            <button
              type="button"
              className="onboarding__skip"
              onClick={() => finish("library", true)}
            >
              Skip
            </button>
          )}
          <div
            className="onboarding__progress"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={step + 1}
            aria-label={`Step ${step + 1} of ${total}`}
          >
            {ONBOARDING_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`onboarding__seg${i <= step ? " onboarding__seg--on" : ""}`}
              />
            ))}
          </div>
          <span className="onboarding__count" aria-hidden>
            {step + 1}/{total}
          </span>
        </header>

        <div
          key={current.id}
          className={`onboarding__stage onboarding__stage--${dir > 0 ? "fwd" : "back"}`}
        >
          <div className={`onboarding__visual onboarding__visual--${current.visual}`} aria-hidden>
            <StepVisual step={current} />
          </div>

          <div className="onboarding__copy">
            {current.eyebrow ? <p className="onboarding__eyebrow">{current.eyebrow}</p> : null}
            <h1 id={titleId} className="onboarding__title">
              {current.title}
            </h1>
            <p className="onboarding__body">{current.body}</p>
          </div>
        </div>

        <footer className="onboarding__footer">
          {last ? (
            <div className="onboarding__cta-row">
              <button
                type="button"
                className="btn btn--primary onboarding__cta"
                onClick={() => finish("library")}
                autoFocus
              >
                Open Library
              </button>
            </div>
          ) : (
            <div className="onboarding__nav">
              {step > 0 ? (
                <button type="button" className="btn btn--ghost" onClick={() => go(step - 1)}>
                  Back
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="btn btn--primary onboarding__continue"
                onClick={() => go(step + 1)}
                autoFocus
              >
                Continue
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

function StepVisual({ step }: { step: OnboardingStep }) {
  switch (step.visual) {
    case "scout":
      return (
        <div className="ob-scout">
          <div className="ob-scout__route" />
          <span className="ob-scout__pin ob-scout__pin--water" style={{ ["--i" as string]: 0 }}>
            <Icon name="water" size={16} weight="medium" />
            Fountain
          </span>
          <span className="ob-scout__pin ob-scout__pin--shop" style={{ ["--i" as string]: 1 }}>
            <Icon name="pin" size={16} weight="medium" />
            Shop
          </span>
          <span className="ob-scout__pin ob-scout__pin--ok" style={{ ["--i" as string]: 2 }}>
            <Icon name="check" size={16} weight="semibold" />
            Verified
          </span>
        </div>
      );
    case "ride":
      return (
        <div className="ob-ride">
          <div className="ob-ride__phone">
            <div className="ob-ride__map">
              <div className="ob-ride__trail" />
              <span className="ob-ride__dot" />
            </div>
            <div className="ob-ride__sv">
              <span className="ob-ride__sv-label">Street View</span>
              <span className="ob-ride__sv-check">
                <Icon name="check" size={14} weight="semibold" />
                Real stop
              </span>
            </div>
          </div>
          <span className="ob-ride__chip ob-ride__chip--search" style={{ ["--i" as string]: 0 }}>
            <Icon name="search" size={14} weight="medium" />
            More water
          </span>
          <span className="ob-ride__chip ob-ride__chip--shop" style={{ ["--i" as string]: 1 }}>
            <Icon name="pin" size={14} weight="medium" />
            Shop nearby
          </span>
        </div>
      );
    case "tour":
      return (
        <div className="ob-tour">
          <div className="ob-tour__days">
            {["Day 1", "Day 2", "Day 3", "Day 4"].map((d, i) => (
              <span key={d} className="ob-tour__day" style={{ ["--i" as string]: i }}>
                {d}
              </span>
            ))}
            <span className="ob-tour__stitch" aria-hidden />
          </div>
          <p className="ob-tour__merge">One multi-day tour</p>
          <ul className="ob-tour__metrics">
            {TOUR_METRICS.map((m, i) => (
              <li
                key={m.id}
                className={`ob-tour__metric ob-tour__metric--${m.tone}`}
                style={{ ["--i" as string]: i }}
              >
                <span className="ob-tour__metric-l">{m.label}</span>
                <strong className="ob-tour__metric-v">{m.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      );
    case "climbs":
      return (
        <div className="ob-climbs">
          <div className="ob-climbs__hero" style={{ ["--i" as string]: 0 }}>
            <Icon name="summit" size={20} weight="semibold" />
            <span className="ob-climbs__hero-v">820 m/h</span>
            <span className="ob-climbs__hero-l">altitude gain</span>
          </div>
          <ul className="ob-climbs__list">
            {CLIMB_CARDS.map((c, i) => (
              <li key={c.id} className="ob-climbs__card" style={{ ["--i" as string]: i + 1 }}>
                <strong>{c.name}</strong>
                <span>{c.watts}</span>
                <span>{c.rate}</span>
                <span>{c.grade}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "share":
      return (
        <div className="ob-share">
          <div className="ob-share__card">
            <div className="ob-share__map">
              <div className="ob-share__line" />
            </div>
            <div className="ob-share__stats">
              <span>
                <strong>412</strong> km
              </span>
              <span>
                <strong>6,840</strong> m
              </span>
              <span>
                <strong>4</strong> days
              </span>
            </div>
            <p className="ob-share__caption">Alps bikepack · full tour</p>
          </div>
          <span className="ob-share__badge" style={{ ["--i" as string]: 0 }}>
            IG · Strava ready
          </span>
        </div>
      );
    case "finish":
      return (
        <div className="ob-finish">
          <RydnMark size={36} className="ob-finish__mark" />
          <div className="ob-finish__paths">
            <span className="ob-finish__chip ob-finish__chip--scout" style={{ ["--i" as string]: 0 }}>
              <Icon name="route" size={16} weight="medium" />
              Tours
            </span>
            <span className="ob-finish__chip ob-finish__chip--see" style={{ ["--i" as string]: 1 }}>
              <Icon name="summit" size={16} weight="medium" />
              Climbs
            </span>
            <span className="ob-finish__chip ob-finish__chip--share" style={{ ["--i" as string]: 2 }}>
              <Icon name="flag" size={16} weight="medium" />
              Share cards
            </span>
          </div>
          <p className="ob-finish__tag">Start in Library</p>
        </div>
      );
    default:
      return null;
  }
}
