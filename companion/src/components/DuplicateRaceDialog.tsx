import type { ImportDuplicateMatch } from "@shared/api/importGpx";

interface DuplicateRaceDialogProps {
  matches: ImportDuplicateMatch[];
  fileName: string;
  onReplace: (raceId: string) => void;
  onDuplicate: () => void;
  onCancel: () => void;
}

export default function DuplicateRaceDialog({
  matches,
  fileName,
  onReplace,
  onDuplicate,
  onCancel,
}: DuplicateRaceDialogProps) {
  const primary = matches[0];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-race-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141414] p-5 shadow-2xl"
      >
        <h2 id="duplicate-race-title" className="text-lg font-semibold text-white">
          Route already exists
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          <span className="font-medium text-white/80">{fileName}</span> matches an existing race
          {primary ? (
            <>
              {" "}
              <span className="font-medium text-white/80">{primary.name}</span>
            </>
          ) : null}
          . Choose how to proceed.
        </p>
        {matches.length > 1 ? (
          <ul className="mt-3 space-y-1 text-xs text-white/45">
            {matches.map((match) => (
              <li key={match.id}>
                {match.name}
                {match.distance_km ? ` · ${Math.round(match.distance_km)} km` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-5 flex flex-col gap-2">
          {primary ? (
            <button
              type="button"
              onClick={() => onReplace(primary.id)}
              className="min-h-[48px] rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black"
            >
              Replace existing
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDuplicate}
            className="min-h-[48px] rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white"
          >
            Import as duplicate
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-white/45"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
