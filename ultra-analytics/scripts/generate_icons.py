#!/usr/bin/env python3
"""Deprecated — use scripts/generate_icons.mjs (renders icon-source.svg via resvg).

Kept as a thin wrapper so existing docs keep working:
  python3 scripts/generate_icons.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MJS = HERE / "generate_icons.mjs"
FRONTEND = HERE.parent / "frontend"


def main() -> None:
    node = shutil.which("node")
    if not node:
        print("node is required to rasterize icons from SVG", file=sys.stderr)
        sys.exit(1)
    # Ensure resvg is available
    if not (FRONTEND / "node_modules" / "@resvg" / "resvg-js").exists():
        print("Installing @resvg/resvg-js…")
        subprocess.check_call(["npm", "install", "--save-dev", "@resvg/resvg-js"], cwd=FRONTEND)
    subprocess.check_call([node, str(MJS)])


if __name__ == "__main__":
    main()
