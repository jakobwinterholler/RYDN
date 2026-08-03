# Contributing to RYDN (`ultra-analytics`)

> Start with [`RYDN_CONTEXT.md`](./RYDN_CONTEXT.md). Tag `v1-architecture-freeze` marks the product snapshot — preserve behavior unless the user asks otherwise.

---

## Before you change code

1. Confirm the request is **not** accidental scope creep (new features, redesign, UX “polish”).
2. Identify the smallest module that owns the behavior ([`ARCHITECTURE.md`](./ARCHITECTURE.md)).
3. If UI: match [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) tokens/classes — do not invent a parallel system.
4. If API/types: keep camelCase JSON and path contracts stable.

---

## Safe change patterns

| OK | Avoid |
|----|--------|
| Extract pure helpers / presentational components | Rewriting PlanMap effects “while here” |
| Delete confirmed-dead files (zero importers) | Renaming CSS classes for taste |
| Deduplicate identical pure math | Bumping `analysisSchema` casually |
| Add tests for existing behavior | Speculative `useMemo` / new state libraries |
| Docs that describe reality | Docs that invent unfinished UI as shipped |

**Mechanical moves preferred:** cut/paste + fix imports + re-export if needed. Same rendered output.

---

## Frontend workflow

```bash
cd ultra-analytics/frontend
npm install          # if needed
npm test             # vitest
npm run build        # tsc -b && vite build
```

E2E (when relevant): `npm run test:e2e` (requires Playwright browsers + running app).

Harnesses under `frontend/*Harness*` are intentional QA tools.

---

## Backend workflow

```bash
cd ultra-analytics/backend
# use the project venv / deps as documented in SETUP.md
python -m pytest tests/
```

Do not change response shapes without updating `frontend/src/types.ts` and callers in the same change.

---

## Entitlement & billing

- Feature gates: keep `backend/app/subscription/features.py` and `frontend/src/subscription/features.ts` in sync.
- Prefer existing deps: `require_can_import_route`, `require_route_planning_access`.
- Billing notes: [`BILLING.md`](./BILLING.md).

---

## Git & deploy

- **Do not commit** unless the user asks.
- **Do not force-push** main/master.
- Deploy only when build + tests are green **and** changes are confidently behavior-identical (or the user requested deploy). Prefer stating “undeployed” if unsure.
- Never commit `.env` or secrets.

---

## PR / commit hygiene (when asked)

- Message focuses on **why**.
- Exclude secrets, tunnel logs, and accidental `test-results/` screenshots unless intentional.
- Mention architecture-freeze / behavior-preservation in the summary when relevant.

---

## AI-specific checklist

- [ ] Read `RYDN_CONTEXT.md`
- [ ] No UI/UX redesign
- [ ] No API contract change (unless explicit)
- [ ] No schema bump without migration plan
- [ ] Dead code deleted only with import proof
- [ ] Tests/build run
- [ ] Docs updated if structure meaningfully changed
