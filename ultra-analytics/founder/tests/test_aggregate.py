"""Founder aggregation over a fake ULTRA_DATA_DIR."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

FOUNDER_ROOT = Path(__file__).resolve().parents[1]
UA_ROOT = FOUNDER_ROOT.parent
BACKEND = UA_ROOT / "backend"

sys.path.insert(0, str(UA_ROOT))
sys.path.insert(0, str(BACKEND))


def _write_user(root: Path, uid: str, body: dict) -> None:
    users = root / "users"
    users.mkdir(parents=True, exist_ok=True)
    path = users / f"{uid}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(body, f)


def _touch_json(path: Path, data: dict | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data if data is not None else {"id": path.stem}, f)


class AggregateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self._tmpdir.name)
        (self.root / ".secret").write_text("test-founder-secret-key-not-real", encoding="utf-8")
        now = time.time()
        _write_user(
            self.root,
            "u_free",
            {
                "id": "u_free",
                "provider": "google",
                "email": "free@example.com",
                "name": "Free Rider",
                "createdAt": now - 2 * 86400,
                "subscriptionTier": "free",
                "subscriptionSource": "default",
                "stripeStatus": None,
                "racePassCredits": 1,
                "racePassPurchases": [{"at": now, "qty": 1, "checkoutSessionId": "cs_1"}],
                "providers": {"strava": {"athleteId": 1, "lastSyncAt": now}},
            },
        )
        _write_user(
            self.root,
            "u_pro",
            {
                "id": "u_pro",
                "provider": "google",
                "email": "pro@example.com",
                "name": "Pro Rider",
                "createdAt": now - 40 * 86400,
                "subscriptionTier": "pro",
                "subscriptionSource": "stripe",
                "stripeCustomerId": "cus_test123",
                "stripeStatus": "active",
                "racePassCredits": 0,
                "providers": {},
            },
        )
        _touch_json(self.root / "users" / "u_free" / "rides" / "r1.json", {"id": "r1"})
        _touch_json(
            self.root / "users" / "u_free" / "routes" / "rt1.json",
            {
                "id": "rt1",
                "name": "Race",
                "proUnlock": {"source": "race_pass", "at": now},
            },
        )
        _touch_json(
            self.root / "users" / "u_free" / "routes" / "rt1.analysis.json",
            {"ok": True},
        )
        _touch_json(self.root / "users" / "u_pro" / "ultras" / "ul1.json", {"id": "ul1"})
        with open(self.root / "redeem_codes.json", "w", encoding="utf-8") as f:
            json.dump(
                {
                    "RYDN-PRO-BETA": {
                        "tier": "pro",
                        "reusable": True,
                        "active": True,
                        "note": "beta",
                        "redemptions": [{"userId": "u_pro", "at": now}],
                    }
                },
                f,
            )
        with open(self.root / "stripe_billing.json", "w", encoding="utf-8") as f:
            json.dump(
                {
                    "priceProMonthly": "price_month",
                    "priceProYearly": "price_year",
                    "priceRacePass": "price_race",
                },
                f,
            )

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_build_app_snapshot(self) -> None:
        from founder.aggregate import build_app_snapshot

        snap = build_app_snapshot(str(self.root))
        self.assertEqual(snap["summary"]["users"], 2)
        self.assertEqual(snap["summary"]["rides"], 1)
        self.assertEqual(snap["summary"]["routes"], 1)
        self.assertEqual(snap["summary"]["ultras"], 1)
        self.assertEqual(snap["summary"]["routesUnlocked"], 1)
        self.assertEqual(snap["summary"]["racePassCreditsTotal"], 1)
        self.assertEqual(snap["summary"]["racePassPurchasesTotal"], 1)
        self.assertEqual(snap["summary"]["stravaLinked"], 1)
        self.assertEqual(snap["summary"]["tierMix"].get("free"), 1)
        self.assertEqual(snap["summary"]["tierMix"].get("pro"), 1)
        self.assertEqual(snap["summary"]["newUsers7d"], 1)

        free = next(u for u in snap["users"] if u["id"] == "u_free")
        self.assertTrue(free["stravaLinked"])
        self.assertEqual(free["routesUnlocked"], 1)
        # No tokens leaked
        blob = json.dumps(snap)
        self.assertNotIn("accessToken", blob)
        self.assertNotIn("refreshToken", blob)

        self.assertEqual(len(snap["redeemCodes"]), 1)
        self.assertEqual(snap["redeemCodes"][0]["redemptionCount"], 1)

    def test_classify_line_from_billing_store(self) -> None:
        from founder.stripe_ops import classify_line, _price_map_from_billing_store

        price_map = _price_map_from_billing_store(str(self.root))
        self.assertEqual(price_map["price_race"], "Race Pass")
        self.assertEqual(
            classify_line(
                price_id="price_race",
                description=None,
                interval=None,
                price_map=price_map,
            ),
            "Race Pass",
        )
        self.assertEqual(
            classify_line(
                price_id=None,
                description="RYDN Race Pass",
                interval=None,
                price_map={},
            ),
            "Race Pass",
        )

    def test_stripe_ops_without_key(self) -> None:
        from founder.stripe_ops import fetch_stripe_ops

        out = fetch_stripe_ops("")
        self.assertFalse(out["configured"])
        self.assertIn("STRIPE_SECRET_KEY", out["error"])

    def test_stripe_ops_mocked(self) -> None:
        from founder import stripe_ops

        class FakeCharge:
            def __init__(self):
                self.id = "ch_1"
                self.paid = True
                self.amount = 499
                self.amount_refunded = 0
                self.currency = "eur"
                self.created = int(time.time())
                self.customer = "cus_test123"
                self.receipt_email = "pro@example.com"
                self.description = "RYDN Race Pass"
                self.metadata = {}
                self.status = "succeeded"
                self.billing_details = None
                self.calculated_statement_descriptor = None
                self.statement_descriptor = None
                self.balance_transaction = type(
                    "BT", (), {"fee": 30, "net": 469}
                )()

        class FakeStripe:
            api_key = None

            class Charge:
                @staticmethod
                def list(limit=40, expand=None):
                    return type("L", (), {"data": [FakeCharge()]})()

            class Invoice:
                @staticmethod
                def list(limit=40, status="paid"):
                    return type("L", (), {"data": []})()

            class Subscription:
                @staticmethod
                def list(limit=40, status="all"):
                    return type("L", (), {"data": []})()

        with mock.patch.dict(sys.modules, {"stripe": FakeStripe}):
            # Re-import path uses import stripe inside function
            out = stripe_ops.fetch_stripe_ops("sk_test_fake", data_dir=str(self.root))
        self.assertTrue(out["configured"])
        self.assertIsNone(out["error"])
        self.assertEqual(out["revenue"]["totalPaidCents"], 499)
        self.assertEqual(out["revenue"]["feesCents"], 30)
        self.assertEqual(out["revenue"]["netCents"], 469)
        self.assertEqual(out["revenue"]["racePassCents"], 499)
        self.assertEqual(out["charges"][0]["product"], "Race Pass")


if __name__ == "__main__":
    unittest.main()
