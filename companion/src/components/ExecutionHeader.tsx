import { useCompanion } from "../context/CompanionContext";
import { formatKm } from "../lib/utils";
import { GpsStatusBadge } from "./GpsStatusBadge";

interface ExecutionHeaderProps {
  /** Semi-transparent overlay for map screen */
  overlay?: boolean;
}

export default function ExecutionHeader({ overlay = false }: ExecutionHeaderProps) {
  const { currentKm } = useCompanion();

  return (
    <header
      className={`shrink-0 px-4 pb-2 ${
        overlay
          ? "bg-gradient-to-b from-black/75 via-black/45 to-transparent"
          : "border-b border-white/8 bg-[#0a0a0a]"
      }`}
    >
      <div className="flex min-h-[40px] items-center gap-2">
        <span className="text-[13px] font-medium tabular-nums text-white/65">
          {formatKm(currentKm)}
        </span>
        <GpsStatusBadge compact />
      </div>
    </header>
  );
}
