"""Local founder dashboard — binds to 127.0.0.1 only."""

from __future__ import annotations

import html
import json
import os
from typing import Any

from fastapi import FastAPI, Form, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from .finance import add_expense
from .stripe_ops import build_full_snapshot

HOST = "127.0.0.1"
PORT = int(os.environ.get("FOUNDER_PORT") or "8787")


def _data_dir() -> str:
    raw = (os.environ.get("ULTRA_DATA_DIR") or "").strip()
    if not raw:
        raise HTTPException(
            status_code=500,
            detail="Set ULTRA_DATA_DIR to a local data snapshot directory.",
        )
    return os.path.abspath(raw)


def create_app() -> FastAPI:
    app = FastAPI(title="RYDN Founder (local)", docs_url=None, redoc_url=None)

    @app.get("/api/snapshot")
    def api_snapshot() -> JSONResponse:
        snap = build_full_snapshot(_data_dir())
        return JSONResponse(snap)

    @app.post("/api/expenses")
    def api_add_expense(
        label: str = Form(...),
        amount_euros: str = Form(...),
        category: str = Form("ops"),
        note: str = Form(""),
    ) -> RedirectResponse:
        try:
            euros = float(str(amount_euros).replace(",", "."))
        except ValueError as e:
            raise HTTPException(400, "Invalid amount") from e
        cents = int(round(euros * 100))
        add_expense(
            _data_dir(),
            label=label,
            amount_cents=cents,
            category=category,
            note=note,
        )
        return RedirectResponse("/", status_code=303)

    @app.get("/", response_class=HTMLResponse)
    def index() -> HTMLResponse:
        snap = build_full_snapshot(_data_dir())
        return HTMLResponse(_render_html(snap))

    return app


def _fmt_money(cents: Any, currency: str = "eur") -> str:
    try:
        n = int(cents or 0) / 100.0
    except (TypeError, ValueError):
        return "—"
    cur = (currency or "eur").upper()
    if cur == "EUR":
        return f"{n:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{n:,.2f} {cur}"


def _fmt_ts(ts: Any) -> str:
    if ts is None or ts == "":
        return "—"
    try:
        import datetime as dt

        return dt.datetime.fromtimestamp(float(ts), tz=dt.timezone.utc).strftime(
            "%Y-%m-%d"
        )
    except (TypeError, ValueError, OSError):
        return "—"


def _esc(v: Any) -> str:
    return html.escape("" if v is None else str(v))


def _mix_cells(mix: dict) -> str:
    if not mix:
        return "<span class='muted'>—</span>"
    parts = [f"<strong>{_esc(k)}</strong> {int(v)}" for k, v in sorted(mix.items())]
    return " · ".join(parts)


def _render_paid_stack(stack: dict[str, Any], cur: str) -> str:
    rows = []
    for s in stack.get("services") or []:
        role = str(s.get("role") or "")
        monthly = int(s.get("monthlyCents") or 0)
        cls = "warn" if role == "future" else ""
        link = s.get("billingUrl") or ""
        label = _esc(s.get("label"))
        if link:
            label = f'<a href="{_esc(link)}" target="_blank" rel="noopener">{label}</a>'
        burn = "yes" if s.get("includeInBurn") else "no"
        rows.append(
            "<tr class='{cls}'>"
            "<td>{label}</td><td>{plan}</td><td>{role}</td>"
            "<td>{mo}</td><td>{burn}</td><td>{src}</td><td class='muted'>{note}</td>"
            "</tr>".format(
                cls=cls,
                label=label,
                plan=_esc(s.get("plan") or "—"),
                role=_esc(role),
                mo=_esc(_fmt_money(monthly, cur) if monthly or s.get("amountCents") else "€0"),
                burn=_esc(burn),
                src=_esc(s.get("source") or "—"),
                note=_esc(s.get("note") or ""),
            )
        )
    body = (
        "".join(rows)
        or "<tr><td colspan='7' class='muted'>No paid_stack.json</td></tr>"
    )
    return f"""
    <h3 style="font-size:0.95rem;margin:18px 0 8px">Paid stack (wired to RYDN)</h3>
    <p class="mix">{_esc(stack.get("note") or "")} Monthly burn in P&amp;L: <strong>{_esc(_fmt_money(stack.get("monthlyBurnCents"), cur))}</strong></p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Service</th><th>Plan</th><th>Role</th>
            <th>/ month</th><th>In burn</th><th>Source</th><th>Note</th>
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
"""


def _render_finance(fin: dict[str, Any]) -> str:
    if not fin:
        return ""
    cur = fin.get("currency") or "eur"
    rev = fin.get("revenue") or {}
    exp = fin.get("expenses") or {}
    profit = fin.get("profit") or {}
    month_profit = int(profit.get("monthCents") or 0)
    profit_cls = "ok" if month_profit >= 0 else "warn"

    cards = [
        ("Gross (all)", _fmt_money(rev.get("grossCents"), cur)),
        ("Stripe fees (all)", _fmt_money(rev.get("feesCents"), cur)),
        ("Net (all)", _fmt_money(rev.get("netCents"), cur)),
        ("Gross (month)", _fmt_money(rev.get("monthGrossCents"), cur)),
        ("Net (month)", _fmt_money(rev.get("monthNetCents"), cur)),
        ("MRR est.", _fmt_money(rev.get("mrrEstimateCents"), cur)),
        ("Stack burn / mo", _fmt_money(exp.get("recurringMonthlyCents"), cur)),
        ("  runtime / mo", _fmt_money(exp.get("runtimeMonthlyCents"), cur)),
        ("  Cursor/dev / mo", _fmt_money(exp.get("devMonthlyCents"), cur)),
        ("Manual (month)", _fmt_money(exp.get("manualMonthCents"), cur)),
        ("Profit (month)", _fmt_money(month_profit, cur)),
    ]
    card_html = "".join(
        f'<div class="card"><div class="label">{_esc(k)}</div><div class="value">{_esc(v)}</div></div>'
        for k, v in cards
    )

    hints = "".join(
        f"<p class='banner warn'>{_esc(h)}</p>" for h in (fin.get("hints") or [])
    )
    note = profit.get("note") or ""

    rec_rows = []
    for item in exp.get("recurringItems") or []:
        rec_rows.append(
            "<tr><td>{label}</td><td>{src}</td><td>{amt}</td><td>{mo}</td><td>{note}</td></tr>".format(
                label=_esc(item.get("label")),
                src=_esc(item.get("source") or "—"),
                amt=_esc(_fmt_money(item.get("amountCents"), cur)),
                mo=_esc(_fmt_money(item.get("monthlyCents"), cur)),
                note=_esc(item.get("note") or "—"),
            )
        )

    man_rows = []
    for item in exp.get("manualItems") or []:
        man_rows.append(
            "<tr><td>{when}</td><td>{label}</td><td>{amt}</td><td>{cat}</td><td>{note}</td></tr>".format(
                when=_esc(_fmt_ts(item.get("at"))),
                label=_esc(item.get("label")),
                amt=_esc(_fmt_money(item.get("amountCents"), item.get("currency") or cur)),
                cat=_esc(item.get("category")),
                note=_esc(item.get("note") or "—"),
            )
        )

    rw = exp.get("railway") or {}
    rw_line = ""
    if rw.get("currentPeriodCents") is not None:
        rw_line = (
            f"<p class='mix'>Railway current period: "
            f"{_esc(_fmt_money(rw.get('currentPeriodCents'), cur))}</p>"
        )
    elif rw.get("error"):
        rw_line = f"<p class='mix muted'>Railway: {_esc(rw.get('error'))}</p>"

    return f"""
  <section>
    <h2>Profit &amp; loss</h2>
    <p class="mix">{_esc(note)}</p>
    {hints}
    <div class="grid">{card_html}</div>
    <p class="banner {profit_cls}">
      Month profit: <strong>{_esc(_fmt_money(month_profit, cur))}</strong>
      · approx all-time: {_esc(_fmt_money(profit.get("allTimeApproxCents"), cur))}
    </p>
    {rw_line}

    {_render_paid_stack(fin.get("paidStack") or {}, cur)}

    <h3 style="font-size:0.95rem;margin:18px 0 8px">Burning in P&amp;L</h3>
    <p class="mix">From <code>founder/paid_stack.json</code> (override in <code>founder/data/usage/paid_stack.json</code>). Railway + Stripe fees auto when keys are set.</p>
    <div class="scroll">
      <table>
        <thead><tr><th>Item</th><th>Source</th><th>Amount</th><th>/ month</th><th>Note</th></tr></thead>
        <tbody>
          {"".join(rec_rows) or "<tr><td colspan='5' class='muted'>No recurring costs configured</td></tr>"}
        </tbody>
      </table>
    </div>

    <h3 style="font-size:0.95rem;margin:18px 0 8px">Add expense</h3>
    <form class="expense-form" method="post" action="/api/expenses">
      <input name="label" placeholder="Label" required />
      <input name="amount_euros" placeholder="Amount €" required inputmode="decimal" />
      <input name="category" placeholder="Category" value="ops" />
      <input name="note" placeholder="Note" />
      <button type="submit" class="btn">Add</button>
    </form>

    <h3 style="font-size:0.95rem;margin:18px 0 8px">Manual expenses</h3>
    <div class="scroll">
      <table>
        <thead><tr><th>Date</th><th>Label</th><th>Amount</th><th>Category</th><th>Note</th></tr></thead>
        <tbody>
          {"".join(man_rows) or "<tr><td colspan='5' class='muted'>None yet</td></tr>"}
        </tbody>
      </table>
    </div>
  </section>
"""


def _render_service_usage(usage: dict[str, Any]) -> str:
    railway = usage.get("railway") or {}
    vol_bits = []
    if railway.get("currentSizeMB") is not None:
        vol_bits.append(
            f"Volume {railway.get('currentSizeMB')} MB / {railway.get('sizeMB') or '?'} MB"
        )
    if railway.get("name"):
        vol_bits.append(str(railway.get("name")))
    vol_line = (
        f"<p class='mix'>Railway: {_esc(' · '.join(vol_bits))}</p>" if vol_bits else ""
    )
    hint = usage.get("hint")
    hint_html = f"<p class='banner warn'>{_esc(hint)}</p>" if hint else ""

    rows = []
    for svc in usage.get("services") or []:
        soft = svc.get("softDaily")
        soft_s = str(soft) if soft is not None else "—"
        pct = svc.get("todayPctOfSoftDaily")
        pct_s = f"{pct}%" if pct is not None else "—"
        cls = "warn" if svc.get("warn") else ""
        t = svc.get("today") or {}
        w = svc.get("last7d") or {}
        m = svc.get("last30d") or {}
        rows.append(
            "<tr class='{cls}'>"
            "<td><strong>{label}</strong><div class='muted'>{note}</div></td>"
            "<td>{today}</td><td>{week}</td><td>{month}</td>"
            "<td>{soft}</td><td>{pct}</td><td>{err}</td>"
            "</tr>".format(
                cls=cls,
                label=_esc(svc.get("label")),
                note=_esc(svc.get("note") or ""),
                today=_esc(t.get("total", 0)),
                week=_esc(w.get("total", 0)),
                month=_esc(m.get("total", 0)),
                soft=_esc(soft_s),
                pct=_esc(pct_s),
                err=_esc(
                    f"t{t.get('err', 0)} / 7d{w.get('err', 0)} / 30d{m.get('err', 0)}"
                ),
            )
        )

    body = (
        "".join(rows)
        or "<tr><td colspan='7' class='muted'>No metered calls yet</td></tr>"
    )
    return f"""
  <section>
    <h2>API &amp; service usage</h2>
    <p class="mix">Outbound calls from RYDN (Google Maps, Strava, Overpass, Open-Meteo, DEM). Soft daily caps are reference only.</p>
    {vol_line}
    {hint_html}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Today</th><th>7d</th><th>30d</th>
            <th>Soft daily</th><th>Today %</th><th>Errors</th>
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  </section>
"""


def _render_html(snap: dict[str, Any]) -> str:
    s = snap.get("summary") or {}
    stripe = snap.get("stripe") or {}
    rev = stripe.get("revenue") or {}
    currency = rev.get("currency") or "eur"
    past = s.get("pastDueEmails") or []

    cards = [
        ("Users", str(s.get("users", 0))),
        ("New 7d / 30d", f"{s.get('newUsers7d', 0)} / {s.get('newUsers30d', 0)}"),
        ("Rides", str(s.get("rides", 0))),
        ("Routes", str(s.get("routes", 0))),
        ("Ultras", str(s.get("ultras", 0))),
        ("Unlocked routes", str(s.get("routesUnlocked", 0))),
        ("Race Pass credits", str(s.get("racePassCreditsTotal", 0))),
        ("Race Pass buys", str(s.get("racePassPurchasesTotal", 0))),
        ("Strava linked", f"{s.get('stravaLinked', 0)} ({s.get('stravaLinkedPct', 0)}%)"),
    ]
    if stripe.get("configured") and not stripe.get("error"):
        cards.extend(
            [
                ("Paid (charges)", _fmt_money(rev.get("totalPaidCents"), currency)),
                ("MRR est.", _fmt_money(rev.get("mrrEstimateCents"), currency)),
                ("Race Pass €", _fmt_money(rev.get("racePassCents"), currency)),
            ]
        )

    card_html = "".join(
        f'<div class="card"><div class="label">{_esc(k)}</div><div class="value">{_esc(v)}</div></div>'
        for k, v in cards
    )

    user_rows = []
    for u in snap.get("users") or []:
        st = str(u.get("stripeStatus") or "")
        cls = "warn" if st.lower() in ("past_due", "unpaid") else ""
        user_rows.append(
            "<tr class='{cls}'>"
            "<td>{email}</td><td>{name}</td><td>{created}</td>"
            "<td>{tier}</td><td>{source}</td><td>{status}</td>"
            "<td>{rpc}</td><td>{rpp}</td>"
            "<td>{rides}</td><td>{routes}</td><td>{ultras}</td><td>{unlock}</td>"
            "<td>{strava}</td><td>{cus}</td>"
            "</tr>".format(
                cls=cls,
                email=_esc(u.get("email")),
                name=_esc(u.get("name")),
                created=_esc(_fmt_ts(u.get("createdAt"))),
                tier=_esc(u.get("subscriptionTier")),
                source=_esc(u.get("subscriptionSource")),
                status=_esc(st),
                rpc=_esc(u.get("racePassCredits")),
                rpp=_esc(u.get("racePassPurchases")),
                rides=_esc(u.get("rides")),
                routes=_esc(u.get("routes")),
                ultras=_esc(u.get("ultras")),
                unlock=_esc(u.get("routesUnlocked")),
                strava="yes" if u.get("stravaLinked") else "no",
                cus="yes" if u.get("hasStripeCustomer") else "no",
            )
        )

    charge_rows = []
    for ch in stripe.get("charges") or []:
        charge_rows.append(
            "<tr>"
            "<td>{when}</td><td>{amt}</td><td>{product}</td>"
            "<td>{email}</td><td>{desc}</td><td>{status}</td>"
            "</tr>".format(
                when=_esc(_fmt_ts(ch.get("created"))),
                amt=_esc(_fmt_money(ch.get("amountCents"), ch.get("currency") or currency)),
                product=_esc(ch.get("product")),
                email=_esc(ch.get("userEmail") or ch.get("receiptEmail") or ch.get("customerId")),
                desc=_esc(ch.get("description") or "—"),
                status=_esc(ch.get("status")),
            )
        )

    sub_rows = []
    for sub in stripe.get("subscriptions") or []:
        sub_rows.append(
            "<tr>"
            "<td>{email}</td><td>{product}</td><td>{interval}</td>"
            "<td>{amt}</td><td>{status}</td><td>{end}</td>"
            "</tr>".format(
                email=_esc(sub.get("userEmail") or sub.get("customerId")),
                product=_esc(sub.get("product")),
                interval=_esc(sub.get("interval") or "—"),
                amt=_esc(_fmt_money(sub.get("amountCents"), sub.get("currency") or currency)),
                status=_esc(sub.get("status")),
                end=_esc(_fmt_ts(sub.get("currentPeriodEnd"))),
            )
        )

    redeem_rows = []
    for r in snap.get("redeemCodes") or []:
        redeem_rows.append(
            "<tr>"
            "<td><code>{code}</code></td><td>{tier}</td><td>{n}</td>"
            "<td>{active}</td><td>{note}</td>"
            "</tr>".format(
                code=_esc(r.get("code")),
                tier=_esc(r.get("tier")),
                n=_esc(r.get("redemptionCount")),
                active="yes" if r.get("active") else "no",
                note=_esc(r.get("note") or "—"),
            )
        )

    stripe_banner = ""
    if stripe.get("error"):
        stripe_banner = f"<p class='banner warn'>{_esc(stripe.get('error'))}</p>"
    elif stripe.get("configured"):
        stripe_banner = (
            f"<p class='banner ok'>Stripe {_esc(stripe.get('mode') or '')} · "
            f"product mix: {_mix_cells(rev.get('byProductCents') or {})}</p>"
        )

    past_html = ""
    if past:
        past_html = (
            "<p class='banner warn'>Past due / unpaid: "
            + _esc(", ".join(past))
            + "</p>"
        )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RYDN Founder (local)</title>
  <style>
    :root {{
      --bg: #f4f2ec;
      --ink: #1a1a18;
      --muted: #5c5a52;
      --line: #d8d4c8;
      --card: #fffdf8;
      --warn-bg: #fff1e8;
      --ok-bg: #e8f5e9;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #ebe6da 0%, var(--bg) 40%);
      color: var(--ink); padding: 24px;
    }}
    h1 {{ font-size: 1.5rem; margin: 0 0 4px; letter-spacing: -0.02em; }}
    .sub {{ color: var(--muted); font-size: 0.9rem; margin-bottom: 20px; }}
    .grid {{
      display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px; margin-bottom: 20px;
    }}
    .card {{
      background: var(--card); border: 1px solid var(--line); padding: 12px 14px;
    }}
    .card .label {{ font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }}
    .card .value {{ font-size: 1.25rem; font-weight: 600; margin-top: 4px; }}
    section {{ margin: 28px 0; }}
    h2 {{ font-size: 1.05rem; margin: 0 0 10px; }}
    .mix {{ color: var(--muted); font-size: 0.9rem; margin-bottom: 12px; }}
    table {{
      width: 100%; border-collapse: collapse; background: var(--card);
      border: 1px solid var(--line); font-size: 0.85rem;
    }}
    th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }}
    th {{ font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }}
    tr.warn {{ background: var(--warn-bg); }}
    .banner {{ padding: 10px 12px; border: 1px solid var(--line); margin: 0 0 12px; font-size: 0.9rem; }}
    .banner.warn {{ background: var(--warn-bg); }}
    .banner.ok {{ background: var(--ok-bg); }}
    .muted {{ color: var(--muted); }}
    code {{ font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 0.84em; }}
    a.json {{ color: var(--ink); }}
    .scroll {{ overflow-x: auto; }}
    h3 {{ font-weight: 600; }}
    .expense-form {{
      display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;
    }}
    .expense-form input {{
      border: 1px solid var(--line); background: var(--card); padding: 8px 10px;
      font: inherit; min-width: 120px;
    }}
    .expense-form .btn, button.btn {{
      border: 1px solid var(--ink); background: var(--ink); color: #fff;
      padding: 8px 14px; font: inherit; cursor: pointer;
    }}
  </style>
</head>
<body>
  <h1>RYDN Founder</h1>
  <p class="sub">
    Local only · {_esc(snap.get("dataDir"))} · generated {_esc(_fmt_ts(snap.get("generatedAt")))}
    · <a class="json" href="/api/snapshot">JSON</a>
  </p>
  {stripe_banner}
  {past_html}
  <div class="grid">{card_html}</div>
  <p class="mix">Tiers: {_mix_cells(s.get("tierMix") or {})}</p>
  <p class="mix">Sources: {_mix_cells(s.get("sourceMix") or {})}</p>
  <p class="mix">Stripe status: {_mix_cells(s.get("stripeStatusMix") or {})}</p>

  {_render_finance(snap.get("finance") or {})}
  {_render_service_usage(snap.get("serviceUsage") or {})}

  <section>
    <h2>Users</h2>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Email</th><th>Name</th><th>Created</th>
            <th>Tier</th><th>Source</th><th>Stripe</th>
            <th>RP credits</th><th>RP buys</th>
            <th>Rides</th><th>Routes</th><th>Ultras</th><th>Unlocked</th>
            <th>Strava</th><th>Customer</th>
          </tr>
        </thead>
        <tbody>
          {"".join(user_rows) or "<tr><td colspan='14' class='muted'>No users in snapshot</td></tr>"}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Payments (Stripe charges)</h2>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Amount</th><th>Product</th>
            <th>Customer</th><th>Description</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {"".join(charge_rows) or "<tr><td colspan='6' class='muted'>No charges (or Stripe not configured)</td></tr>"}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Subscriptions</h2>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Customer</th><th>Product</th><th>Interval</th>
            <th>Amount</th><th>Status</th><th>Period end</th>
          </tr>
        </thead>
        <tbody>
          {"".join(sub_rows) or "<tr><td colspan='6' class='muted'>No subscriptions</td></tr>"}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Redeem codes</h2>
    <div class="scroll">
      <table>
        <thead>
          <tr><th>Code</th><th>Tier</th><th>Redemptions</th><th>Active</th><th>Note</th></tr>
        </thead>
        <tbody>
          {"".join(redeem_rows) or "<tr><td colspan='5' class='muted'>No redeem_codes.json</td></tr>"}
        </tbody>
      </table>
    </div>
  </section>
</body>
</html>
"""


def main() -> None:
    import uvicorn

    if not (os.environ.get("ULTRA_DATA_DIR") or "").strip():
        raise SystemExit(
            "Set ULTRA_DATA_DIR to your local data snapshot, then re-run.\n"
            "See founder/README.md"
        )
    app = create_app()
    print(f"Founder dashboard → http://{HOST}:{PORT}/  (localhost only)")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
