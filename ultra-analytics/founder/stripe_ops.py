"""Pull Stripe revenue / product mix for the founder dashboard."""

from __future__ import annotations

import json
import os
from typing import Any, Optional


def _g(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _price_map_from_billing_store(data_dir: Optional[str]) -> dict[str, str]:
    """Map price_id → product label using stripe_billing.json when present."""
    out: dict[str, str] = {}
    if not data_dir:
        return out
    path = os.path.join(data_dir, "stripe_billing.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            store = json.load(f)
    except (OSError, json.JSONDecodeError):
        return out
    if not isinstance(store, dict):
        return out
    for key, label in (
        ("priceProMonthly", "Pro monthly"),
        ("pricePro", "Pro monthly"),
        ("priceProYearly", "Pro yearly"),
        ("priceRacePass", "Race Pass"),
    ):
        pid = store.get(key)
        if isinstance(pid, str) and pid.startswith("price_"):
            out[pid] = label
    return out


def classify_line(
    *,
    price_id: Optional[str],
    description: Optional[str],
    interval: Optional[str],
    price_map: dict[str, str],
) -> str:
    if price_id and price_id in price_map:
        return price_map[price_id]
    desc = (description or "").lower()
    if "race" in desc and "pass" in desc:
        return "Race Pass"
    if interval == "year" or "year" in desc:
        return "Pro yearly"
    if interval == "month" or "month" in desc or "pro" in desc:
        return "Pro monthly"
    if description:
        return str(description)
    return "Other"


def _month_start_ts() -> int:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    return int(datetime(now.year, now.month, 1, tzinfo=timezone.utc).timestamp())


def fetch_stripe_ops(
    secret_key: str,
    *,
    data_dir: Optional[str] = None,
    charge_limit: int = 100,
    sub_limit: int = 40,
) -> dict[str, Any]:
    """Return payments + subscriptions. Never raises — returns error field instead."""
    if not secret_key or not secret_key.startswith("sk_"):
        return {
            "configured": False,
            "error": "Set STRIPE_SECRET_KEY (sk_test_… or sk_live_…) for revenue.",
            "charges": [],
            "subscriptions": [],
            "revenue": {},
        }

    try:
        import stripe
    except ImportError:
        return {
            "configured": False,
            "error": "stripe package missing — pip install stripe in the backend venv.",
            "charges": [],
            "subscriptions": [],
            "revenue": {},
        }

    stripe.api_key = secret_key
    price_map = _price_map_from_billing_store(data_dir)

    charges_out: list[dict[str, Any]] = []
    by_product: dict[str, int] = {}
    total_paid = 0
    total_fees = 0
    total_net = 0
    total_refunds = 0
    month_paid = 0
    month_fees = 0
    month_net = 0
    currency = "eur"
    month_start = _month_start_ts()

    try:
        charges = stripe.Charge.list(
            limit=charge_limit, expand=["data.balance_transaction"]
        )
        for ch in _g(charges, "data") or []:
            if not _g(ch, "paid"):
                continue
            amount = int(_g(ch, "amount") or 0)
            refunded = int(_g(ch, "amount_refunded") or 0)
            curr = str(_g(ch, "currency") or "eur").lower()
            currency = curr or currency
            created = int(_g(ch, "created") or 0)
            desc = _g(ch, "description")
            # Best-effort product from invoice / metadata
            meta = _g(ch, "metadata") or {}
            if hasattr(meta, "to_dict"):
                meta = meta.to_dict()
            price_id = None
            if isinstance(meta, dict):
                price_id = meta.get("price_id") or meta.get("priceId")
            label = classify_line(
                price_id=price_id,
                description=desc if isinstance(desc, str) else None,
                interval=None,
                price_map=price_map,
            )
            # Refine from billing_details / statement
            if label == "Other":
                stmt = _g(ch, "calculated_statement_descriptor") or _g(
                    ch, "statement_descriptor"
                )
                if isinstance(stmt, str) and "race" in stmt.lower():
                    label = "Race Pass"
            bt = _g(ch, "balance_transaction")
            fee = int(_g(bt, "fee") or 0) if bt else 0
            net = int(_g(bt, "net") or (amount - fee - refunded)) if bt else (amount - fee - refunded)
            by_product[label] = by_product.get(label, 0) + amount
            total_paid += amount
            total_fees += fee
            total_net += net
            total_refunds += refunded
            if created >= month_start:
                month_paid += amount
                month_fees += fee
                month_net += net
            cust = _g(ch, "customer")
            cust_id = cust if isinstance(cust, str) else _g(cust, "id")
            charges_out.append(
                {
                    "id": _g(ch, "id"),
                    "amountCents": amount,
                    "feeCents": fee,
                    "netCents": net,
                    "refundedCents": refunded,
                    "currency": curr,
                    "created": created,
                    "customerId": cust_id,
                    "receiptEmail": _g(ch, "receipt_email")
                    or _g(_g(ch, "billing_details"), "email"),
                    "description": desc,
                    "product": label,
                    "status": _g(ch, "status"),
                }
            )
    except Exception as e:  # noqa: BLE001
        return {
            "configured": True,
            "error": f"Stripe charges failed: {e}",
            "charges": [],
            "subscriptions": [],
            "revenue": {},
        }

    # Prefer invoices for better product labeling when available
    try:
        invoices = stripe.Invoice.list(limit=charge_limit, status="paid")
        for inv in _g(invoices, "data") or []:
            lines = _g(_g(inv, "lines"), "data") or []
            for line in lines:
                price = _g(line, "price")
                price_id = _g(price, "id") if price else None
                recurring = _g(price, "recurring") if price else None
                interval = _g(recurring, "interval") if recurring else None
                label = classify_line(
                    price_id=price_id if isinstance(price_id, str) else None,
                    description=_g(line, "description"),
                    interval=interval if isinstance(interval, str) else None,
                    price_map=price_map,
                )
                # Tag matching charges by amount/time is hard — annotate product map from invoices
                amt = int(_g(line, "amount") or 0)
                if amt > 0 and label != "Other":
                    # Don't double-count total_paid (charges already summed). Only improve labels.
                    pass
                # Update charge product labels when customer+amount match loosely
                inv_cust = _g(inv, "customer")
                inv_cust_id = inv_cust if isinstance(inv_cust, str) else _g(inv_cust, "id")
                inv_total = int(_g(inv, "amount_paid") or 0)
                for ch in charges_out:
                    if (
                        ch.get("customerId") == inv_cust_id
                        and ch.get("amountCents") == inv_total
                        and ch.get("product") == "Other"
                    ):
                        ch["product"] = label
                        # rebuild by_product from charges after relabel
    except Exception:  # noqa: BLE001
        pass

    # Rebuild product totals from (possibly relabeled) charges
    by_product = {}
    for ch in charges_out:
        label = str(ch.get("product") or "Other")
        by_product[label] = by_product.get(label, 0) + int(ch.get("amountCents") or 0)

    race_cents = int(by_product.get("Race Pass") or 0)
    pro_month_cents = int(by_product.get("Pro monthly") or 0)
    pro_year_cents = int(by_product.get("Pro yearly") or 0)

    subs_out: list[dict[str, Any]] = []
    mrr_cents = 0
    try:
        subs = stripe.Subscription.list(limit=sub_limit, status="all")
        for sub in _g(subs, "data") or []:
            status = str(_g(sub, "status") or "")
            items = _g(_g(sub, "items"), "data") or []
            interval = None
            price_id = None
            amount = 0
            if items:
                price = _g(items[0], "price")
                price_id = _g(price, "id")
                recurring = _g(price, "recurring")
                interval = _g(recurring, "interval") if recurring else None
                amount = int(_g(price, "unit_amount") or 0)
            label = classify_line(
                price_id=price_id if isinstance(price_id, str) else None,
                description=None,
                interval=interval if isinstance(interval, str) else None,
                price_map=price_map,
            )
            if status == "active":
                if interval == "year":
                    mrr_cents += amount // 12
                elif interval == "month":
                    mrr_cents += amount
            cust = _g(sub, "customer")
            cust_id = cust if isinstance(cust, str) else _g(cust, "id")
            subs_out.append(
                {
                    "id": _g(sub, "id"),
                    "status": status,
                    "customerId": cust_id,
                    "interval": interval,
                    "amountCents": amount,
                    "currency": str(
                        _g(_g(items[0], "price"), "currency") if items else "eur"
                    ).lower(),
                    "product": label,
                    "currentPeriodEnd": _g(sub, "current_period_end"),
                }
            )
    except Exception as e:  # noqa: BLE001
        return {
            "configured": True,
            "error": f"Stripe subscriptions failed: {e}",
            "charges": charges_out,
            "subscriptions": [],
            "revenue": {
                "currency": currency,
                "totalPaidCents": total_paid,
                "feesCents": total_fees,
                "netCents": total_net,
                "refundsCents": total_refunds,
                "monthPaidCents": month_paid,
                "monthFeesCents": month_fees,
                "monthNetCents": month_net,
                "byProductCents": by_product,
                "racePassCents": race_cents,
                "proMonthlyCents": pro_month_cents,
                "proYearlyCents": pro_year_cents,
                "mrrEstimateCents": mrr_cents,
            },
        }

    return {
        "configured": True,
        "error": None,
        "mode": "live" if secret_key.startswith("sk_live_") else "test",
        "charges": charges_out,
        "subscriptions": subs_out,
        "revenue": {
            "currency": currency,
            "totalPaidCents": total_paid,
            "feesCents": total_fees,
            "netCents": total_net,
            "refundsCents": total_refunds,
            "monthPaidCents": month_paid,
            "monthFeesCents": month_fees,
            "monthNetCents": month_net,
            "byProductCents": by_product,
            "racePassCents": race_cents,
            "proMonthlyCents": pro_month_cents,
            "proYearlyCents": pro_year_cents,
            "mrrEstimateCents": mrr_cents,
        },
    }


def build_full_snapshot(data_dir: str, stripe_secret: Optional[str] = None) -> dict[str, Any]:
    from .aggregate import build_app_snapshot
    from .finance import build_finance
    from .railway_billing import fetch_railway_billing
    from .service_usage import build_service_usage

    snap = build_app_snapshot(data_dir)
    key = (stripe_secret or os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    snap["stripe"] = fetch_stripe_ops(key, data_dir=data_dir)
    snap["serviceUsage"] = build_service_usage(data_dir)
    snap["railwayBilling"] = fetch_railway_billing()
    snap["finance"] = build_finance(
        data_dir, stripe=snap["stripe"], railway=snap["railwayBilling"]
    )

    # Attach emails to charges/subs when customer id matches app users
    by_cus = {
        u["stripeCustomerId"]: u
        for u in snap["users"]
        if u.get("stripeCustomerId")
    }
    for ch in snap["stripe"].get("charges") or []:
        u = by_cus.get(ch.get("customerId"))
        if u:
            ch["userEmail"] = u.get("email")
            ch["userId"] = u.get("id")
    for sub in snap["stripe"].get("subscriptions") or []:
        u = by_cus.get(sub.get("customerId"))
        if u:
            sub["userEmail"] = u.get("email")
            sub["userId"] = u.get("id")
    return snap
