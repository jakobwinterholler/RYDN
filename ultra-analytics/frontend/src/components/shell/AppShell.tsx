import type { ReactNode } from "react";
import type { User } from "../../types";
import shellHeaderMark from "../../assets/shell-header-mark.png";

export type ShellSpace = "planning" | "trips" | "library" | "you";

interface Props {
  user: User;
  space: ShellSpace;
  onSpace: (s: ShellSpace) => void;
  children: ReactNode;
}

/** App chrome — Planning · Trips · Library. Account via top-right avatar. */
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
            className={`shell__tab${space === "planning" ? " is-active" : ""}`}
            onClick={() => onSpace("planning")}
            aria-current={space === "planning" ? "page" : undefined}
          >
            Planning
          </button>
          <button
            type="button"
            className={`shell__tab${space === "trips" ? " is-active" : ""}`}
            onClick={() => onSpace("trips")}
            aria-current={space === "trips" ? "page" : undefined}
          >
            Trips
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
          aria-label="Account"
          aria-current={space === "you" ? "page" : undefined}
          title="Account"
        >
          {user.avatar ? (
            <img src={user.avatar} alt="" className="shell__avatar" referrerPolicy="no-referrer" />
          ) : (
            <span className="shell__initial">{initial}</span>
          )}
          <span className="shell__you-label">Account</span>
        </button>
      </header>

      <main className="shell__main">{children}</main>

      <nav className="shell__nav shell__nav--mobile" aria-label="Primary">
        <button
          type="button"
          className={`shell__tab${space === "planning" ? " is-active" : ""}`}
          onClick={() => onSpace("planning")}
          aria-current={space === "planning" ? "page" : undefined}
        >
          Planning
        </button>
        <button
          type="button"
          className={`shell__tab${space === "trips" ? " is-active" : ""}`}
          onClick={() => onSpace("trips")}
          aria-current={space === "trips" ? "page" : undefined}
        >
          Trips
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
    </div>
  );
}
