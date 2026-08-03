"""Subscription HTTP API — redeem codes (no payments)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from ..auth import current_user
from ..users import public_user
from .codes import redeem_code
from .service import get_tier

router = APIRouter(prefix="/api/subscription", tags=["subscription"])


@router.get("/status")
def subscription_status(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse(
        {
            "subscriptionTier": get_tier(user),
            "source": user.get("subscriptionSource"),
            "updatedAt": user.get("subscriptionUpdatedAt"),
        }
    )


@router.post("/redeem")
async def redeem(request: Request, user: dict = Depends(current_user)) -> JSONResponse:
    try:
        body = await request.json()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid JSON body.") from e
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object.")

    code = body.get("code")
    if not isinstance(code, str):
        raise HTTPException(status_code=400, detail="Enter a redeem code.")

    try:
        updated, redeem_action = redeem_code(user["id"], code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except KeyError as e:
        raise HTTPException(status_code=401, detail="Not signed in.") from e

    payload = public_user(updated)
    if redeem_action:
        payload["redeemAction"] = redeem_action
    return JSONResponse(payload)
