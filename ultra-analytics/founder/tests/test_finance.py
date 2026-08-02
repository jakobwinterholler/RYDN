"""P&L helpers for the founder dashboard."""

from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

UA = Path(__file__).resolve().parents[1].parent
sys.path.insert(0, str(UA))


class FinanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = self._tmpdir.name
        Path(self.root, "usage").mkdir(parents=True)
        self.addCleanup(self._tmpdir.cleanup)

    def test_profit_month(self) -> None:
        from founder.finance import add_expense, build_finance

        # Override catalog amounts for a deterministic burn
        with open(Path(self.root) / "usage" / "paid_stack.json", "w", encoding="utf-8") as f:
            json.dump(
                {
                    "services": [
                        {
                            "id": "railway",
                            "label": "Railway",
                            "amountCents": 500,
                            "cadence": "month",
                            "role": "runtime",
                            "includeInBurn": True,
                        },
                        {
                            "id": "domain",
                            "label": "Domain",
                            "amountCents": 1200,
                            "cadence": "year",
                            "role": "runtime",
                            "includeInBurn": True,
                        },
                        {
                            "id": "cursor-pro",
                            "amountCents": 0,
                            "includeInBurn": False,
                        },
                        {
                            "id": "stripe",
                            "source": "auto_fees",
                            "includeInBurn": False,
                        },
                    ]
                },
                f,
            )
        add_expense(self.root, label="Sticker print", amount_cents=1000)

        stripe = {
            "configured": True,
            "revenue": {
                "currency": "eur",
                "totalPaidCents": 899,
                "feesCents": 40,
                "netCents": 859,
                "monthPaidCents": 899,
                "monthFeesCents": 40,
                "monthNetCents": 859,
                "mrrEstimateCents": 899,
            },
        }
        railway = {
            "configured": True,
            "currentPeriodCents": 500,
            "invoices": [{"totalCents": 500, "status": "paid"}],
        }
        fin = build_finance(self.root, stripe=stripe, railway=railway)
        # burn: 500 + 1200/12 = 600 (cursor overridden off)
        self.assertEqual(fin["expenses"]["recurringMonthlyCents"], 600)
        self.assertEqual(fin["expenses"]["manualMonthCents"], 1000)
        self.assertEqual(fin["profit"]["monthCents"], 859 - 600 - 1000)
        self.assertTrue(any(s["id"] == "cursor-pro" for s in fin["paidStack"]["services"]))

    def test_railway_autofill_zero_amount(self) -> None:
        from founder.finance import build_finance

        with open(Path(self.root) / "usage" / "paid_stack.json", "w", encoding="utf-8") as f:
            json.dump(
                {
                    "services": [
                        {
                            "id": "railway",
                            "label": "Railway",
                            "amountCents": 0,
                            "cadence": "month",
                            "source": "auto",
                            "role": "runtime",
                        },
                        {"id": "cursor-pro", "amountCents": 0, "includeInBurn": False},
                    ]
                },
                f,
            )
        fin = build_finance(
            self.root,
            stripe={"revenue": {}},
            railway={"configured": True, "currentPeriodCents": 1234, "invoices": []},
        )
        rw = next(i for i in fin["paidStack"]["services"] if i["id"] == "railway")
        self.assertEqual(rw["amountCents"], 1234)
        self.assertEqual(rw["source"], "railway_auto")

    def test_catalog_includes_cursor_and_cloudflare(self) -> None:
        from founder.finance import load_paid_stack

        stack = load_paid_stack(self.root)
        ids = {s["id"] for s in stack["services"]}
        self.assertIn("cursor-pro", ids)
        self.assertIn("cloudflare", ids)
        self.assertIn("railway", ids)
        cursor = next(s for s in stack["services"] if s["id"] == "cursor-pro")
        self.assertEqual(cursor["amountCents"], 2000)


if __name__ == "__main__":
    unittest.main()
