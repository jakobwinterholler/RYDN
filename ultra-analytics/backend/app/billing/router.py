"""Billing HTTP API — Checkout, Portal, webhook, status."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from ..auth import current_user
from ..util.logging_util import log_exception
from .config import billing_configured, get_stripe_config
from .stripe_service import (
    create_checkout_session,
    create_portal_session,
    create_race_pass_checkout,
)
from .webhooks import construct_event, handle_stripe_event

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/status")
def billing_status(user: dict = Depends(current_user)) -> JSONResponse:
    from .config import pricing_public
    from .store import load_billing_store

    cfg = get_stripe_config()
    store = load_billing_store()
    return JSONResponse(
        {
            "configured": billing_configured(),
            "publishableKey": cfg.publishable_key or None,
            "hasStripeCustomer": bool(
                isinstance(user.get("stripeCustomerId"), str)
                and str(user.get("stripeCustomerId")).startswith("cus_")
            ),
            "stripeStatus": user.get("stripeStatus"),
            "subscriptionTier": user.get("subscriptionTier"),
            "subscriptionSource": user.get("subscriptionSource"),
            "pricing": pricing_public(),
            "racePassCredits": int(user.get("racePassCredits") or 0),
            "racePassConfigured": cfg.race_pass_configured,
            "autoSetup": {
                "hasSecretKey": bool(cfg.secret_key),
                "pricePro": cfg.price_pro or None,
                "priceProYearly": cfg.price_pro_yearly or None,
                "priceRacePass": cfg.price_race_pass or None,
                "mode": store.get("mode"),
            },
        }
    )


@router.post("/bootstrap")
def billing_bootstrap(user: dict = Depends(current_user)) -> JSONResponse:
    """Re-run auto setup (e.g. after pasting a new Stripe secret). Auth required."""
    from .bootstrap import bootstrap_stripe

    if not get_stripe_config().secret_key:
        raise HTTPException(
            status_code=503,
            detail="Add STRIPE_SECRET_KEY in Railway, then try again.",
        )
    result = bootstrap_stripe(force=True)
    if not result.get("ok"):
        raise HTTPException(
            status_code=502,
            detail=result.get("reason") or "Stripe auto-setup failed.",
        )
    return JSONResponse({"configured": billing_configured(), **result})


@router.post("/checkout-session")
async def checkout_session(request: Request, user: dict = Depends(current_user)) -> JSONResponse:
    if not billing_configured():
        raise HTTPException(
            status_code=503,
            detail="Payments are not set up yet. Use a redeem code on Account, or try again later.",
        )
    interval = "month"
    try:
        body = await request.json()
        if isinstance(body, dict) and body.get("interval"):
            interval = str(body.get("interval"))
    except Exception:  # noqa: BLE001
        pass
    try:
        out = create_checkout_session(user["id"], interval=interval)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        log_exception("billing.checkout_failed", e)
        raise HTTPException(status_code=502, detail="Could not start checkout. Try again.") from e
    return JSONResponse(out)


@router.post("/race-pass-checkout")
async def race_pass_checkout(request: Request, user: dict = Depends(current_user)) -> JSONResponse:
    cfg = get_stripe_config()
    if not cfg.race_pass_configured:
        raise HTTPException(
            status_code=503,
            detail="Race Pass is not set up yet. Try again in a moment, or upgrade to Pro.",
        )
    route_id = None
    try:
        body = await request.json()
        if isinstance(body, dict) and body.get("routeId"):
            route_id = str(body.get("routeId"))
    except Exception:  # noqa: BLE001
        pass
    try:
        out = create_race_pass_checkout(user["id"], route_id=route_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        log_exception("billing.race_pass_checkout_failed", e)
        raise HTTPException(status_code=502, detail="Could not start Race Pass checkout.") from e
    return JSONResponse(out)


@router.post("/portal-session")
def portal_session(user: dict = Depends(current_user)) -> JSONResponse:
    if not billing_configured():
        raise HTTPException(status_code=503, detail="Payments are not set up yet.")
    try:
        out = create_portal_session(user["id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        log_exception("billing.portal_failed", e)
        raise HTTPException(status_code=502, detail="Could not open billing portal.") from e
    return JSONResponse(out)


@router.post("/webhook")
async def stripe_webhook(request: Request) -> JSONResponse:
    """Stripe → RYDN. No session cookie — verified via signature."""
    if not billing_configured():
        raise HTTPException(status_code=503, detail="Billing not configured.")

    payload = await request.body()
    sig = request.headers.get("stripe-signature") or ""
    if not sig:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature.")

    try:
        event = construct_event(payload, sig)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid payload.") from e
    except Exception as e:  # noqa: BLE001
        # stripe.error.SignatureVerificationError
        raise HTTPException(status_code=400, detail="Invalid signature.") from e

    try:
        result = handle_stripe_event(event)
    except Exception as e:  # noqa: BLE001
        log_exception("billing.webhook_handler_failed", e)
        raise HTTPException(status_code=500, detail="Webhook handler error.") from e

    return JSONResponse(result)
