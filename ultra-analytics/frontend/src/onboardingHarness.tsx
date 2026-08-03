import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import Onboarding from "./components/onboarding/Onboarding";
import "./styles.css";

function Harness() {
  const [open, setOpen] = useState(true);
  const [last, setLast] = useState<string>("—");

  return (
    <div style={{ minHeight: "100dvh", padding: 24, fontFamily: "var(--font)" }}>
      <p style={{ marginBottom: 12, color: "var(--ink-secondary)" }}>
        Last finish: <strong>{last}</strong>
      </p>
      <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
        Open onboarding
      </button>
      <Onboarding
        open={open}
        onClose={() => {
          setOpen(false);
          setLast("skipped");
        }}
        onFinish={(dest) => {
          setOpen(false);
          setLast(dest);
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
