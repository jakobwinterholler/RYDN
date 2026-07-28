"""Wave 0: Ultra membership consistency — no stale totals, exclusive claims."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from app import ultras


def _ride(
    rid: str,
    *,
    km: float,
    elev: float,
    dur: float,
    moving: float,
    date: str,
) -> dict:
    return {
        "id": rid,
        "name": f"Ride {rid}",
        "distanceKm": km,
        "elevationGainM": elev,
        "durationS": dur,
        "movingTimeS": moving,
        "date": date,
        "analyzed": True,
        "status": "reviewed",
    }


class UltraConsistencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.uid = "test-user"
        self._users = os.path.join(self._tmpdir.name, "users")
        os.makedirs(os.path.join(self._users, self.uid), exist_ok=True)
        self._patcher = mock.patch.object(ultras, "_USERS_DIR", self._users)
        self._patcher.start()
        self.addCleanup(self._patcher.stop)

    def test_recompute_totals_and_day_count(self) -> None:
        # Day A: 10h elapsed starting 08:00. Day B: ~11.1h starting next day 08:00.
        # Ultra elapsed = end(B) − start(A) ≈ 24h + 11.1h = 35.1h, NOT sum of ride elapsed.
        rides = [
            _ride("a", km=100, elev=1000, dur=36000, moving=30000, date="2024-06-01T08:00:00+00:00"),
            _ride("b", km=120, elev=800, dur=40000, moving=32000, date="2024-06-02T08:00:00+00:00"),
        ]
        ultra = ultras.ultra_from_activities(self.uid, "Test Ultra", rides)
        self.assertEqual(ultra["distanceKm"], 220.0)
        self.assertEqual(ultra["elevationGainM"], 1800)
        # Wall clock: 2024-06-02 08:00 + 40000s − 2024-06-01 08:00
        expected_ultra = 24 * 3600 + 40000
        self.assertEqual(ultra["durationS"], expected_ultra)
        self.assertEqual(ultra["rideElapsedTimeS"], 76000)
        self.assertEqual(ultra["movingTimeS"], 62000)
        self.assertEqual(ultra["dayCount"], 2)
        self.assertEqual(ultra["year"], 2024)
        self.assertEqual(ultra["dateStart"][:10], "2024-06-01")
        self.assertEqual(ultra["dateEnd"][:10], "2024-06-02")

    def test_ultra_elapsed_includes_overnight_gap(self) -> None:
        # Two short rides with a long overnight between them.
        rides = [
            _ride("a", km=50, elev=400, dur=3600, moving=3000, date="2024-06-01T06:00:00+00:00"),
            _ride("b", km=50, elev=400, dur=3600, moving=3000, date="2024-06-02T06:00:00+00:00"),
        ]
        ultra = ultras.ultra_from_activities(self.uid, "Overnight", rides)
        # 24h + 1h = 25h wall clock; ride elapsed sum = 2h; moving = 6000
        self.assertEqual(ultra["durationS"], 25 * 3600)
        self.assertEqual(ultra["rideElapsedTimeS"], 7200)
        self.assertEqual(ultra["movingTimeS"], 6000)
        self.assertGreater(ultra["durationS"], ultra["rideElapsedTimeS"])
        self.assertGreater(ultra["rideElapsedTimeS"], ultra["movingTimeS"])

    def test_detach_and_recompute_after_remove(self) -> None:
        rides = [
            _ride("a", km=100, elev=1000, dur=36000, moving=30000, date="2024-06-01T08:00:00+00:00"),
            _ride("b", km=120, elev=800, dur=40000, moving=32000, date="2024-06-02T08:00:00+00:00"),
        ]
        ultra = ultras.ultra_from_activities(self.uid, "Test Ultra", rides)
        with mock.patch("app.store.list_rides", return_value=rides):
            affected = ultras.detach_activity_from_ultras(self.uid, "a")
        self.assertEqual(affected, [ultra["id"]])
        updated = ultras.get_ultra(self.uid, ultra["id"])
        assert updated is not None
        self.assertEqual(updated["activityIds"], ["b"])
        self.assertEqual(updated["distanceKm"], 120.0)
        self.assertEqual(updated["dayCount"], 1)
        self.assertEqual(updated["movingTimeS"], 32000)
        self.assertEqual(updated["durationS"], 40000)
        self.assertEqual(updated["rideElapsedTimeS"], 40000)

    def test_recompute_prunes_missing_rides(self) -> None:
        rides = [
            _ride("a", km=100, elev=1000, dur=36000, moving=30000, date="2024-06-01T08:00:00+00:00"),
            _ride("b", km=120, elev=800, dur=40000, moving=32000, date="2024-06-02T08:00:00+00:00"),
        ]
        ultra = ultras.ultra_from_activities(self.uid, "Test Ultra", rides)
        # Simulate deleted ride file: only b remains in library.
        remaining = [rides[1]]
        updated = ultras.recompute_ultra(self.uid, ultra["id"], rides=remaining)
        assert updated is not None
        self.assertEqual(updated["activityIds"], ["b"])
        self.assertEqual(updated["distanceKm"], 120.0)
        self.assertEqual(updated["dayCount"], 1)
        self.assertEqual(updated["year"], 2024)

    def test_exclusive_membership_conflicts(self) -> None:
        rides = [
            _ride("a", km=100, elev=1000, dur=36000, moving=30000, date="2024-06-01T08:00:00+00:00"),
            _ride("b", km=50, elev=200, dur=10000, moving=9000, date="2024-07-01T08:00:00+00:00"),
        ]
        first = ultras.ultra_from_activities(self.uid, "Ultra A", [rides[0]])
        conflicts = ultras.find_membership_conflicts(self.uid, ["a", "b"])
        self.assertEqual(conflicts, ["a"])
        ok = ultras.find_membership_conflicts(self.uid, ["a"], except_ultra_id=first["id"])
        self.assertEqual(ok, [])

    def test_empty_ultra_zeros_totals(self) -> None:
        ultra = ultras.create_ultra(self.uid, name="Empty")
        updated = ultras.recompute_ultra(self.uid, ultra["id"], rides=[])
        assert updated is not None
        self.assertEqual(updated["distanceKm"], 0)
        self.assertEqual(updated["elevationGainM"], 0)
        self.assertEqual(updated["durationS"], 0)
        self.assertEqual(updated["rideElapsedTimeS"], 0)
        self.assertEqual(updated["movingTimeS"], 0)
        self.assertEqual(updated["dayCount"], 0)
        self.assertIsNone(updated["year"])


class OAuthStateContractTests(unittest.TestCase):
    """Sanity: provider router no longer treats state as a user id."""

    def test_connect_uses_random_state_not_uid(self) -> None:
        from app.providers import router as provider_router

        self.assertTrue(hasattr(provider_router, "_STATE_COOKIE"))
        self.assertTrue(hasattr(provider_router, "_UID_COOKIE"))
        # Cookie names must not be the session cookie.
        from app.users import COOKIE_NAME

        self.assertNotEqual(provider_router._STATE_COOKIE, COOKIE_NAME)
        self.assertNotEqual(provider_router._UID_COOKIE, COOKIE_NAME)


if __name__ == "__main__":
    unittest.main()
