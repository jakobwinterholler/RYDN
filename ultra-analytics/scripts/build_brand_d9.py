#!/usr/bin/env python3
"""DEPRECATED — do not recreate logo vectors.

Use scripts/generate_brand_from_source.py which downscales the user's real
HighQuality square master (and installs their Subtract.svg wordmark).
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
print("build_brand_d9.py is deprecated — running generate_brand_from_source.py", file=sys.stderr)
runpy.run_path(str(HERE / "generate_brand_from_source.py"), run_name="__main__")
sys.exit(0)

# --- legacy body kept below for reference only (unreachable) ---
