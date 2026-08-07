# Pipeline mobile — launch checklist (the owner's part)

The code for Phases 1–5 is done. What remains is account creation, credentials,
and spending decisions that only the owner can make. Items marked 💰 cost money
— per the plan's rule, nothing is spent until you approve that line.

## A. Free sign-ups (do anytime, ~1 hour total)

1. **Clerk** (sign-in service) — clerk.com → create application "Pipeline".
   - Enable: Email/password, Google, Microsoft, Apple.
   - Sessions → Customize session token → add `{"email": "{{user.primary_email_address}}"}`.
   - Copy the **Frontend API URL** → server env `CLERK_ISSUER`; copy the
     **Secret key** → server env `CLERK_SECRET_KEY`; copy the
     **Publishable key** → app env `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`.
2. **Expo** (build service) — expo.dev → create org/account.
   - `cd apps/mobile && pnpm dlx eas-cli init` links the project (writes the
     projectId into app config). Create an access token → GitHub secret
     `EXPO_TOKEN` (activates `.github/workflows/eas.yml`).
3. **Firebase** (Android push delivery only, no SDK in the app) — console →
   new project → add Android app `com.pipeline.mobile` → upload the FCM
   service-account key to Expo (EAS credentials).

## B. Money gates 💰 (approve individually)

| # | Item | Cost | Unlocks |
|---|---|---|---|
| 1 | Domain (+ static hosting for `site/`) | ~$10–15/yr | Legal pages live → store forms, Google verification, universal links |
| 2 | Apple Developer Program | $99/yr | iOS device push, TestFlight, App Store; Sign in with Apple config |
| 3 | Google Play Console | $25 once | Play internal testing + release |
| 4 | Render paid tier (worker + persistent Postgres) | ~$15–30/mo | Reliable public backend; uncomment the worker block in `render.yaml` |
| 5 | Google restricted-scope verification / CASA | ~$0–few $k/yr | Flip `FEATURE_GMAIL_CONNECT=true` — Gmail for the public |

## C. Wiring after sign-ups (I do these once you hand me the values)

- Server env: `CLERK_ISSUER`, `CLERK_SECRET_KEY`, `MOBILE_REDIRECT_URL`,
  `PIPELINE_MASTER_KEY`, provider client ids; remove `ENABLE_DEV_LOGIN` when
  Clerk lands on web.
- `site/.well-known/apple-app-site-association` → real `TEAMID`;
  `assetlinks.json` → release cert fingerprint.
- `eas.json` production `EXPO_PUBLIC_API_URL` → the real API domain.
- Submit builds: `git tag mobile-v0.1.0 && git push --tags` (or the
  workflow_dispatch button) → TestFlight / Play internal.

## D. Pre-submission sanity list

- [ ] Legal pages reviewed by counsel (drafts are marked DRAFT)
- [ ] Demo account seeded for reviewers (`docs/STORE-LISTING.md` notes)
- [ ] Privacy labels entered exactly as drafted
- [ ] Sign in with Apple verified on a device (guideline 4.8)
- [ ] Account deletion verified on a device (guideline 5.1.1(v))
- [ ] Google verification submitted (start of the CASA clock) — launch
      proceeds Microsoft-first regardless
