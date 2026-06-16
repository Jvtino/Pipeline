# Pipeline — Privacy Policy

_Last updated: 2026-06-15 — **DRAFT. Review with legal counsel before publishing.**_

Pipeline ("the app", "we") is a desktop application that organizes job‑application
emails from your own mailbox into a dashboard. This policy explains what the app
accesses, what it stores, and what leaves your device.

## The short version
- Pipeline runs **on your device**. We do **not** operate a server that receives
  your email, your credentials, or your application data.
- The app reads your mailbox **read‑only**, only to find and display
  job‑application messages.
- Your mailbox content and credentials are **not sent to the developer** or sold
  to anyone.

## What the app accesses
Depending on the mailbox you connect, Pipeline uses **read‑only** access via:
- **Google (Gmail):** the `gmail.readonly` scope, to read message metadata and
  snippets used to classify job‑application emails.
- **Microsoft (Outlook/Hotmail/Live):** the delegated `Mail.Read` permission.
- **Any IMAP provider:** read‑only IMAP access using an app password you supply.

The app does not send email, modify, or delete messages.

## What is stored, and where
All data is stored **locally on your device**, in the app's user‑data directory:
- **Credentials/tokens:** OAuth refresh/access tokens, or the IMAP app password you
  enter. These are encrypted with your operating system's keychain
  (Electron `safeStorage`) **when an OS encryption backend is available**. On
  systems without one (some Linux setups), they are stored **base64‑encoded, which
  is not encryption** — the app logs a warning in that case. Treat the user‑data
  directory as sensitive.
- **Derived application data:** company names, role titles, statuses, dates, and
  short message snippets, cached locally (e.g. `localStorage`) to render the
  dashboard.

Disconnecting an account removes its stored credentials. Uninstalling the app, or
clearing its user‑data directory, removes all locally stored data.

## What leaves your device
- **Your mail provider:** the app communicates directly with Google, Microsoft, or
  your IMAP host to fetch mail. That traffic is governed by those providers'
  policies.
- **Company logos (off by default):** if you enable logos (`SHOW_LOGOS`), the app
  requests favicons from Google's favicon service (`google.com/s2/favicons`), which
  means the **company domains** derived from your mail are sent to Google. This is
  disabled by default. If you enable it, that disclosure applies.
- **"Interview prep" links:** choosing "Prep" on a role opens a Google search in
  your browser using the company and role names. No mailbox data is sent.

We do **not** use analytics, advertising, or tracking, and we do **not** sell or
share your data.

## Google API Services — Limited Use
Pipeline's use and transfer of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the **Limited Use** requirements. Gmail data is used only to provide the
in‑app, user‑facing features described above; it is not transferred to others
except as needed to provide those features, and it is not used for advertising or
sold.

## Data retention & your choices
- You control connected accounts in the app and can disconnect at any time.
- Revoke the app's access to Google (myaccount.google.com → Security → Third‑party
  access) or Microsoft (account.microsoft.com → Privacy) at any time.
- Because data is local, deleting it is under your control.

## Children
Pipeline is not directed to children under 13 (or the age of digital consent in
your jurisdiction).

## Changes
We may update this policy; material changes will be reflected by the "Last updated"
date above.

## Contact
[Add a contact email / address before publishing.]
