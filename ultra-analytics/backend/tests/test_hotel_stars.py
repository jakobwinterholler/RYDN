from app.analysis.route_pois import _parse_hotel_stars, _parse_phone, _parse_website


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


def test_parse_phone_and_website():
    assert _parse_phone({"phone": "+33 1 23 45 67 89"}) == "+33 1 23 45 67 89"
    assert _parse_phone({"contact:phone": "0123456789"}) == "0123456789"
    assert _parse_phone({"contact:mobile": "06 12 34 56 78"}) == "06 12 34 56 78"
    assert _parse_phone({}) is None
    assert _parse_website({"website": "https://hotel.example"}) == "https://hotel.example"
    assert _parse_website({"contact:website": "hotel.example"}) == "hotel.example"
    assert _parse_website({"url": "https://x.test"}) == "https://x.test"
    assert _parse_website({}) is None
