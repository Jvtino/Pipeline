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

---

## Troubleshooting

### Microsoft sign-in: `invalid_request … 'redirect_uri' is not valid`
> *"The expected value is a URI which matches a redirect URI registered for this client application."*

The desktop app signs in over a **loopback** redirect with a random port
(`http://localhost:<port>`). Microsoft only ignores the port — and so accepts any
port — when `http://localhost` is registered under the **Mobile and desktop
applications** platform (a *public client*). If it's registered under the **Web**
platform instead (or not at all), Microsoft demands an exact port match that can
never happen, and you get this error.

**Fix (Azure portal → App registrations → your app → Authentication):**
1. Under **Platform configurations**, if `http://localhost` is listed under **Web**, remove it from there.
2. **+ Add a platform → Mobile and desktop applications** → add **`http://localhost`** → Configure.
3. **Advanced settings → Allow public client flows → Yes** → Save.

Note: this flow is a *public client* and uses **no client secret** — a
`MS_CLIENT_SECRET` is a sign the app was mistakenly registered as a *Web* app.

### Desktop app won't open: `Electron failed to install correctly` / `EBADARCH`
Electron's binary is missing or the wrong CPU type — usually because pnpm (the web
app's installer) installed Electron without its postinstall. From the repo folder:
```bash
rm -rf node_modules/electron && npm install
```
`npm` runs Electron's postinstall, which downloads the correct binary for your Mac's
chip. (The `Pipeline Desktop` launcher now does this check and self-heals automatically.)

---

## Always-on background sync (local)

By default Pipeline syncs when you open the app and every 30 minutes while its
window is running. To keep it syncing **even when the window is closed** — as long
as your Mac is on and logged in — turn on background sync:

**In the app (recommended):** open **Settings → Sync → Background sync** and flip
the toggle on. Pick a cadence (every 30 min / hourly / every 4 hours). That
installs a macOS **LaunchAgent** (`com.pipeline.sync`) that runs the Pipeline API
in the background. Flip it off any time from the same place.

**Or from Finder** (works even when the app isn't running): in your **Pipeline**
folder → **launchers**, double-click **`Enable Background Sync.command`** (first
time: right-click → Open, to clear Gatekeeper). `Disable Background Sync.command`
turns it off.

**How it fits together**
- The agent runs the *same* API the app uses (port 3001, the persistent PGlite
  data dir), so exactly one process ever owns the local database. Opening the
  Desktop app **reuses** the agent's API rather than starting a second one, and
  closing the app leaves background sync running.
- It does **not** update its own code — that would be unsafe unattended. New
  code lands when you open the Desktop app (which pulls the latest `main`).

**Turn it off:** double-click **`Disable Background Sync.command`** — the board
keeps what it has synced; new mail is then only picked up when you open the app.

**Notes**
- Only runs while your Mac is **on and logged in** (a login agent, not a system
  daemon). It does not wake a sleeping Mac.
- Log: `~/Library/Logs/PipelineSync.log`.
- Change the cadence by editing `SYNC_INTERVAL_MS` (milliseconds) in
  `~/Library/LaunchAgents/com.pipeline.sync.plist`, then run Disable + Enable.
