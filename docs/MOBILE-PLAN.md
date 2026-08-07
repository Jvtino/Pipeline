# Pipeline: Desktop App → Public Mobile App (iOS + Android)

> **Status (2026-08-07, evening):** Phases 1–5 built, reviewed, merged (#30).
> Since then, three more merged arcs: a **premium refinement pass** (#31 —
> motion, board/detail depth, welcome, stats, alerts badge; 22 findings from
> three independent reviews fixed); **interview reminders on real mail + web
> convergence** (#32 — prose interview dates normalized server-side so push
> reminders/calendars work on real mailboxes; the web app's status moves,
> manual adds and review confirms now write server truth; 15 review findings
> fixed); and a **pagination-ready board endpoint + override transparency**
> (#33 — the plan's last named scaling risk retired). What remains is
> owner-side only — see `docs/LAUNCH-CHECKLIST.md` for the sign-ups and 💰 gates.

## Context

Pipeline turns job-application emails into a board showing where every application stands. Today it exists as an Electron desktop app (`index.html` + `main.js`, dark theme), a frozen Python local build, and a newer hosted web product (`apps/web` React + `apps/api` Fastify + Postgres, pnpm monorepo). The owner wants a **real, downloadable mobile app on both the Apple App Store and Google Play, usable by the general public** — not a PWA.

The repo's own prior plan (`docs/Pipeline-Transformation-Plan.md` §5, line 703+) already chose Expo/React Native and a server-centric architecture; this plan adopts it, with one deliberate departure: the phone must support the **full journey** (sign up → connect mailbox → use the board), not be a web-companion, because the app is public.

### Decisions locked with the owner (all confirmed via Q&A)

1. Real downloadable app on **both** iOS and Android — public, anyone can sign up.
2. **v1 scope (owner delegated, recommendation approved):** sign up, connect mailbox, board, application detail (timeline/snippet/contacts/docs metadata), status change, manual add, simplified review queue, calendar, push alerts, settings incl. account deletion. **Deferred to v2:** templates, CSV export, tasks kanban, document uploads, deep statistics (a "lite" stats screen ships in v1).
3. **Look & feel: the desktop app's dark theme** (`--bg #07090e`, blue `#2f81f7`, status colors at `index.html:11-36`) — not the light web theme.
4. **Push notifications from day one** (status changes + interview reminders — nothing else, no engagement spam).
5. **Sign-in: both** one-tap (Google/Microsoft — and Apple, required by App Store rule 4.8) **and** email/password.
6. **Free for now** — billing scaffolding (`gate.ts`, `/webhooks/billing`) stays dormant.
7. **Launch without Gmail first**: ship with Microsoft/Outlook + manual tracking; Gmail shows "coming soon" behind a server flag until Google's restricted-scope verification lands. Verification paperwork starts day one.
8. **Sign-in via a managed service (Clerk)** — the repo pre-planned this seam (`apps/api/src/auth.ts:1-5`).
9. **No IMAP (Yahoo/iCloud app-password) in v1** — hosted sync already skips it (`apps/api/src/sync-service.ts:41`).
10. **💰 Money rule: every step that costs money is flagged and requires the owner's explicit approval before it is spent.** Nothing below is purchased without asking first.

### Non-negotiable architecture rule (from the repo's own security posture)

The phone **never scans a mailbox, never holds a mail OAuth token, never sees raw email**. All mail sync/classification stays server-side (`packages/sync`, `packages/classify`); the phone is a pure consumer of derived records via `apps/api`. Mailbox connect from the phone uses the **system browser** (PKCE, deep-link return) — never an embedded webview; the token goes straight to the server and is envelope-encrypted (`packages/crypto`).

---

## 💰 Cost sheet & approval gates

| Item | Cost | When needed | Gate |
|---|---|---|---|
| Apple Developer Program | $99/yr | Before iOS device push testing / TestFlight (end of Phase 2) | **ASK FIRST** |
| Google Play Console | $25 once | Before Play internal testing (Phase 3) | **ASK FIRST** |
| Server paid tier (Render: worker process + persistent Postgres) | ~$15–30/mo | Before public launch (dev/staging can stay free-tier) | **ASK FIRST** |
| Domain + hosting for legal pages (if not already owned) | ~$10–15/yr | Phase 0 (needed for Google verification + store listings) | **ASK FIRST** |
| Google CASA Tier 2 security assessment (Gmail) | ~$1,000+/yr | Only when flipping Gmail on (post-launch) | **ASK FIRST** |
| Expo EAS paid plan (optional; free tier has build queue limits) | $0 or ~$19/mo | Only if free build quota becomes a bottleneck | **ASK FIRST** |
| Clerk (sign-in), Firebase (push credentials only) | $0 at this scale | — | none |

**Phases 1–2 (all the backend + most mobile code) cost $0** — everything runs locally/simulator. The first unavoidable spend is the Apple account.

---

## Workstream A — Backend (`apps/api`, `packages/db`, `packages/sync`)

### A1. Auth: Clerk behind the existing `req.user` seam
- New `apps/api/src/clerk.ts`: verify Clerk session JWTs (JWKS via `@clerk/backend` `verifyToken` or `jose`); export `verifyBearer(req)`.
- `apps/api/src/server.ts` preHandler (~line 76): try `Authorization: Bearer` → Clerk verify → upsert `users` row (`id = jwt.sub`), call existing `seedDemoForUser` for brand-new users; else fall back to the existing cookie check. **Web/desktop cookie flow untouched — fully backward compatible.**
- `apps/api/src/auth-routes.ts`: flip dev login **fail-closed** (`ENABLE_DEV_LOGIN === "true"` and not production) — closes the hole flagged in `PRODUCTION-READINESS.md` §B.
- Add `@fastify/rate-limit` on `/auth/*`, `/api/sync`, `/api/devices`.
- Clerk dashboard config: Email+Password, Google, Microsoft, Apple connections.

### A2. Schema (extend `packages/db/src/schema.ts` + idempotent SQL in `migrations.ts`, matching existing pattern)
- `devices` table: `id, user_id (cascade), platform enum(ios,android,web), expo_push_token unique, device_name, notify_status_changes, notify_reminders, disabled, created_at, last_seen_at` — matches the spec already in the Transformation Plan (~line 1379).
- `push_log` table: `dedupe_key unique` — send-once idempotency.
- `applications` add columns: `override_status`, `override_at`, `reviewed_at` — sync upserts never touch them, so user overrides survive re-classification by construction; board reads coalesce `override_status ?? status`.

### A3. New endpoints (all additive; new file `apps/api/src/mobile-routes.ts` + small edits)
- `POST/PATCH/DELETE /api/devices` — push-token registration & prefs.
- `PATCH /api/applications/:threadId {status}` — server-side status override + `application_events` row (`source:'user'`).
- `POST /api/applications` — manual add (`threadId = manual:<uuid>`), reusing `upsertApplications`.
- `GET /api/review` + `POST /api/review/:threadId` — simplified review queue over the already-persisted `classification.requiresManualReview` JSON (`schema.ts:65`).
- `POST /api/connect-token` — single-use nonce (reuse `apps/api/src/pending-store.ts`) so the system browser can start mail OAuth for a bearer-authenticated phone user.
- `DELETE /api/account` — Apple-mandated in-app deletion: revoke mail grants at provider, delete `users` row (all tables cascade — verified), delete Clerk user.
- `GET /api/meta` — `{ minMobileVersion, features: { gmailConnect } }`: forced-upgrade lever + the **Gmail kill-switch** for decision 7.
- Modify `apps/api/src/oauth-routes.ts`: accept `?ct=<connect-token>` on `/auth/:provider/start`; `returnTo: 'mobile'` in pending state → callback redirects to the universal link `https://<domain>/connect/done?connect=<status>`. Web behavior unchanged. **No `/api/v1` retro-versioning** — contracts stay additive; mobile sends `X-Pipeline-Client` header.

### A4. Sync → push hook + worker split
- `packages/db/src/repo.ts` `upsertApplications` (lines ~125–187) already computes per-thread status transitions — change it to **return** them (additive).
- Thread `transitions` through `packages/sync` `SyncResult` and an optional `onTransitions(userId, transitions)` hook in `apps/api/src/sync-service.ts`. **Suppress on first-sync backfill** (no prior cursor) to avoid a push flood on connect.
- New `apps/api/src/worker.ts`: dedicated process for the sync scheduler + push receipts + interview-reminder scan; `render.yaml` gains a `worker` service (💰 gate) and the web service drops `SYNC_INTERVAL_MS`. Keep 5-min polling for v1; Gmail `watch`/Graph subscriptions (specced in Transformation Plan §8.5) are post-launch.

---

## Workstream B — Mobile app (`apps/mobile`, new)

### B1. Stack
Expo (managed) + React Native + TypeScript, **Expo Router**, **TanStack Query v5** (+ AsyncStorage persister for offline reads), `@clerk/clerk-expo` + `expo-secure-store`, `expo-notifications`, `expo-web-browser`, `expo-apple-authentication`, `react-native-svg`. Imports `@pipeline/contracts` unchanged (pure zod — Metro-compatible; reuse `boardFromApplications` for grouping). No UI library — hand-rolled components, matching the repo's ethos. If pnpm/Metro fight: scoped `apps/mobile/.npmrc` with `node-linker=hoisted` (timeboxed spike, Phase 2 day 1). `apps/*` workspace glob already covers it.

### B2. Design tokens — new `packages/tokens`
Zero-dep TS constants transcribed from `index.html:11-36`: bg `#07090e`, panel `#0c111b`, elev `#0f1622`, borders `rgba(255,255,255,.07/.13)`, text `#e8edf5/#9aa6b8/#61708a`, blue `#2f81f7/#4f9cff`, status map (applied `#8b97a8`, interview `#f5c542`, offer `#34d399`, rejected `#f0556b`, cancelled `#f59e42`) keyed off the contracts `STATUSES` tuple, radius 16, spacing 4/8/12/16/22. Splash/background `#07090e`, `userInterfaceStyle: "dark"`, blue radial glow via `expo-linear-gradient` or static asset.

### B3. Screens (expo-router tree)
```
app/_layout.tsx                      Clerk + QueryClient + theme + notification-tap router
app/(auth)/sign-in|sign-up|forgot-password.tsx   (Apple button iOS-only; Clerk sends reset emails)
app/(app)/(tabs)/index.tsx           Board: status chips, company groups, search, pull-to-refresh, "+"
app/(app)/(tabs)/calendar.tsx        Interview dates from enrichment.interviewDateTime
app/(app)/(tabs)/alerts.tsx          Review queue + nudges list
app/(app)/(tabs)/settings.tsx        Profile, mailboxes, notification prefs, stats-lite link, legal, sign out, DELETE ACCOUNT
app/(app)/application/[threadId].tsx Detail: status timeline (events), ≤600-char snippet, messages, contacts/docs metadata
app/(app)/add-position.tsx  (modal)
app/(app)/review/[threadId].tsx (modal, push-tap target)
app/(app)/connect-mailbox.tsx        connect-token → WebBrowser.openAuthSessionAsync → universal-link return
app/(app)/stats.tsx                  Lite stats (donut + response rate, react-native-svg)
```
Onboarding after sign-up: connect Outlook (Gmail = "coming soon" when `features.gmailConnect=false`) or "add applications by hand" or demo data (`seedDemoForUser` already provides this).

### B4. Data layer
`src/api/client.ts` — `EXPO_PUBLIC_API_URL`, Clerk bearer injection, zod-parse every response (fail loud, "app may need an update"), 401 → sign-in preserving deep-link intent. Query keys `['board'] ['messages',id] ['events',id] ['review'] ['connections'] ['meta']`; optimistic mutations with rollback. **Offline = cached reads + banner; writes require connectivity in v1** (queued-writes machinery deferred to v2). Startup checks `/api/meta` `minMobileVersion`.

---

## Workstream C — Push, end-to-end

Expo Push Service (one API for APNs+FCM; EAS manages credentials; Firebase project used for FCM keys only — no Firebase SDK in the app).
1. Client `apps/mobile/src/notifications.ts`: ask permission **after** first board render; register token → `POST /api/devices`; Android channels `status-changes`/`reminders`; tap → route by `{type, threadId}`. **Payload carries ids only — never snippet text.**
2. Server `apps/api/src/push.ts` (`expo-server-sdk`): chunked sends honoring per-device prefs; receipt polling in worker; disable tokens on `DeviceNotRegistered`.
3. Triggers in `apps/api/src/notifications.ts`: status transitions (dedupe key `userId:threadId:to`, backfill-suppressed) and interview reminders at T-24h/T-1h. Nothing else.

---

## Workstream D — Store readiness & compliance

- **Phase 0 (longest lead, start immediately):** domain + publish `PRIVACY.md`/`TERMS.md` as pages (extend `site/`); `.well-known/apple-app-site-association` + `assetlinks.json` for deep links; Clerk app with 4 sign-in methods; **submit Google restricted-scope verification** (`GOOGLE-VERIFICATION.md` phases 0–2) — decoupled from launch by the `gmailConnect` flag; Apple/Play enrollment (💰 gates); EAS project; Firebase-for-FCM.
- **Sign in with Apple** (guideline 4.8) — Clerk Apple connection + native button.
- **In-app account deletion** (guideline 5.1.1(v)) — type-to-confirm → `DELETE /api/account`; Play Data-safety deletion URL page on `site/`.
- **Privacy labels** (both stores): collected & linked — email, derived job-application records (company/role/status/dates/≤600-char snippet, attachment metadata only); no tracking/ads. Mirrors `PRIVACY.md` verbatim — genuinely clean story.
- **Builds:** `eas.json` (development/preview/production), EAS Update with `runtimeVersion: appVersion`, TestFlight + Play internal tracks; App Review notes include a seeded demo account (reviewers see a populated board without connecting mail).

---

## Testing & CI

- **API (vitest + PGlite, existing pattern):** clerk-auth (mock JWKS), devices, application writes (override stickiness vs sync upsert), review, account-delete cascade + revoke, push policy (transition→send, backfill suppression, dedupe), connect-token + mobile OAuth return.
- **db/sync:** `upsertApplications` transition-return; migration idempotency.
- **Mobile:** `jest-expo` + `@testing-library/react-native`; `tsc --noEmit`; pure logic (calendar derivation, formatting) unit-tested.
- **CI:** extend `.github/workflows/packages.yml` with a `mobile` job; new `eas.yml` on `mobile-v*` tags (`EXPO_TOKEN` secret). Classifier parity gate untouched.

## Verification (per phase)

1. **Phase 1:** run API locally (`pnpm --filter @pipeline/api dev`), `curl` with a Clerk test JWT: devices CRUD, PATCH status → events row, review queue, account delete cascades; confirm web app still works on the cookie path; full vitest suite green.
2. **Phase 2:** Expo dev build (simulator): sign-in each method → dark board renders from staging API; airplane mode → cached board + banner.
3. **Phase 3:** on-device: connect Outlook via system browser → return → board populates from a real mailbox; override status → survives a forced `POST /api/resync`; delete account → all rows gone.
4. **Phase 4:** send a mail that flips a status in a test mailbox → within one sync tick a push arrives → tap → lands on the review modal for that thread; verify no pushes on first connect (backfill suppression).
5. **Phase 5:** TestFlight/Play-internal install by the owner; store pre-submission checklists; submit.

## Phasing (solo dev; total build ~8–11 weeks; Google verification runs in parallel, 4–12+ wks calendar)

| Phase | Time | Deliverable |
|---|---|---|
| 0. Accounts & compliance kickoff (💰 gates here) | ~1 wk active | Legal pages live, Clerk configured, Google verification submitted |
| 1. Backend auth + API surface | 2 wks | Staging API a phone can fully use ($0 spend) |
| 2. Mobile foundation | 2–3 wks | Sign-in → dark board on simulator ($0 until device/TestFlight) |
| 3. Mobile actions | 2 wks | Feature-complete: override, add, review, calendar, connect-mailbox, deletion |
| 4. Push end-to-end | 1–1.5 wks | Server event → notification → deep-linked modal |
| 5. Hardening + submission | 2 wks | Sentry, states/accessibility, screenshots, labels, submit both stores |
| Launch | — | Public, Microsoft + manual; Gmail flips on when Google approves (💰 CASA gate) |

## Key risks

1. **CASA/Gmail timing & cost** — biggest calendar risk; fully mitigated by the launch-without-Gmail flag (decision 7).
2. **Render free tier** — DB expires after 30 days; worker needs paid plan before launch (💰 gated).
3. **pnpm + Metro** — known papercut; scoped hoisted-linker fallback, day-1 spike.
4. **User-id duality** (legacy `id=email` vs Clerk `id=sub`) — harmless on fresh prod DB; dev boards don't carry over. Web's own public launch will eventually want the Clerk adapter too (out of scope, flagged).
5. **Unpaginated `GET /api/applications`** — fine at v1 scale; paginate before heavy users.
6. **Apple review** — 4.8 and 5.1.1(v) handled by design; demo account provided for reviewers.

## Explicitly out of scope for v1

Templates, CSV export, tasks kanban, document uploads, deep statistics, IMAP providers, offline write-queueing, billing/Pro, Gmail `watch`/Graph push subscriptions, any changes to the Electron desktop app or Python build (both keep working untouched).
