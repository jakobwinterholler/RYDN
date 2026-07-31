"""CSP must allow MapLibre OpenFreeMap + blob workers + Google Maps JS."""

from __future__ import annotations

import unittest

from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.middleware_security import SecurityHeadersMiddleware


class SecurityCspTests(unittest.TestCase):
    def test_csp_allows_maplibre_tiles_and_blob_worker(self) -> None:
        async def homepage(_request):
            return PlainTextResponse("ok")

        app = Starlette(routes=[Route("/", homepage)])
        app.add_middleware(SecurityHeadersMiddleware)
        client = TestClient(app)
        csp = client.get("/").headers["content-security-policy"]
        self.assertIn("tiles.openfreemap.org", csp)
        self.assertIn("tile.openstreetmap.org", csp)
        self.assertIn("worker-src 'self' blob:", csp)
        connect = next(part for part in csp.split(";") if "connect-src" in part)
        self.assertIn("tiles.openfreemap.org", connect)

    def test_csp_allows_google_maps_javascript(self) -> None:
        async def homepage(_request):
            return PlainTextResponse("ok")

        app = Starlette(routes=[Route("/", homepage)])
        app.add_middleware(SecurityHeadersMiddleware)
        client = TestClient(app)
        csp = client.get("/").headers["content-security-policy"]
        self.assertIn("https://maps.googleapis.com", csp)
        script = next(part for part in csp.split(";") if "script-src" in part)
        self.assertIn("maps.googleapis.com", script)
        self.assertIn("maps.gstatic.com", script)


if __name__ == "__main__":
    unittest.main()
