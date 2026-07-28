interface Props {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: boolean;
}

/** A single premium metric tile. The whole Overview is a grid of these. */
export default function MetricCard({ label, value, unit, sub, accent }: Props) {
  return (
    <div className={`metric-card${accent ? " metric-card--accent" : ""}`}>
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">
        {value}
        {unit && <span className="metric-card__unit">{unit}</span>}
      </div>
      {sub && <div className="metric-card__sub">{sub}</div>}
    </div>
  );
}
