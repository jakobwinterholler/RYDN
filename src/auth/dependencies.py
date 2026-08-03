"""FastAPI auth dependencies."""

from __future__ import annotations

from fastapi import Header, HTTPException, Request

from auth.jwt import AuthUser, verify_access_token
from cloud.config import cloud_config

_LOCAL_SYNC_HOSTS = {"127.0.0.1", "::1"}


def get_optional_user(authorization: str | None = Header(default=None)) -> AuthUser | None:
    if not authorization or not cloud_config.auth_enabled:
        return None
    if not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        return verify_access_token(token)
    except Exception:
        return None


def get_bearer_token(authorization: str | None = Header(default=None)) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return token or None


def require_user(authorization: str | None = Header(default=None)) -> AuthUser:
    if not cloud_config.auth_enabled:
        raise HTTPException(status_code=503, detail="Cloud auth is not configured on this server.")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in required.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        return verify_access_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session.") from exc


def _user_from_bearer(authorization: str | None) -> AuthUser | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        return verify_access_token(token)
    except Exception:
        return None


def resolve_sync_user(
    request: Request,
    authorization: str | None,
    body_user_id: str | None = None,
) -> AuthUser:
    """Resolve the signed-in user for cloud sync pushes.

    Desktop dev uses the local API with a service-role key for Supabase uploads.
    When JWT verification fails in the browser, accept the Supabase user id from
    the client on localhost only.
    """
    user = _user_from_bearer(authorization)
    if user is not None:
        return user

    client_host = request.client.host if request.client else ""
    if (
        client_host in _LOCAL_SYNC_HOSTS
        and cloud_config.service_role_key
        and body_user_id
    ):
        return AuthUser(id=body_user_id)

    if not cloud_config.auth_enabled:
        raise HTTPException(status_code=503, detail="Cloud auth is not configured on this server.")
    raise HTTPException(status_code=401, detail="Sign in required.")
