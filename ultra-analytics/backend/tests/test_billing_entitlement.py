"""Entitlement recompute + Stripe webhook mapping (no live Stripe)."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from app import users
from app.billing.webhooks import handle_stripe_event
from app.subscription.entitlement import apply_stripe_subscription, grant_redeem_pro


class EntitlementTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        users_dir = os.path.join(self._tmpdir.name, "users")
        os.makedirs(users_dir, exist_ok=True)
        self._users_dir = mock.patch.object(users, "_USERS_DIR", users_dir)
        self._users_dir.start()
        self.addCleanup(self._users_dir.stop)

        self.uid = "u_billing_1"
        users.save_user(
            {
                "id": self.uid,
                "provider": "local",
                "email": "a@b.c",
                "name": "Tester",
                "avatar": None,
                "onboardedAt": None,
                "providers": {},
                "subscriptionTier": "free",
            }
        )

    def test_stripe_active_grants_pro(self) -> None:
        u = apply_stripe_subscription(
            self.uid,
            customer_id="cus_test",
            subscription_id="sub_test",
            status="active",
        )
        self.assertEqual(u["subscriptionTier"], "pro")
        self.assertEqual(u["subscriptionSource"], "stripe")

    def test_stripe_canceled_drops_to_free(self) -> None:
        apply_stripe_subscription(
            self.uid, customer_id="cus_x", subscription_id="sub_x", status="active"
        )
        u = apply_stripe_subscription(
            self.uid, customer_id="cus_x", subscription_id="sub_x", status="canceled"
        )
        self.assertEqual(u["subscriptionTier"], "free")

    def test_redeem_survives_stripe_cancel(self) -> None:
        grant_redeem_pro(self.uid)
        apply_stripe_subscription(
            self.uid, customer_id="cus_x", subscription_id="sub_x", status="active"
        )
        u = apply_stripe_subscription(
            self.uid, customer_id="cus_x", subscription_id="sub_x", status="canceled"
        )
        self.assertEqual(u["subscriptionTier"], "pro")
        self.assertEqual(u["subscriptionSource"], "redeem")

    def test_webhook_checkout_completed(self) -> None:
        event = {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "mode": "subscription",
                    "client_reference_id": self.uid,
                    "customer": "cus_wh",
                    "subscription": "sub_wh",
                    "metadata": {"rydn_user_id": self.uid},
                }
            },
        }
        out = handle_stripe_event(event)
        self.assertTrue(out.get("ok"))
        user = users.get_user(self.uid)
        assert user is not None
        self.assertEqual(user["subscriptionTier"], "pro")
        self.assertEqual(user["stripeCustomerId"], "cus_wh")

    def test_webhook_race_pass_payment_grants_credit(self) -> None:
        event = {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_race_1",
                    "mode": "payment",
                    "client_reference_id": self.uid,
                    "customer": "cus_race",
                    "metadata": {"rydn_user_id": self.uid, "product": "race_pass"},
                }
            },
        }
        out = handle_stripe_event(event)
        self.assertTrue(out.get("ok"))
        self.assertEqual(out.get("product"), "race_pass")
        user = users.get_user(self.uid)
        assert user is not None
        self.assertEqual(user["subscriptionTier"], "free")
        self.assertEqual(int(user.get("racePassCredits") or 0), 1)
        # Retry is idempotent
        handle_stripe_event(event)
        user = users.get_user(self.uid)
        assert user is not None
        self.assertEqual(int(user.get("racePassCredits") or 0), 1)

    def test_checkout_requires_config(self) -> None:
        for key in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO", "STRIPE_PRICE_PRO_MONTHLY"):
            os.environ.pop(key, None)
        from app.auth import current_user
        from app.main import app
        from fastapi.testclient import TestClient

        def _user():
            return users.get_user(self.uid)

        app.dependency_overrides[current_user] = _user
        try:
            client = TestClient(app)
            res = client.post("/api/billing/checkout-session")
            self.assertEqual(res.status_code, 503)
        finally:
            app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
