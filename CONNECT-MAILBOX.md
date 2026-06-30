# Connect a real mailbox (Gmail + Outlook) — hosted web app

This guide wires the redesigned web app (`apps/web` + `apps/api`) to your **real
inbox** so Pipeline imports your actual job applications. It reads your mail
**read-only** over OAuth (Microsoft Graph / Gmail API), turns job-application
emails into derived records (company · role · status · dates · a short snippet —
**never your raw email**), and groups them on the board.

> This is the Node/React stack. The older zero-dependency Python build
> (`server.py`) has its own OAuth notes in **[WEB-OAUTH.md](WEB-OAUTH.md)**; the
> desktop app is covered in **[DESKTOP.md](DESKTOP.md)**.

It's **local-first and single-user**: it runs on *your* machine, signs you in
through your browser, and stores the mailbox tokens **envelope-encrypted at rest**
(AES via `PIPELINE_MASTER_KEY`). Tokens never leave your machine. Clicking
**Disconnect** (or deleting the data dir) signs you out.

The one thing only **you** can do: register an OAuth app with Google / Microsoft
and approve the consent screen in your browser. Pipeline can't access your mailbox
without your own client ID + your consent. The steps below take ~10 minutes each.

---

## 0. Prerequisites

- Node.js 18+ and pnpm (`npm i -g pnpm`)
- Your own Google Cloud and/or Microsoft Entra (Azure AD) account — both free

```bash
git clone https://github.com/Jvtino/Pipeline.git
cd Pipeline
pnpm install
pnpm -r --filter "./packages/*" build   # build the shared packages once
```

---

## 1. Create your `.env`

```bash
cp .env.example .env
```

Fill in at least a master key (so your tokens survive a restart) and a data dir:

```bash
# .env
PIPELINE_MASTER_KEY=   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
PGLITE_DIR=.pipeline-data
# Local defaults are assumed if unset:
#   PUBLIC_URL=http://localhost:3001   (the API — used to build OAuth redirect URIs)
#   WEB_URL=http://localhost:5173      (the web app — where you land after connecting)
```

Then add the provider(s) you want, from the steps below.

---

## 2a. Microsoft (Outlook / Hotmail / Live)

1. Go to <https://entra.microsoft.com> → **App registrations → New registration**.
2. **Name:** `Pipeline` (anything).
3. **Supported account types:**
   - Personal Outlook/Hotmail/Live → **Personal Microsoft accounts only**.
   - A **work/school** Microsoft 365 mailbox → **Accounts in any org directory and
     personal Microsoft accounts** (and set `MS_TENANT=common` in `.env`).
4. **Redirect URI** → platform **Web** →
   ```
   http://localhost:3001/auth/microsoft/callback
   ```
   (If you set a custom `PUBLIC_URL`, use `<PUBLIC_URL>/auth/microsoft/callback`.)
5. **Register.** On the overview page copy the **Application (client) ID**.
6. **API permissions → Add a permission → Microsoft Graph → Delegated** → add
   **`Mail.Read`** (plus `offline_access`, `email`, `openid` — usually already there).
   No admin consent needed for a personal account.
7. Leave it a **public client** — *no client secret*. Pipeline uses PKCE.

Put it in `.env`:
```bash
MS_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# MS_TENANT=common     # only if it's a work/school account
```

## 2b. Google (Gmail)

1. <https://console.cloud.google.com> → create a project.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen** → **External** → fill the basics →
   add the scope **`https://www.googleapis.com/auth/gmail.readonly`** → under
   **Test users**, add your own Gmail address. (While the app is "Testing" you can
   use it immediately; public launch later needs Google verification + a CASA
   security assessment for this restricted scope.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.**
5. **Authorized redirect URIs** → add:
   ```
   http://localhost:3001/auth/google/callback
   ```
6. Copy the **Client ID** and **Client secret** into `.env`:
```bash
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
```

---

## 3. Run it

Two terminals (the web dev server proxies `/api` and `/auth` to the API):

```bash
# terminal 1 — API on :3001  (loads .env)
pnpm --filter @pipeline/api start

# terminal 2 — web app on :5173
pnpm --filter @pipeline/web dev
```

Open <http://localhost:5173>.

> `pnpm --filter @pipeline/api start` reads `.env` if you export it first
> (`set -a; source .env; set +a`) or run via a tool like `dotenv`/`direnv`. You can
> also pass vars inline: `MS_CLIENT_ID=… PIPELINE_MASTER_KEY=… pnpm --filter @pipeline/api start`.

---

## 4. Connect and sync

1. In the app, open **Settings → Connect another mailbox**, or use the onboarding
   screen's **Connect Gmail / Connect Outlook** (Settings → **Disconnect** takes you
   there).
2. You're redirected to Microsoft/Google, you approve **read-only** mail access,
   and you land back on the board.
3. Pipeline immediately runs a sync. Your **demo sample data is cleared** and your
   real job-application emails appear. Use **Run sync** (top bar) any time to pull
   new mail.

**Background auto-sync:** start the API with `SYNC_INTERVAL_MS=1800000` (30 min) to
keep the board fresh without clicking.

---

## What gets imported (and what doesn't)

- Only mail that **looks like a job application** becomes a card. Outlook's inbox is
  scanned and filtered by a relevance gate (ATS senders like Greenhouse/Lever/
  Workday, plus application/interview/offer/rejection language); Gmail is narrowed by
  a search query up front. Newsletters, receipts and personal mail are ignored.
- **Gmail** searches all mail (incl. archived) from the last year. **Outlook** reads
  your **Inbox** folder (incremental after the first backfill).
- The status (Applied → Screening → Interview → Offer / Rejected) is inferred from the
  newest decisive message in each thread; you can always override it with **Move stage**.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Toast: *"That provider isn't set up yet"* | The client ID env var isn't set (or the API didn't load `.env`). Restart the API with the vars present. |
| Provider error: **redirect_uri mismatch** | The redirect URI registered with Google/Microsoft must exactly equal `<PUBLIC_URL>/auth/<provider>/callback` (default `http://localhost:3001/...`). |
| Outlook sign-in says the account isn't supported | It's a work/school account — set `MS_TENANT=common` (or `organizations`) and register the app with the broad account type. |
| Sync result: **reauth required** | The refresh token expired/was revoked — click **Connect** again. (Google returns a refresh token because we request `access_type=offline&prompt=consent`.) |
| Tokens gone after restarting the API | Set a real `PIPELINE_MASTER_KEY` and `PGLITE_DIR` (or `DATABASE_URL`) in `.env` — the dev fallback key is ephemeral. |

---

## Deploying it (multi-user / hosted) — later

The same code runs hosted: set `PUBLIC_URL`/`WEB_URL` to your HTTPS domains, register
**those** redirect URIs with Google/Microsoft, use managed **Postgres** (`DATABASE_URL`)
and a persisted `PIPELINE_MASTER_KEY`, and (for multi-replica) `REDIS_URL` for the OAuth
state store. Public Gmail access additionally requires Google's OAuth verification +
CASA review for the restricted `gmail.readonly` scope. See **[PRODUCTION.md](PRODUCTION.md)**.
