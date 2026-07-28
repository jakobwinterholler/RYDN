"""Regression tests for moving vs elapsed speed curves.

Best average speed over duration d:
  elapsed  — max (dist[t+d] - dist[t]) / d          over any wall-clock window
  moving   — max (dist[b] - dist[a]) / d            over any window with exactly
                                                    d *moving* seconds in [a, b)

On a fully-moving stretch the two MUST match. Product curves start at 5s
(configurable); the helpers still accept shorter durations when called directly.
"""

from __future__ import annotations

import os

from app.analysis.curves import (
    _clean_dist_for_speed,
    _elapsed_speed_curve,
    _moving_speed_curve,
    _speed_durations,
    _speed_min_duration_s,
)


def _assert_close(a: float, b: float, tol: float = 0.15) -> None:
    assert abs(a - b) <= tol, f"{a} != {b} (tol {tol})"


def test_constant_speed_no_stops_curves_match() -> None:
    # 10 m/s for 120 s → 36.0 km/h at every duration
    n = 120
    dist = [float(i * 10) for i in range(n)]
    moving = [True] * n
    durations = [5, 15, 30, 60]

    elapsed = {p["d"]: p["v"] for p in _elapsed_speed_curve(dist, durations)}
    moving_c = {p["d"]: p["v"] for p in _moving_speed_curve(dist, moving, durations)}

    for d in durations:
        assert d in elapsed and d in moving_c
        _assert_close(elapsed[d], 36.0)
        _assert_close(moving_c[d], 36.0)
        _assert_close(elapsed[d], moving_c[d])


def test_short_windows_match_even_with_stops() -> None:
    # 40 s riding @ 10 m/s, 20 s stop, 40 s riding @ 10 m/s
    dist = []
    moving = []
    d = 0.0
    for i in range(100):
        is_moving = not (40 <= i < 60)
        moving.append(is_moving)
        dist.append(d)
        if is_moving:
            d += 10.0

    elapsed = {p["d"]: p["v"] for p in _elapsed_speed_curve(dist, [5, 15, 30, 60])}
    moving_c = {p["d"]: p["v"] for p in _moving_speed_curve(dist, moving, [5, 15, 30, 60])}

    for d in (5, 15, 30):
        _assert_close(elapsed[d], 36.0)
        _assert_close(moving_c[d], 36.0)
        _assert_close(elapsed[d], moving_c[d])

    assert elapsed[60] < moving_c[60]
    _assert_close(moving_c[60], 36.0)
    _assert_close(elapsed[60], 24.0)  # 400 m / 60 s = 6.67 m/s = 24 km/h


def test_one_second_moving_is_not_zero() -> None:
    """Low-level helper still works at 1s; product analysis no longer emits it."""
    dist = [0.0, 12.0, 24.0, 36.0, 48.0]  # 12 m/s
    moving = [True] * 5
    pts = _moving_speed_curve(dist, moving, [1])
    assert pts and pts[0]["v"] > 0
    _assert_close(pts[0]["v"], 43.2)  # 12 m/s


def test_speed_min_duration_defaults_to_five() -> None:
    prev = os.environ.pop("ULTRA_SPEED_MIN_DURATION_S", None)
    try:
        assert _speed_min_duration_s() == 5
        assert _speed_durations([1, 5, 15, 60], 3600) == [5, 15, 60]
        os.environ["ULTRA_SPEED_MIN_DURATION_S"] = "15"
        assert _speed_durations([1, 5, 15, 60], 3600) == [15, 60]
    finally:
        if prev is None:
            os.environ.pop("ULTRA_SPEED_MIN_DURATION_S", None)
        else:
            os.environ["ULTRA_SPEED_MIN_DURATION_S"] = prev


def test_gps_spike_does_not_inflate_short_best_speed() -> None:
    # Steady 10 m/s with one absurd 50 m jump (180 km/h for 1s) — classic GPS noise.
    n = 60
    dist = [0.0]
    for i in range(1, n):
        step = 50.0 if i == 30 else 10.0
        dist.append(dist[-1] + step)
    moving = [True] * n

    cleaned = _clean_dist_for_speed(dist)
    # Spike step clamped to ~22.2 m (80 km/h)
    assert cleaned[30] - cleaned[29] <= 22.3

    raw_5 = max(
        (dist[i] - dist[i - 5]) / 5 * 3.6 for i in range(5, n) if dist[i] >= dist[i - 5]
    )
    elapsed = {p["d"]: p["v"] for p in _elapsed_speed_curve(dist, [5, 15])}
    # Cleaning must beat the raw spiked window (which is well above 50 km/h).
    assert raw_5 > 50
    assert elapsed[5] < 50.0
    # Longer windows stay near true pace; residual clamp adds at most one capped step.
    assert 34.0 <= elapsed[15] <= 42.0
    _assert_close(_moving_speed_curve(dist, moving, [5])[0]["v"], elapsed[5])


def main() -> None:
    test_constant_speed_no_stops_curves_match()
    print("  ok  test_constant_speed_no_stops_curves_match")
    test_short_windows_match_even_with_stops()
    print("  ok  test_short_windows_match_even_with_stops")
    test_one_second_moving_is_not_zero()
    print("  ok  test_one_second_moving_is_not_zero")
    test_speed_min_duration_defaults_to_five()
    print("  ok  test_speed_min_duration_defaults_to_five")
    test_gps_spike_does_not_inflate_short_best_speed()
    print("  ok  test_gps_spike_does_not_inflate_short_best_speed")
    print("5 passed")


if __name__ == "__main__":
    main()
