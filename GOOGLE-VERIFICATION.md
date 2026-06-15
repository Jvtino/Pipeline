# Google OAuth verification — checklist for Pipeline

Pipeline requests the **`gmail.readonly`** scope, which Google classifies as a
**restricted** scope. To let the general public (beyond 100 test users) connect
Gmail, the OAuth app must pass Google's production verification. This is the
longest pole in commercializing with Gmail — plan for **weeks**, not days.

> If you'd rather launch sooner: ship **Microsoft + IMAP only** for v1 and add
> Gmail after verification. The code already supports disabling Google (don't set a
> Google `clientId` in `config.json`).

## Phase 0 — prerequisites (you provide)
- [ ] A **domain you own** (e.g. `pipelineapp.com`).
- [ ] A **published homepage** on that domain (see `site/index.html`).
- [ ] A **privacy policy** hosted on that domain (publish `PRIVACY.md`).
- [ ] Verify domain ownership in **Google Search Console** with the same Google
      account that owns the Cloud project.

## Phase 1 — OAuth consent screen
1. Google Cloud Console → **APIs & Services → OAuth consent screen**.
2. User type **External**; publishing status will move from *Testing* → *In
   production*.
3. Fill **App name, support email, app logo, app domain, homepage URL, privacy
   policy URL, terms URL, authorized domains**.
4. Add the **`.../auth/gmail.readonly`** scope and write a clear **scope
   justification** (why a job‑application tracker needs read access).
5. Provide a **demo video** showing: the OAuth consent flow, what the app does with
   Gmail data, and that it matches your scope justification.

## Phase 2 — submit for verification
6. Click **Publish app** → **Prepare for verification**.
7. Google reviews **brand** (logo/name/consistent domain) and **restricted‑scope**
   use. Expect back‑and‑forth questions; answer precisely.

## Phase 3 — security assessment (maybe)
8. Restricted‑scope apps **may** require an annual independent **security
   assessment (CASA)**, depending on how the app stores/transmits Gmail data.
   Because Pipeline is a **local desktop app** that keeps data on the device and
   runs no backend, confirm the **exact** current requirement with Google's
   restricted‑scope docs and, ideally, counsel — don't assume either way.
   - Google's restricted‑scope verification:
     https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification

## Phase 4 — keep it compliant
- [ ] Use a **Google‑brand‑compliant "Sign in with Google" button** (done in‑app).
- [ ] Keep the privacy policy accurate (Limited Use statement included).
- [ ] Re‑verify when scopes, branding, or data handling change.

## Notes
- Until verified, users see an **"unverified app"** warning and the 100‑test‑user
  cap applies — fine for you + testers, not for a public paid launch.
- Microsoft's path is lighter: `Mail.Read` is consentable by personal accounts;
  publisher verification via an org‑owned Entra registration is recommended but not
  a hard day‑one blocker.
