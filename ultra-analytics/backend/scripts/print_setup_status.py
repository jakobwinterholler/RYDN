"""Print /api/auth/setup checklist for setup.sh (stdin = JSON)."""

from __future__ import annotations

import json
import sys


def main() -> None:
    d = json.load(sys.stdin)
    print("  Setup checklist\n")
    for c in d.get("checks") or []:
        mark = "✓" if c.get("ok") else "○"
        print(f"  {mark}  {c.get('label')}")
        if (not c.get("ok")) and c.get("fix"):
            print(f"      → {c['fix']}")
    print("")
    if d.get("tunnelUrl"):
        print(f"  Active tunnel:  {d['tunnelUrl']}")
        print(f"  Active origin:  {d.get('origin')}")
        print("")
    reg = d.get("register") or {}
    print("  Google — Authorized JavaScript origins:")
    for u in reg.get("googleOrigins") or []:
        print(f"    {u}")
    print("  Google — Authorized redirect URIs:")
    for u in reg.get("googleRedirectUris") or []:
        print(f"    {u}")
    print("")
    print("  Strava — Authorization Callback Domain:")
    print(f"    {reg.get('stravaCallbackDomain') or '(none)'}")
    print("")
    print(f"  Next: {d.get('nextStep') or 'Open the app.'}")
    print("")
    if d.get("readyForGoogle"):
        print("  Google credentials: READY")
    else:
        print("  Google credentials: MISSING")
        print(f"  Edit: {d.get('envPath')}")
        print("  Save — no restart.")
    if d.get("readyForStrava"):
        print("  Strava credentials: READY")
    else:
        print("  Strava credentials: MISSING")


if __name__ == "__main__":
    main()
