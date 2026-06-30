# Deploying Pipeline (hosted)

The hosted product is `apps/api` (Fastify) + `apps/web` (React/Vite) over the
shared packages, backed by Postgres. The schema is applied automatically on API
startup, so there's no separate migration step for the initial deploy.

> **Status:** the app runs on **demo data for a single stand-in user** until real
> auth is wired. It is fully functional as a service; it is not yet multi-tenant
> or publicly launchable — that needs the gates in issue #7 (Google/Microsoft
> verification + CASA, legal, your OAuth client IDs).

## 1. Generate secrets

```bash
# Master key (wraps mail tokens at rest) — 32 bytes base64
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Ed25519 license keypair (Pro/Teams gate) — prints public then private PEM
node -e "const {generateKeyPairSync}=require('crypto');const k=generateKeyPairSync('ed25519');console.log(k.publicKey.export({type:'spki',format:'pem'}).toString());console.log(k.privateKey.export({type:'pkcs8',format:'pem'}).toString())"
```

Copy `.env.example` → `.env` and fill in at least `PIPELINE_MASTER_KEY` (+
`DATABASE_URL` for anything beyond local).

## 2. Run it locally (production-like, with Postgres)

```bash
docker compose up --build
# API  → http://localhost:3001/api/health
# Web  → http://localhost:8080   (nginx serves the build and proxies /api → api:3001)
```

## 3. Managed hosting (recommended shape)

Per the plan (§12/§15), a hybrid setup keeps cost near zero idle:

| Piece | Suggested | Notes |
|---|---|---|
| API + (later) workers | Fly.io / Render / Railway | always-on container (needed for OAuth + webhooks); build from the root `Dockerfile` |
| Postgres | Neon / Supabase | set `DATABASE_URL` |
| Web | Vercel / Netlify / Cloudflare Pages | build `apps/web` (`pnpm --filter @pipeline/web build`), output `apps/web/dist`; rewrite `/api/*` → the API origin |
| Redis (later) | Upstash | sync queue + OAuth `state` (replaces the in-memory pending map) |

### Web build settings (Vercel/Netlify)
- Build command: `corepack enable && pnpm install --filter "@pipeline/web..." && pnpm --filter @pipeline/contracts build && pnpm --filter @pipeline/web build`
- Output dir: `apps/web/dist`
- Add a rewrite so `/api/*` proxies to your API origin (so the app stays same-origin).

## 4. Environment reference

See `.env.example`. Required in prod: `PIPELINE_MASTER_KEY`, `DATABASE_URL`.
To connect real mailboxes: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`,
`PUBLIC_URL`, `WEB_URL`. For billing: `BILLING_WEBHOOK_SECRET` and the license keys.

The OAuth **redirect URIs** to register with each provider are
`<PUBLIC_URL>/auth/google/callback` and `<PUBLIC_URL>/auth/microsoft/callback`
(locally, `PUBLIC_URL` defaults to `http://localhost:3001`). A friendly,
end-user walkthrough — including Google's one-time *publish to production* step —
is in [`EMAIL-SETUP.md`](../EMAIL-SETUP.md).

> **Running locally without `DATABASE_URL`/`PIPELINE_MASTER_KEY`?** The API runs in
> single-user **local mode**: it persists the DB, master key and session secret
> under `~/.pipeline` (override with `PIPELINE_HOME`) so connected mailboxes survive
> restarts. Set `PIPELINE_LOCAL=false` to force the old ephemeral dev behavior.

## 5. Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/applications` | the board (derived records) |
| POST | `/api/sync` | incremental sync of connected mailboxes |
| GET | `/api/analytics` | Pro-gated funnel |
| GET | `/auth/:provider/start` · `/callback` | OAuth connect (Google/Microsoft) |
| POST | `/webhooks/billing` | MoR webhook (HMAC-verified) → plan upgrade |

## 6. Before a public, multi-user launch (not code — see issue #7)

- Google OAuth verification for the restricted `gmail.readonly` scope + likely
  annual **CASA Tier 2**; Microsoft publisher verification.
  → practical readiness checklist: [`GOOGLE-VERIFICATION.md`](./GOOGLE-VERIFICATION.md).
- Replace the single stand-in user with real per-request auth (Clerk seam exists).
- Finalize Privacy/Terms with a real contact (legal review).
- Move OAuth `state` + sync queue to Redis; add a background sync scheduler and
  provider webhooks (Gmail Pub/Sub, Graph subscriptions).
