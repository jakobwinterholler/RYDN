/** Temporary discovery marker — grey circle with subtle blue sparkle badge. */

export const DISCOVER_MARKER_GREY = "#9ca3af";
export const DISCOVER_SPARKLE_BLUE = "#3b82f6";
/** Between normal stops (12px) and selected stops (16px). */
export const DISCOVER_MARKER_SIZE_PX = 14;
export const DISCOVER_MARKER_SELECTED_SIZE_PX = 15;

export interface DiscoverMarkerOptions {
  selected?: boolean;
  animationDelayMs?: number;
  size?: number;
}

export function discoverMarkerHtml(options: DiscoverMarkerOptions = {}): string {
  const size =
    options.size ?? (options.selected ? DISCOVER_MARKER_SELECTED_SIZE_PX : DISCOVER_MARKER_SIZE_PX);
  const delay = options.animationDelayMs ?? 0;
  const selected = options.selected ?? false;
  const ring = selected ? "box-shadow:0 0 0 3px rgba(59,130,246,.22);" : "";

  return `<div class="discover-marker-pin" style="animation-delay:${delay}ms;${ring}">
  <div class="discover-marker-circle" style="width:${size}px;height:${size}px;background:${DISCOVER_MARKER_GREY};border:2px solid #fff;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,.2);"></div>
  <span class="discover-marker-sparkle" style="position:absolute;top:-3px;right:-4px;width:9px;height:9px;border-radius:9999px;background:${DISCOVER_SPARKLE_BLUE};border:1.5px solid #fff;color:#fff;font-size:7px;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,.15);" aria-hidden="true">+</span>
</div>`;
}

export const DISCOVER_MARKER_CSS = `
.discover-marker-pin {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: discover-marker-in 0.45s ease-out both;
  cursor: pointer;
  background: transparent;
  border: none;
  padding: 0;
}
.discover-marker-circle {
  flex-shrink: 0;
}
`;
