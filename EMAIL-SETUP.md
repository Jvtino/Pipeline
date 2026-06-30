# Connect your email — one time, stays working

Pipeline reads your **job-application mail** from Gmail and/or Outlook and turns it
into a board. You set each one up **once**; after that the app stays connected
every time you open it.

Two things make it permanent:

1. **Pipeline now remembers your mailboxes between launches.** Your connection
   (and login) are saved on your own machine under `~/.pipeline`, so reopening the
   app no longer forgets them. *(This used to reset on every launch — fixed.)*
2. **For Gmail, you publish your Google project to "In production" once.** A Google
   project left in *Testing* logs you out after **7 days** — that's the weekly
   reconnect you've been doing. Publishing stops it. (Details below.)

You only redo any of this if you move to a new computer (your secrets are never
uploaded to GitHub, by design — see [SETUP-NEW-LAPTOP.md](SETUP-NEW-LAPTOP.md)).

---

## Gmail (about 5 minutes, free)

### 1. Make a Google project + enable Gmail
1. Go to <https://console.cloud.google.com/> and create a project (top bar → **New
   Project**), or pick an existing one.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.

### 2. Set up the consent screen and PUBLISH it  ← the step that makes it stick
1. **APIs & Services → OAuth consent screen.**
2. **User type: External** → **Create**.
3. Fill in **App name** (e.g. `Pipeline`), **User support email**, and **Developer
   contact email**. Save and continue through the steps (you can skip optional
   fields).
4. Back on the OAuth consent screen, click **PUBLISH APP** so the **Publishing
   status** reads **In production** (not *Testing*).

   > **Why this matters:** in *Testing*, Google **expires your sign-in after 7
   > days** and you have to reconnect. **In production**, it stays connected (you
   > just need to open Pipeline at least once every 6 months).
   >
   > You do **not** need to finish Google's "verification" for personal use. Your
   > app shows as *unverified*, which only means a one-time warning screen — see
   > step 4. (Full verification is only needed to remove that warning for the
   > general public; that's [GOOGLE-VERIFICATION.md](GOOGLE-VERIFICATION.md).)

### 3. Create the OAuth client
1. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
2. **Application type: Web application.**
3. Under **Authorized redirect URIs**, click **+ Add URI** and paste **exactly**:
   ```
   http://localhost:3001/auth/google/callback
   ```
4. **Create.** Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and
   the **Client secret** (starts with `GOCSPX-`).

### 4. Save it in Pipeline and connect
1. Double-click **`connect-google.command`** and paste the **Client ID** and
   **Client secret** when asked. (Or put `GOOGLE_CLIENT_ID=…` and
   `GOOGLE_CLIENT_SECRET=…` in a `.env` file next to the app.)
2. Restart the app (close the launcher window and double-click it again), then
   **Connect ▾ → Connect Gmail**.
3. On the **"Google hasn't verified this app"** screen, click **Advanced → Go to
   Pipeline (unsafe)** → **Allow**. (Expected while unverified; safe — it's your
   own app reading your own mail.)

That's it — Gmail stays connected.

---

## Outlook / Hotmail / Live (about 5 minutes, free)

Personal Outlook can't use app passwords anymore, so it uses Microsoft sign-in.
There's **no 7-day expiry** to worry about here — once connected it stays connected
as long as you open Pipeline at least every ~90 days.

### 1. Register the app
1. Go to <https://entra.microsoft.com/> → **App registrations → New registration**
   (or <https://portal.azure.com> → *App registrations*).
2. **Name:** `Pipeline`.
3. **Supported account types:** **Personal Microsoft accounts only**.
4. **Register.**

### 2. Add the redirect and allow the public-client flow
1. **Authentication → Add a platform → Mobile and desktop applications.**
2. Under **Custom redirect URIs**, add **exactly**:
   ```
   http://localhost:3001/auth/microsoft/callback
   ```
   *(If you also use the native desktop app, add `http://localhost` here too.)*
   → **Configure**.
3. Still on **Authentication**, scroll to **Advanced settings → Allow public client
   flows → Yes** → **Save**. (Pipeline signs in without a secret, so it must be a
   *public client* — registering the redirect under **Web** instead causes a
   `redirect_uri is not valid` error.)

### 3. Add the mail permission
1. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions → Mail.Read → Add permissions.** (No admin consent needed for a
   personal account.)

### 4. Save it in Pipeline and connect
1. **Overview →** copy the **Application (client) ID** (a UUID).
2. Double-click **`connect-outlook.command`** and paste it. (Or set
   `MS_CLIENT_ID=…` in `.env`.)
3. Restart the app, then **Connect ▾ → Connect Outlook** and approve.

---

## Connect several at once

You can connect Gmail **and** Outlook (and more than one of each). Their
applications merge into one board — a "Stripe" card can hold roles from both
inboxes. Reconnecting the same address just refreshes it.

---

## Troubleshooting — "why do I keep having to reconnect?"

| Symptom | Cause | Fix |
|---|---|---|
| Gmail drops every ~7 days | Google project still in **Testing** | OAuth consent screen → **Publish app** → *In production* (Gmail step 2.4) |
| Everything resets when I reopen the app | Old versions didn't persist locally | Fixed — connections live in `~/.pipeline`. Update to the latest version. |
| `redirect_uri is not valid` (Microsoft) | Redirect registered under **Web** | Move it to **Mobile and desktop applications** + **Allow public client flows = Yes** (Outlook step 2) |
| "Google hasn't verified this app" | App is unverified (normal for personal use) | **Advanced → Go to Pipeline** once. Full verification only matters for a public launch. |
| New laptop asks me to set it up again | Secrets are never uploaded to GitHub, by design | Re-run `connect-google.command` / `connect-outlook.command` ([SETUP-NEW-LAPTOP.md](SETUP-NEW-LAPTOP.md)) |
| Connected but no applications show | Nothing matched the mail search, or the token needs a refresh | Click **Sync**; if it says *needs reconnecting*, use **Connect ▾** again |

Both client IDs/secrets are stored only in your local, git-ignored `.env` — they're
never committed. Pipeline reads your mail **read-only** and stores only derived
records (company, role, status, dates, a short snippet), never your raw email.
