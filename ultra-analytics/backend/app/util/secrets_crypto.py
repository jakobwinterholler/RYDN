"""Encrypt sensitive provider credentials at rest (Fernet + HKDF).

Tokens on disk are never stored as plaintext once saved through ``save_user``.
Legacy plaintext values are accepted on read and re-encrypted on the next write.
"""

from __future__ import annotations

import base64
import copy
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from ..config import get_secret

_PREFIX = "enc:v1:"
_TOKEN_KEYS = ("accessToken", "refreshToken", "access_token", "refresh_token")


def _fernet() -> Fernet:
    raw = get_secret().encode("utf-8")
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"rydn-provider-tokens-v1",
        info=b"at-rest",
    ).derive(raw)
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(value: str) -> str:
    if not value:
        return value
    if value.startswith(_PREFIX):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{_PREFIX}{token}"


def decrypt_secret(value: str) -> str:
    if not value or not value.startswith(_PREFIX):
        return value
    blob = value[len(_PREFIX) :].encode("ascii")
    try:
        return _fernet().decrypt(blob).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Could not decrypt stored credential — check ULTRA_SECRET.") from exc


def _walk_encrypt(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in _TOKEN_KEYS and isinstance(v, str) and v and not v.startswith(_PREFIX):
                out[k] = encrypt_secret(v)
            else:
                out[k] = _walk_encrypt(v)
        return out
    if isinstance(obj, list):
        return [_walk_encrypt(x) for x in obj]
    return obj


def _walk_decrypt(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in _TOKEN_KEYS and isinstance(v, str):
                out[k] = decrypt_secret(v)
            else:
                out[k] = _walk_decrypt(v)
        return out
    if isinstance(obj, list):
        return [_walk_decrypt(x) for x in obj]
    return obj


def encrypt_user_for_disk(user: dict) -> dict:
    """Deep-copy user and encrypt provider tokens before JSON write."""
    return _walk_encrypt(copy.deepcopy(user))


def decrypt_user_from_disk(user: dict) -> dict:
    """Decrypt provider tokens after JSON read (in-place safe copy)."""
    return _walk_decrypt(copy.deepcopy(user))


def is_encrypted_value(value: Optional[str]) -> bool:
    return bool(value and str(value).startswith(_PREFIX))
