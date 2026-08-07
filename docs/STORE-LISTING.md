# Pipeline — store listing kit

Everything the App Store / Play Store submission forms will ask for, drafted and
consistent with `site/privacy.html`. Fill the bracketed blanks during Phase 0.

## Identity

| Field | Value |
|---|---|
| App name | Pipeline — Job Application Tracker |
| Subtitle (iOS, ≤30 chars) | Applications, from your inbox |
| Short description (Play, ≤80 chars) | Your job applications, tracked automatically from your inbox. |
| Bundle id / package | `com.pipeline.mobile` |
| Category | Productivity (secondary: Business) |
| Price | Free, no in-app purchases (v1) |
| Privacy policy URL | `https://[domain]/privacy.html` |
| Data deletion URL (Play) | `https://[domain]/delete-account.html` |
| Support URL | `https://github.com/Jvtino/Pipeline` |

## Full description (both stores)

> Job hunting scatters itself across your inbox. Pipeline puts it back together.
>
> Connect your mailbox once and Pipeline reads it — read-only — to find your
> job applications and keep a live board of where each one stands: Applied,
> Interview, Offer, Rejected. No spreadsheets, no manual logging.
>
> **A board that fills itself.** Every application grouped by company, with the
> status, dates, and the latest message at a glance.
> **You stay in charge.** One tap corrects any status, and your word is final —
> future syncs never overwrite it. When Pipeline isn't sure how to read an
> email, it asks instead of guessing.
> **Never miss the interview.** Dates found in your email surface on the
> calendar, with a reminder the day before and an hour before.
> **Private by design.** Pipeline keeps derived facts only — company, role,
> status, dates, a short snippet. Your full emails are never stored, never
> sent anywhere, never sold. Delete everything in two taps, any time.
>
> Works with Outlook and Hotmail today; Gmail arriving shortly.

Keywords (iOS, ≤100 chars):
`job,application,tracker,interview,offer,career,search,inbox,email,board`

## Privacy labels

**Apple "nutrition label"** — Data linked to you:
- Contact info → Email address (account creation)
- User content → "Other user content": derived job-application records
  (company, role, status, dates, ≤600-char snippet, attachment names)
- Identifiers → none (no advertising identifiers)
- Data used to track you: **none**. Third-party advertising: **none**.

**Play Data safety:**
- Collected: email address (account), user-generated + derived content (as
  above), push token (optional, notifications).
- Shared with third parties: none, other than processors (hosting, sign-in,
  push delivery) acting on our instructions.
- Data encrypted in transit: yes. Deletion path: in-app + URL above.
- Independent security review: [pending — CASA, with Gmail launch]

## App review notes (both stores)

> Pipeline is a client for a hosted service that classifies the reviewer's own
> job-application email. For review WITHOUT connecting a mailbox, use the
> demo build/account: [demo account credentials — Phase 0], or the
> `EXPO_PUBLIC_DEMO=1` build profile (`demo` channel), which runs the full app
> against a bundled sample inbox and requires no credentials or server.
> Mail access is read-only ('gmail.readonly' / 'Mail.Read'); the phone app
> itself never receives mail credentials — mailbox connect runs in the system
> browser and tokens stay server-side, encrypted.
> Account deletion: Settings → Danger zone (guideline 5.1.1(v)).

## Screenshot plan (6.7" + 6.1" iOS, phone + 7" tablet Play)

1. Board — "Your search, one board" (populated demo board)
2. Detail + Move stage — "One tap to correct, forever respected"
3. Review modal — "It asks when it isn't sure"
4. Calendar — "Interviews, surfaced"
5. Settings/notifications — "Alerts you choose"

Draft captures: regenerate from the demo build (`EXPO_PUBLIC_DEMO=1 expo export --platform web`) at store resolutions.
