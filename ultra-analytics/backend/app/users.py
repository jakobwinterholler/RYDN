"""User accounts + signed session cookies — Phase 1 local persistence.

One JSON file per user on disk. A user owns their rides (see store.py) and,
optionally, a linked Strava connection. Sessions are stateless signed cookies:
the cookie carries only the user id, signed with the app secret.
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional

from itsdangerous import BadSignature, URLSafeTimedSerializer

from .config import get_secret
from .paths import users_dir
from .util.secrets_crypto import decrypt_user_from_disk, encrypt_user_for_disk

_USERS_DIR = users_dir()
COOKIE_NAME = "ultra_session"
_SESSION_MAX_AGE = 60 * 60 * 24 * 60  # 60 days


def _ensure_dir() -> None:
    os.makedirs(_USERS_DIR, exist_ok=True)


def _path(uid: str) -> str:
    return os.path.join(_USERS_DIR, f"{uid}.json")


def _normalize(user: dict) -> dict:
    """Keep older records readable as the shape evolves. Auth identity and ride
    providers are separate concerns — connections live under user['providers']."""
    from .subscription.tiers import normalize_persisted_tier

    user.setdefault("providers", {})
    user.setdefault("onboardedAt", None)
    user.setdefault("weightKg", None)
    # Logged-in default is free; guest is unauthenticated (no user record).
    user["subscriptionTier"] = normalize_persisted_tier(user.get("subscriptionTier"))
    user.setdefault("subscriptionSource", None)
    user.setdefault("subscriptionUpdatedAt", None)
    user.setdefault("stripeCustomerId", None)
    user.setdefault("stripeSubscriptionId", None)
    user.setdefault("stripeStatus", None)
    user.setdefault("redeemPro", False)
    user.setdefault("appleActive", False)
    user.setdefault("racePassCredits", 0)
    # migrate any legacy embedded Strava connection into the providers map
    legacy = user.pop("strava", None)
    if legacy and "strava" not in user["providers"]:
        user["providers"]["strava"] = legacy
    return user


# Body weight for W/kg — user-set profile value (kg). Clear with None.
WEIGHT_KG_MIN = 30.0
WEIGHT_KG_MAX = 200.0


def parse_weight_kg(raw) -> float | None:
    """Validate a profile weight. Returns None to clear. Raises ValueError if bad."""
    if raw is None or raw == "":
        return None
    try:
        w = float(raw)
    except (TypeError, ValueError) as e:
        raise ValueError("Weight must be a number in kilograms.") from e
    if not (WEIGHT_KG_MIN <= w <= WEIGHT_KG_MAX):
        raise ValueError(f"Weight must be between {WEIGHT_KG_MIN:.0f} and {WEIGHT_KG_MAX:.0f} kg.")
    return round(w, 1)


def get_user(uid: str) -> Optional[dict]:
    try:
        path = _path(uid)
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        needs_reseal = False
        for conn in (raw.get("providers") or {}).values():
            if not isinstance(conn, dict):
                continue
            for k in ("accessToken", "refreshToken", "access_token", "refresh_token"):
                v = conn.get(k)
                if isinstance(v, str) and v and not v.startswith("enc:v1:"):
                    needs_reseal = True
                    break
            if needs_reseal:
                break
        user = _normalize(decrypt_user_from_disk(raw))
        if needs_reseal:
            save_user(user)
        return user
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def save_user(user: dict) -> dict:
    _ensure_dir()
    path = _path(user["id"])
    sealed = encrypt_user_for_disk(_normalize(user))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sealed, f)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return user


def upsert_google_user(sub: str, email: str, name: str, picture: str) -> dict:
    """Find or create the account for a Google identity (keyed by Google 'sub')."""
    uid = f"g_{sub}"
    user = get_user(uid)
    if user is None:
        user = {
            "id": uid,
            "provider": "google",
            "email": email,
            "name": name or email.split("@")[0],
            "avatar": picture,
            "createdAt": time.time(),
            "onboardedAt": None,
            "subscriptionTier": "free",
            "subscriptionSource": "default",
            "subscriptionUpdatedAt": None,
            "providers": {},
        }
    else:
        user["email"] = email or user.get("email")
        user["name"] = name or user.get("name")
        user["avatar"] = picture or user.get("avatar")
    return save_user(user)


def get_or_create_dev_user() -> dict:
    """Local, credential-free account so Review works before OAuth is configured."""
    uid = "local-dev"
    user = get_user(uid)
    if user is None:
        user = {
            "id": uid,
            "provider": "local",
            "email": "you@localhost",
            "name": "Local rider",
            "avatar": None,
            "createdAt": time.time(),
            "onboardedAt": None,
            "subscriptionTier": "free",
            "subscriptionSource": "default",
            "subscriptionUpdatedAt": None,
            "providers": {},
        }
        save_user(user)
    return user


def list_users() -> list[dict]:
    """Load all user records (small installs). Used for Stripe customer lookup."""
    _ensure_dir()
    out: list[dict] = []
    try:
        names = os.listdir(_USERS_DIR)
    except OSError:
        return out
    for name in names:
        if not name.endswith(".json"):
            continue
        uid = name[: -len(".json")]
        user = get_user(uid)
        if user:
            out.append(user)
    return out


def find_user_id_by_stripe_customer(customer_id: str) -> Optional[str]:
    if not customer_id:
        return None
    for user in list_users():
        if user.get("stripeCustomerId") == customer_id:
            return str(user["id"])
    return None


def public_user(user: dict) -> dict:
    """The safe subset sent to the browser — identity only, never tokens.
    Provider *connection* status is served separately by /api/providers."""
    weight = user.get("weightKg")
    try:
        weight_out = float(weight) if weight is not None else None
    except (TypeError, ValueError):
        weight_out = None
    from .subscription.service import get_tier

    stripe_status = user.get("stripeStatus")
    return {
        "id": user["id"],
        "provider": user.get("provider"),  # the auth provider (google/local)
        "email": user.get("email"),
        "name": user.get("name"),
        "avatar": user.get("avatar"),
        "onboardedAt": user.get("onboardedAt"),
        "weightKg": weight_out,
        "subscriptionTier": get_tier(user),
        "subscriptionSource": user.get("subscriptionSource"),
        "billing": {
            "stripeStatus": stripe_status,
            "hasStripeCustomer": bool(
                isinstance(user.get("stripeCustomerId"), str)
                and str(user.get("stripeCustomerId")).startswith("cus_")
            ),
            "redeemPro": bool(user.get("redeemPro")),
            "racePassCredits": int(user.get("racePassCredits") or 0),
        },
        "racePassCredits": int(user.get("racePassCredits") or 0),
    }


# --- sessions -------------------------------------------------------------- #
def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_secret(), salt="ultra-session")


def sign_session(uid: str) -> str:
    return _serializer().dumps(uid)


def read_session(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        return _serializer().loads(token, max_age=_SESSION_MAX_AGE)
    except (BadSignature, Exception):  # noqa: BLE001
        return None
