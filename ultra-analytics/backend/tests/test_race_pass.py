"""Race Pass credits, unlock, and import gate."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest import mock

from app import users
from app.subscription.race_pass import (
    apply_pass_after_import,
    can_access_route_planning,
    can_import_planned_route,
    grant_race_pass_credit,
    race_pass_credits,
    unlock_route_with_pass,
)
from app.subscription.service import set_subscription_tier


class RacePassUnitTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        users_dir = os.path.join(self._tmpdir.name, "users")
        os.makedirs(users_dir, exist_ok=True)
        self._users_dir = mock.patch.object(users, "_USERS_DIR", users_dir)
        self._users_dir.start()
        self.addCleanup(self._users_dir.stop)

        from app import routes_store

        self.routes_store = routes_store
        self._routes = mock.patch.object(routes_store, "_USERS_DIR", users_dir)
        self._routes.start()
        self.addCleanup(self._routes.stop)

        self.uid = "race-user"
        users.save_user(
            {
                "id": self.uid,
                "provider": "local",
                "email": "r@example.com",
                "name": "R",
                "avatar": None,
                "createdAt": 1,
                "providers": {},
                "subscriptionTier": "free",
                "racePassCredits": 0,
            }
        )

    def _seed_route(self, route_id: str = "route-1") -> None:
        path = self.routes_store._path(self.uid, route_id)  # noqa: SLF001
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "id": route_id,
                    "createdAt": 1,
                    "updatedAt": 1,
                    "name": "Race",
                    "distanceKm": 100,
                    "elevationGainM": 1000,
                    "pointCount": 2,
                    "hasTimestamps": False,
                    "status": "planning",
                    "track": [[0, 0], [1, 1]],
                    "points": [[0, 0], [1, 1]],
                },
                f,
            )

    def test_grant_and_import_gate(self) -> None:
        user = users.get_user(self.uid)
        assert user is not None
        self.assertFalse(can_import_planned_route(user))
        grant_race_pass_credit(self.uid, checkout_session_id="cs_a")
        user = users.get_user(self.uid)
        assert user is not None
        self.assertEqual(race_pass_credits(user), 1)
        self.assertTrue(can_import_planned_route(user))

    def test_unlock_consumes_credit(self) -> None:
        grant_race_pass_credit(self.uid)
        self._seed_route("r1")
        unlocked = unlock_route_with_pass(self.uid, "r1", consume_credit=True)
        assert unlocked is not None
        self.assertEqual(unlocked["proUnlock"]["source"], "race_pass")
        user = users.get_user(self.uid)
        assert user is not None
        self.assertEqual(race_pass_credits(user), 0)
        self.assertTrue(can_access_route_planning(user, unlocked))

    def test_apply_pass_after_import(self) -> None:
        grant_race_pass_credit(self.uid)
        self._seed_route("r2")
        apply_pass_after_import(self.uid, "r2")
        route = self.routes_store.get_route(self.uid, "r2")
        assert route is not None
        self.assertTrue(route.get("proUnlock"))
        user = users.get_user(self.uid)
        assert user is not None
        self.assertEqual(race_pass_credits(user), 0)

    def test_pro_skips_credit_spend(self) -> None:
        set_subscription_tier(self.uid, "pro", source="test")
        self._seed_route("r3")
        apply_pass_after_import(self.uid, "r3")
        route = self.routes_store.get_route(self.uid, "r3")
        assert route is not None
        self.assertIsNone(route.get("proUnlock"))
        user = users.get_user(self.uid)
        assert user is not None
        self.assertEqual(race_pass_credits(user), 0)

    def test_public_user_exposes_credits(self) -> None:
        grant_race_pass_credit(self.uid, qty=2)
        user = users.get_user(self.uid)
        assert user is not None
        pub = users.public_user(user)
        self.assertEqual(pub["racePassCredits"], 2)
        self.assertEqual(pub["billing"]["racePassCredits"], 2)


class RacePassImportApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        users_dir = os.path.join(self._tmpdir.name, "users")
        os.makedirs(users_dir, exist_ok=True)

        from app import routes_store
        from app.auth import current_user
        from app.main import app
        from fastapi.testclient import TestClient

        self._routes = mock.patch.object(routes_store, "_USERS_DIR", users_dir)
        self._routes.start()
        self.addCleanup(self._routes.stop)
        self._users_dir = mock.patch.object(users, "_USERS_DIR", users_dir)
        self._users_dir.start()
        self.addCleanup(self._users_dir.stop)

        self.uid = "import-gate"
        users.save_user(
            {
                "id": self.uid,
                "provider": "local",
                "email": "i@example.com",
                "name": "I",
                "avatar": None,
                "createdAt": 1,
                "providers": {},
                "subscriptionTier": "free",
                "racePassCredits": 0,
            }
        )

        app.dependency_overrides[current_user] = lambda: users.get_user(self.uid)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_import_forbidden_without_credit(self) -> None:
        res = self.client.post(
            "/api/routes/import",
            files={"file": ("course.gpx", b"<gpx/>", "application/gpx+xml")},
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("Race Pass", res.json().get("detail", ""))

    def test_import_allowed_with_credit_gate(self) -> None:
        grant_race_pass_credit(self.uid)
        # Gate passes; corrupt GPX → 400 (not 403).
        res = self.client.post(
            "/api/routes/import",
            files={"file": ("course.gpx", b"<gpx/>", "application/gpx+xml")},
        )
        self.assertNotEqual(res.status_code, 403)


if __name__ == "__main__":
    unittest.main()
