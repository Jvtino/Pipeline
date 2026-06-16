# Pipeline — from prototype to a real app

How to take Pipeline from a local prototype to something other people can actually
use, with a **one-click "Connect Google / Connect Microsoft"** button instead of
the app-password/IMAP dance. (Short version: end users never do any of what we did
to test — that was one-time *developer* setup.)

---

## Where it stands today
- Single-file dark-mode UI (`index.html`) with a swappable data **Provider**.
- Local, zero-dependency backend (`server.py`) that reads mail over **IMAP**.
- Runs for one person, on one machine, reading one mailbox; demo data otherwise.

One thing already production-friendly: the UI only knows about a `Provider` that
returns email threads. Swapping IMAP for OAuth/Gmail/Graph **doesn't touch the UI**.

---

## The core change: OAuth instead of passwords
End users never see app passwords or IMAP toggles — they click a button and approve
a consent screen ("Pipeline wants to read your email — Allow?"). To enable that:

|              | Google (Gmail)              | Microsoft (Outlook)        |
|--------------|-----------------------------|----------------------------|
| API          | Gmail API                   | Microsoft Graph            |
| Scope        | `gmail.readonly`            | `Mail.Read`                |
| Flow         | OAuth 2.0 auth-code (web)   | OAuth 2.0 auth-code (web)  |
| Tokens       | access + refresh            | access + refresh           |

**User flow:** Connect → provider consent → redirect back → tokens saved → fetch
mail. Sign-in and mail access can be the *same* step ("Sign in with Google/Microsoft").
The app registration that makes this work is a **one-time developer step**, baked
into the shipped app — not something each user repeats.

---

## Two ways to ship it

### Option A — Hosted web app (use it at a URL)
- Frontend: today's HTML on a static host (Vercel/Netlify).
- Backend: a real web server — **FastAPI/Flask (Python)** or Node — replacing
  `server.py`'s stdlib server. Handles OAuth callbacks, token storage, mail fetch,
  classification.
- Needs: a **domain + HTTPS** (required for OAuth redirect URIs) and a **database**
  (Postgres) for users, tokens, and cached applications.
- Hosts: Render, Railway, Fly.io, or a VPS.
- ➕ Nothing to install, works on any device.  ➖ You run servers and hold users'
  tokens (more responsibility + verification).

### Option B — Downloadable desktop app (the "download it" idea)
- Wrap the UI in **Tauri** (light) or **Electron**, ship a `.dmg` / `.exe`.
- OAuth runs locally; **tokens stay on the user's device** — you store nothing.
- ➕ No hosting, far less data liability, strong privacy story.  ➖ You maintain
  per-OS builds; public distribution still needs OAuth verification.

Both reuse the exact same UI + provider design. Desktop is often the simplest first
real step (privacy + no servers); hosted web wins on reach.

---

## The real gate: provider verification
Because email is sensitive, you can't flip OAuth on for the whole world on day one:

- **Google** (`gmail.readonly` is a *restricted* scope): up to **100 test users**
  immediately, no verification. Public launch requires **OAuth app verification**
  (verified domain, published homepage, privacy policy). Restricted-scope apps
  *may also* require an **annual third-party security assessment (CASA)** depending
  on how the app stores/transmits Gmail data — confirm the exact requirement for a
  local-only desktop client against Google's current restricted-scope docs.
- **Microsoft**: app registration is free; **personal accounts consent
  individually**, so a small audience works without admin steps. **Publisher
  verification** recommended; heavier programs apply only at scale. Generally
  lighter than Google's restricted-scope review.

For **you + friends/testers**, both providers work *without* full verification via
test-user lists. Verification only matters for unlimited public users.

---

## Other things that change for "real"
- **Classifier:** swap the keyword `detectStatus()` for an **LLM pass** to handle
  messy, multilingual, and varied ATS emails accurately. (The hook is already
  isolated in `index.html` / could move server-side.)
- **Sync:** instead of re-reading everything each open, use **incremental sync**
  (Gmail History API / Graph delta queries) + push notifications for new mail;
  cache results in the DB.
- **Privacy/data:** ideally store only the **derived application records**, not raw
  emails; encrypt tokens at rest; publish a privacy policy; let users disconnect and
  delete their data (GDPR/CCPA).
- **Multi-user:** account system + per-user data isolation (the email OAuth can
  double as login).

---

## Suggested phased roadmap
1. **Phase 1 — Connect (test mode):** OAuth for ONE provider in "testing" mode
   (you + a few testers, no verification). Ship as a desktop app (tokens local) or a
   tiny hosted backend. → real inboxes, one-click button.
2. **Phase 2 — Real app:** database, both providers, incremental sync, LLM
   classifier, privacy policy, disconnect/delete.
3. **Phase 3 — Public:** Google/Microsoft verification + security review; scale
   hosting; support.

---

## What carries over unchanged
The entire front end — dark theme, company grouping, status colors, pins, timeframe,
accordion threads, logos, sync indicator — stays as-is. Only the **data source**
swaps from local IMAP to OAuth providers. That's exactly what the `Provider`
abstraction was built for.
