"""GET /api/maps/js-config — auth-gated Maps JS key from server env."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.auth import current_user
from app.main import app
from app.maps import maps_js_config


class MapsJsConfigTests(unittest.TestCase):
    def test_js_config_requires_auth(self) -> None:
        client = TestClient(app)
        res = client.get("/api/maps/js-config")
        self.assertEqual(res.status_code, 401)

    def test_js_config_returns_key_when_configured(self) -> None:
        with patch("app.maps.get_config") as gc:
            gc.return_value.google_maps_api_key = "test-maps-key-not-for-prod"
            body = maps_js_config(user={"id": "u1"})
        self.assertTrue(body["configured"])
        self.assertEqual(body["apiKey"], "test-maps-key-not-for-prod")

    def test_js_config_unconfigured(self) -> None:
        with patch("app.maps.get_config") as gc:
            gc.return_value.google_maps_api_key = ""
            body = maps_js_config(user={"id": "u1"})
        self.assertFalse(body["configured"])
        self.assertIsNone(body["apiKey"])

    def test_js_config_http_with_auth_override(self) -> None:
        app.dependency_overrides[current_user] = lambda: {"id": "u1"}
        try:
            with patch("app.maps.get_config") as gc:
                gc.return_value.google_maps_api_key = "test-maps-key-not-for-prod"
                client = TestClient(app)
                res = client.get("/api/maps/js-config")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["apiKey"], "test-maps-key-not-for-prod")
        finally:
            app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
