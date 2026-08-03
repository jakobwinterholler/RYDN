"""Lightweight structured logging for Railway / local reliability — no PII."""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any, Optional

_configured = False


def configure_logging() -> None:
    """Idempotent — JSON lines on Railway, readable locally."""
    global _configured
    if _configured:
        return
    root = logging.getLogger("rydn")
    if not root.handlers:
        handler = logging.StreamHandler(sys.stderr)
        on_railway = bool(
            os.environ.get("RAILWAY_ENVIRONMENT")
            or os.environ.get("RAILWAY_PROJECT_ID")
            or (os.environ.get("ULTRA_ENV") or "").lower() == "production"
        )
        if on_railway or os.environ.get("ULTRA_LOG_JSON", "").lower() in ("1", "true", "yes"):
            handler.setFormatter(logging.Formatter("%(message)s"))
        else:
            handler.setFormatter(
                logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
            )
        root.addHandler(handler)
        level_name = (os.environ.get("ULTRA_LOG_LEVEL") or "INFO").upper()
        root.setLevel(getattr(logging, level_name, logging.INFO))
    _configured = True


def get_logger(name: str = "rydn") -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)


def log_event(event: str, *, level: int = logging.INFO, **fields: Any) -> None:
    """Emit one JSON line — safe for Railway log aggregators."""
    payload = {"ts": time.time(), "event": event, **fields}
    for key in ("email", "name", "access_token", "refresh_token", "password", "client_secret"):
        payload.pop(key, None)
    get_logger().log(level, json.dumps(payload, default=str))


def log_exception(event: str, exc: BaseException, **fields: Any) -> None:
    log_event(
        event,
        level=logging.ERROR,
        error_type=type(exc).__name__,
        error=str(exc)[:400],
        **fields,
    )


def sanitize_client_payload(body: Optional[dict]) -> dict:
    """Accept only reliability fields from the browser."""
    if not isinstance(body, dict):
        return {}
    out: dict[str, Any] = {}
    for key in ("message", "source", "url", "status", "code"):
        val = body.get(key)
        if isinstance(val, str):
            out[key] = val[:500]
        elif isinstance(val, (int, float)) and key in ("status",):
            out[key] = int(val)
    stack = body.get("stack")
    if isinstance(stack, str):
        out["stack"] = stack[:1500]
    return out
