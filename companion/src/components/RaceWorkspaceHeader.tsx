interface RaceWorkspaceHeaderProps {
  raceName: string;
  onBackToLibrary: () => void;
}

export default function RaceWorkspaceHeader({
  raceName,
  onBackToLibrary,
}: RaceWorkspaceHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-1 border-b border-white/8 px-3 pb-2 pt-safe-top">
      <button
        type="button"
        onClick={onBackToLibrary}
        aria-label="Back to race library"
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-0.5 rounded-xl text-sky-300 transition hover:bg-white/8 active:scale-[0.98]"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-medium">Library</span>
      </button>
      <h1 className="min-w-0 flex-1 truncate px-1 text-center text-[15px] font-semibold leading-tight text-white">
        {raceName}
      </h1>
      <div className="min-w-[44px] shrink-0" aria-hidden />
    </header>
  );
}
