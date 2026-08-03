import type { LedgerBucket } from "../../types";

export default function TimeLedgerSection({
  data,
}: {
  data: { question: string; totalS: number; buckets: LedgerBucket[]; insight: string };
}) {
  return (
    <section className="section">
      <div className="section__q">{data.question}</div>
      <h2 className="section__title">Time Ledger</h2>
      <div className="card">
        <div className="ledger-bar">
          {data.buckets.map((b) => (
            <div
              key={b.label}
              className="ledger-seg"
              style={{ width: `${b.pct}%`, background: b.color }}
              title={`${b.label} — ${b.label_duration} (${b.pct}%)`}
            />
          ))}
        </div>
        <div className="ledger-list">
          {data.buckets.map((b) => (
            <div className="ledger-item" key={b.label}>
              <span className="ledger-swatch" style={{ background: b.color }} />
              <span className="ledger-item__label">{b.label}</span>
              <span className="ledger-item__t">{b.label_duration}</span>
              <span className="ledger-item__pct">{b.pct}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="insight">{data.insight}</div>
    </section>
  );
}
