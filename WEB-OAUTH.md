# Web OAuth backend (Gmail + Outlook without app passwords)

The web build (`server.py`) can now connect mailboxes via **OAuth**, not just IMAP.
This matters because:

- **Outlook / Hotmail / Live (personal):** Microsoft disabled basic-auth/app-password
  IMAP in 2024. OAuth (Microsoft Graph) is the only way to read this mail.
- **Gmail:** OAuth avoids the 2-Step-Verification + app-password dance.
- **Everyone else** (iCloud, Yahoo, Fastmail, work accounts…): still IMAP, in-app.

This backend is **local-first and single-user**: it runs on *your* machine, does the
OAuth sign-in in your browser, and stores tokens in a git-ignored file
(`.pipeline-accounts.json`, `chmod 600`) next to `server.py`. Tokens never leave your
machine; deleting that file (or clicking **Disconnect**) signs you out. Tokens are
*not* encrypted at rest here — they're protected by file permissions. (The desktop
app uses the OS keychain; a deployed multi-user web app would use a real secret store.)

---

## 1. Create OAuth client IDs

Reuse the **same `config.json`** the desktop app uses (it's git-ignored). Copy the
example and fill in the providers you want:

```bash
cp config.example.json config.json
```

```json
{
  "google":    { "clientId": "....apps.googleusercontent.com", "clientSecret": "..." },
  "microsoft": { "clientId": "........-....-....-....-............" }
}
```

You can also pass them as env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`.

### Google (Gmail)
1. <https://console.cloud.google.com/> → create a project.
2. **APIs & Services → Enable APIs** → enable **Gmail API**.
3. **OAuth consent screen** → External → add the **`gmail.readonly`** scope → add your
   Google account as a **Test user** (while the app is unverified).
4. **Credentials → Create credentials → OAuth client ID → Web application.**
5. Add an **Authorized redirect URI**:
   ```
   http://localhost:8000/auth/google/callback
   ```
   (match the port you run on; change `8000` if you set `PORT`.)
6. Copy the **client ID + client secret** into `config.json`.

### Microsoft (Outlook / Hotmail / Live)
1. <https://entra.microsoft.com/> → **App registrations → New registration**.
2. Supported account types: **Personal Microsoft accounts** (consumers).
3. **Redirect URI** → platform **Web** →
   ```
   http://localhost:8000/auth/microsoft/callback
   ```
4. **API permissions** → Microsoft Graph → Delegated → **Mail.Read** (+ `offline_access`, `email`, `openid`).
5. Copy the **Application (client) ID** into `config.json`. No secret needed (PKCE public client).

---

## 2. Run and connect

```bash
python3 server.py
# open http://localhost:8000
```

Click **Connect email** → **Sign in with Google** / **Continue with Microsoft** (or enter
IMAP credentials for any other provider). You'll be redirected to the provider, approve
access, and land back in Pipeline with your real mail synced. Connect several mailboxes —
they merge into one board. Manage or remove them from the same modal.

If a provider isn't configured, its button shows "Not configured" instead of signing in.

---

## How it works (for the mobile/web roadmap)

- `providers.py` — the OAuth protocol + Gmail/Graph fetch + the pure mapping to the
  unified `{ threadId, domain, subject, messages:[{date,from,body}] }` shape. This is the
  Python twin of the desktop's `gmail.js` / `msgraph.js`.
- `server.py` routes:
  - `GET  /auth/<provider>/start` → redirect into the OAuth loopback flow (PKCE).
  - `GET  /auth/<provider>/callback` → exchange code, store tokens, return to the app.
  - `GET  /api/accounts` → which providers are configured + connected mailboxes.
  - `GET  /api/threads` → fetch + merge every connected mailbox (OAuth + IMAP).
  - `POST /api/imap/connect`, `POST /api/disconnect`.

**Going multi-user / hosted later:** swap the loopback redirect for a hosted HTTPS
redirect URI, add session cookies, and move `.pipeline-accounts.json` into a per-user
secret store (DB + encryption). The provider/mapping logic in `providers.py` stays as-is.
The mapping functions are unit-tested headlessly in `test/providers_test.py`.
