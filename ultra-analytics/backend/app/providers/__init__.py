"""Ride providers — *where a user's rides come from*.

Deliberately separate from authentication (who the user is). A provider knows how
to authorize, pull activity summaries, and fetch a single ride's streams; the
canonical analysis pipeline never knows or cares which provider produced a ride.
Adding Garmin/Wahoo/etc. later means adding one file here — auth is untouched.
"""

from .registry import get_provider, list_providers

__all__ = ["get_provider", "list_providers"]
