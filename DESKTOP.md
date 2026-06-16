# Pipeline — Desktop app (works with any email)

A downloadable desktop version of Pipeline. It reuses the exact same UI
(`index.html`) and connects to **any mailbox**:

- **Google (Gmail)** — one-click OAuth
- **Microsoft (Outlook / Hotmail / Live)** — one-click OAuth (bypasses the
  basic-auth/IMAP block that stops app passwords)
- **Any other provider via IMAP** — iCloud, Yahoo, Fastmail, AOL, Proton (Bridge),
  work accounts… using an app password

You can connect **several at once** — their applications merge into one view.
Credentials/tokens are stored only in your user-data dir — never in this repo.
When your OS provides an encryption backend, they're encrypted with the **OS
keychain** (Electron `safeStorage`). If no backend is available (some Linux setups),
they fall back to **base64-encoded** local storage — which is *not* encryption — and
the app logs a warning. Treat the user-data dir as sensitive in that case.

```
index.html   the UI (shared with the web version)
main.js      Electron main: window, OAuth (loopback), multi-account store, fetch
preload.js   safe IPC bridge → window.pipelineAPI
gmail.js     Google OAuth + Gmail fetch          (Node stdlib)
msgraph.js   Microsoft OAuth + Graph fetch       (Node stdlib)
imap.js      generic IMAP (imapflow + mailparser)
```

---

## Run it (development)
```bash
cd path/to/pipeline
npm install        # electron + imapflow + mailparser (first time only)
npm start
```
Click **Connect email** → pick a provider → approve. Until you connect, it shows
demo data. IMAP needs no setup below — just enter your address + app password in the
app. The two OAuth providers each need a **one-time** developer registration:

---

## One-time OAuth setup (developer; ~5 min each, free)

Copy the template, then fill only the providers you want:
```bash
cp config.example.json config.json     # config.json is git-ignored
```

### Microsoft (Outlook / Hotmail / Live)
1. **portal.azure.com → App registrations → New registration**
2. Name `Pipeline`; **Supported account types: Personal Microsoft accounts only**
3. **Redirect URI:** platform **Mobile and desktop applications** → `http://localhost`
4. **Register** → **Authentication** → **Allow public client flows = Yes** → Save
5. **API permissions** → Microsoft Graph → Delegated → **`Mail.Read`**
6. Copy **Application (client) ID** → `config.json` → `microsoft.clientId`

### Google (Gmail)
1. **console.cloud.google.com** → create a project
2. **APIs & Services → Library** → enable **Gmail API**
3. **OAuth consent screen** → External → fill basics → **Add test users**
   (add the Gmail addresses you'll connect; up to 100, no verification needed)
4. **Credentials → Create credentials → OAuth client ID → Desktop app**
5. Copy the **Client ID** and **Client secret** → `config.json` →
   `google.clientId` / `google.clientSecret`

### Any other provider (IMAP) — no config needed
In the app, choose **any other mailbox**, enter your address + an **app password**
(not your login password). The host is auto-detected for common providers; for
others, type the IMAP host. Examples: iCloud (`imap.mail.me.com`), Yahoo
(`imap.mail.yahoo.com`), Fastmail (`imap.fastmail.com`).

---

## Build a downloadable installer
```bash
npm run dist:mac     # → dist/Pipeline-0.1.0.dmg   (macOS)
npm run dist:win     # → dist/ ... .exe            (Windows; build on Windows)
```
> Unsigned builds trigger Gatekeeper/SmartScreen warnings (right-click → Open the
> first time on macOS). For *public* distribution, Google/Microsoft require app
> verification — see `PRODUCTION.md`. For you + a few testers, the test-user lists
> above are enough.

---

## How it fits together
`index.html`'s `LiveProvider` checks for `window.pipelineAPI` (from `preload.js`).
In the desktop app it calls the providers over IPC; in a browser it falls back to
the `server.py` web backend; with neither, it shows demo data — the **same UI** in
all three modes. The main process aggregates threads from every connected account
into one list, and the company-grouping view naturally merges (e.g. a "Stripe" card
can hold applications from both your Gmail and Outlook).
