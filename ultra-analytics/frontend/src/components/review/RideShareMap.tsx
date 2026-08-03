/**
 * Ride share map — RoutePreview detail plate.
 * Compact inland rides use a RYDN-restyled local basemap (lakes/roads/places);
 * wide multi-country spans keep the quiet country atlas.
 */

import RoutePreview from "../ui/RoutePreview";

type IntroReveal = boolean | "hold" | "play";

interface Props {
  points?: number[][];
  className?: string;
  reveal?: IntroReveal;
  onReady?: () => void;
}

export default function RideShareMap({ points, className = "", reveal, onReady }: Props) {
  return (
    <RoutePreview
      className={className}
      points={points}
      variant="detail"
      reveal={reveal}
      onReady={onReady}
    />
  );
}
