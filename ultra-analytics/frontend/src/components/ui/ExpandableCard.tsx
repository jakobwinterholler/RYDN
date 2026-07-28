import { useState, type ReactNode } from "react";

interface Props {
  icon?: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  available?: boolean;
  children: ReactNode;
}

/** Collapsible card used across Analysis so the section stays scannable —
 * every metric is one tap from expansion, never its own buried page. */
export default function ExpandableCard({
  icon,
  title,
  summary,
  defaultOpen = false,
  available = true,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`xcard${open ? " open" : ""}`}>
      <button
        className="xcard__head"
        onClick={() => available && setOpen((v) => !v)}
        disabled={!available}
        aria-expanded={open}
      >
        {icon && <span className="xcard__icon">{icon}</span>}
        <span className="xcard__title">{title}</span>
        {summary && <span className="xcard__summary">{summary}</span>}
        {available ? (
          <span className="xcard__chev">{open ? "▲" : "▼"}</span>
        ) : (
          <span className="xcard__na">no data</span>
        )}
      </button>
      {open && available && <div className="xcard__body">{children}</div>}
    </div>
  );
}
