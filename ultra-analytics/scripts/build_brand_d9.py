#!/usr/bin/env python3
"""
RYDN brand vectors — Figma logo exports recreated as production Béziers.

Creative source (dark-on-black presentation PNGs):
  - R standalone brandmark (open-bowl italic R, horizontal right-side notch)
  - Square social mark (same R + thick incomplete circle / C at bottom-left)
  - RYDN. wordmark (circular period)
  - RYDN.BIKE lockup (BIKE at ~0.66 cap height, baseline-aligned)

Light-mode app icons: ink #111 / #1A1A18 on paper #F7F6F3.
Never ship the PNG exports as the mark — regenerate all rasters via resvg from SVG.
"""

from __future__ import annotations

import math
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
PUBLIC = ROOT / "frontend" / "public"
SRC_ASSETS = ROOT / "frontend" / "src" / "assets"

INK = "#111111"
INK_SOFT = "#1A1A18"
PAPER = "#F7F6F3"
WHITE = "#FFFFFF"
# Stealth social square: charcoal mark on pure black (FinalFinalFinal export).
STEALTH_MARK = "#212121"
STEALTH_BG = "#000000"
SLANT = -10.0
STEM = 20.0

# Bottom-left C / incomplete circle for standalone square social mark.
# Fitted from FinalFinalFinal PNG (true circle in path space; gap toward stem).
SOCIAL_C_CX = -11.46
SOCIAL_C_CY = 98.20
SOCIAL_C_RO = 28.47
SOCIAL_C_RI = 15.96
SOCIAL_C_A0 = 24.0  # deg; 0=east, + = clockwise (SVG y-down)
SOCIAL_C_A1 = 224.0


def skew(x: float, y: float, angle: float = SLANT) -> tuple[float, float]:
    return x + y * math.tan(math.radians(angle)), y


def fmt(n: float) -> str:
    s = f"{n:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


def xy(p: tuple[float, float]) -> str:
    return f"{fmt(p[0])} {fmt(p[1])}"


def letter_R(ox: float = 0.0) -> tuple[str, float]:
    """Open-bowl geometric italic R with horizontal notch (Figma brandmark)."""

    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y)

    w = STEM
    # Construction from Figma R export (unskewed design space, height 100):
    # - Continuous left stem (~20u)
    # - Bowl curves from top, ends in a flat horizontal terminal (~y=35)
    # - Thin right-side notch gap, then waist + diagonal leg
    d = (
        f"M{xy(P(0, 100))}"
        f"L{xy(P(0, 0))}"
        f"L{xy(P(50, 0))}"
        # Outer bowl — geometric arc, flat horizontal tip (not a teardrop)
        f"C{xy(P(68, 0))} {xy(P(76, 10))} {xy(P(76, 24))}"
        f"L{xy(P(76, 34))}"
        f"L{xy(P(64, 34))}"
        # Inner counter — thick wall, opens into the notch
        f"L{xy(P(64, 24))}"
        f"C{xy(P(64, 16))} {xy(P(58, 14))} {xy(P(46, 14))}"
        f"L{xy(P(w, 14))}"
        f"L{xy(P(w, 48))}"
        # Lower form: clean triangular tip → waist → leg (Figma rows 22–37)
        f"L{xy(P(40, 48))}"
        f"L{xy(P(54, 38))}"
        f"L{xy(P(70, 48))}"
        f"L{xy(P(62, 62))}"
        f"L{xy(P(82, 100))}"
        f"L{xy(P(56, 100))}"
        f"L{xy(P(38, 64))}"
        f"L{xy(P(w, 64))}"
        f"L{xy(P(w, 100))}"
        f"L{xy(P(0, 100))}"
        f"Z"
    )
    return d, 84.0


def letter_Y(ox: float = 0.0) -> tuple[str, float]:
    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y)

    d = (
        f"M{xy(P(0, 0))}"
        f"L{xy(P(24, 0))}"
        f"L{xy(P(40, 48))}"
        f"L{xy(P(56, 0))}"
        f"L{xy(P(80, 0))}"
        f"L{xy(P(50, 56))}"
        f"L{xy(P(50, 100))}"
        f"L{xy(P(30, 100))}"
        f"L{xy(P(30, 56))}"
        f"Z"
    )
    return d, 80.0


def letter_D(ox: float = 0.0) -> tuple[str, float]:
    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y)

    w = STEM
    d = (
        f"M{xy(P(0, 0))}"
        f"L{xy(P(44, 0))}"
        f"C{xy(P(72, 0))} {xy(P(86, 18))} {xy(P(86, 50))}"
        f"C{xy(P(86, 82))} {xy(P(72, 100))} {xy(P(44, 100))}"
        f"L{xy(P(0, 100))}"
        f"Z"
        f"M{xy(P(w, 16))}"
        f"L{xy(P(42, 16))}"
        f"C{xy(P(64, 16))} {xy(P(68, 28))} {xy(P(68, 50))}"
        f"C{xy(P(68, 72))} {xy(P(64, 84))} {xy(P(42, 84))}"
        f"L{xy(P(w, 84))}"
        f"Z"
    )
    return d, 88.0


def letter_N(ox: float = 0.0) -> tuple[str, float]:
    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y)

    w = STEM
    width = 86.0
    d = (
        f"M{xy(P(0, 0))}"
        f"L{xy(P(w, 0))}"
        f"L{xy(P(w, 48))}"
        f"L{xy(P(width - w, 0))}"
        f"L{xy(P(width, 0))}"
        f"L{xy(P(width, 100))}"
        f"L{xy(P(width - w, 100))}"
        f"L{xy(P(width - w, 52))}"
        f"L{xy(P(w, 100))}"
        f"L{xy(P(0, 100))}"
        f"Z"
    )
    return d, width


def _small_P(ox: float, scale: float, x: float, y: float) -> tuple[float, float]:
    """Scale letter toward baseline (BIKE sits on the RYDN baseline)."""
    y2 = 100 - (100 - y) * scale
    return skew(ox + x * scale, y2)


def letter_B_small(ox: float, scale: float = 0.66) -> tuple[str, float]:
    P = lambda x, y: _small_P(ox, scale, x, y)  # noqa: E731
    w = STEM
    d = (
        f"M{xy(P(0, 0))}L{xy(P(46, 0))}"
        f"C{xy(P(68, 0))} {xy(P(72, 14))} {xy(P(72, 28))}"
        f"C{xy(P(72, 40))} {xy(P(64, 48))} {xy(P(52, 50))}"
        f"C{xy(P(70, 52))} {xy(P(76, 64))} {xy(P(76, 78))}"
        f"C{xy(P(76, 92))} {xy(P(64, 100))} {xy(P(46, 100))}"
        f"L{xy(P(0, 100))}Z"
        f"M{xy(P(w, 12))}L{xy(P(44, 12))}"
        f"C{xy(P(54, 12))} {xy(P(56, 18))} {xy(P(56, 26))}"
        f"C{xy(P(56, 34))} {xy(P(52, 38))} {xy(P(42, 38))}"
        f"L{xy(P(w, 38))}Z"
        f"M{xy(P(w, 58))}L{xy(P(46, 58))}"
        f"C{xy(P(58, 58))} {xy(P(60, 66))} {xy(P(60, 76))}"
        f"C{xy(P(60, 88))} {xy(P(54, 88))} {xy(P(44, 88))}"
        f"L{xy(P(w, 88))}Z"
    )
    return d, 76 * scale + 2


def letter_I_small(ox: float, scale: float = 0.66) -> tuple[str, float]:
    P = lambda x, y: _small_P(ox, scale, x, y)  # noqa: E731
    w = STEM
    d = f"M{xy(P(0, 0))}L{xy(P(w, 0))}L{xy(P(w, 100))}L{xy(P(0, 100))}Z"
    return d, 28 * scale + 2


def letter_K_small(ox: float, scale: float = 0.66) -> tuple[str, float]:
    P = lambda x, y: _small_P(ox, scale, x, y)  # noqa: E731
    w = STEM
    pts = [
        P(0, 0),
        P(w, 0),
        P(w, 38),
        P(64, 0),
        P(88, 0),
        P(46, 48),
        P(90, 100),
        P(66, 100),
        P(w, 56),
        P(w, 100),
        P(0, 100),
    ]
    d = "M" + "L".join(xy(p) for p in pts) + "Z"
    return d, 90 * scale + 2


def letter_E_small(ox: float, scale: float = 0.66) -> tuple[str, float]:
    P = lambda x, y: _small_P(ox, scale, x, y)  # noqa: E731
    w = STEM
    t = 15
    pts = [
        P(0, 0),
        P(72, 0),
        P(72, t),
        P(w, t),
        P(w, 42),
        P(58, 42),
        P(58, 42 + t),
        P(w, 42 + t),
        P(w, 100 - t),
        P(72, 100 - t),
        P(72, 100),
        P(0, 100),
    ]
    d = "M" + "L".join(xy(p) for p in pts) + "Z"
    return d, 72 * scale + 2


def period_dot(ox: float, scale: float = 1.0) -> tuple[str, float]:
    """Circular period on the baseline (Figma RYDN. / RYDN.BIKE)."""
    r = 10.0 * scale
    cx = ox + r
    cy = 100 - r
    k = 0.5522847498

    def P(x: float, y: float) -> tuple[float, float]:
        return skew(x, y)

    d = (
        f"M{xy(P(cx, cy - r))}"
        f"C{xy(P(cx + k * r, cy - r))} {xy(P(cx + r, cy - k * r))} {xy(P(cx + r, cy))}"
        f"C{xy(P(cx + r, cy + k * r))} {xy(P(cx + k * r, cy + r))} {xy(P(cx, cy + r))}"
        f"C{xy(P(cx - k * r, cy + r))} {xy(P(cx - r, cy + k * r))} {xy(P(cx - r, cy))}"
        f"C{xy(P(cx - r, cy - k * r))} {xy(P(cx - k * r, cy - r))} {xy(P(cx, cy - r))}"
        f"Z"
    )
    return d, 2 * r + 10


def svg_doc(body: str, view_box: str, w: str | None = None, h: str | None = None) -> str:
    attrs = f'xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" fill="none"'
    if w:
        attrs += f' width="{w}"'
    if h:
        attrs += f' height="{h}"'
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<svg {attrs}>\n{body}\n</svg>\n'


def compose_wordmark(fill: str, with_bike: bool = False) -> str:
    parts: list[str] = []
    x = 0.0
    track = 8.0
    for fn in (letter_R, letter_Y, letter_D, letter_N):
        d, adv = fn(x)
        parts.append(f'<path fill="{fill}" fill-rule="evenodd" d="{d}"/>')
        x += adv - track
    # Period always — wordmark is RYDN. ; lockup is RYDN.BIKE
    x += 6
    d, adv = period_dot(x)
    parts.append(f'<path fill="{fill}" d="{d}"/>')
    x += adv
    if with_bike:
        x += 4
        bike_scale = 0.66
        for fn in (letter_B_small, letter_I_small, letter_K_small, letter_E_small):
            d, adv = fn(x, bike_scale)
            parts.append(f'<path fill="{fill}" fill-rule="evenodd" d="{d}"/>')
            x += adv + 3
    pad_l, pad_t, pad_r, pad_b = 24, 8, 28, 10
    body = (
        f'  <g transform="translate({pad_l},{pad_t})">\n    '
        + "\n    ".join(parts)
        + "\n  </g>"
    )
    return svg_doc(body, f"0 0 {x + pad_l + pad_r:.0f} {100 + pad_t + pad_b}")


# Favicon-tuned notched R for 16–48 — heavier stem, open counter, visible notch.
# Snapped for crisp stems at 16/32; notch reads as a clean horizontal break on the right.
FAV_R = (
    "M7 27.5 L7 4.5 L17 4.5 "
    "C21.5 4.5 24.5 6.5 24.5 10.5 "
    "L24.5 14.5 L19.5 14.5 L19.5 11 "
    "C19.5 9.2 18.2 8.5 16 8.5 L11 8.5 "
    "L11 16.5 L15 16.5 L18.5 13.5 L22 16.5 L20 20 "
    "L24.5 27.5 L18.5 27.5 L14.5 21 L11 21 L11 27.5 Z"
)

# Axis-aligned bounds of letter_R after -10° slant (design space).
_R_BOUNDS = (-17.63, 0.0, 82.0, 100.0)

# Home-screen optical R (≤180 / apple-touch): heavier stem, less slant, thicker walls.
HOME_STEM = 28.0
HOME_SLANT = -7.0
HOME_FILL = 0.70
HOME_ICON_SIZES = (64, 72, 96, 120, 128, 144, 152, 167, 180, 192)
SNAP_INK_MAX = 0.42
SNAP_PAPER_MIN = 0.68


def letter_R_home(ox: float = 0.0) -> tuple[str, float]:
    """Home-screen optical R — same notched DNA, heavier for AA at 60pt."""

    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y, HOME_SLANT)

    w = HOME_STEM
    d = (
        f"M{xy(P(0, 100))}"
        f"L{xy(P(0, 0))}"
        f"L{xy(P(54, 0))}"
        f"C{xy(P(74, 0))} {xy(P(84, 12))} {xy(P(84, 26))}"
        f"L{xy(P(84, 36))}"
        f"L{xy(P(68, 36))}"
        f"L{xy(P(68, 26))}"
        f"C{xy(P(68, 18))} {xy(P(60, 16))} {xy(P(46, 16))}"
        f"L{xy(P(w, 16))}"
        f"L{xy(P(w, 50))}"
        f"L{xy(P(42, 50))}"
        f"L{xy(P(56, 40))}"
        f"L{xy(P(76, 50))}"
        f"L{xy(P(66, 64))}"
        f"L{xy(P(88, 100))}"
        f"L{xy(P(54, 100))}"
        f"L{xy(P(38, 66))}"
        f"L{xy(P(w, 66))}"
        f"L{xy(P(w, 100))}"
        f"L{xy(P(0, 100))}"
        f"Z"
    )
    return d, 96.0


def _home_bounds() -> tuple[float, float, float, float]:
    pts = [
        skew(0, 0, HOME_SLANT),
        skew(0, 100, HOME_SLANT),
        skew(HOME_STEM, 100, HOME_SLANT),
        skew(86, 24, HOME_SLANT),
        skew(86, 100, HOME_SLANT),
        skew(54, 0, HOME_SLANT),
        skew(76, 52, HOME_SLANT),
    ]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _mark_place(
    canvas: float,
    fill_ratio: float,
    *,
    path_d: str | None = None,
    bounds: tuple[float, float, float, float] | None = None,
    bias: tuple[float, float] = (-1.2, -1.0),
) -> tuple[str, float, float, float]:
    if path_d is None:
        path_d, _ = letter_R(0)
    min_x, min_y, max_x, max_y = bounds if bounds is not None else _R_BOUNDS
    cx = (min_x + max_x) / 2 + bias[0]
    cy = (min_y + max_y) / 2 + bias[1]
    scale = (canvas * fill_ratio) / (max_y - min_y)
    tx = canvas / 2 - cx * scale
    ty = canvas / 2 - cy * scale
    return path_d, tx, ty, scale


def _softsnap_rgba(im: "Image.Image") -> "Image.Image":  # type: ignore[name-defined]
    im = im.convert("RGBA")
    out = im.copy()
    px = im.load()
    op = out.load()
    ink = (0x11, 0x11, 0x11, 255)
    paper = (0xF7, 0xF6, 0xF3, 255)
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b, a = px[x, y]
            t = (r - 17) / 230.0
            if t < SNAP_INK_MAX:
                op[x, y] = ink
            elif t > SNAP_PAPER_MIN:
                op[x, y] = paper
    return out


def favicon_svg() -> str:
    return svg_doc(
        f'  <rect width="32" height="32" rx="7.5" fill="{INK}"/>\n'
        f'  <path fill="{WHITE}" fill-rule="evenodd" d="{FAV_R}"/>',
        "0 0 32 32",
    )


def brandmark_svg(fill: str = "currentColor") -> str:
    d, _ = letter_R(0)
    return svg_doc(
        f'  <g transform="translate(22,4)"><path fill="{fill}" d="{d}"/></g>',
        "0 0 118 110",
    )


def social_c_path(
    cx: float = SOCIAL_C_CX,
    cy: float = SOCIAL_C_CY,
    ro: float = SOCIAL_C_RO,
    ri: float = SOCIAL_C_RI,
    a0: float = SOCIAL_C_A0,
    a1: float = SOCIAL_C_A1,
) -> str:
    """Thick incomplete circle (lowercase-c) tucked at bottom-left of the R."""

    def pt(r: float, ang: float) -> tuple[float, float]:
        rad = math.radians(ang)
        return cx + r * math.cos(rad), cy + r * math.sin(rad)

    span = (a1 - a0) % 360.0
    large = 1 if span > 180 else 0
    o0, o1 = pt(ro, a0), pt(ro, a1)
    i0, i1 = pt(ri, a0), pt(ri, a1)
    return (
        f"M{fmt(o0[0])} {fmt(o0[1])}"
        f"A{fmt(ro)} {fmt(ro)} 0 {large} 1 {fmt(o1[0])} {fmt(o1[1])}"
        f"L{fmt(i1[0])} {fmt(i1[1])}"
        f"A{fmt(ri)} {fmt(ri)} 0 {large} 0 {fmt(i0[0])} {fmt(i0[1])}"
        f"Z"
    )


def _social_bounds() -> tuple[float, float, float, float]:
    """Axis-aligned bounds of R + social C in letter_R path space."""
    min_x, min_y, max_x, max_y = _R_BOUNDS[0], _R_BOUNDS[1], _R_BOUNDS[2], _R_BOUNDS[3]
    cx, cy, ro = SOCIAL_C_CX, SOCIAL_C_CY, SOCIAL_C_RO
    a0, a1 = int(SOCIAL_C_A0), int(SOCIAL_C_A1)
    for ang in range(a0, a1 + 1, 2):
        rad = math.radians(ang)
        x = cx + ro * math.cos(rad)
        y = cy + ro * math.sin(rad)
        min_x, max_x = min(min_x, x), max(max_x, x)
        min_y, max_y = min(min_y, y), max(max_y, y)
    return min_x, min_y, max_x, max_y


def social_square_svg(bg: str, fg: str, canvas: float = 1024.0, fill_ratio: float = 0.78) -> str:
    """Standalone Instagram/social square: notched italic R + bottom-left C on square."""
    r_d, _ = letter_R(0)
    c_d = social_c_path()
    bounds = _social_bounds()
    _, tx, ty, scale = _mark_place(
        canvas,
        fill_ratio,
        path_d=r_d,
        bounds=bounds,
        bias=(0.0, 0.0),
    )
    c = int(canvas) if canvas == int(canvas) else canvas
    body = (
        f'  <rect width="{c}" height="{c}" fill="{bg}"/>\n'
        f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.4f})">\n'
        f'    <path fill="{fg}" fill-rule="evenodd" d="{r_d}"/>\n'
        f'    <path fill="{fg}" d="{c_d}"/>\n'
        f"  </g>"
    )
    return svg_doc(body, f"0 0 {c} {c}", str(c), str(c))


def icon_master(bg: str, fg: str) -> str:
    d, tx, ty, scale = _mark_place(1024.0, 0.58)
    return svg_doc(
        f'  <rect width="1024" height="1024" fill="{bg}"/>\n'
        f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.4f})">\n'
        f'    <path fill="{fg}" d="{d}"/>\n'
        f"  </g>",
        "0 0 1024 1024",
        "1024",
        "1024",
    )


def icon_transparent(fg: str = INK) -> str:
    d, tx, ty, scale = _mark_place(1024.0, 0.58)
    return svg_doc(
        f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.4f})">\n'
        f'    <path fill="{fg}" d="{d}"/>\n'
        f"  </g>",
        "0 0 1024 1024",
        "1024",
        "1024",
    )


def icon_home_master(bg: str, fg: str, canvas: float = 1024.0) -> str:
    d, _ = letter_R_home(0)
    d, tx, ty, scale = _mark_place(
        canvas,
        HOME_FILL,
        path_d=d,
        bounds=_home_bounds(),
        bias=(-1.5, -1.2),
    )
    tx = round(tx * 4) / 4
    ty = round(ty * 4) / 4
    c = int(canvas) if canvas == int(canvas) else canvas
    return svg_doc(
        f'  <rect width="{c}" height="{c}" fill="{bg}"/>\n'
        f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.4f})">\n'
        f'    <path fill="{fg}" d="{d}"/>\n'
        f"  </g>",
        f"0 0 {c} {c}",
        str(c),
        str(c),
    )


def maskable_svg() -> str:
    d, _ = letter_R_home(0)
    d, tx, ty, scale = _mark_place(
        512.0,
        0.52,
        path_d=d,
        bounds=_home_bounds(),
        bias=(-1.5, -1.2),
    )
    return svg_doc(
        f'  <rect width="512" height="512" fill="{INK}"/>\n'
        f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.4f})">\n'
        f'    <path fill="{WHITE}" d="{d}"/>\n'
        f"  </g>",
        "0 0 512 512",
    )


def loading_animation_svg() -> str:
    parts: list[str] = []
    x = 0.0
    track = 8.0
    for fn in (letter_R, letter_Y, letter_D, letter_N):
        d, adv = fn(x)
        parts.append(f'<path fill="currentColor" d="{d}"/>')
        x += adv - track
    d, adv = period_dot(x + 6)
    parts.append(f'<path fill="currentColor" d="{d}"/>')
    route = "M18 42 C44 42 52 30 78 34 C104 38 112 46 148 42 C168 40 178 42 196 42"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 84" fill="none">
  <style>
    .route{{stroke-dasharray:240;stroke-dashoffset:240;animation:draw 1s cubic-bezier(.4,0,.2,1) infinite}}
    .mark{{opacity:0;animation:resolve 1s cubic-bezier(.4,0,.2,1) infinite}}
    .dot{{animation:dotfade 1s cubic-bezier(.4,0,.2,1) infinite}}
    @keyframes draw{{0%{{stroke-dashoffset:240;opacity:.9}}55%{{stroke-dashoffset:0;opacity:.9}}70%{{opacity:0}}100%{{opacity:0}}}}
    @keyframes resolve{{0%,58%{{opacity:0}}72%,90%{{opacity:1}}100%{{opacity:0}}}}
    @keyframes dotfade{{0%,55%{{opacity:1}}68%,100%{{opacity:0}}}}
  </style>
  <g stroke="currentColor" fill="none" stroke-width="2.25" stroke-linecap="round">
    <path class="route" d="{route}"/>
    <circle class="dot" cx="18" cy="42" r="3.1" fill="currentColor" stroke="none"/>
    <circle class="dot" cx="196" cy="42" r="3.1" fill="currentColor" stroke="none"/>
  </g>
  <g class="mark" transform="translate(8,10) scale(0.48)">
    {"".join(parts)}
  </g>
</svg>
"""


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


def write_ico(path: Path, pngs: list[tuple[int, bytes]]) -> None:
    count = len(pngs)
    offset = 6 + 16 * count
    entries = bytearray()
    payload = bytearray()
    for size, data in pngs:
        w = 0 if size >= 256 else size
        h = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    path.write_bytes(struct.pack("<HHH", 0, 1, count) + bytes(entries) + bytes(payload))
    print(f"wrote {path.relative_to(ROOT)}")


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)

    write(BRAND / "logo.svg", compose_wordmark(INK, True))
    write(BRAND / "logo-dark.svg", compose_wordmark(WHITE, True))
    write(BRAND / "logo-light.svg", compose_wordmark(INK_SOFT, True))
    write(BRAND / "logo-transparent.svg", compose_wordmark("currentColor", True))
    write(BRAND / "wordmark.svg", compose_wordmark(INK, False))
    write(BRAND / "wordmark-dark.svg", compose_wordmark(WHITE, False))
    write(BRAND / "wordmark-light.svg", compose_wordmark(INK_SOFT, False))
    write(BRAND / "wordmark-transparent.svg", compose_wordmark("currentColor", False))
    write(BRAND / "brandmark.svg", brandmark_svg(INK))
    write(BRAND / "brandmark-dark.svg", brandmark_svg(WHITE))
    write(BRAND / "brandmark-light.svg", brandmark_svg(INK_SOFT))
    write(BRAND / "brandmark-transparent.svg", brandmark_svg("currentColor"))
    write(BRAND / "favicon.svg", favicon_svg())
    write(BRAND / "loading-logo.svg", compose_wordmark("currentColor", False))
    write(BRAND / "loading-animation.svg", loading_animation_svg())
    write(BRAND / "icon-dark.svg", icon_master(INK, WHITE))
    write(BRAND / "icon-light.svg", icon_master(PAPER, INK))
    write(BRAND / "icon-transparent.svg", icon_transparent(INK))
    # Standalone square social mark (R + bottom-left C) — Instagram / avatar.
    write(BRAND / "social-avatar.svg", social_square_svg(STEALTH_BG, STEALTH_MARK))
    write(BRAND / "icon-social.svg", social_square_svg(STEALTH_BG, STEALTH_MARK))
    write(BRAND / "social-avatar-light.svg", social_square_svg(PAPER, INK))
    mono_d, mono_tx, mono_ty, mono_s = _mark_place(1024.0, 0.58)
    write(
        BRAND / "icon-mono.svg",
        svg_doc(
            f'  <g transform="translate({mono_tx:.2f},{mono_ty:.2f}) scale({mono_s:.4f})">'
            f'<path fill="{INK}" d="{mono_d}"/></g>',
            "0 0 1024 1024",
            "1024",
            "1024",
        ),
    )

    write(PUBLIC / "icon-source.svg", icon_master(PAPER, INK))
    write(PUBLIC / "icon-source-home.svg", icon_home_master(PAPER, INK, 1024.0))
    write(BRAND / "icon-home.svg", icon_home_master(PAPER, INK, 1024.0))
    for s in (120, 152, 167, 180, 192):
        write(PUBLIC / f"icon-source-home-{s}.svg", icon_home_master(PAPER, INK, float(s)))
    write(PUBLIC / "favicon.svg", favicon_svg())
    write(PUBLIC / "icon-maskable.svg", maskable_svg())

    r_d, _ = letter_R(0)
    # Same tracking as compose_wordmark for in-app loader paths
    wx = 0.0
    track = 8.0
    wr, wa = letter_R(wx)
    wx += wa - track
    wy, wa = letter_Y(wx)
    wx += wa - track
    wd, wa = letter_D(wx)
    wx += wa - track
    wn, wa = letter_N(wx)
    wx += wa - track + 6
    wp, _ = period_dot(wx)

    write(
        SRC_ASSETS / "rydn-mark.svg",
        svg_doc(
            f'  <!-- RYDN notched R — favicon-tuned for UI 16–48; app icons use brandmark Béziers. -->\n'
            f'  <path fill="currentColor" fill-rule="evenodd" d="{FAV_R}"/>',
            "0 0 32 32",
        ),
    )
    write(SRC_ASSETS / "rydn-wordmark.svg", compose_wordmark("currentColor", False))
    write(
        SRC_ASSETS / "rydn-paths.ts",
        "/** Auto-generated by scripts/build_brand_d9.py — do not edit by hand. */\n"
        f'export const RYDN_FAV_R = "{FAV_R}";\n'
        f'export const RYDN_BRAND_R = "{r_d}";\n'
        f"export const RYDN_WORDMARK = {{\n"
        f'  r: "{wr}",\n'
        f'  y: "{wy}",\n'
        f'  d: "{wd}",\n'
        f'  n: "{wn}",\n'
        f'  period: "{wp}",\n'
        f"}} as const;\n",
    )

    home_sizes_js = ",".join(str(s) for s in HOME_ICON_SIZES)
    pixel_exact = (120, 152, 167, 180, 192)
    pixel_exact_js = ",".join(str(s) for s in pixel_exact)
    large_sizes = [
        s
        for s in (64, 72, 96, 120, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024)
        if s not in HOME_ICON_SIZES
    ]
    large_sizes_js = ",".join(str(s) for s in large_sizes)

    batch = ROOT / "scripts" / "_resvg_batch.mjs"
    batch.write_text(
        f"""
import {{ readFileSync, writeFileSync, copyFileSync, existsSync }} from 'node:fs';
import {{ join }} from 'node:path';
import {{ createRequire }} from 'node:module';
const require = createRequire(join(process.cwd(), 'frontend/package.json'));
const {{ Resvg }} = require('@resvg/resvg-js');
const BRAND = 'assets/brand';
const PUBLIC = 'frontend/public';
const HOME = PUBLIC+'/icon-source-home.svg';
const FULL = PUBLIC+'/icon-source.svg';
const PIXEL_EXACT = new Set([{pixel_exact_js}]);
function render(src, size, out) {{
  const r = new Resvg(readFileSync(src), {{ fitTo: {{ mode: 'width', value: size }}, background: 'transparent' }});
  const png = r.render().asPng();
  writeFileSync(out, png);
  console.log(out, png.length, '(SVG→'+size+'px)');
  return png;
}}
function homeSrc(size) {{
  const exact = PUBLIC+`/icon-source-home-${{size}}.svg`;
  return (PIXEL_EXACT.has(size) && existsSync(exact)) ? exact : HOME;
}}
render(homeSrc(180), 180, BRAND+'/apple-touch-icon.png');
render(homeSrc(192), 192, BRAND+'/icon-192.png');
render(FULL, 512, BRAND+'/icon-512.png');
render(PUBLIC+'/icon-maskable.svg', 512, BRAND+'/maskable-icon.png');
render(BRAND+'/social-avatar.svg', 1024, BRAND+'/social-avatar.png');
render(BRAND+'/social-avatar.svg', 512, BRAND+'/social-avatar-512.png');
render(BRAND+'/social-avatar-light.svg', 512, BRAND+'/_preview-social-light.png');
const f16 = render(BRAND+'/favicon.svg', 16, PUBLIC+'/icon-16.png');
const f32 = render(BRAND+'/favicon.svg', 32, PUBLIC+'/icon-32.png');
const f48 = render(BRAND+'/favicon.svg', 48, PUBLIC+'/icon-48.png');
writeFileSync(BRAND+'/_f16.png', f16);
writeFileSync(BRAND+'/_f32.png', f32);
writeFileSync(BRAND+'/_f48.png', f48);
for (const s of [{home_sizes_js}]) {{
  render(homeSrc(s), s, PUBLIC+`/icon-${{s}}.png`);
}}
for (const s of [{large_sizes_js}]) {{
  render(FULL, s, PUBLIC+`/icon-${{s}}.png`);
}}
copyFileSync(PUBLIC+'/icon-180.png', PUBLIC+'/apple-touch-icon.png');
copyFileSync(PUBLIC+'/icon-152.png', PUBLIC+'/apple-touch-icon-152.png');
copyFileSync(PUBLIC+'/icon-167.png', PUBLIC+'/apple-touch-icon-167.png');
copyFileSync(PUBLIC+'/apple-touch-icon.png', BRAND+'/apple-touch-icon.png');
copyFileSync(PUBLIC+'/icon-192.png', BRAND+'/icon-192.png');
copyFileSync(PUBLIC+'/icon-512.png', BRAND+'/icon-512.png');
render(PUBLIC+'/icon-maskable.svg', 192, PUBLIC+'/icon-maskable-192.png');
render(PUBLIC+'/icon-maskable.svg', 512, PUBLIC+'/icon-maskable-512.png');
copyFileSync(PUBLIC+'/icon-maskable-512.png', BRAND+'/maskable-icon.png');
for (const [src,size,out] of [
  [BRAND+'/logo.svg', 900, BRAND+'/_preview-logo.png'],
  [BRAND+'/wordmark.svg', 700, BRAND+'/_preview-wordmark.png'],
  [BRAND+'/brandmark.svg', 280, BRAND+'/_preview-brandmark.png'],
  [homeSrc(180), 180, BRAND+'/_preview-icon-180.png'],
  [homeSrc(120), 120, BRAND+'/_preview-icon-120.png'],
  [HOME, 256, BRAND+'/_preview-icon.png'],
  [BRAND+'/favicon.svg', 128, BRAND+'/_preview-favicon.png'],
]) {{
  const r = new Resvg(readFileSync(src), {{ fitTo: {{ mode: 'width', value: size }}, background: '{PAPER}' }});
  writeFileSync(out, r.render().asPng());
}}
""",
        encoding="utf-8",
    )
    subprocess.check_call(["node", str(batch)], cwd=str(ROOT))

    pngs = [
        (16, (BRAND / "_f16.png").read_bytes()),
        (32, (BRAND / "_f32.png").read_bytes()),
        (48, (BRAND / "_f48.png").read_bytes()),
    ]
    write_ico(BRAND / "favicon.ico", pngs)
    write_ico(PUBLIC / "favicon.ico", pngs)

    for p in list(BRAND.glob("_f*.png")):
        p.unlink()
    batch.unlink()

    try:
        from PIL import Image

        snap_targets = [
            *(PUBLIC / f"icon-{s}.png" for s in HOME_ICON_SIZES),
            PUBLIC / "apple-touch-icon.png",
            PUBLIC / "apple-touch-icon-152.png",
            PUBLIC / "apple-touch-icon-167.png",
            PUBLIC / "icon-maskable-192.png",
        ]
        for path in snap_targets:
            if not path.exists():
                continue
            snapped = _softsnap_rgba(Image.open(path))
            snapped.save(path, format="PNG", optimize=True)
            print(f"softsnap {path.relative_to(ROOT)}")

        (PUBLIC / "apple-touch-icon.png").write_bytes((PUBLIC / "icon-180.png").read_bytes())
        (PUBLIC / "apple-touch-icon-152.png").write_bytes((PUBLIC / "icon-152.png").read_bytes())
        (PUBLIC / "apple-touch-icon-167.png").write_bytes((PUBLIC / "icon-167.png").read_bytes())
        (BRAND / "apple-touch-icon.png").write_bytes((PUBLIC / "apple-touch-icon.png").read_bytes())
        (BRAND / "icon-192.png").write_bytes((PUBLIC / "icon-192.png").read_bytes())
        (BRAND / "maskable-icon.png").write_bytes((PUBLIC / "icon-maskable-512.png").read_bytes())

        for s in (16, 32, 48):
            Image.open(PUBLIC / f"icon-{s}.png").resize((s * 10, s * 10), Image.NEAREST).save(
                BRAND / f"_preview-icon{s}-xx.png"
            )
        at = Image.open(PUBLIC / "apple-touch-icon.png").convert("RGB")
        at.crop((95, 105, 155, 165)).resize((300, 300), Image.NEAREST).save(BRAND / "_proof-180-leg.png")
        at.crop((40, 30, 110, 100)).resize((300, 300), Image.NEAREST).save(BRAND / "_proof-180-bowl.png")
        Image.open(PUBLIC / "icon-120.png").convert("RGB").resize((360, 360), Image.NEAREST).save(
            BRAND / "_proof-120-nn.png"
        )
        at.resize((540, 540), Image.NEAREST).save(BRAND / "_proof-180-nn.png")
    except Exception as exc:
        print("softsnap/preview skipped:", exc)

    print("RYDN Figma brand pack complete →", BRAND)


if __name__ == "__main__":
    main()
