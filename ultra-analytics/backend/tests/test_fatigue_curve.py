"""Durability / fatigue curve — % of first-hour baseline over elapsed time."""

from __future__ import annotations

from app.analysis.curves import _fatigue_curve


def _const(n: int, v: float):
    return [v] * n


def test_steady_power_stays_near_100() -> None:
    # 4 h flat 200 W — every sample should be ~100% of hour 1
    n = 4 * 3600
    power = _const(n, 200.0)
    out = _fatigue_curve(power, _const(n, None), _const(n, None))
    assert out["available"] is True
    assert out["unit"] == "% of hour 1"
    assert out["absUnit"] == "W"
    assert out["baselineAbs"] == 200
    assert out["metric"] == "best 5-min power"
    assert len(out["series"]) >= 8  # 15-min steps from 1h → 4h
    assert out["series"][0]["h"] == 1.0
    assert out["series"][0]["v"] == 100.0
    assert out["series"][0]["abs"] == 200
    for p in out["series"]:
        assert abs(p["v"] - 100.0) < 0.5


def test_fading_power_drops_below_baseline() -> None:
    # Hour 1: 250 W, then steps down to 180 W
    n = 4 * 3600
    power = []
    for i in range(n):
        h = i // 3600
        power.append(250.0 - h * 20.0)
    out = _fatigue_curve(power, [None] * n, [None] * n)
    assert out["available"] is True
    assert out["baselineAbs"] == 250
    late = [p for p in out["series"] if p["h"] >= 3.5]
    assert late
    assert late[-1]["v"] < 85
    assert late[-1]["abs"] < 220


def test_short_ride_unavailable() -> None:
    n = 3600  # only 1 hour
    out = _fatigue_curve(_const(n, 200.0), [None] * n, [None] * n)
    assert out["available"] is False


def test_efficiency_fallback_without_power() -> None:
    n = 3 * 3600
    speed = _const(n, 25.0)  # km/h
    hr = _const(n, 140.0)
    power = [None] * n
    out = _fatigue_curve(power, speed, hr)
    assert out["available"] is True
    assert out["absUnit"] == "m/beat"
    assert out["series"][0]["v"] == 100.0
