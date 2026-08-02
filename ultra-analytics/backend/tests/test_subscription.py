"""Subscription tiers, redeem codes, and Pro API gating."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest import mock

from app.subscription.codes import (
    ACTION_ONBOARDING,
    SEED_CODE,
    SEED_ONBOARD_CODE,
    ensure_seed_codes,
    redeem_code,
)
from app.subscription.features import (
    FEATURE_GPX_EXPORT,
    FEATURE_PLANNING,
    can_access,
)
from app.subscription.service import get_tier, set_subscription_tier
from app.subscription.tiers import TIER_FREE, TIER_PRO
from app import users


class FeatureGateUnitTests(unittest.TestCase):
    def test_pro_only_features(self) -> None:
        self.assertFalse(can_access("guest", FEATURE_PLANNING))
        self.assertFalse(can_access("free", FEATURE_PLANNING))
        self.assertFalse(can_access("free", FEATURE_GPX_EXPORT))
        self.assertTrue(can_access("pro", FEATURE_PLANNING))
        self.assertTrue(can_access("pro", FEATURE_GPX_EXPORT))

    def test_unknown_feature_fail_closed(self) -> None:
        self.assertFalse(can_access("pro", "notARealFeature"))


class RedeemAndTierTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self._data = mock.patch(
            "app.subscription.codes.data_root", return_value=self._tmpdir.name
        )
        self._data.start()
        self.addCleanup(self._data.stop)
        # users module caches users_dir at import — patch the path helper it uses
        users_dir = os.path.join(self._tmpdir.name, "users")
        os.makedirs(users_dir, exist_ok=True)
        self._users_dir = mock.patch.object(users, "_USERS_DIR", users_dir)
        self._users_dir.start()
        self.addCleanup(self._users_dir.stop)
        ensure_seed_codes()

        self.uid = "sub-test-user"
        users.save_user(
            {
                "id": self.uid,
                "provider": "local",
                "email": "rider@example.com",
                "name": "Rider",
                "avatar": None,
                "createdAt": 1,
                "onboardedAt": 1,
                "providers": {},
            }
        )

    def test_default_tier_is_free(self) -> None:
        user = users.get_user(self.uid)
        assert user is not None
        self.assertEqual(get_tier(user), TIER_FREE)
        self.assertEqual(users.public_user(user)["subscriptionTier"], TIER_FREE)

    def test_redeem_seed_code_upgrades_to_pro(self) -> None:
        updated, action = redeem_code(self.uid, SEED_CODE)
        self.assertIsNone(action)
        self.assertEqual(updated["subscriptionTier"], TIER_PRO)
        self.assertEqual(updated["subscriptionSource"], "redeem")
        again = users.get_user(self.uid)
        assert again is not None
        self.assertEqual(get_tier(again), TIER_PRO)

    def test_redeem_is_idempotent_for_reusable_code(self) -> None:
        redeem_code(self.uid, SEED_CODE)
        again, action = redeem_code(self.uid, "  rydn-pro-beta  ")
        self.assertIsNone(action)
        self.assertEqual(again["subscriptionTier"], TIER_PRO)

    def test_redeem_onboard_code_does_not_change_tier(self) -> None:
        before = users.get_user(self.uid)
        assert before is not None
        self.assertEqual(get_tier(before), TIER_FREE)
        updated, action = redeem_code(self.uid, SEED_ONBOARD_CODE)
        self.assertEqual(action, ACTION_ONBOARDING)
        self.assertEqual(get_tier(updated), TIER_FREE)
        # Re-redeem for QA — still onboarding, still Free.
        again, action2 = redeem_code(self.uid, "  rydn-onboard  ")
        self.assertEqual(action2, ACTION_ONBOARDING)
        self.assertEqual(get_tier(again), TIER_FREE)

    def test_invalid_code_rejected(self) -> None:
        with self.assertRaises(ValueError):
            redeem_code(self.uid, "NOT-A-REAL-CODE")

    def test_set_subscription_tier_stripe_hook(self) -> None:
        updated = set_subscription_tier(self.uid, "pro", source="stripe")
        self.assertEqual(updated["subscriptionTier"], TIER_PRO)
        self.assertEqual(updated["subscriptionSource"], "stripe")

    def test_single_use_code(self) -> None:
        path = os.path.join(self._tmpdir.name, "redeem_codes.json")
        with open(path, "r", encoding="utf-8") as f:
            store = json.load(f)
        store["ONCE-PRO"] = {
            "tier": "pro",
            "reusable": False,
            "active": True,
            "note": "single use",
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(store, f)

        other = "other-user"
        users.save_user(
            {
                "id": other,
                "provider": "local",
                "email": "o@example.com",
                "name": "Other",
                "avatar": None,
                "createdAt": 1,
                "providers": {},
            }
        )
        redeem_code(self.uid, "ONCE-PRO")
        with self.assertRaises(ValueError):
            redeem_code(other, "ONCE-PRO")


class ProApiGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        users_dir = os.path.join(self._tmpdir.name, "users")
        os.makedirs(users_dir, exist_ok=True)

        from app import routes_store
        from app import users as users_mod
        from app.auth import current_user
        from app.main import app
        from fastapi.testclient import TestClient

        self._routes = mock.patch.object(routes_store, "_USERS_DIR", users_dir)
        self._routes.start()
        self.addCleanup(self._routes.stop)
        self._users_dir = mock.patch.object(users_mod, "_USERS_DIR", users_dir)
        self._users_dir.start()
        self.addCleanup(self._users_dir.stop)

        self.app = app
        self.uid = "gate-user"
        self.routes_store = routes_store
        users_mod.save_user(
            {
                "id": self.uid,
                "provider": "local",
                "email": "gate@example.com",
                "name": "Gate",
                "avatar": None,
                "createdAt": 1,
                "providers": {},
                "subscriptionTier": "free",
                "racePassCredits": 0,
            }
        )

        def _user() -> dict:
            u = users_mod.get_user(self.uid)
            assert u is not None
            return u

        # Only override current_user — route planning deps still enforce access.
        app.dependency_overrides[current_user] = _user
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def _set_tier(self, tier: str) -> None:
        from app.subscription.service import set_subscription_tier

        set_subscription_tier(self.uid, tier, source="test")

    def _seed_route(self, route_id: str = "r1", *, unlocked: bool = False) -> None:
        path = self.routes_store._path(self.uid, route_id)  # noqa: SLF001
        os.makedirs(os.path.dirname(path), exist_ok=True)
        route = {
            "id": route_id,
            "createdAt": 1,
            "updatedAt": 1,
            "name": "Test route",
            "distanceKm": 10,
            "elevationGainM": 100,
            "pointCount": 2,
            "hasTimestamps": False,
            "status": "planning",
            "track": [[0, 0], [1, 1]],
            "points": [[0, 0], [1, 1]],
        }
        if unlocked:
            route["proUnlock"] = {"source": "race_pass", "at": 1}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(route, f)

    def test_export_forbidden_for_free_locked_route(self) -> None:
        self._set_tier("free")
        self._seed_route("locked", unlocked=False)
        res = self.client.get("/api/routes/locked/export.gpx")
        self.assertEqual(res.status_code, 403)
        self.assertIn("Pro", res.json().get("detail", ""))

    def test_export_allowed_for_free_unlocked_route(self) -> None:
        self._set_tier("free")
        self._seed_route("open", unlocked=True)
        res = self.client.get("/api/routes/open/export.gpx")
        # Access passes; export may 404 if track/export data incomplete — not 403.
        self.assertNotEqual(res.status_code, 403)

    def test_export_allowed_for_pro(self) -> None:
        self._set_tier("pro")
        res = self.client.get("/api/routes/missing/export.gpx")
        # Auth + Pro pass; missing route → 404
        self.assertEqual(res.status_code, 404)

    def test_list_routes_free_only_unlocked(self) -> None:
        self._set_tier("free")
        self._seed_route("locked", unlocked=False)
        self._seed_route("open", unlocked=True)
        res = self.client.get("/api/routes")
        self.assertEqual(res.status_code, 200)
        ids = {r["id"] for r in res.json()}
        self.assertEqual(ids, {"open"})

    def test_list_routes_pro_sees_all(self) -> None:
        self._set_tier("pro")
        self._seed_route("locked", unlocked=False)
        self._seed_route("open", unlocked=True)
        res = self.client.get("/api/routes")
        self.assertEqual(res.status_code, 200)
        ids = {r["id"] for r in res.json()}
        self.assertEqual(ids, {"locked", "open"})

    def test_rides_still_allowed_for_free(self) -> None:
        self._set_tier("free")
        from app import store

        with mock.patch.object(store, "list_rides", return_value=[]):
            res = self.client.get("/api/rides")
        self.assertEqual(res.status_code, 200)


class RedeemEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self._data = mock.patch(
            "app.subscription.codes.data_root", return_value=self._tmpdir.name
        )
        self._data.start()
        self.addCleanup(self._data.stop)
        users_dir = os.path.join(self._tmpdir.name, "users")
        os.makedirs(users_dir, exist_ok=True)
        self._users_dir = mock.patch.object(users, "_USERS_DIR", users_dir)
        self._users_dir.start()
        self.addCleanup(self._users_dir.stop)
        ensure_seed_codes()

        self.uid = "http-redeem"
        users.save_user(
            {
                "id": self.uid,
                "provider": "local",
                "email": "r@example.com",
                "name": "R",
                "avatar": None,
                "createdAt": 1,
                "providers": {},
            }
        )

        from app.auth import current_user
        from app.main import app
        from fastapi.testclient import TestClient

        app.dependency_overrides[current_user] = lambda: users.get_user(self.uid)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_redeem_endpoint(self) -> None:
        res = self.client.post("/api/subscription/redeem", json={"code": SEED_CODE})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["subscriptionTier"], "pro")
        stored = users.get_user(self.uid)
        assert stored is not None
        self.assertEqual(stored["subscriptionTier"], "pro")
        self.assertEqual(users.public_user(stored)["subscriptionTier"], "pro")

    def test_redeem_onboard_endpoint(self) -> None:
        res = self.client.post("/api/subscription/redeem", json={"code": SEED_ONBOARD_CODE})
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body.get("redeemAction"), ACTION_ONBOARDING)
        self.assertEqual(body["subscriptionTier"], "free")


if __name__ == "__main__":
    unittest.main()
