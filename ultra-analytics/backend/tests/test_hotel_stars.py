from app.analysis.route_pois import _parse_hotel_stars


def test_parse_hotel_stars_basic():
    assert _parse_hotel_stars({"stars": "3"}) == 3
    assert _parse_hotel_stars({"stars": "4.0"}) == 4
    assert _parse_hotel_stars({"stars:hotel": "2"}) == 2
    assert _parse_hotel_stars({"hotel:stars": "5"}) == 5


def test_parse_hotel_stars_rejects_missing_or_junk():
    assert _parse_hotel_stars({}) is None
    assert _parse_hotel_stars({"stars": "0"}) is None
    assert _parse_hotel_stars({"stars": "6"}) is None
    assert _parse_hotel_stars({"stars": "3-4"}) is None
    assert _parse_hotel_stars({"stars": "good"}) is None
