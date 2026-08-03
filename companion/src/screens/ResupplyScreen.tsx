import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stopIdentity } from "@shared/race/stopMatching";
import { formatRidingTime } from "@shared/race/riderAssumptions";
import { useCompanion } from "../context/CompanionContext";
import { buildResupplyCards, formatKm } from "../lib/utils";
import { isVerifiedEverywhere, isVerifiedLocally } from "../lib/raceExecution";
import { haptic } from "../lib/haptics";
import NextVerifiedStopCard from "../components/NextVerifiedStopCard";
import StopSheet from "../components/StopSheet";
import UnsupportedSectionSheet from "../components/UnsupportedSectionSheet";
import type { CompanionStop, CompanionUnsupportedSection } from "../types";

function VerificationBadge({ status }: { status: string }) {
  if (isVerifiedEverywhere(status as CompanionStop["verificationStatus"])) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
        ✓
      </span>
    );
  }
  if (isVerifiedLocally(status as CompanionStop["verificationStatus"])) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/80 text-[10px] font-bold text-white">
        ✓
      </span>
    );
  }
  return null;
}

function ResupplyGapRow({
  gap,
  onUnsupportedClick,
}: {
  gap: NonNullable<ReturnType<typeof buildResupplyCards>[number]["gapBefore"]>;
  onUnsupportedClick: () => void;
}) {
  return (
    <div
      className="my-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 border-l-2 py-1 pl-2 text-center text-[11px] tabular-nums text-white/35"
      style={{ borderLeftColor: gap.difficultyColor }}
    >
      <span>{formatKm(gap.distanceKm)}</span>
      <span className="text-white/15" aria-hidden>
        ·
      </span>
      <span>+{gap.elevationGainM} m</span>
      <span className="text-white/15" aria-hidden>
        ·
      </span>
      <span>−{gap.elevationLossM} m</span>
      <span className="text-white/15" aria-hidden>
        ·
      </span>
      <span>{formatRidingTime(gap.ridingTimeHours)}</span>
      <span className="text-white/15" aria-hidden>
        ·
      </span>
      <span style={{ color: gap.difficultyColor }}>{gap.difficultyLabel}</span>
      {gap.unsupportedLabel ? (
        <>
          <span className="text-white/15" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={onUnsupportedClick}
            className="text-amber-300/50 underline-offset-2 hover:underline"
          >
            Unsupported
          </button>
        </>
      ) : null}
    </div>
  );
}

export default function ResupplyScreen() {
  const listRef = useRef<HTMLDivElement | null>(null);
  const userScrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const { bundle, currentKm, selectedStop, selectStop } = useCompanion();
  const [selectedSection, setSelectedSection] = useState<CompanionUnsupportedSection | null>(null);

  const cards = useMemo(() => buildResupplyCards(bundle, true), [bundle]);

  const nextIndex = useMemo(
    () => cards.findIndex((entry) => entry.stop.km >= currentKm - 0.5),
    [cards, currentKm],
  );

  useEffect(() => {
    if (nextIndex < 0 || !listRef.current || userScrollingRef.current) {
      return;
    }
    const row = listRef.current.querySelector(`[data-stop-index="${nextIndex}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentKm, nextIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const markUserScroll = () => {
      userScrollingRef.current = true;
      if (scrollIdleTimerRef.current != null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = window.setTimeout(() => {
        userScrollingRef.current = false;
      }, 4000);
    };

    list.addEventListener("scroll", markUserScroll, { passive: true });
    list.addEventListener("touchstart", markUserScroll, { passive: true });

    return () => {
      list.removeEventListener("scroll", markUserScroll);
      list.removeEventListener("touchstart", markUserScroll);
      if (scrollIdleTimerRef.current != null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
    };
  }, []);

  const scrollToStopIndex = useCallback((index: number) => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const row = list.querySelector(`[data-stop-index="${index}"]`);
    if (row) {
      userScrollingRef.current = true;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        userScrollingRef.current = false;
      }, 600);
    }
  }, []);

  const handleStopTap = useCallback(
    (stop: CompanionStop, index: number) => {
      haptic("selection");
      selectStop(stop);
      scrollToStopIndex(index);
    },
    [scrollToStopIndex, selectStop],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 space-y-3 border-b border-white/8 px-4 pb-4 pt-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
            What happens next?
          </p>
          <p className="mt-0.5 text-sm text-white/50">Verified resupply plan ahead</p>
        </div>
        <NextVerifiedStopCard bundle={bundle} currentKm={currentKm} />
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {cards.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/45">
            No verified stops yet. Verify stops on the Plan tab or in Verify.
          </p>
        ) : (
          cards.map((entry, index) => {
            const { stop, gapBefore } = entry;
            const isPast = stop.km < currentKm - 0.25;
            const isNext = index === nextIndex;

            return (
              <div key={`card-${stopIdentity(stop)}`} data-stop-index={index}>
                {gapBefore ? (
                  <ResupplyGapRow
                    gap={gapBefore}
                    onUnsupportedClick={() => {
                      const section = bundle.unsupportedSections.find(
                        (item) => item.displayLabel === gapBefore.unsupportedLabel,
                      );
                      if (section) {
                        setSelectedSection(section);
                      }
                    }}
                  />
                ) : null}

                <button
                  type="button"
                  onClick={() => handleStopTap(stop, index)}
                  className={`mb-3 flex min-h-[72px] w-full flex-col rounded-2xl border px-4 py-4 text-left transition duration-200 ${
                    isNext
                      ? "border-sky-400/35 bg-sky-500/12"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                  } ${isPast ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-3xl leading-none" aria-hidden>
                      {stop.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-base font-semibold text-white">
                        <VerificationBadge status={stop.verificationStatus} />
                        <span className="truncate">{stop.name}</span>
                        {isVerifiedLocally(stop.verificationStatus) ? (
                          <span className="shrink-0 text-[10px] font-medium text-sky-300/70">
                            on device
                          </span>
                        ) : null}
                      </p>
                      {stop.resupplyReason ? (
                        <p className="mt-1 line-clamp-2 text-xs text-white/45">{stop.resupplyReason}</p>
                      ) : (
                        <p className="mt-0.5 truncate text-sm text-white/45">{stop.categoryLabel}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-white/70">{formatKm(stop.km)}</p>
                      {isNext ? (
                        <span className="mt-1 inline-block rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
                          Next
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>

      <StopSheet
        stop={selectedStop}
        bundle={bundle}
        onClose={() => selectStop(null)}
        onSelectAlternative={selectStop}
      />
      <UnsupportedSectionSheet
        section={selectedSection}
        bundle={bundle}
        onClose={() => setSelectedSection(null)}
      />
    </div>
  );
}
