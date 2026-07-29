"""Ultra aggregation — stitched totals must match day sums for distance/elev/moving."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from app.analysis.report import build_report
from app.analysis.ultra_report import _sum_member_overviews, _validate, build_ultra_analysis
from app.models import Activity, Race, Sample
from app import store, ultras


def _samples(t0: float, n: int = 120, speed: float = 8.0, ele0: float = 100.0) -> list:
    out = []
    dist = 0.0
    for i in range(n):
        dist += speed
        out.append(
            Sample(
                t=t0 + i,
                lat=48.0 + i * 0.0001,
                lon=11.0 + i * 0.0001,
                ele=ele0 + (i * 0.4 if i < n // 2 else (n - i) * 0.4),
                dist=dist,
                speed=speed,
                power=180.0 if i % 3 else None,
                hr=140,
                cadence=85,
            )
        )
    return out


class UltraAggregationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.uid = "agg-user"
        users = os.path.join(self._tmpdir.name, "users")
        os.makedirs(os.path.join(users, self.uid), exist_ok=True)
        self._p1 = mock.patch.object(ultras, "_USERS_DIR", users)
        self._p2 = mock.patch.object(store, "_USERS_DIR", users)
        self._p1.start()
        self._p2.start()
        self.addCleanup(self._p1.stop)
        self.addCleanup(self._p2.stop)

    def test_stitched_matches_day_sums(self) -> None:
        day1 = Activity(source_file="d1", samples=_samples(1_700_000_000.0, n=200))
        day2 = Activity(source_file="d2", samples=_samples(1_700_090_000.0, n=200, ele0=200))
        r1 = build_report(Race(name="D1", kind="race", activities=[day1]))
        r2 = build_report(Race(name="D2", kind="race", activities=[day2]))
        s1 = store.save_ride(self.uid, r1, activities=[day1])
        s2 = store.save_ride(self.uid, r2, activities=[day2])
        ultra = ultras.ultra_from_activities(
            self.uid,
            "Agg Ultra",
            [s1, s2],
        )

        user = {"id": self.uid}
        import asyncio

        payload = asyncio.run(build_ultra_analysis(user, ultra["id"], force=True))
        self.assertIn(payload["status"], ("ready", "ready_with_warnings"))
        self.assertIsNotNone(payload["aggregation"])
        validation = payload["aggregation"]["validation"]
        self.assertTrue(validation["ok"], validation)
        day_sum = _sum_member_overviews(self.uid, payload["activityIds"])
        agg = payload["aggregation"]
        self.assertAlmostEqual(agg["distanceKm"], day_sum["distanceKm"], delta=2.0)
        self.assertAlmostEqual(agg["movingTimeS"], day_sum["movingTimeS"], delta=120)
        # Ultra elapsed includes inter-day gap — must be >= sum of day elapsed
        self.assertGreaterEqual(agg["elapsedTimeS"], day_sum["elapsedTimeS"] - 1)
        self.assertEqual(agg["rideElapsedTimeS"], day_sum["elapsedTimeS"])
        self.assertEqual(agg["ridingDays"], 2)
        # Explicit: last end − first start
        self.assertAlmostEqual(agg["elapsedTimeS"], 1_700_090_000.0 + 199 - 1_700_000_000.0, delta=2)

    def test_validate_flags_mismatch(self) -> None:
        stitched = {"distanceKm": 100.0, "elevationGainM": 1000, "movingTimeS": 10000}
        day_sum = {"distanceKm": 120.0, "elevationGainM": 1000, "movingTimeS": 10000}
        result = _validate(stitched, day_sum)
        self.assertFalse(result["ok"])
        dist = next(c for c in result["checks"] if c["metric"] == "distanceKm")
        self.assertFalse(dist["ok"])

    def test_same_calendar_day_counts_as_one_riding_day(self) -> None:
        # Morning + afternoon on the same UTC calendar day, then next day.
        from datetime import datetime, timezone

        t_am = datetime(2024, 6, 11, 8, 0, tzinfo=timezone.utc).timestamp()
        t_pm = datetime(2024, 6, 11, 15, 20, tzinfo=timezone.utc).timestamp()
        t_next = datetime(2024, 6, 12, 8, 0, tzinfo=timezone.utc).timestamp()
        day1a = Activity(source_file="d1a", samples=_samples(t_am, n=100))
        day1b = Activity(source_file="d1b", samples=_samples(t_pm, n=80, ele0=150))
        day2 = Activity(source_file="d2", samples=_samples(t_next, n=120, ele0=200))
        r1a = build_report(Race(name="D1a", kind="race", activities=[day1a]))
        r1b = build_report(Race(name="D1b", kind="race", activities=[day1b]))
        r2 = build_report(Race(name="D2", kind="race", activities=[day2]))
        s1a = store.save_ride(self.uid, r1a, activities=[day1a])
        s1b = store.save_ride(self.uid, r1b, activities=[day1b])
        s2 = store.save_ride(self.uid, r2, activities=[day2])
        ultra = ultras.ultra_from_activities(self.uid, "Same Day Agg", [s1a, s1b, s2])
        self.assertEqual(ultra["dayCount"], 2)

        # Calendar-day grouping without requiring full analysis stitch (env-light).
        detail = ultras.ultra_detail(self.uid, ultra["id"], [s1a, s1b, s2])
        assert detail is not None
        days = detail["days"]
        self.assertEqual(len(days), 2)
        self.assertEqual(days[0]["recordingCount"], 2)
        self.assertEqual(days[1]["recordingCount"], 1)
        merged_km = float(s1a["distanceKm"]) + float(s1b["distanceKm"])
        self.assertAlmostEqual(days[0]["distanceKm"], merged_km, delta=0.2)

        # dayHours merge when analysis can run
        user = {"id": self.uid}
        import asyncio

        try:
            payload = asyncio.run(build_ultra_analysis(user, ultra["id"], force=True))
        except ModuleNotFoundError:
            self.skipTest("provider deps unavailable in this environment")
            return
        self.assertIn(payload["status"], ("ready", "ready_with_warnings"))
        agg = payload["aggregation"]
        self.assertEqual(agg["ridingDays"], 2)
        day_hours = payload["dayHours"]
        self.assertEqual(len(day_hours), 2)
        self.assertEqual(day_hours[0]["recordingCount"], 2)
        self.assertEqual(len(day_hours[0]["activityIds"]), 2)
        self.assertEqual(day_hours[1]["recordingCount"], 1)
        self.assertAlmostEqual(day_hours[0]["distanceKm"], merged_km, delta=2.0)


if __name__ == "__main__":
    unittest.main()
