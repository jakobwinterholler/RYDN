import type { ReactNode } from "react";
import type { User } from "../../types";
import shellHeaderMark from "../../assets/shell-header-mark.png";

export type ShellSpace = "ultras" | "library" | "you";

interface Props {
  user: User;
  space: ShellSpace;
  onSpace: (s: ShellSpace) => void;
  children: ReactNode;
}

/** App chrome — Ultras · Library · You. Clarity: where am I / what can I do. */
export default function AppShell({ user, space, onSpace, children }: Props) {
  const initial = (user.name || "Y").charAt(0).toUpperCase();

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__brand" aria-label="RYDN">
          <img
            className="shell__mark"
            src={shellHeaderMark}
            width={28}
            height={28}
            alt=""
            draggable={false}
          />
          <span className="shell__word">RYDN</span>
        </div>

        <nav className="shell__nav shell__nav--desktop" aria-label="Primary">
          <button
            type="button"
            className={`shell__tab${space === "ultras" ? " is-active" : ""}`}
            onClick={() => onSpace("ultras")}
            aria-current={space === "ultras" ? "page" : undefined}
          >
            Ultras
          </button>
          <button
            type="button"
            className={`shell__tab${space === "library" ? " is-active" : ""}`}
            onClick={() => onSpace("library")}
            aria-current={space === "library" ? "page" : undefined}
          >
            Library
          </button>
        </nav>

        <button
          type="button"
          className={`shell__you${space === "you" ? " is-active" : ""}`}
          onClick={() => onSpace("you")}
          aria-label="You"
          aria-current={space === "you" ? "page" : undefined}
        >
          {user.avatar ? (
            <img src={user.avatar} alt="" className="shell__avatar" referrerPolicy="no-referrer" />
          ) : (
            <span className="shell__initial">{initial}</span>
          )}
          <span className="shell__you-label">You</span>
        </button>
      </header>

      <main className="shell__main">{children}</main>

      <nav className="shell__nav shell__nav--mobile" aria-label="Primary">
        <button
          type="button"
          className={`shell__tab${space === "ultras" ? " is-active" : ""}`}
          onClick={() => onSpace("ultras")}
          aria-current={space === "ultras" ? "page" : undefined}
        >
          Ultras
        </button>
        <button
          type="button"
          className={`shell__tab${space === "library" ? " is-active" : ""}`}
          onClick={() => onSpace("library")}
          aria-current={space === "library" ? "page" : undefined}
        >
          Library
        </button>
        <button
          type="button"
          className={`shell__tab${space === "you" ? " is-active" : ""}`}
          onClick={() => onSpace("you")}
          aria-current={space === "you" ? "page" : undefined}
        >
          You
        </button>
      </nav>
    </div>
  );
}
