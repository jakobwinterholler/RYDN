"""Bootstrap helpers — mocked Stripe SDK."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock


class BootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self._data = mock.patch(
            "app.billing.store.data_root", return_value=self._tmpdir.name
        )
        self._data.start()
        self.addCleanup(self._data.stop)
        os.environ["STRIPE_SECRET_KEY"] = "sk_test_fake"
        for k in (
            "STRIPE_WEBHOOK_SECRET",
            "STRIPE_PRICE_PRO",
            "STRIPE_PRICE_PRO_MONTHLY",
            "STRIPE_PRICE_PRO_YEARLY",
            "STRIPE_PRICE_RACE_PASS",
        ):
            os.environ.pop(k, None)

    def tearDown(self) -> None:
        os.environ.pop("STRIPE_SECRET_KEY", None)

    def test_bootstrap_creates_and_persists(self) -> None:
        from app.billing import bootstrap as boot
        from app.billing.config import get_stripe_config
        from app.billing.store import load_billing_store

        fake_stripe = mock.MagicMock()
        fake_stripe.Product.search.return_value = {"data": []}
        fake_stripe.Product.list.return_value = {"data": []}
        fake_stripe.Product.create.side_effect = [
            {"id": "prod_pro"},
            {"id": "prod_race"},
        ]
        fake_stripe.Price.list.return_value = {"data": []}
        # month + year + race pass one-time
        fake_stripe.Price.create.side_effect = [
            {"id": "price_month"},
            {"id": "price_year"},
            {"id": "price_race"},
        ]
        fake_stripe.WebhookEndpoint.list.return_value = {"data": []}
        fake_stripe.WebhookEndpoint.create.return_value = {
            "id": "we_1",
            "secret": "whsec_auto",
        }
        fake_stripe.billing_portal.Configuration.list.return_value = {"data": [{"id": "bpc_1"}]}
        fake_stripe.PaymentMethodDomain.list.return_value = {"data": []}
        fake_stripe.PaymentMethodDomain.create.return_value = {"id": "pmd_1"}

        with mock.patch.object(boot, "_stripe_sdk", return_value=fake_stripe):
            with mock.patch.object(boot, "_webhook_url", return_value="https://rydn.bike/api/billing/webhook"):
                with mock.patch.object(boot, "_domains", return_value=["rydn.bike"]):
                    out = boot.bootstrap_stripe(force=True)

        self.assertTrue(out.get("ok"))
        store = load_billing_store()
        self.assertEqual(store.get("pricePro"), "price_month")
        self.assertEqual(store.get("priceProYearly"), "price_year")
        self.assertEqual(store.get("priceRacePass"), "price_race")
        self.assertEqual(store.get("amountRacePassCents"), 499)
        self.assertEqual(store.get("webhookSecret"), "whsec_auto")
        cfg = get_stripe_config()
        self.assertTrue(cfg.configured)
        self.assertTrue(cfg.race_pass_configured)
        self.assertEqual(out.get("priceRacePass"), "price_race")


if __name__ == "__main__":
    unittest.main()
