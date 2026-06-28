# Google OAuth verification & CASA — readiness checklist

> **When this matters:** the moment you want *more than ~100 users* on real Gmail,
> or you want the consent screen to say **"Pipeline"** with a verified publisher
> instead of **"Google hasn't verified this app."** Until then, Testing mode (a
> ≤100-user allowlist, 7-day token refresh) is fine for a private beta and your
> first paying testers. This is a **launch gate, not a build gate** — it runs as a
> parallel track and blocks *public* GA, not your development or a closed beta.
>
> This file is the practical "how/when". The strategic "why" lives in
> `Pipeline-Transformation-Plan.md` §2.2 / §16.

`gmail.readonly` is a Google **restricted** scope. That means you are signing up
for **two** separate reviews, not one:

1. **OAuth / brand verification** — Google reviews your app's identity, consent
   screen, scopes, and privacy policy. (Weeks.)
2. **CASA security assessment** (Cloud Application Security Assessment), **renewed
   annually**, performed by a Google-authorized third-party assessor, because you
   handle restricted Gmail data. Tier 2 is typical for an app of this shape.
   (Weeks to a couple of months the first time; there is usually an **assessor
   fee** — confirm current pricing/voucher terms when you apply, they change.)

Plan for **1–3 months and a real (if modest) cash cost** the first time. Neither
review is something code alone clears — but good architecture is most of the
battle, and that part is already done (below).

---

## Where Pipeline already stands (the part most apps fail)

Restricted-scope review turns almost entirely on **Limited Use** and **data
minimization**. Pipeline's architecture was built for exactly this, and it's
enforced in code — not promised in a policy:

| Requirement Google checks | Status | Where it lives in the code |
|---|---|---|
| **No raw mail stored** (data minimization) | ✅ Done — *schema-enforced* | `packages/contracts/src/index.ts:83` (`snippet: z.string().max(600)`), `packages/db/src/schema.ts:3` — there is **no column for a raw body**. You persist derived records (company, role, status, dates, ≤600-char snippet) only. |
| **Minimal access / no full-inbox re-scans** | ✅ Done | Incremental sync — Gmail `history` / Graph `delta` with per-account cursors (`packages/sync/src/engine.ts`, `sources.ts`; cursors via `saveCursor`/`getCursor` in `packages/db/src/repo.ts`). Full read only on first connect. *(This replaced the old full-rescan path the plan flagged as CASA-hostile.)* |
| **Tokens encrypted at rest** | ✅ Done | Envelope encryption, AES-256-GCM, per-record data key (`packages/crypto/src/index.ts`; written via `saveMailConnection`). For production, move the master key into a KMS. |
| **No ads, no data resale, no human reads your mail** | ✅ By design | Classification is automated keyword scoring (`packages/classify`); no human-in-the-loop, no ad stack, no third-party data sharing. These are the four Limited Use prohibitions — Pipeline meets all four. |
| **Minimal scope requested** | ✅ `gmail.readonly` only | `packages/providers/src/oauth.ts:37`. Read-only; no send, modify, or delete. (See "Can you avoid restricted scope?" below.) |
| **Sign-in decoupled from the mail grant** | ✅ By design | Identity (session/Clerk seam) is separate from the `gmail.readonly` consent, which is incremental at connect time — so a verification delay never blocks sign-up. |

**Translation:** the hardest, most-rejected requirements (Limited Use + data
minimization) are already satisfied and demonstrable from the source tree. That
is your strongest CASA and GDPR argument.

---

## What you still need before you apply

These are not code — they're product/ops/legal items that have to exist on a
**real domain you own**:

- [ ] **A hosted deployment on your own domain** (e.g. `app.yourdomain.com` +
      `api.yourdomain.com`). Verification requires a real homepage and HTTPS
      redirect URIs on an **authorized domain** — `localhost` is fine for
      development but cannot be verified. (Deploy artifacts already exist:
      `Dockerfile`, `docker-compose.yml`, `docs/DEPLOY.md`. Set `PUBLIC_URL` /
      `WEB_URL` to your domain; the OAuth redirect URI becomes
      `https://api.yourdomain.com/auth/google/callback`.)
- [ ] **Domain ownership verified** in Google Search Console, and the domain
      added under **Authorized domains** on the OAuth consent screen.
- [ ] **A published Privacy Policy** at your domain that *explicitly* covers
      Google user data and includes the **Limited Use** affirmation (that you
      comply with the Google API Services User Data Policy, including its Limited
      Use requirements). A Terms page too. Use a **real, monitored contact
      address** — placeholder contact = automatic rejection.
- [ ] **App homepage** on the same domain, describing what the app does.
- [ ] **Consent-screen branding**: app name "Pipeline", logo, support email,
      links to the homepage + privacy policy; publishing status moved from
      *Testing* → *In production*.
- [ ] **A demo video** (unlisted YouTube) showing the full OAuth grant flow and
      demonstrating, scope by scope, **how `gmail.readonly` data is used** in the
      product (i.e. classified into the board — never displayed raw, never
      exported wholesale). This is where "store derived, not raw" pays off on
      camera.
- [ ] **CASA**: engage a Google-authorized assessor, complete the security
      questionnaire + scan, remediate findings, obtain the Letter of Validation.
      Budget for the assessor fee and the **annual** renewal.

---

## Suggested sequence

1. Finish the hosted product to MVP and deploy it on your domain (private/Testing).
2. Onboard your first ≤100 testers (including paying ones) under the Testing
   allowlist — **you can start charging here**; you do not need verification to
   take money from a closed beta.
3. In parallel, stand up the homepage + finalized Privacy/Terms with a real
   contact, and record the demo video.
4. Submit **OAuth/brand verification**; kick off **CASA** at the same time (CASA
   is the long pole).
5. On approval, flip the consent screen to production → the "unverified" warning
   and the 7-day token expiry go away → open public signups.

Keep the app on the Testing allowlist until **both** clear. Verification gates
*public* GA, not your beta or your revenue.

---

## Can you avoid restricted scope? (worth a thought before you commit)

`gmail.readonly` is restricted because it can read message bodies — and Pipeline
needs bodies to detect status ("we'd like to schedule an interview", "moving
forward with other candidates"). `gmail.metadata` (headers only, **not**
restricted, lighter review) can't see that text, so a metadata-only build would
classify far worse. The realistic options:

- **Stay on `gmail.readonly`** and do the full verification + CASA. *(Default —
  the product is materially better and the architecture is already compliant.)*
- Offer a **metadata-only "lite" tier** for users who won't grant restricted
  access — degraded classification, but no restricted-scope review for that path.

Don't widen the scope to simplify anything: read-only is already the minimum that
makes the product work, and minimal scope is itself a verification asset.

---

*Pricing, tiers, exact required artifacts, and the assessor list change over
time — confirm against Google's current "OAuth API verification" and "CASA" docs
at the time you apply. This checklist is the map; Google's console is the
territory.*
