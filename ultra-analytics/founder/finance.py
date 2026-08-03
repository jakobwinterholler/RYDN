"""P&L: Stripe revenue/fees + paid stack + Railway + manual expenses."""

from __future__ import annotations

import json
import os
import time
import uuid
from calendar import monthrange
from datetime import datetime, timezone
from typing import Any, Optional


def _founder_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def _expenses_path(data_dir: str) -> str:
    return os.path.join(data_dir, "usage", "expenses.json")


def _load_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def load_expenses(data_dir: str) -> list[dict[str, Any]]:
    raw = _load_json(_expenses_path(data_dir))
    if isinstance(raw, dict) and isinstance(raw.get("items"), list):
        return [x for x in raw["items"] if isinstance(x, dict)]
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    return []


def save_expenses(data_dir: str, items: list[dict[str, Any]]) -> None:
    path = _expenses_path(data_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {"updatedAt": time.time(), "items": items}
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def add_expense(
    data_dir: str,
    *,
    label: str,
    amount_cents: int,
    currency: str = "eur",
    category: str = "ops",
    at: Optional[float] = None,
    note: str = "",
) -> dict[str, Any]:
    items = load_expenses(data_dir)
    row = {
        "id": f"exp_{uuid.uuid4().hex[:10]}",
        "label": label.strip() or "Expense",
        "amountCents": int(amount_cents),
        "currency": (currency or "eur").lower(),
        "category": category or "ops",
        "at": float(at if at is not None else time.time()),
        "note": note or "",
        "source": "manual",
    }
    items.append(row)
    items.sort(key=lambda x: float(x.get("at") or 0), reverse=True)
    save_expenses(data_dir, items)
    return row


def load_paid_stack(data_dir: str) -> dict[str, Any]:
    """Merge catalog + optional local overrides (by id)."""
    base = _load_json(os.path.join(_founder_dir(), "paid_stack.json"))
    if not isinstance(base, dict):
        base = {"currency": "eur", "services": []}
    services = {
        str(s["id"]): dict(s)
        for s in (base.get("services") or [])
        if isinstance(s, dict) and s.get("id")
    }

    # Legacy / override files
    for path in (
        os.path.join(data_dir, "usage", "paid_stack.json"),
        os.path.join(data_dir, "usage", "recurring_costs.json"),
        os.path.join(_founder_dir(), "recurring_costs.json"),
    ):
        raw = _load_json(path)
        if not isinstance(raw, dict):
            continue
        items = raw.get("services") or raw.get("items") or []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            sid = str(item["id"])
            if sid in services:
                services[sid] = {**services[sid], **item}
            else:
                services[sid] = dict(item)

    return {
        "currency": base.get("currency") or "eur",
        "updatedAt": base.get("updatedAt"),
        "note": base.get("note"),
        "services": list(services.values()),
    }


def load_recurring(data_dir: str) -> dict[str, Any]:
    """Compatibility: recurring items = paid stack entries that burn cash."""
    stack = load_paid_stack(data_dir)
    items = []
    for s in stack.get("services") or []:
        if s.get("includeInBurn") is False:
            continue
        if s.get("source") == "auto_fees":
            continue  # Stripe fees come from live charges
        items.append(s)
    return {"currency": stack.get("currency") or "eur", "items": items}


def monthly_from_recurring(item: dict[str, Any]) -> int:
    cents = int(item.get("amountCents") or 0)
    cadence = str(item.get("cadence") or "month").lower()
    if cadence in ("year", "yearly", "annual"):
        return cents // 12
    if cadence in ("week", "weekly"):
        return int(round(cents * 52 / 12))
    return cents


def _month_bounds(now: Optional[float] = None) -> tuple[float, float]:
    dt = datetime.fromtimestamp(now or time.time(), tz=timezone.utc)
    start = datetime(dt.year, dt.month, 1, tzinfo=timezone.utc)
    last = monthrange(dt.year, dt.month)[1]
    end = datetime(dt.year, dt.month, last, 23, 59, 59, tzinfo=timezone.utc)
    return start.timestamp(), end.timestamp()


def build_finance(
    data_dir: str,
    *,
    stripe: Optional[dict[str, Any]] = None,
    railway: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    stripe = stripe or {}
    railway = railway or {}
    rev = stripe.get("revenue") or {}
    currency = (rev.get("currency") or "eur").lower()

    gross = int(rev.get("totalPaidCents") or 0)
    fees = int(rev.get("feesCents") or 0)
    net = int(rev.get("netCents") if rev.get("netCents") is not None else gross - fees)
    refunds = int(rev.get("refundsCents") or 0)

    month_start, month_end = _month_bounds()
    gross_m = int(rev.get("monthPaidCents") or 0)
    fees_m = int(rev.get("monthFeesCents") or 0)
    net_m = int(
        rev.get("monthNetCents")
        if rev.get("monthNetCents") is not None
        else gross_m - fees_m
    )

    stack = load_paid_stack(data_dir)
    stack_rows: list[dict[str, Any]] = []
    recurring_monthly = 0
    runtime_monthly = 0
    dev_monthly = 0

    for item in stack.get("services") or []:
        if not isinstance(item, dict):
            continue
        amount = int(item.get("amountCents") or 0)
        # Auto-fill Railway from current period / latest invoice
        if item.get("id") == "railway" and (
            amount <= 0 or item.get("source") == "auto"
        ):
            cur = railway.get("currentPeriodCents")
            if cur is None:
                invs = railway.get("invoices") or []
                if invs:
                    cur = invs[0].get("totalCents")
            if cur is not None:
                amount = int(cur)
                item = {**item, "amountCents": amount, "source": "railway_auto"}

        # Stripe fees line mirrors live month fees for display
        if item.get("id") == "stripe" or item.get("source") == "auto_fees":
            amount = fees_m
            item = {
                **item,
                "amountCents": amount,
                "cadence": "month",
                "source": "stripe_auto",
            }

        monthly = monthly_from_recurring({**item, "amountCents": amount})
        include = item.get("includeInBurn") is not False and item.get("source") != "auto_fees"
        # After stripe rewrite, source is stripe_auto — still exclude from recurring burn
        # because fees are already in Stripe net.
        if item.get("id") == "stripe" or item.get("source") in ("auto_fees", "stripe_auto"):
            include = False

        if include:
            recurring_monthly += monthly
            role = str(item.get("role") or "runtime")
            if role == "build":
                dev_monthly += monthly
            elif role != "future":
                runtime_monthly += monthly

        stack_rows.append(
            {
                **item,
                "amountCents": amount,
                "monthlyCents": monthly,
                "includeInBurn": include,
            }
        )

    # Sort: paying first, then by monthly desc
    stack_rows.sort(
        key=lambda r: (
            0 if int(r.get("monthlyCents") or 0) > 0 else 1,
            str(r.get("role") or ""),
            -int(r.get("monthlyCents") or 0),
            str(r.get("label") or ""),
        )
    )

    expenses = load_expenses(data_dir)
    expenses_all = sum(int(e.get("amountCents") or 0) for e in expenses)
    expenses_month = sum(
        int(e.get("amountCents") or 0)
        for e in expenses
        if month_start <= float(e.get("at") or 0) <= month_end
    )

    railway_invoices = railway.get("invoices") or []
    opex_month = recurring_monthly + expenses_month + fees_m
    profit_month = net_m - (recurring_monthly + expenses_month)
    profit_all_approx = net - expenses_all - recurring_monthly

    paying = [
        r
        for r in stack_rows
        if int(r.get("monthlyCents") or 0) > 0 and r.get("includeInBurn")
    ]
    free = [
        r
        for r in stack_rows
        if int(r.get("monthlyCents") or 0) <= 0 and r.get("role") != "future"
    ]

    return {
        "currency": currency,
        "revenue": {
            "grossCents": gross,
            "feesCents": fees,
            "refundsCents": refunds,
            "netCents": net,
            "monthGrossCents": gross_m,
            "monthFeesCents": fees_m,
            "monthNetCents": net_m,
            "mrrEstimateCents": int(rev.get("mrrEstimateCents") or 0),
            "byProductCents": rev.get("byProductCents") or {},
        },
        "expenses": {
            "recurringMonthlyCents": recurring_monthly,
            "runtimeMonthlyCents": runtime_monthly,
            "devMonthlyCents": dev_monthly,
            "recurringItems": [r for r in stack_rows if r.get("includeInBurn")],
            "manualMonthCents": expenses_month,
            "manualAllCents": expenses_all,
            "manualItems": expenses[:50],
            "stripeFeesMonthCents": fees_m,
            "stripeFeesAllCents": fees,
            "opexMonthCents": opex_month,
            "railway": {
                "configured": bool(railway.get("configured")),
                "error": railway.get("error"),
                "currentPeriodCents": railway.get("currentPeriodCents"),
                "invoices": railway_invoices[:24],
            },
        },
        "paidStack": {
            "updatedAt": stack.get("updatedAt"),
            "note": stack.get("note"),
            "services": stack_rows,
            "paying": paying,
            "free": free,
            "monthlyBurnCents": recurring_monthly,
        },
        "profit": {
            "monthCents": profit_month,
            "allTimeApproxCents": profit_all_approx,
            "note": (
                "Month profit = Stripe net this month − paid-stack burn (infra + Cursor etc.) "
                "− manual expenses. Stripe processing fees are already deducted in net."
            ),
        },
        "hints": _hints(stripe, railway, stack_rows),
    }


def _hints(stripe: dict, railway: dict, stack_rows: list) -> list[str]:
    hints = []
    if not stripe.get("configured"):
        hints.append("Set STRIPE_SECRET_KEY for automatic revenue + fees.")
    if not railway.get("configured"):
        hints.append(
            "Set RAILWAY_TOKEN for automatic Railway invoice totals "
            "(Account → Tokens), or edit paid_stack railway amountCents."
        )
    maps = next((i for i in stack_rows if i.get("id") == "google-maps"), None)
    if maps and int(maps.get("amountCents") or 0) <= 0:
        hints.append(
            "Google Maps is usage-based — paste monthly GCP Billing into "
            "founder/data/usage/paid_stack.json (id: google-maps) when non-zero."
        )
    return hints
