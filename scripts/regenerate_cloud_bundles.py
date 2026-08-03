#!/usr/bin/env python3
"""Regenerate all cloud companion bundles from stored analysis.json.

Use when phone downloads fail due to legacy bundle schema. Requires .env with Supabase credentials.

  PYTHONPATH=src python3 scripts/regenerate_cloud_bundles.py

Or re-upload from local desktop data (preferred when local analysis is newer):

  PYTHONPATH=src python3 scripts/regenerate_cloud_bundles.py --from-local
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from cloud.config import cloud_config  # noqa: E402
from cloud.race_sync import push_all_local_races, regenerate_all_cloud_bundles  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Regenerate cloud companion bundles.")
    parser.add_argument(
        "--from-local",
        action="store_true",
        help="Push all local races (rebuilds bundles from desktop analysis).",
    )
    parser.add_argument("--user-id", help="Supabase user id (defaults to first local race owner if omitted).")
    args = parser.parse_args()

    if not cloud_config.sync_enabled:
        print("Cloud sync is not configured. Fill .env with SUPABASE_* values.", file=sys.stderr)
        return 1

    user_id = args.user_id or os.environ.get("ULTRA_USER_ID")
    if not user_id:
        print("Pass --user-id or set ULTRA_USER_ID in .env", file=sys.stderr)
        return 1

    if args.from_local:
        print("Pushing all local races to cloud (fresh bundles)…")
        result = push_all_local_races(user_id)
    else:
        print("Regenerating all cloud bundles from analysis.json…")
        result = regenerate_all_cloud_bundles(user_id)

    uploaded = result.get("uploaded") or result.get("regenerated") or []
    failed = result.get("failed") or []
    skipped = result.get("skipped") or []

    print(f"✓ Success: {len(uploaded)}")
    for entry in uploaded:
        name = entry.get("name") or entry.get("race_id")
        revision = entry.get("companion_revision")
        checksum = (entry.get("bundle_checksum") or "")[:16]
        print(f"  - {name} (rev {revision}, checksum {checksum}…)")

    if skipped:
        print(f"○ Skipped: {len(skipped)}")
        for entry in skipped:
            print(f"  - {entry.get('name')}: {entry.get('reason')}")

    if failed:
        print(f"✗ Failed: {len(failed)}", file=sys.stderr)
        for entry in failed:
            print(f"  - {entry.get('name')}: {entry.get('error')}", file=sys.stderr)
        return 1

    print("Done. On phone: Account → Developer → Reset Local Race Cache → reopen app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
