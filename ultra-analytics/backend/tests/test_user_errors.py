"""Regression: API errors must stay user-facing — no exception text leaked."""

from __future__ import annotations

from app.util.http_errors import (
    MSG_ANALYSIS,
    MSG_IMPORT_CORRUPT,
    MSG_SYNC,
    MSG_ULTRA_ANALYSIS,
    format_validation_detail,
)


def test_stable_messages_are_human():
    for msg in (MSG_ANALYSIS, MSG_IMPORT_CORRUPT, MSG_SYNC, MSG_ULTRA_ANALYSIS):
        assert "Traceback" not in msg
        assert "Exception" not in msg
        assert "{" not in msg
        assert len(msg) < 200


def test_format_validation_detail_list():
    detail = [{"loc": ["body", "name"], "msg": "field required", "type": "value_error"}]
    text = format_validation_detail(detail)
    assert "name" in text
    assert "required" in text.lower()


def test_format_validation_detail_string():
    assert format_validation_detail("Already exists.") == "Already exists."
