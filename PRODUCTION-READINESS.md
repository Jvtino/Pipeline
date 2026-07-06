# Production readiness — honest assessment & roadmap

Pipeline today is an excellent **personal, single-user, local-Mac tool**. This
document is a straight audit of what it takes to put it on the market "for
everybody," grounded in the actual code — so you can see the real scope before
committing to an architecture.

**Bottom line:** the *code* is in good shape (strong classifier, clean data
model, 424 tests). The work to reach market is mostly **non-code gates** (OAuth
verification, legal, billing, support) plus **operational hardening** (rate
limits, observability, a real sync worker). The single longest-lead item is
**Google OAuth verification** — start it early; it gates everything else.

---

## What's already production-grade

Give this credit — it's real and unusual for a project this size:

- **Classifier** — 218 golden eval cases, a legacy-parity gate, weighted scoring;
  well beyond a prototype.
- **Privacy-by-design data model** — stores only *derived* records (company, role,
  status, dates, ≤600-char snippet), never raw email; OAuth tokens are
  **envelope-encrypted** at rest (`@pipeline/crypto`); every row is `user_id`-scoped.
- **Incremental sync** — Gmail History API / Graph delta, automatic token refresh,
  non-overlapping ticks.
- **Auth basics done right** — signed sessions; cookies are `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production (`apps/api/src/auth.ts`).
- **Data-subject rights** — export-my-data (CSV) and delete-all-my-data already ship.
- **Test coverage** — 424 workspace tests + 48 legacy; CI runs tests/packages/docker.
- **Deploy scaffolding** — Dockerfiles, docker-compose, and Vercel/Render config exist.

---

## Gaps by area  ·  severity → effort

### A. OAuth verification & platform compliance  · **BLOCKER · weeks–months (calendar, not coding)**
The critical path. Reading Gmail uses the **restricted** `gmail.readonly` scope.
- Test mode caps at **100 users** with no verification — fine for you + testers.
- Public launch needs Google **OAuth app verification**: verified domain, published
  privacy policy + homepage, in-app consent copy, a demo video.
- Restricted-scope apps often need an **annual third-party security assessment
  (CASA)** — real cost (a few $k/yr) and lead time. A *desktop* app that stores no
  mail server-side may get a lighter tier; confirm against current Google docs.
- Microsoft Graph is lighter: publisher verification recommended, personal accounts
  consent individually.
**Action:** submit Google verification the day you have a domain + privacy policy —
it runs in the background while you build everything else.

### B. Security hardening  · **HIGH · ~1 week**
- **Dev-login is opt-*out*** (`DISABLE_DEV_LOGIN=true` disables it). Fail-open: a
  prod deploy that forgets the flag exposes `POST /auth/dev/login`. → default it
  **off** unless explicitly enabled.
- **No rate limiting** anywhere. → add `@fastify/rate-limit` on auth + sync routes.
- **No CSRF token** on state-changing POSTs. `SameSite=Lax` covers most of it;
  add a token for defense-in-depth.
- **Master-key management** — `PIPELINE_MASTER_KEY` decrypts every user's tokens; if
  lost, all connections break. → document rotation, use a secrets manager (not a
  bare env var) in hosted, plan re-encryption.
- **Dependency + secret scanning** in CI (audit, gitleaks). Add security headers
  (helmet-equivalent), CORS lockdown to the real origin.

### C. Reliability & scale  · **HIGH · 1–2 weeks (hosted only)**
- **Scheduler is in-process** and self-documents as "a separate worker/queue for a
  real deploy" (`apps/api/src/scheduler.ts`). At >1 user it needs a **job queue +
  worker** (BullMQ/Redis or a cron worker) so sync doesn't block the API and can retry.
- **DB migrations** are apply-on-boot idempotent SQL — fine now; a real deploy wants
  versioned migrations + a **backup/restore** policy.
- **Retry/backoff** on provider API failures; dead-letter for repeatedly-failing mailboxes.

### D. Observability  · **HIGH · ~3 days**
- **No error tracking** (Sentry/equivalent) and no uptime/alerting. You'd be blind to
  failures for real users. → add error tracking, structured logs shipped somewhere,
  a health/metrics endpoint + uptime monitor.

### E. Testing gaps  · **MEDIUM · ~1 week**
- No **end-to-end** test of the real OAuth connect → sync → board flow (mocked
  providers only). No **load** test of the scheduler at N users. Web has thin
  component coverage; no visual-regression.

### F. Accessibility  · **MEDIUM · ~1 week**
- The UI leans on inline styles and custom controls (toggles, selects, the drawer).
  Needs a pass for **keyboard navigation, focus states, ARIA roles, screen-reader
  labels, and WCAG-AA contrast**. Required for many markets/enterprises; also just
  correct.

### G. Product for strangers  · **MEDIUM · ~1 week**
- First-run **onboarding** (you know how it works; a new user doesn't). Friendlier
  **error states** for connect failures, expired tokens ("reconnect"), sync errors.
  In-app help / empty-state guidance. The demo-data path is a good start.

### H. Legal & privacy  · **HIGH · ~1 week + counsel**
- `PRIVACY.md` / `TERMS.md` exist but must be **published, dated, and reviewed** for
  a public product. GDPR/CCPA: data-export + delete exist (good) — add a documented
  **retention policy**, a **DPA** for any subprocessors, cookie/consent notice, and a
  security contact. Google verification *requires* a live privacy policy URL.

### I. Billing (if monetized)  · **MEDIUM · ~1 week**
- Entitlement/license infra + a billing-webhook stub exist (`packages/license`,
  Pro-gating), but **no payment provider is wired** (Stripe/Paddle/LemonSqueezy).
  This is also where the deferred **free-vs-Pro split** gets decided.

### J. Distribution  · **MEDIUM–HIGH · varies by path**
- **Desktop:** the launcher is unsigned (right-click-Open once). Market-grade needs
  **Apple notarization** ($99/yr) + **auto-update** + eventually **Windows/Linux**
  builds. Consider repackaging as Tauri/Electron for a real installer.
- **Hosted:** a real **deploy pipeline**, domain, HTTPS, staging environment.

### K. Docs & support  · **LOW–MEDIUM · ongoing**
- User-facing help/FAQ, a support channel, a status page, changelog.

---

## The two architecture paths

Everything in **A, B, D, E, F, G, H, K** applies to *both*. The fork:

| | Desktop app | Hosted SaaS |
|---|---|---|
| Sync runs | on the user's machine | 24/7 on your servers (needs **C**) |
| Their data | never leaves their device | lives on your infra (more liability) |
| Reach | download + install | any device, a URL |
| OAuth review | lighter (no server mail storage) | heavier (likely CASA) |
| Ongoing cost | ~$99/yr signing | hosting + assessment + on-call |
| Extra work | per-OS builds, auto-update | worker/queue, backups, multi-tenant ops |

Background sync differs: desktop uses the LaunchAgent you just built; hosted syncs
server-side (the toggle becomes "always on").

---

## Recommended phased roadmap

**Phase 0 — Hardening (do regardless of path, ~2–3 weeks):**
default dev-login off · rate limiting · error tracking + uptime · security headers +
dep scanning · publish privacy policy/ToS · **submit Google verification** ·
accessibility pass · onboarding + friendlier errors.

**Phase 1 — Pick ONE shape and ship to a small audience (test-mode OAuth):**
- *Desktop:* notarize + auto-update; polish the installer. Or —
- *Hosted:* stand up the worker/queue, deploy pipeline, backups; run on the free-ish
  hosting the Vercel/Render config already targets.

**Phase 2 — Open up:**
finish OAuth verification (+ CASA if hosted), wire billing + the free/Pro split, load
test, add the second platform/OS, support + docs.

---

## Effort, honestly

The *code* gaps above are on the order of **6–10 focused weeks**. The **calendar**
gate is Google verification (weeks to a few months, mostly waiting) — which is why it
should start on day one. Legal review and (if hosted) the CASA assessment carry real
dollar cost. None of it is exotic; it's the standard "personal tool → real product"
climb, and Pipeline starts that climb from an unusually strong base.
