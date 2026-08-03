import type { CoachTip } from "../../coach/rideCoach";

type Props = {
  tips: CoachTip[];
  title?: string;
};

export default function RideCoachCard({ tips, title = "Ride Coach" }: Props) {
  if (!tips.length) return null;
  return (
    <section className="ride-coach" aria-label={title}>
      <header className="ride-coach__head">
        <h2 className="ride-coach__title">{title}</h2>
        <p className="ride-coach__sub">From your recent numbers — not generic advice.</p>
      </header>
      <ul className="ride-coach__list">
        {tips.map((t) => (
          <li key={t.id} className={`ride-coach__tip ride-coach__tip--${t.severity}`}>
            <span className="ride-coach__tip-title">{t.title}</span>
            <span className="ride-coach__tip-body">{t.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
