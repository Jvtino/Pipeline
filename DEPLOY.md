# Deploying Pipeline to the web (Vercel + Render)

This gets the hosted app (`apps/web` + `apps/api`) online so anyone with the
URL can use it:

- **Vercel** serves the React web app and rewrites `/api/*` and `/auth/*` to
  the API, so the browser sees a single origin (no CORS, cookies just work).
- **Render** runs the Fastify API plus a managed Postgres, from `render.yaml`.
- **Firebase** is not part of this deploy. When a real identity provider is
  wired (see "Security note" below), Firebase Auth is a natural candidate.

Config files in the repo root: [`render.yaml`](render.yaml) (API + database)
and [`vercel.json`](vercel.json) (web build + rewrites).

---

## 1. Deploy the API on Render

1. Go to <https://dashboard.render.com> → **New → Blueprint**.
2. Connect your GitHub account and pick this repository (and the branch you
   merged the deploy config to).
3. Render reads `render.yaml` and offers to create the **pipeline-api** web
   service and the **pipeline-db** Postgres. Before applying, it asks for the
   env vars marked `sync: false`:
   - **PIPELINE_MASTER_KEY** — run `openssl rand -base64 32` locally and paste
     the result. Save it somewhere safe (it encrypts stored mail tokens).
   - **PUBLIC_URL** and **WEB_URL** — you don't know the Vercel URL yet; enter
     a placeholder like `https://example.com` and come back after step 2.
   - **GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / MS_CLIENT_ID** — leave blank
     for now (the app runs on demo data); fill in during step 3.
4. Apply. First build takes a few minutes. When it's live, note the service
   URL, e.g. `https://pipeline-api.onrender.com` — if Render gave it a suffix
   (e.g. `pipeline-api-xyz1.onrender.com`), you'll use that in step 2.

> Free-tier notes: the service sleeps after ~15 min idle (first request then
> takes ~30–60 s), and the **free Postgres expires after 30 days** unless
> upgraded (~$7/mo keeps it).

## 2. Deploy the web app on Vercel

1. Go to <https://vercel.com/new> → **Import** this repository.
2. Leave **Root Directory** as the repo root — `vercel.json` supplies the
   install/build commands and output directory. Framework preset: **Vite** (or
   "Other"; the commands are overridden either way).
3. In the project's **Settings → Environment Variables**, add
   `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version pinned in
   `package.json`.
4. Deploy, and note your production URL, e.g. `https://pipeline-xyz.vercel.app`.
5. **Wire the two together:**
   - If your Render URL is *not* exactly `https://pipeline-api.onrender.com`,
     edit the two `destination` entries in `vercel.json` to match, commit, and
     push (Vercel redeploys automatically).
   - In Render → pipeline-api → **Environment**, set **both** `PUBLIC_URL` and
     `WEB_URL` to your Vercel URL (no trailing slash) and save — the service
     restarts.
6. Open the Vercel URL: sign in with any email and you'll get a board seeded
   with demo data. **This is the point where your friends can see it online.**

## 3. (Optional) Enable real Gmail / Outlook connect

Follow [CONNECT-MAILBOX.md](CONNECT-MAILBOX.md) to create OAuth clients, with
the hosted URLs in place of localhost:

- Google: authorized redirect URI = `https://<your-vercel-domain>/auth/google/callback`,
  then set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` on the Render service.
- Microsoft: redirect URI = `https://<your-vercel-domain>/auth/microsoft/callback`
  (platform: *Mobile and desktop / public client* — PKCE, no secret), then set
  `MS_CLIENT_ID` on the Render service.

Note the redirect URIs use the **Vercel** domain: the `/auth/*` rewrite proxies
the callback to the API, keeping the whole flow (and the session cookie) on one
origin. While your Google OAuth consent screen is in *Testing* mode, only
emails you add as test users can connect Gmail — add your friends there.

## Security note — read before connecting a real mailbox

Sign-in is currently the built-in **dev login**: email only, **no password**
(`DISABLE_DEV_LOGIN` must stay unset for the hosted app to be usable). That is
fine for demo data, but it means *anyone who has the URL and your email* could
open your board. If you connect a real mailbox, treat the deployment as
private: share the URL only with people you trust, or hold off on real connect
until a real identity provider (e.g. Firebase Auth, Clerk, Auth.js) replaces
the dev login — the hook for that is already in `apps/api/src/auth-routes.ts`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Vercel build fails resolving `@pipeline/contracts` | Confirm `ENABLE_EXPERIMENTAL_COREPACK=1` is set and Root Directory is the repo root. |
| Web loads but API calls 404/502 | The `destination` hosts in `vercel.json` must exactly match your Render URL; check the service is live in Render. |
| First load takes a minute | Free-tier cold start — the Render service is waking up. |
| `redirect_uri mismatch` on connect | The URI registered with Google/Microsoft must exactly equal `https://<vercel-domain>/auth/<provider>/callback`, and `PUBLIC_URL` must be the Vercel domain. |
| Everyone's data disappeared | Render free Postgres expired (30 days) or `PIPELINE_MASTER_KEY` changed. |
