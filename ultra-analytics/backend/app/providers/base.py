"""The contract every ride provider implements.

A *connection* is the per-user, provider-specific state we persist (tokens, athlete
id, last sync). It lives under ``user["providers"][provider_id]`` — never mixed with
identity. The router owns saving; the provider only computes.
"""

from __future__ import annotations

from typing import Callable, List, Optional

from ..models import Race


class RideProvider:
    id: str = ""
    label: str = ""

    def enabled(self) -> bool:
        """True when the provider is configured (client id/secret present)."""
        raise NotImplementedError

    # --- OAuth ---
    def authorize_url(self, state: str, redirect_uri: Optional[str] = None) -> str:
        raise NotImplementedError

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> dict:
        """Turn an OAuth code into a connection dict (tokens + identity)."""
        raise NotImplementedError

    async def valid_token(self, connection: dict, on_refresh: Callable[[dict], None]) -> str:
        """Return a usable access token, refreshing in place and calling
        ``on_refresh`` so the caller can persist the updated connection."""
        raise NotImplementedError

    # --- data ---
    async def list_activity_stubs(self, token: str, gear_map: Optional[dict] = None) -> List[dict]:
        """Lightweight ride summaries for Home. Each stub must include:
        id, provider, externalId, source, analyzed(False), name, kind, date,
        distanceKm, elevationGainM, durationS, movingTimeS, rideType."""
        raise NotImplementedError

    async def fetch_streams(self, token: str, external_id: str) -> dict:
        raise NotImplementedError

    def streams_to_race(self, stub: dict, streams: dict) -> Race:
        """Pure mapping from provider streams to the canonical Race. No network."""
        raise NotImplementedError

    def status(self, connection: Optional[dict]) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "enabled": self.enabled(),
            "connected": bool(connection),
            "lastSyncAt": (connection or {}).get("lastSyncAt"),
            "athleteId": (connection or {}).get("athleteId"),
        }
