import { haptic } from "../lib/haptics";

interface BottomNavProps {
  active: CompanionTab;
  onChange: (tab: CompanionTab) => void;
  onBackToLibrary: () => void;
}

function NavIcon({ tab, active }: { tab: CompanionTab | "library"; active: boolean }) {
  const color = active ? "text-white" : "text-white/40";
  if (tab === "library") {
    return (
      <svg className={`h-6 w-6 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M3 10.5L12 4l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tab === "map") {
    return (
      <svg className={`h-6 w-6 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" strokeLinejoin="round" />
        <path d="M9 4v14M15 6v14" />
      </svg>
    );
  }
  if (tab === "resupply") {
    return (
      <svg className={`h-6 w-6 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M6 6h15l-1.5 9H7.5L6 6z" strokeLinejoin="round" />
        <path d="M6 6L5 3H2" strokeLinecap="round" />
        <circle cx="9" cy="20" r="1" fill="currentColor" />
        <circle cx="18" cy="20" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (tab === "verify") {
    return (
      <svg className={`h-6 w-6 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={`h-6 w-6 ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 3v12M8 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BottomNav({ active, onChange, onBackToLibrary }: BottomNavProps) {
  const items: { id: CompanionTab; label: string; accent?: boolean }[] = [
    { id: "map", label: "Race" },
    { id: "resupply", label: "Resupply" },
    { id: "verify", label: "Verify", accent: true },
    { id: "share", label: "Share" },
  ];

  return (
    <nav
      className="shrink-0 border-t border-white/8 bg-[#0a0a0a]/92 backdrop-blur-xl"
      style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}
    >
      <div className="relative grid grid-cols-5">
        <button
          type="button"
          onClick={() => {
            haptic("selection");
            onBackToLibrary();
          }}
          aria-label="Race library"
          className="relative flex min-h-[52px] min-w-[44px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-white/40 transition-colors duration-200 hover:text-white/70 active:scale-95"
        >
          <NavIcon tab="library" active={false} />
          <span className="text-[11px] font-medium leading-none">Library</span>
        </button>
        {items.map((item) => {
          const isActive = active === item.id;
          const activeClass =
            item.accent && isActive
              ? "text-orange-300"
              : isActive
                ? "text-sky-300"
                : "text-white/40";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (!isActive) {
                  haptic("selection");
                }
                onChange(item.id);
              }}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex min-h-[52px] min-w-[44px] flex-col items-center justify-center gap-1 px-1 py-1.5 transition-[color,transform] duration-200 active:scale-95 ${activeClass}`}
            >
              {isActive ? (
                <span
                  className={`absolute top-0 h-0.5 w-8 rounded-full ${
                    item.accent ? "bg-orange-400" : "bg-sky-400"
                  }`}
                  aria-hidden
                />
              ) : null}
              <NavIcon tab={item.id} active={isActive} />
              <span className="text-[11px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export type CompanionTab = "map" | "resupply" | "verify" | "share";
