"""Optional Railway invoice pull via GraphQL (RAILWAY_TOKEN / RAILWAY_API_TOKEN)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional

_API = "https://backboard.railway.app/graphql/v2"


def _token() -> str:
    return (
        os.environ.get("RAILWAY_TOKEN")
        or os.environ.get("RAILWAY_API_TOKEN")
        or ""
    ).strip()


def _gql(query: str, variables: Optional[dict] = None) -> dict[str, Any]:
    token = _token()
    if not token:
        return {"errors": [{"message": "Set RAILWAY_TOKEN for Railway invoices."}]}
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        _API,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as e:
        return {"errors": [{"message": str(e)}]}


def fetch_railway_billing() -> dict[str, Any]:
    """Best-effort invoices + current period total. Never raises."""
    if not _token():
        return {
            "configured": False,
            "error": "Set RAILWAY_TOKEN (Account → Tokens) for automatic Railway expenses.",
            "invoices": [],
            "currentPeriodCents": None,
        }

    # Discover workspace / me
    me = _gql(
        """
        query {
          me {
            id
            email
            workspaces { id name }
          }
        }
        """
    )
    if me.get("errors"):
        # Older schema fallback — try teams
        me = _gql(
            """
            query {
              me {
                id
                email
                teams { edges { node { id name } } }
              }
            }
            """
        )

    if me.get("errors"):
        return {
            "configured": True,
            "error": "; ".join(
                str(e.get("message") or e) for e in (me.get("errors") or [])
            ),
            "invoices": [],
            "currentPeriodCents": None,
        }

    data = me.get("data") or {}
    me_node = data.get("me") or {}
    workspace_id = None
    workspaces = me_node.get("workspaces") or []
    if isinstance(workspaces, list) and workspaces:
        workspace_id = workspaces[0].get("id")
    if not workspace_id:
        teams = ((me_node.get("teams") or {}).get("edges")) or []
        if teams:
            workspace_id = (teams[0].get("node") or {}).get("id")

    invoices_out: list[dict[str, Any]] = []
    current = None
    err = None

    if workspace_id:
        inv = _gql(
            """
            query($id: String!) {
              workspace(workspaceId: $id) {
                customer {
                  invoices {
                    invoiceId
                    total
                    amountDue
                    status
                  }
                  subscriptions {
                    nextInvoiceCurrentTotal
                    latestInvoiceId
                  }
                }
              }
            }
            """,
            {"id": workspace_id},
        )
        if inv.get("errors"):
            err = "; ".join(
                str(e.get("message") or e) for e in (inv.get("errors") or [])
            )
        else:
            cust = (
                ((inv.get("data") or {}).get("workspace") or {}).get("customer") or {}
            )
            for row in cust.get("invoices") or []:
                if not isinstance(row, dict):
                    continue
                # Railway totals are often in cents already; if looks like euros (< 1e5 for hobby), keep.
                total = row.get("total")
                try:
                    total_i = int(total)
                except (TypeError, ValueError):
                    continue
                invoices_out.append(
                    {
                        "id": row.get("invoiceId") or row.get("id"),
                        "totalCents": total_i,
                        "amountDueCents": int(row.get("amountDue") or total_i),
                        "status": row.get("status"),
                        "source": "railway",
                    }
                )
            subs = cust.get("subscriptions") or []
            if isinstance(subs, list) and subs:
                nit = subs[0].get("nextInvoiceCurrentTotal")
                try:
                    current = int(nit) if nit is not None else None
                except (TypeError, ValueError):
                    current = None
    else:
        err = "No Railway workspace/team found for this token."

    return {
        "configured": True,
        "error": err,
        "workspaceId": workspace_id,
        "invoices": invoices_out,
        "currentPeriodCents": current,
    }
