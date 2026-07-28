import SectionHeader from "../ui/SectionHeader";

/** Architecture placeholder. Compare is deliberately not built yet — the shape is
 * reserved so the eventual implementation (ride vs ride, climb vs climb, ultra vs
 * previous ultra, training progression) drops into a known slot. */
export default function ComparePage() {
  const ideas = [
    { icon: "↔", title: "This ride vs another", body: "Overlay two best-effort curves and time ledgers side by side." },
    { icon: "⛰", title: "This climb vs another", body: "Compare the same climb across efforts, or two climbs head to head." },
    { icon: "∞", title: "This ultra vs my last ultra", body: "Did the plan-vs-actual improve? Fewer, tighter stops? Less fade?" },
    { icon: "📈", title: "Training progression", body: "Watch a duration on the power curve climb over weeks." },
  ];
  return (
    <section className="review-page">
      <SectionHeader question="How does this ride compare?" title="Compare" />
      <div className="compare-note">
        Compare is coming next. It will reuse the same curve and metric components you see
        elsewhere — nothing here is throwaway.
      </div>
      <div className="compare-grid">
        {ideas.map((i) => (
          <div className="compare-idea" key={i.title}>
            <span className="compare-idea__icon">{i.icon}</span>
            <div className="compare-idea__title">{i.title}</div>
            <div className="compare-idea__body">{i.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
