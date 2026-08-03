"""Overnight-chain grouping suggestions for Library."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from app.analysis.report import build_report
from app.models import Activity, Race, Sample
from app import store, ultras

# Fixed calendar anchors (UTC)
_DAY1 = 1_717_233_600.0  # 2024-06-01T08:00:00Z
_DAY2 = 1_717_320_000.0  # 2024-06-02T08:00:00Z
_LOOP1 = 1_719_820_800.0  # 2024-07-01T08:00:00Z
_LOOP2 = 1_719_907_200.0  # 2024-07-02T08:00:00Z


def _line_samples(
    t0: float,
    start_lat: float,
    start_lon: float,
    end_lat: float,
    end_lon: float,
    n: int = 40,
    speed: float = 8.0,
) -> list:
    out = []
    dist = 0.0
    for i in range(n):
        t = i / (n - 1)
        lat = start_lat + (end_lat - start_lat) * t
        lon = start_lon + (end_lon - start_lon) * t
        if i:
            dist += speed
        out.append(
            Sample(
                t=t0 + i * 60,
                lat=lat,
                lon=lon,
                ele=100.0,
                dist=dist,
                speed=speed,
                power=None,
                hr=None,
                cadence=None,
            )
        )
    return out


def _out_and_back(
    t0: float,
    lat: float,
    lon: float,
    tip_lat: float,
    tip_lon: float,
) -> list:
    out = _line_samples(t0, lat, lon, tip_lat, tip_lon, n=24)
    back = _line_samples(t0 + 24 * 60, tip_lat, tip_lon, lat, lon, n=24)
    return out + back[1:]


def _save(uid: str, name: str, samples: list, kind: str = "tour") -> dict:
    day = Activity(source_file=name, samples=samples)
    report = build_report(Race(name=name, kind=kind, activities=[day]))
    return store.save_ride(uid, report, activities=[day])


class UltraSuggestionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.uid = "suggest-user"
        users = os.path.join(self._tmpdir.name, "users")
        os.makedirs(os.path.join(users, self.uid), exist_ok=True)
        self._p1 = mock.patch.object(ultras, "_USERS_DIR", users)
        self._p2 = mock.patch.object(store, "_USERS_DIR", users)
        self._p1.start()
        self._p2.start()
        self.addCleanup(self._p1.stop)
        self.addCleanup(self._p2.stop)

    def test_suggests_overnight_chain(self) -> None:
        # Point-to-point stages: Day1 finish ≈ Day2 start, relocated overnight, Day2 onward.
        a = _save(
            self.uid,
            "Tour Day 1",
            _line_samples(_DAY1, 48.14, 11.58, 48.37, 10.90),
        )
        b = _save(
            self.uid,
            "Tour Day 2",
            _line_samples(_DAY2, 48.38, 10.89, 48.60, 10.40),
        )
        rides = store.list_rides(self.uid)
        suggestions = ultras.suggest_ultra_groups(rides, claimed=set(), uid=self.uid)
        self.assertEqual(len(suggestions), 1)
        self.assertEqual(set(suggestions[0]["activityIds"]), {a["id"], b["id"]})
        self.assertIn("overnight", suggestions[0]["message"].lower())

    def test_rejects_same_garage_name_twins(self) -> None:
        # Shared "Alps Day N" stem but both are garage out-and-backs.
        _save(
            self.uid,
            "Alps Day 1",
            _out_and_back(_LOOP1, 48.14, 11.58, 48.20, 11.80),
            kind="training",
        )
        _save(
            self.uid,
            "Alps Day 2",
            _out_and_back(_LOOP2, 48.14, 11.58, 48.22, 11.70),
            kind="training",
        )
        rides = store.list_rides(self.uid)
        suggestions = ultras.suggest_ultra_groups(rides, claimed=set(), uid=self.uid)
        self.assertEqual(suggestions, [])

    def test_rejects_without_uid_or_geo(self) -> None:
        rides = [
            {"id": "x1", "name": "Somewhere Day 1", "date": "2024-08-01T08:00:00Z"},
            {"id": "x2", "name": "Somewhere Day 2", "date": "2024-08-02T08:00:00Z"},
        ]
        self.assertEqual(ultras.suggest_ultra_groups(rides, set(), uid=None), [])
        self.assertEqual(ultras.suggest_ultra_groups(rides, set(), uid=self.uid), [])

    def test_return_toward_start_is_valid_chain(self) -> None:
        # Two-day out: Day2 returns toward Day1 start.
        a = _save(
            self.uid,
            "Ridge Day 1",
            _line_samples(_DAY1, 47.00, 10.00, 47.40, 10.50),
        )
        b = _save(
            self.uid,
            "Ridge Day 2",
            _line_samples(_DAY2, 47.41, 10.51, 47.05, 10.05),
        )
        rides = store.list_rides(self.uid)
        suggestions = ultras.suggest_ultra_groups(rides, claimed=set(), uid=self.uid)
        self.assertEqual(len(suggestions), 1)
        self.assertEqual(set(suggestions[0]["activityIds"]), {a["id"], b["id"]})
