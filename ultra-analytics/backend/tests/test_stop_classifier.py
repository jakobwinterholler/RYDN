"""Locks in the behaviour-first stop classification philosophy.

Run: ./.venv/bin/python -m tests.test_stop_classifier
"""

from app.analysis.stop_classifier import (
    HOTEL,
    RESTAURANT,
    SLEEP,
    UNKNOWN,
    StopFeatures,
    classify,
)


def _mins(m):
    return m * 60.0


def test_overnight_is_sleep_from_behaviour_not_location():
    f = StopFeatures(
        duration_s=_mins(372),  # 6h12m
        local_hour=2.0,
        night=True,
        is_gap=True,
        high_point=False,
    )
    cat, conf, reasons = classify(f)
    assert cat == SLEEP, cat
    assert conf >= 0.90, conf
    # The decisive reason must be behavioural, not a nearby POI.
    assert any("stationary" in r for r in reasons), reasons
    assert not any("nearby" in r for r in reasons), reasons


def test_nearby_hotel_alone_does_not_make_a_hotel():
    # A 10-minute stop that merely happens to be near accommodation.
    f = StopFeatures(
        duration_s=_mins(10),
        local_hour=15.0,
        night=False,
        is_gap=False,
        high_point=False,
        near_accommodation=True,
    )
    cat, conf, _ = classify(f)
    assert cat not in (HOTEL, SLEEP), f"10-min stop became {cat}"
    assert cat == UNKNOWN, cat


def test_short_stop_with_no_evidence_is_unknown():
    f = StopFeatures(
        duration_s=_mins(6),
        local_hour=15.5,
        night=False,
        is_gap=False,
        high_point=False,
    )
    cat, conf, _ = classify(f)
    assert cat == UNKNOWN, cat
    assert conf < 0.5, conf


def test_meal_time_plus_poi_yields_restaurant():
    f = StopFeatures(
        duration_s=_mins(28),
        local_hour=12.75,  # lunch
        night=False,
        is_gap=False,
        high_point=False,
        poi_category=RESTAURANT,
    )
    cat, conf, _ = classify(f)
    assert cat == RESTAURANT, cat
    assert 0.6 <= conf <= 0.8, conf


def test_long_daytime_rest_can_be_hotel_from_duration():
    f = StopFeatures(
        duration_s=_mins(240),  # 4h off the bike, daytime
        local_hour=14.0,
        night=False,
        is_gap=True,
        high_point=False,
    )
    cat, conf, reasons = classify(f)
    assert cat == HOTEL, cat
    assert conf >= 0.7, conf
    assert any("stationary" in r for r in reasons), reasons


def test_verified_stop_is_authoritative():
    f = StopFeatures(
        duration_s=_mins(9),
        local_hour=16.0,
        night=False,
        is_gap=False,
        high_point=False,
        verified_category="supermarket",
    )
    cat, conf, _ = classify(f)
    assert cat == "supermarket", cat
    assert conf >= 0.9, conf


def test_user_correction_wins():
    f = StopFeatures(
        duration_s=_mins(200),
        local_hour=1.0,
        night=True,
        is_gap=True,
        high_point=False,
        user_category="restaurant",
    )
    cat, conf, _ = classify(f)
    assert cat == "restaurant", cat
    assert conf >= 0.95, conf


def _run():
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok  {name}")
            passed += 1
    print(f"\n{passed} passed")


if __name__ == "__main__":
    _run()
