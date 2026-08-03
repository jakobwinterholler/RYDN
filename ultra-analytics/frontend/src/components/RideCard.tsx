import type { RideSummary } from "../types";
import { fmtDate } from "./ui/format";
import ScoreLine from "./ui/ScoreLine";

interface Props {
  ride: RideSummary;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

/** Source day in Library — ingredients for an Ultra. */
export default function RideCard({ ride, onOpen, onDelete }: Props) {
  return (
    <button type="button" className="ride-card" onClick={() => onOpen(ride.id)}>
      <div className="ride-card__top">
        <span className="ride-card__type">{ride.rideType}</span>
        <span className="ride-card__date">{fmtDate(ride.date)}</span>
      </div>

      <div className="ride-card__title">{ride.name}</div>

      <ScoreLine
        distanceKm={ride.distanceKm}
        elevationGainM={ride.elevationGainM}
        durationS={ride.durationS}
      />

      <span
        className="ride-card__del"
        role="button"
        tabIndex={0}
        aria-label="Remove from Library"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(ride.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            onDelete(ride.id);
          }
        }}
      >
        ×
      </span>
    </button>
  );
}
