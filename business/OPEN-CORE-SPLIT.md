# Pipeline — Open-core split (free vs Pro vs Teams)

_Internal planning doc. Local only — do NOT commit to the public repo._

## The guiding line
- **Free = "track my applications."** Genuinely useful on its own.
- **Pro = "optimize my search."** Automation, analytics, AI — ongoing value.
- **Teams = "manage a cohort."** Seats, admin, opt-in summaries (B2B2C).

Keep Free strong on purpose: it's the funnel, the word-of-mouth, and the privacy/trust
asset. A crippled free tier kills the whole flywheel.

## Feature allocation

### Free (MIT, open, local-only) — ships in the public repo
- Connect **1 mailbox** (Gmail / Outlook / IMAP), read-only
- Core dashboard: group by company, status pills, color coding, summary dots
- **Manual add position** + **manual status change**
- Search, timeframe filter, sort, pin company, ignore company
- Demo data, keyboard shortcuts
- 100% local / privacy promise

### Pro (closed build, license-gated) — individual, ~$29 one-time or ~$5/mo
- **Multiple mailboxes merged** into one view (already ~built in the desktop main process — easy, compelling gate)
- **Follow-up reminders / nudges** ("no reply in 14 days — follow up?")
- **Analytics**: funnel conversion %, time-in-stage, response rate, weekly digest
- **Export** to CSV / PDF
- **AI classification** (LLM in `detectStatus`) for messy emails + better company/role extraction — has real per-use cost, which *justifies* charging
- **Interview prep generator** (beyond the current Google-search link)
- **Notes / contacts** per application

### Teams (B2B2C) — career services, ~$10–15/seat, volume-tiered, free pilots
- Everything in Pro × N seats
- Seat / license **admin**
- **Opt-in cohort summary** dashboard — aggregate only (who's stalling, response rates) — **never inbox content**
- Onboarding + support; optional **white-label**

## Why these lines
- **Multi-mailbox** is the cleanest first paid gate: high perceived value, already mostly implemented, trivial to lock.
- **AI + analytics** are where motivated job seekers feel the value, and AI has a marginal cost — perfect for a paid tier.
- **Teams summary** is the B2B hook, but it must stay aggregate/opt-in or it reintroduces the data-privacy problem we deliberately avoided.

## Repo / build structure (keep Free open without leaking Pro)
1. **Public repo (`Jvtino/Pipeline`) stays MIT** = the Free app. This is marketing + trust; don't move it private.
2. **Pro code lives in a private repo/module** (e.g. `pipeline-pro`). The app exposes hooks; Pro modules register features when present.
3. **Two build artifacts** via an electron-builder flag/env:
   - *Free build*: public code only.
   - *Pro build*: public + private modules, feature-gated by license.
4. **License check**: offline-verifiable signed token (embed an Ed25519 **public** key in the app; issue licenses from your Merchant-of-Record webhook). Lemon Squeezy / Paddle have a license API for exactly this.

## Anti-piracy reality (don't over-build DRM)
The core is OSS-adjacent — a determined dev can rebuild Pro. That's fine. Your moat is
**convenience** (signed installers, updates, support) and **B2B compliance** (institutions
buy legitimately; piracy is irrelevant to them). Start with a simple license gate; ship
Pro code only in the Pro build if easy, otherwise ship-and-lock. Optimize later, never.

## Decision checklist (lock before outreach)
- [ ] Free stays 1 mailbox? (recommended yes — multi-mailbox is the upsell)
- [ ] First Pro feature to build = **multi-mailbox + analytics** (cheap, high-value)
- [ ] Individual price = **$29 one-time** (or $5/mo) — confirm
- [ ] Teams = per-seat, with a free pilot — confirm
- [ ] Pro lives in a private repo/module; public app stays MIT — confirm
