"""Provider registry — the one place that knows which providers exist.

Add a provider by adding it here; nothing in auth, storage or analysis changes.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from .base import RideProvider
from .strava import StravaProvider

_REGISTRY: Dict[str, RideProvider] = {
    "strava": StravaProvider(),
    # future: "garmin": GarminProvider(), "wahoo": WahooProvider(), ...
}


def get_provider(provider_id: str) -> Optional[RideProvider]:
    return _REGISTRY.get(provider_id)


def list_providers() -> List[RideProvider]:
    return list(_REGISTRY.values())
