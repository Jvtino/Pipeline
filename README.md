# Pipeline — job applications from your inbox

A dark-themed dashboard that turns job-application emails into a clean,
color-coded view of where every application stands — grouped by company.

It runs on **demo data out of the box**, and can read a **real mailbox**
(Gmail, Outlook/Live, or any IMAP provider) via a tiny local backend with
zero third-party dependencies.

---

## Quick start (demo data)

```bash
cd "email app"
python3 server.py
# open http://localhost:8000
```

With no credentials set, the dashboard shows sample data so you can see how it
works. (The chip in the top-right reads **“Demo data”**.)

---

## Go live: connect a real mailbox

Run the same server with IMAP credentials. The dashboard switches to your real
mail automatically and the chip flips to **“Live · your@email”**.

```bash
IMAP_USER="you@gmail.com" IMAP_PASSWORD="your-app-password" python3 server.py
```

> Use an **app password**, never your normal login password. The server runs
> only on `127.0.0.1` (your machine), opens the mailbox **read-only**, and never
> stores or logs the password.

### Gmail  (`haciahmet02041997@gmail.com`)
1. Turn on **2-Step Verification**: <https://myaccount.google.com/security>
2. Create an **App password**: <https://myaccount.google.com/apppasswords>
3. Run:
   ```bash
   IMAP_USER="haciahmet02041997@gmail.com" IMAP_PASSWORD="the-16-char-app-password" python3 server.py
   ```
   Tip: to include archived mail (not just the inbox), add
   `IMAP_FOLDER="[Gmail]/All Mail"`.

### Outlook / Live  (`Haciilhan@live.com`)
1. Turn on **Two-step verification** in your Microsoft account security settings.
2. Create an **app password** (Security → Advanced security options → App passwords).
3. Run:
   ```bash
   IMAP_USER="Haciilhan@live.com" IMAP_PASSWORD="the-app-password" python3 server.py
   ```
   The host (`outlook.office365.com`) is auto-detected.

### Any other provider (IMAP)
Yahoo, iCloud, Proton (via Bridge), Fastmail, etc. — set the host explicitly if
it isn't auto-detected:
```bash
IMAP_USER="you@example.com" IMAP_PASSWORD="app-password" IMAP_HOST="imap.example.com" python3 server.py
```

---

## How it works

Everything lives in two files.

**`index.html`** — the whole UI, in four labeled layers:
1. **Data layer** — `MockProvider` (demo) and `LiveProvider` (calls the backend).
   Both return the same shape: `{ threadId, domain, subject, messages[] }`.
2. **Classifier** — `detectStatus(text)` maps email wording to a status.
   (Natural spot to later swap in an LLM for messy real-world emails.)
3. **Aggregation** — bundles an email thread into one application (current
   status = the latest status in the thread) and groups applications by company.
4. **UI** — stats, filters, search, and the company board.

**Pinning (two levels):**
- Click the 📌 on a **company** card header to pin the whole company — it floats
  into a "Pinned" section at the top, above the active sort.
- Hover a **position** row and click its 📌 to pin that role to the top of its
  company's list (the company itself stays where it is).

Both kinds persist across reloads via `localStorage`; click again to unpin.

**Company logos:** each card shows the company's real logo, derived from the
sender's email domain via a favicon service (`google.com/s2/favicons`). The logo
is kept only if a real one is found (validated by image size); otherwise the card
falls back to a lettered avatar. This works automatically once a real mailbox is
synced, since the logo follows the domain. The status-color ring stays around the
logo either way. Notes:
- Set `SHOW_LOGOS = false` in `index.html` to use plain lettered avatars.
- Domains are sent to the favicon service (Google) to fetch icons; swap `logoUrl()`
  to self-host if you'd rather not. Requests use `referrerpolicy="no-referrer"`.
- Like the company name, the logo follows the *sender* domain, so mail sent
  through an applicant tracking system shows the ATS's logo.

**Timeframe (fresh start):** the toolbar has a recency dropdown — All time,
Last 7 days, 30 days, 3 / 6 / 12 months. Pick a window and only applications whose
*latest activity* falls inside it are shown; the stats, filter counts, footer and
cards all update to match. This lets you reuse the same mailbox each job search
without seeing last year's applications — no new email needed. Your choice persists
across reloads via `localStorage`.

**Sync:** the app pulls fresh mail from the backend automatically — on open, and
again whenever you return to the tab (throttled to once per 30s). You can also
click the status chip in the header to **sync on demand**. While it runs the chip
shows a "Syncing…" spinner; afterward it reads e.g. "Live · you@gmail.com · synced
4:42 PM". A sync never disturbs your current view — filters, timeframe, pins and
expanded cards are all preserved. Because each `/api/threads` call does a fresh
IMAP search, new application emails show up on the next sync.

**Dense cards:** each company lists **all** its positions in a fixed-height,
scrollable area, so cards stay a uniform, tidy size no matter how many roles a
company has (pinned positions float to the top). Opening a position's email thread
keeps the card the same height — the thread appears in that scroll area and the
other positions scroll down out of the way.

**`server.py`** — zero-dependency Python backend (standard library only). Serves
the static UI and one endpoint:
```
GET /api/threads → [{ threadId, domain, subject, messages:[{date,from,body}] }, ...]
```
It connects over IMAP, searches for job-application mail in the last year,
parses each message, and groups messages into threads by sender + subject — the
exact shape the UI already understands. If unconfigured or the connection fails,
it returns `{error}` and the UI falls back to demo data.

### Status colors (your spec)
- 🔴 **Red** — Rejected
- ⚪ **Gray** — Active / pending
- 🟡 **Yellow** — Interview / meeting phase
- 🟢 **Green** — Offer / accepted

---

## Config reference

| Variable          | Default                | Notes                                            |
|-------------------|------------------------|--------------------------------------------------|
| `IMAP_USER`       | —                      | Full email address (required for live)           |
| `IMAP_PASSWORD`   | —                      | **App password** (required for live)             |
| `IMAP_HOST`       | auto from email domain | Override for unlisted providers                  |
| `IMAP_PORT`       | `993`                  | IMAPS                                             |
| `IMAP_FOLDER`     | `INBOX`                | Gmail: `"[Gmail]/All Mail"` to include archived  |
| `IMAP_SINCE_DAYS` | `365`                  | How far back to search                           |
| `PORT`            | `8000`                 | Local web-server port                            |

---

## Known limitations / next steps

- **Company name** comes from the sender’s domain. Mail sent through an applicant
  tracking system (e.g. `greenhouse.io`, `myworkday.com`) will group under the
  ATS, not the employer. Next step: also parse the company from the subject/body.
- **Classification** is keyword-based. It’s solid for standard ATS wording; an
  LLM pass in `detectStatus` would handle unusual phrasing.
- **Auth** uses IMAP app passwords (works with “any email”). For Gmail/Outlook a
  full **OAuth** flow would be a cleaner production upgrade — and is the only
  option if a provider has disabled basic auth/app passwords for the account.
