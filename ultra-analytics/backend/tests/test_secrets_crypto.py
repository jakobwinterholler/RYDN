"""Unit tests for at-rest credential encryption."""

from __future__ import annotations

import json
import os
import tempfile

import pytest

# Ensure a stable secret before importing app modules that cache it.
os.environ["ULTRA_SECRET"] = "test-secret-for-crypto-unit-tests-only-32b"


def test_roundtrip_encrypt_decrypt():
    from app.util.secrets_crypto import decrypt_secret, encrypt_secret, is_encrypted_value

    plain = "strava-access-token-xyz"
    enc = encrypt_secret(plain)
    assert is_encrypted_value(enc)
    assert enc != plain
    assert decrypt_secret(enc) == plain
    assert encrypt_secret(enc) == enc  # idempotent


def test_user_disk_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("ULTRA_SECRET", "test-secret-for-crypto-unit-tests-only-32b")
    # Reset cached secret if any
    import app.config as cfg

    cfg._secret = None
    cfg._config = None

    from app import users

    monkeypatch.setattr(users, "_USERS_DIR", str(tmp_path))
    user = {
        "id": "u1",
        "provider": "local",
        "email": "a@b.c",
        "name": "A",
        "providers": {
            "strava": {
                "accessToken": "plain-access",
                "refreshToken": "plain-refresh",
                "expiresAt": 9999999999,
                "athleteId": 1,
            }
        },
    }
    users.save_user(user)
    on_disk = json.loads((tmp_path / "u1.json").read_text())
    assert on_disk["providers"]["strava"]["accessToken"].startswith("enc:v1:")
    assert on_disk["providers"]["strava"]["refreshToken"].startswith("enc:v1:")
    assert "plain-access" not in (tmp_path / "u1.json").read_text()

    loaded = users.get_user("u1")
    assert loaded is not None
    assert loaded["providers"]["strava"]["accessToken"] == "plain-access"
    assert loaded["providers"]["strava"]["refreshToken"] == "plain-refresh"


def test_legacy_plaintext_still_loads(tmp_path, monkeypatch):
    monkeypatch.setenv("ULTRA_SECRET", "test-secret-for-crypto-unit-tests-only-32b")
    import app.config as cfg

    cfg._secret = None
    cfg._config = None
    from app import users

    monkeypatch.setattr(users, "_USERS_DIR", str(tmp_path))
    path = tmp_path / "u2.json"
    path.write_text(
        json.dumps(
            {
                "id": "u2",
                "provider": "local",
                "providers": {"strava": {"accessToken": "legacy", "refreshToken": "legacy-r"}},
            }
        )
    )
    loaded = users.get_user("u2")
    assert loaded["providers"]["strava"]["accessToken"] == "legacy"
    users.save_user(loaded)
    sealed = json.loads(path.read_text())
    assert sealed["providers"]["strava"]["accessToken"].startswith("enc:v1:")
