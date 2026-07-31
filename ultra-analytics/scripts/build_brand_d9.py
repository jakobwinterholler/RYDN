#!/usr/bin/env python3
"""
RYDN Direction #9 — original geometric italic brand vectors.

Feeling: premium / modern / fast / minimal / editorial / technical.
Not a pixel trace of the board. Soft paper + ink for light-mode app icons.
"""

from __future__ import annotations

import math
import struct
import subprocess
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
PUBLIC = ROOT / "frontend" / "public"
SRC_ASSETS = ROOT / "frontend" / "src" / "assets"

INK = "#111111"
PAPER = "#F7F6F3"
WHITE = "#FFFFFF"
SLANT = -10.0
STEM = 20.0


def skew(x: float, y: float, angle: float = SLANT) -> tuple[float, float]:
    return x + y * math.tan(math.radians(angle)), y


def fmt(n: float) -> str:
    s = f"{n:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


def xy(p: tuple[float, float]) -> str:
    return f"{fmt(p[0])} {fmt(p[1])}"


def letter_R(ox: float = 0.0) -> tuple[str, float]:
    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y)

    w = STEM
    d = (
        f"M{xy(P(0, 0))}"
        f"L{xy(P(50, 0))}"
        f"C{xy(P(74, 0))} {xy(P(86, 12))} {xy(P(86, 32))}"
        f"C{xy(P(86, 48))} {xy(P(74, 56))} {xy(P(50, 56))}"
        f"L{xy(P(72, 100))}"
        f"L{xy(P(48, 100))}"
        f"L{xy(P(28, 62))}"
        f"L{xy(P(w, 62))}"
        f"L{xy(P(w, 100))}"
        f"L{xy(P(0, 100))}"
        f"Z"
        f"M{xy(P(w, 14))}"
        f"L{xy(P(48, 14))}"
        f"C{xy(P(62, 14))} {xy(P(66, 20))} {xy(P(66, 32))}"
        f"C{xy(P(66, 44))} {xy(P(62, 48))} {xy(P(48, 48))}"
        f"L{xy(P(w, 48))}"
        f"Z"
    )
    return d, 86.0


def letter_Y(ox: float = 0.0) -> tuple[str, float]:
    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y)

    # V arms + vertical stem — classic geometric Y
    d = (
        f"M{xy(P(0, 0))}"
        f"L{xy(P(24, 0))}"
        f"L{xy(P(40, 50))}"
        f"L{xy(P(68, 0))}"
        f"L{xy(P(92, 0))}"
        f"L{xy(P(52, 58))}"
        f"L{xy(P(52, 100))}"
        f"L{xy(P(32, 100))}"
        f"L{xy(P(32, 58))}"
        f"Z"
    )
    return d, 92.0


def letter_D(ox: float = 0.0) -> tuple[str, float]:
    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y)

    w = STEM
    d = (
        f"M{xy(P(0, 0))}"
        f"L{xy(P(46, 0))}"
        f"C{xy(P(78, 0))} {xy(P(94, 20))} {xy(P(94, 50))}"
        f"C{xy(P(94, 80))} {xy(P(78, 100))} {xy(P(46, 100))}"
        f"L{xy(P(0, 100))}"
        f"Z"
        f"M{xy(P(w, 16))}"
        f"L{xy(P(46, 16))}"
        f"C{xy(P(70, 16))} {xy(P(74, 30))} {xy(P(74, 50))}"
        f"C{xy(P(74, 70))} {xy(P(70, 84))} {xy(P(46, 84))}"
        f"L{xy(P(w, 84))}"
        f"Z"
    )
    return d, 94.0


def letter_N(ox: float = 0.0) -> tuple[str, float]:
    def P(x: float, y: float) -> tuple[float, float]:
        return skew(ox + x, y)

    w = STEM
    # Classic geometric N: left stem, diagonal top-left → bottom-right, right stem
    width = 88.0
    d = (
        f"M{xy(P(0, 0))}"
        f"L{xy(P(w, 0))}"
        f"L{xy(P(w, 52))}"
        f"L{xy(P(width - w, 0))}"
        f"L{xy(P(width, 0))}"
        f"L{xy(P(width, 100))}"
        f"L{xy(P(width - w, 100))}"
        f"L{xy(P(width - w, 48))}"
        f"L{xy(P(w, 100))}"
        f"L{xy(P(0, 100))}"
        f"Z"
    )
    return d, width + 2


def _small_P(ox: float, scale: float, x: float, y: float) -> tuple[float, float]:
    y2 = 100 - (100 - y) * scale
    return skew(ox + x * scale, y2)


def letter_B_small(ox: float, scale: float = 0.46) -> tuple[str, float]:
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


def letter_I_small(ox: float, scale: float = 0.46) -> tuple[str, float]:
    P = lambda x, y: _small_P(ox, scale, x, y)  # noqa: E731
    w = STEM
    d = f"M{xy(P(0, 0))}L{xy(P(w, 0))}L{xy(P(w, 100))}L{xy(P(0, 100))}Z"
    return d, 28 * scale + 2


def letter_K_small(ox: float, scale: float = 0.46) -> tuple[str, float]:
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


def letter_E_small(ox: float, scale: float = 0.46) -> tuple[str, float]:
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


def period_dot(ox: float, scale: float = 0.46) -> tuple[str, float]:
    s = 11 * scale
    y0 = 100 - s
    pts = [skew(ox, y0), skew(ox + s, y0), skew(ox + s, 100), skew(ox, 100)]
    d = "M" + "L".join(xy(p) for p in pts) + "Z"
    return d, s + 6


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
    track = 12.0
    for fn in (letter_R, letter_Y, letter_D, letter_N):
        d, adv = fn(x)
        parts.append(f'<path fill="{fill}" fill-rule="evenodd" d="{d}"/>')
        x += adv - track
    if with_bike:
        x += 22  # clear N overhang before .BIKE
        d, adv = period_dot(x)
        parts.append(f'<path fill="{fill}" d="{d}"/>')
        x += adv + 4
        for fn in (letter_B_small, letter_I_small, letter_K_small, letter_E_small):
            d, adv = fn(x)
            parts.append(f'<path fill="{fill}" fill-rule="evenodd" d="{d}"/>')
            x += adv + 4
    pad_l, pad_t, pad_r, pad_b = 24, 8, 28, 10
    body = (
        f'  <g transform="translate({pad_l},{pad_t})">\n    '
        + "\n    ".join(parts)
        + "\n  </g>"
    )
    return svg_doc(body, f"0 0 {x + pad_l + pad_r:.0f} {100 + pad_t + pad_b}")


# Favicon-optimized R for 16–48 only — heavier stems, open counter, snapped terminals.
# Large app icons use the full Direction #9 brandmark (letter_R Béziers), never this glyph upscaled.
FAV_R = (
    "M8.2 4.2 "
    "L17.8 4.2 "
    "C22.6 4.2 26.2 7 26.2 11.4 "
    "C26.2 15.2 23.6 17.8 19.2 18.2 "
    "L24.4 27.8 "
    "L19.1 27.8 "
    "L14.4 19.1 "
    "L11.6 19.1 "
    "L9.5 27.8 "
    "L4.8 27.8 "
    "L8.2 4.2 "
    "Z "
    "M12.2 8 "
    "L17.2 8 "
    "C19.4 8 20.7 9.2 20.7 11.3 "
    "C20.7 13.4 19.3 14.6 17.1 14.6 "
    "L11.8 14.6 "
    "Z"
)

# Axis-aligned bounds of letter_R after -10° slant (design space, before icon padding).
# x min from back-slanted left foot; x max from bowl control; y 0..100.
_R_BOUNDS = (-17.63, 0.0, 86.0, 100.0)  # min_x, min_y, max_x, max_y


def _mark_place(canvas: float, fill_ratio: float) -> tuple[str, float, float, float]:
    """Return (path_d, translate_x, translate_y, scale) to optically center letter_R on a square canvas."""
    d, _ = letter_R(0)
    min_x, min_y, max_x, max_y = _R_BOUNDS
    # Slight optical bias: italic R reads heavy on the right leg — nudge left/up a hair.
    cx = (min_x + max_x) / 2 - 1.2
    cy = (min_y + max_y) / 2 - 1.0
    scale = (canvas * fill_ratio) / (max_y - min_y)
    tx = canvas / 2 - cx * scale
    ty = canvas / 2 - cy * scale
    return d, tx, ty, scale


def favicon_svg() -> str:
    return svg_doc(
        f'  <rect width="32" height="32" rx="7.5" fill="{INK}"/>\n'
        f'  <path fill="{WHITE}" fill-rule="evenodd" d="{FAV_R}"/>',
        "0 0 32 32",
    )


def brandmark_svg(fill: str = "currentColor") -> str:
    d, _ = letter_R(0)
    return svg_doc(
        f'  <g transform="translate(20,6)"><path fill="{fill}" fill-rule="evenodd" d="{d}"/></g>',
        "0 0 118 114",
    )


def icon_master(bg: str, fg: str) -> str:
    # Full brandmark R on paper. ~58% fill leaves Apple-safe optical margin (not edge-to-edge).
    d, tx, ty, scale = _mark_place(1024.0, 0.58)
    return svg_doc(
        f'  <rect width="1024" height="1024" fill="{bg}"/>\n'
        f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.4f})">\n'
        f'    <path fill="{fg}" fill-rule="evenodd" d="{d}"/>\n'
        f"  </g>",
        "0 0 1024 1024",
        "1024",
        "1024",
    )


def maskable_svg() -> str:
    # Maskable safe zone ≈ center 80% circle — keep mark ~48% so it survives adaptive cropping.
    d, tx, ty, scale = _mark_place(512.0, 0.48)
    return svg_doc(
        f'  <rect width="512" height="512" fill="{INK}"/>\n'
        f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.4f})">\n'
        f'    <path fill="{WHITE}" fill-rule="evenodd" d="{d}"/>\n'
        f"  </g>",
        "0 0 512 512",
    )


def loading_animation_svg() -> str:
    parts: list[str] = []
    x = 0.0
    track = 12.0
    for fn in (letter_R, letter_Y, letter_D, letter_N):
        d, adv = fn(x)
        parts.append(f'<path fill="currentColor" fill-rule="evenodd" d="{d}"/>')
        x += adv - track
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
  <g class="mark" transform="translate(8,10) scale(0.52)">
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
    write(BRAND / "logo-light.svg", compose_wordmark(INK, True))
    write(BRAND / "wordmark.svg", compose_wordmark(INK, False))
    write(BRAND / "brandmark.svg", brandmark_svg(INK))
    write(BRAND / "favicon.svg", favicon_svg())
    write(BRAND / "loading-logo.svg", compose_wordmark("currentColor", False))
    write(BRAND / "loading-animation.svg", loading_animation_svg())
    write(BRAND / "icon-dark.svg", icon_master(INK, WHITE))
    write(BRAND / "icon-light.svg", icon_master(PAPER, INK))
    mono_d, mono_tx, mono_ty, mono_s = _mark_place(1024.0, 0.58)
    write(
        BRAND / "icon-mono.svg",
        svg_doc(
            f'  <g transform="translate({mono_tx:.2f},{mono_ty:.2f}) scale({mono_s:.4f})">'
            f'<path fill="{INK}" fill-rule="evenodd" d="{mono_d}"/></g>',
            "0 0 1024 1024",
            "1024",
            "1024",
        ),
    )

    write(PUBLIC / "icon-source.svg", icon_master(PAPER, INK))
    write(PUBLIC / "favicon.svg", favicon_svg())
    write(PUBLIC / "icon-maskable.svg", maskable_svg())
    # In-app mark: favicon-tuned R for small UI; large icons use full brandmark via icon-source.svg
    write(
        SRC_ASSETS / "rydn-mark.svg",
        svg_doc(
            f'  <!-- RYDN Direction #9 — favicon-tuned R (UI / 16–48). App icons use brandmark Béziers. -->\n'
            f'  <path fill="currentColor" fill-rule="evenodd" d="{FAV_R}"/>',
            "0 0 32 32",
        ),
    )
    write(SRC_ASSETS / "rydn-wordmark.svg", compose_wordmark("currentColor", False))

    batch = ROOT / "scripts" / "_resvg_batch.mjs"
    batch.write_text(
        f"""
import {{ readFileSync, writeFileSync, copyFileSync }} from 'node:fs';
import {{ join }} from 'node:path';
import {{ createRequire }} from 'node:module';
const require = createRequire(join(process.cwd(), 'frontend/package.json'));
const {{ Resvg }} = require('@resvg/resvg-js');
const BRAND = 'assets/brand';
const PUBLIC = 'frontend/public';
function render(src, size, out) {{
  const r = new Resvg(readFileSync(src), {{ fitTo: {{ mode: 'width', value: size }}, background: 'transparent' }});
  const png = r.render().asPng();
  writeFileSync(out, png);
  console.log(out, png.length);
  return png;
}}
render(BRAND+'/icon-light.svg', 180, BRAND+'/apple-touch-icon.png');
render(BRAND+'/icon-light.svg', 192, BRAND+'/icon-192.png');
render(BRAND+'/icon-light.svg', 512, BRAND+'/icon-512.png');
render(PUBLIC+'/icon-maskable.svg', 512, BRAND+'/maskable-icon.png');
render(BRAND+'/icon-dark.svg', 512, BRAND+'/social-avatar.png');
// Tiny sizes: favicon-optimized SVG (never upscale a PNG).
const f16 = render(BRAND+'/favicon.svg', 16, PUBLIC+'/icon-16.png');
const f32 = render(BRAND+'/favicon.svg', 32, PUBLIC+'/icon-32.png');
const f48 = render(BRAND+'/favicon.svg', 48, PUBLIC+'/icon-48.png');
writeFileSync(BRAND+'/_f16.png', f16);
writeFileSync(BRAND+'/_f32.png', f32);
writeFileSync(BRAND+'/_f48.png', f48);
// Every larger size rasterized directly from master SVG (resvg), never from a smaller PNG.
for (const s of [64,72,96,120,128,144,152,167,180,192,256,384,512,1024]) {{
  render(PUBLIC+'/icon-source.svg', s, PUBLIC+`/icon-${{s}}.png`);
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
  [PUBLIC+'/icon-source.svg', 256, BRAND+'/_preview-icon.png'],
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

        for s in (16, 32, 48):
            Image.open(PUBLIC / f"icon-{s}.png").resize((s * 10, s * 10), Image.NEAREST).save(
                BRAND / f"_preview-icon{s}-xx.png"
            )
    except Exception:
        pass

    print("Direction #9 brand pack complete →", BRAND)


if __name__ == "__main__":
    main()
