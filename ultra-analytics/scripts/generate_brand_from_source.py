#!/usr/bin/env python3
"""Generate RYDN favicon / PWA / apple-touch rasters from the user's real logo files.

Master for all square icons: assets/brand/source/master-icon-square.png
(HighQuality white R+circle on dark square, 1024×1024).

Rules:
  - Downscale only (LANCZOS). Never upscale. Never redraw the R.
  - No invented SVG geometry for favicons.
  - Wordmark SVG: only the user-exported Subtract.svg (RYDN.BIKE), if present.
"""

from __future__ import annotations

import shutil
import struct
import zlib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand" / "source"
BRAND = ROOT / "assets" / "brand"
PUBLIC = ROOT / "frontend" / "public"
PUBLIC_BRAND = PUBLIC / "brand"
SRC_ASSETS = ROOT / "frontend" / "src" / "assets"

MASTER = SOURCE / "master-icon-square.png"
STEALTH = SOURCE / "master-stealth-square.png"
WORDMARK_RYDN = SOURCE / "master-wordmark-rydn.png"
WORDMARK_BIKE_PNG = SOURCE / "master-wordmark-rydn-bike.png"
WORDMARK_BIKE_SVG = SOURCE / "master-wordmark-rydn-bike.svg"

SIZES = [16, 32, 48, 64, 72, 96, 120, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024]
MASKABLE = [192, 512]
# Maskable safe-zone: logo occupies ~80% of canvas (same art, more pad).
MASKABLE_SCALE = 0.80


def load_master() -> Image.Image:
    if not MASTER.is_file():
        raise SystemExit(f"Missing icon master: {MASTER}")
    im = Image.open(MASTER).convert("RGBA")
    w, h = im.size
    if w != h:
        raise SystemExit(f"Icon master must be square, got {w}x{h}")
    print(f"master: {MASTER.name} {w}x{h}")
    return im


def downscale(im: Image.Image, size: int) -> Image.Image:
    if size > max(im.size):
        raise SystemExit(f"Refuse upscale to {size} from {im.size}")
    if size == im.size[0] and size == im.size[1]:
        return im.copy()
    return im.resize((size, size), Image.Resampling.LANCZOS)


def make_maskable(im: Image.Image, size: int) -> Image.Image:
    """Same master art, centered with extra pad for maskable safe zone."""
    if size > max(im.size):
        # Pad-up from master at master size then downscale — never invent geometry.
        # For size > master: only allowed if we composite on larger canvas without
        # scaling the mark above master resolution.
        mark = im
        canvas = Image.new("RGBA", (size, size), (26, 26, 26, 255))  # ~#1a1a1a
        # Center master pixels 1:1 (no upscale of mark)
        ox = (size - mark.size[0]) // 2
        oy = (size - mark.size[1]) // 2
        canvas.paste(mark, (ox, oy), mark)
        return canvas

    inner = max(1, int(round(size * MASKABLE_SCALE)))
    # Ensure we never upscale the mark above master.
    inner = min(inner, im.size[0])
    mark = downscale(im, inner)
    # Sample corner for bg (dark square master)
    bg = im.getpixel((2, 2))
    canvas = Image.new("RGBA", (size, size), bg)
    ox = (size - mark.size[0]) // 2
    oy = (size - mark.size[1]) // 2
    canvas.paste(mark, (ox, oy), mark)
    return canvas


def write_png(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="PNG", optimize=True)


def write_ico(images: list[Image.Image], path: Path) -> None:
    """Multi-size ICO (16/32/48) from the same master downscales."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Pillow ICO writer
    imgs = [im.convert("RGBA") for im in images]
    imgs[0].save(
        path,
        format="ICO",
        sizes=[(im.width, im.height) for im in imgs],
        append_images=imgs[1:],
    )


def currentcolor_svg(src: Path, dest: Path) -> None:
    """Copy user SVG; swap hard fill for currentColor so UI theming works."""
    text = src.read_text(encoding="utf-8")
    # Only replace the brand fill — do not alter path geometry.
    text = text.replace('fill="#212121"', 'fill="currentColor"')
    text = text.replace("fill='#212121'", "fill='currentColor'")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")


def main() -> None:
    master = load_master()
    PUBLIC.mkdir(parents=True, exist_ok=True)
    PUBLIC_BRAND.mkdir(parents=True, exist_ok=True)
    BRAND.mkdir(parents=True, exist_ok=True)
    SRC_ASSETS.mkdir(parents=True, exist_ok=True)

    # Full-size master as PNG (source may be JPEG bytes with .png name)
    icon_1024 = downscale(master, 1024) if master.size[0] >= 1024 else master.copy()
    write_png(icon_1024, PUBLIC / "icon-1024.png")
    write_png(icon_1024, BRAND / "icon-1024.png")
    write_png(icon_1024, BRAND / "social-avatar.png")
    print("wrote icon-1024.png (= master, no upscale)")

    generated: dict[int, Image.Image] = {1024: icon_1024}
    for size in SIZES:
        if size == 1024:
            continue
        im = downscale(master, size)
        generated[size] = im
        write_png(im, PUBLIC / f"icon-{size}.png")
        print(f"wrote icon-{size}.png (LANCZOS {master.size[0]}→{size})")

    # Apple touch
    shutil.copy2(PUBLIC / "icon-180.png", PUBLIC / "apple-touch-icon.png")
    shutil.copy2(PUBLIC / "icon-152.png", PUBLIC / "apple-touch-icon-152.png")
    shutil.copy2(PUBLIC / "icon-167.png", PUBLIC / "apple-touch-icon-167.png")
    shutil.copy2(PUBLIC / "icon-180.png", BRAND / "apple-touch-icon.png")
    shutil.copy2(PUBLIC / "icon-192.png", BRAND / "icon-192.png")
    shutil.copy2(PUBLIC / "icon-512.png", BRAND / "icon-512.png")
    print("wrote apple-touch-icon*.png")

    # Maskable
    for size in MASKABLE:
        m = make_maskable(master, size)
        write_png(m, PUBLIC / f"icon-maskable-{size}.png")
        if size == 512:
            write_png(m, BRAND / "maskable-icon.png")
        print(f"wrote icon-maskable-{size}.png")

    # Favicon ICO from same master downscales
    write_ico([generated[16], generated[32], generated[48]], PUBLIC / "favicon.ico")
    shutil.copy2(PUBLIC / "favicon.ico", BRAND / "favicon.ico")
    # Also expose PNG favicons
    shutil.copy2(PUBLIC / "icon-32.png", PUBLIC_BRAND / "favicon-32.png")
    print("wrote favicon.ico (16/32/48 from master)")

    # Brand copies for in-app img src
    write_png(icon_1024, PUBLIC_BRAND / "mark-square.png")
    write_png(generated[192], PUBLIC_BRAND / "mark-192.png")
    write_png(generated[512], PUBLIC_BRAND / "mark-512.png")
    write_png(generated[512], BRAND / "social-avatar-512.png")

    if STEALTH.is_file():
        stealth = Image.open(STEALTH).convert("RGBA")
        # Fit into square canvas without upscaling mark pixels
        side = max(stealth.size)
        # Keep original; also provide a square-padded copy at native max side
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 255))
        ox = (side - stealth.size[0]) // 2
        oy = (side - stealth.size[1]) // 2
        canvas.paste(stealth, (ox, oy), stealth)
        write_png(canvas, PUBLIC_BRAND / "mark-stealth.png")
        write_png(canvas, BRAND / "social-avatar-stealth.png")
        shutil.copy2(STEALTH, PUBLIC_BRAND / "mark-stealth-raw.png")
        print(f"wrote stealth mark ({stealth.size})")

    if WORDMARK_RYDN.is_file():
        shutil.copy2(WORDMARK_RYDN, PUBLIC_BRAND / "wordmark-rydn.png")
        shutil.copy2(WORDMARK_RYDN, BRAND / "wordmark-rydn.png")
        shutil.copy2(WORDMARK_RYDN, SRC_ASSETS / "wordmark-rydn.png")
        print("copied RYDN. wordmark PNG")

    if WORDMARK_BIKE_PNG.is_file():
        shutil.copy2(WORDMARK_BIKE_PNG, PUBLIC_BRAND / "wordmark-rydn-bike.png")
        shutil.copy2(WORDMARK_BIKE_PNG, BRAND / "wordmark-rydn-bike.png")
        shutil.copy2(WORDMARK_BIKE_PNG, SRC_ASSETS / "wordmark-rydn-bike.png")
        print("copied RYDN.BIKE wordmark PNG")

    if WORDMARK_BIKE_SVG.is_file():
        # Preserve original fill in brand/source; UI copy uses currentColor
        shutil.copy2(WORDMARK_BIKE_SVG, BRAND / "logo.svg")
        shutil.copy2(WORDMARK_BIKE_SVG, PUBLIC_BRAND / "wordmark-rydn-bike.svg")
        currentcolor_svg(WORDMARK_BIKE_SVG, SRC_ASSETS / "rydn-wordmark.svg")
        currentcolor_svg(WORDMARK_BIKE_SVG, BRAND / "wordmark.svg")
        currentcolor_svg(WORDMARK_BIKE_SVG, BRAND / "logo-transparent.svg")
        print("installed user Wordmark-RYDN.BIKE.svg (no path edits)")

    # Do NOT invent favicon.svg — remove stale hand-drawn one from being preferred.
    # Keep a note file; delete public favicon.svg so browsers use PNG/ICO.
    fav_svg = PUBLIC / "favicon.svg"
    if fav_svg.is_file():
        fav_svg.unlink()
        print("removed invented favicon.svg (using PNG/ICO from master)")

    # Remove hand-drawn icon-source SVGs so generate_icons won't re-fake
    for name in (
        "icon-source.svg",
        "icon-source-home.svg",
        "icon-source-home-120.svg",
        "icon-source-home-152.svg",
        "icon-source-home-167.svg",
        "icon-source-home-180.svg",
        "icon-source-home-192.svg",
        "icon-maskable.svg",
    ):
        p = PUBLIC / name
        if p.is_file():
            p.unlink()
            print(f"removed recreated vector {name}")

    print("OK — all icons from user master, LANCZOS downscale only.")


if __name__ == "__main__":
    main()
