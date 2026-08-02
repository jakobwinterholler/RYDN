# RYDN Pro billing — one key, then click

## You do this (≈2 minutes)

1. Open [Stripe Dashboard](https://dashboard.stripe.com/register) → sign up / log in  
   (use **Test mode** toggle first if you want)
2. **Developers → API keys → Secret key → Reveal → Copy** (`sk_test_…` or `sk_live_…`)
3. Railway → your RYDN service → **Variables** → add:

```
STRIPE_SECRET_KEY=sk_...
```

4. Redeploy (or wait for restart). On boot, RYDN **automatically** creates:
   - Product **RYDN Pro**
   - Prices: **€8.99 / month** and **€59.99 / year** (tax-inclusive — what the customer pays)
   - Product **RYDN Race Pass** + one-time **€4.99** price (tax-inclusive — one planned route)
   - Webhook → `https://rydn.bike/api/billing/webhook`
   - Customer Portal settings
   - Apple Pay / Google Pay domain registration for `rydn.bike`

5. Check `https://rydn.bike/api/health` → `"billingConfigured": true`

6. In the app:
   - **Account → Upgrade to Pro** (Apple Pay / Google Pay / card), or
   - **Race Pass** when importing a planned GPX without Pro (€4.99 → one credit → one unlocked route)

That’s it. No price IDs or webhook secrets to copy.

---

## Race Pass flow

1. Free user hits Planned Route import → Checkout (`mode=payment`) for Race Pass  
2. Webhook grants `racePassCredits` (idempotent per Checkout session)  
3. Next planned GPX import consumes one credit and sets `proUnlock` on that route  
4. Planning + Verify + Ride mode + GPX export work **only on unlocked routes** (or with Pro)

Completed-ride imports stay Free.

---

## Optional knobs (only if you care)

```
STRIPE_PRO_AMOUNT_CENTS=899
STRIPE_PRO_YEARLY_AMOUNT_CENTS=5999
STRIPE_RACE_PASS_AMOUNT_CENTS=499
STRIPE_PRO_CURRENCY=eur
```

Or still override everything manually:

```
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_RACE_PASS=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Try a payment

- Test card: `4242 4242 4242 4242`, any future expiry, any CVC  
- **Manage billing** on Account opens Stripe’s portal  

Redeem codes still work (`RYDN-PRO-BETA`, `RYDN-FREE-TEST`). Product tour: `RYDN-ONBOARD` (no plan change).

## If auto-setup didn’t finish

Sign in → open Account → or call (while signed in):

`POST /api/billing/bootstrap`

Or check Railway logs for `billing.bootstrap`. After an older deploy, re-run bootstrap so `priceRacePass` is created.

## Later: native iPhone app

Web stays on Stripe. App Store in-app purchase is a separate phase; same Pro tier on the account.

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| `billingConfigured: false` | Secret key missing/wrong, or boot failed — check logs / hit bootstrap |
| Paid but still Free | Webhook not reachable (custom domain / deploy). Re-run bootstrap |
| Race Pass paid but no credit | Webhook / bootstrap — confirm `priceRacePass` in billing status; check logs |
| No Apple Pay | Safari + wait a minute after domain registration; Cards enabled in Stripe |
