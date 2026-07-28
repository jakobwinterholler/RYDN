"""User-facing API error helpers — never leak internals to the client."""

from __future__ import annotations

from fastapi import HTTPException


# Stable messages clients can map without parsing exception strings.
MSG_SERVER = "Something went wrong on our side. Please try again in a moment."
MSG_TIMEOUT = "The request timed out. Check your connection and try again."
MSG_UNAVAILABLE = "Service temporarily unavailable. Please try again shortly."
MSG_RATE = "Too many requests. Wait a minute, then try again."
MSG_NETWORK_PROVIDER = "Could not reach the connected service. Try again in a moment."
MSG_IMPORT_CORRUPT = "That file could not be read. Export a fresh FIT, TCX, or GPX and try again."
MSG_ANALYSIS = "Could not analyse this ride. Try re-syncing or re-uploading the file."
MSG_ULTRA_ANALYSIS = "Could not build Ultra analytics. Add days with GPS, then try again."
MSG_SYNC = "Sync failed. Check your connection and try again."
MSG_SESSION = "Your session expired. Sign in again to continue."


def http_user(status: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail=detail)


def format_validation_detail(detail: object) -> str:
    """Turn FastAPI / pydantic detail into a short user string."""
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        parts: list[str] = []
        for item in detail[:3]:
            if isinstance(item, dict):
                loc = ".".join(str(x) for x in (item.get("loc") or []) if x != "body")
                msg = item.get("msg") or "Invalid value"
                parts.append(f"{loc}: {msg}" if loc else str(msg))
            else:
                parts.append(str(item))
        return "; ".join(parts) if parts else "Invalid request."
    return "Invalid request."
