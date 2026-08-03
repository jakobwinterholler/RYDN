# Ultra — new Mac setup

Goal: open **https://rydn.bike** with one command. OAuth URLs never change again.

```bash
cd ultra-analytics
./dev.sh
```

---

## A. One-time (cannot be fully automated)

### A1. Put the domain on Cloudflare

| | |
|---|---|
| **Click** | [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a site** → `rydn.bike` → Free plan |
| **Then** | At your registrar → Nameservers → paste Cloudflare’s two nameservers → Save |
| **Expected** | Cloudflare shows domain **Active** |
| **Verify** | Left nav for `rydn.bike` shows **DNS** |

### A2. SSL mode

| | |
|---|---|
| **Click** | Site `rydn.bike` → **SSL/TLS** → **Overview** → encryption **Full** |
| **Also** | **SSL/TLS** → **Edge Certificates** → **Always Use HTTPS** = On |
| **Expected** | Mode = Full |
| **Verify** | Overview shows Full |

### A3. Google OAuth (once)

| | |
|---|---|
| **Click** | [console.cloud.google.com](https://console.cloud.google.com/) → project → **APIs & Services** → **Credentials** → your **Web client** |
| **Paste origins** | `https://rydn.bike` |
| **Paste redirect** | `https://rydn.bike/api/auth/google/callback` |
| **Remove** | Any `*.trycloudflare.com` entries |
| **Save** | |
| **Test users** | **OAuth consent screen** → **Test users** → add your Google email |
| **Verify** | Both URIs listed exactly as above |

### A4. Strava OAuth (once)

| | |
|---|---|
| **Click** | [strava.com/settings/api](https://www.strava.com/settings/api) |
| **Set** | Authorization Callback Domain = `rydn.bike` (no https, no path) |
| **Save** | |
| **Verify** | Field shows `rydn.bike` |

### A5. Paste secrets into Ultra

```bash
cd ultra-analytics
cp .env.example .env
```

Edit `.env` — fill only:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
```

Leave `PUBLIC_URL=https://rydn.bike`. Do not invent redirect URLs — they are derived.

| **Verify** | `./doctor.sh` shows Google/Strava secrets ✓ |

---

## B. Automated by `./dev.sh`

These need **no dashboard** after A1–A2 (cloudflared login is a one-time browser authorize):

1. Detect / require `cloudflared` (`brew install cloudflared` if missing — script tells you)
2. Detect Cloudflare login → if missing, prints: run `cloudflared tunnel login`
3. Create named tunnel `ultra-local` if missing
4. Write `~/.cloudflared/config.yml` if missing
5. Create DNS CNAME `rydn.bike` → tunnel (`cloudflared tunnel route dns`)
6. Start backend `:8100` + frontend `:5180` + tunnel
7. Verify DNS, HTTPS, `/api/health`
8. Sync all derived env files from `PUBLIC_URL`

**Why login cannot be fully silent:** Cloudflare requires you to authorize the account/domain in a browser once. After `~/.cloudflared/cert.pem` exists, everything else is scripted.

---

## C. Every day

```bash
cd ultra-analytics
./dev.sh
```

Open **https://rydn.bike** (desktop + iPhone).

Stop: `Ctrl+C`

Check anything: `./doctor.sh`

---

## D. Central URLs (future-proof)

Single file: `ultra-analytics/.env`

```env
PUBLIC_URL=https://rydn.bike

# Later on Railway / Hetzner — only change env, not code:
# APP_URL=https://app.rydn.bike
# API_URL=https://api.rydn.bike
# MARKETING_URL=https://rydn.bike
```

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | Default public site |
| `APP_URL` | SPA + OAuth origin (defaults to `PUBLIC_URL`) |
| `API_URL` | API host (defaults to `PUBLIC_URL`; empty `VITE_API_BASE` = same-origin `/api`) |
| `MARKETING_URL` | Marketing site (defaults to `PUBLIC_URL`) |

Moving to a VPS later: deploy the same app, set those three URLs, update Google/Strava once to the new `APP_URL` host. No code changes.

---

## E. Commands

| Command | What |
|---|---|
| `./dev.sh` | Start everything |
| `./setup.sh` | Same as `./dev.sh` |
| `./doctor.sh` | Validate tunnel, DNS, HTTPS, env, servers |
| `python3 scripts/ensure_tunnel.py` | Tunnel/DNS only |
| `python3 scripts/urls.py sync` | Rewrite derived env files |

---

## F. Verify checklist

| Check | How |
|---|---|
| App loads | Browser → https://rydn.bike |
| HTTPS | Padlock in Safari/Chrome |
| Google | Continue with Google → back on rydn.bike signed in |
| Strava | Connect Strava → connected |
| Doctor | `./doctor.sh` → Result: healthy (when stack is running) |

---

## G. What is *not* automated (and why)

| Step | Why |
|---|---|
| Registrar → Cloudflare nameservers | Requires your registrar account |
| Google Console redirect URIs | No public API without your GCP project OAuth setup |
| Strava callback domain | Strava has no API for app settings |
| First `cloudflared tunnel login` | Browser OAuth to your Cloudflare account |

Everything else is scripted.
