"""Verify Strava streams map cleanly onto the canonical model and analyse.

Runnable without network or credentials:  python -m tests.test_strava_adapter
"""

from __future__ import annotations

from app.analysis.report import build_report
from app.providers.strava import StravaProvider

_provider = StravaProvider()


def streams_to_race(stub: dict, streams: dict):
    return _provider.streams_to_race(stub, streams)


def _fake_stub() -> dict:
    return {
        "id": "strava_123",
        "externalId": "123",
        "provider": "strava",
        "name": "Test Ride",
        "kind": "training",
        "date": "2026-06-01T06:00:00Z",
    }


def _fake_streams(n: int = 600) -> dict:
    # a gentle climb with rising power/HR, 1 Hz
    time = list(range(n))
    lat = [42.0 + i * 1e-5 for i in range(n)]
    lng = [2.0 + i * 1e-5 for i in range(n)]
    dist = [i * 7.0 for i in range(n)]  # ~25 km/h
    alt = [100 + i * 0.1 for i in range(n)]
    vel = [7.0 for _ in range(n)]
    hr = [120 + (i // 60) for i in range(n)]
    cad = [85 for _ in range(n)]
    watts = [200 + (i % 30) for i in range(n)]
    temp = [24 for _ in range(n)]
    return {
        "time": {"data": time},
        "latlng": {"data": [[a, b] for a, b in zip(lat, lng)]},
        "distance": {"data": dist},
        "altitude": {"data": alt},
        "velocity_smooth": {"data": vel},
        "heartrate": {"data": hr},
        "cadence": {"data": cad},
        "watts": {"data": watts},
        "temp": {"data": temp},
    }


def main() -> None:
    race = streams_to_race(_fake_stub(), _fake_streams())
    assert len(race.activities) == 1, "expected one activity"
    samples = race.activities[0].samples
    assert len(samples) == 600, f"expected 600 samples, got {len(samples)}"
    assert samples[0].lat is not None and samples[0].power == 200
    assert race.activities[0].start_time == samples[0].t

    report = build_report(race)
    ov = report["overview"]
    assert ov["distanceKm"] > 4, f"distance looks wrong: {ov['distanceKm']}"
    assert report["curves"]["available"], "curves should be available"
    assert report["overview"]["hasPower"], "power should be detected"
    print("streams_to_race OK — samples:", len(samples), "| distanceKm:", ov["distanceKm"], "| NP:", ov["npW"])

    # missing streams should fail cleanly, not crash
    empty_race_ok = False
    try:
        streams_to_race(_fake_stub(), {})
    except Exception:
        empty_race_ok = True
    assert empty_race_ok, "empty streams should raise"
    print("empty-stream guard OK")
    print("ALL STRAVA ADAPTER TESTS PASSED")


if __name__ == "__main__":
    main()
