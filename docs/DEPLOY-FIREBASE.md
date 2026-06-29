# Deploy Pipeline to a web link (Firebase Hosting + Cloud Run)

The hosted setup chosen for "me now, others later": the **UI** on Firebase
Hosting, the **API** as an always-on **Cloud Run** container, **Neon** for
Postgres, and the app **locked to you** with a passphrase until real accounts
(Clerk) are wired. Everything ends up on **one URL** (`https://<project>.web.app`)
because `firebase.json` rewrites `/api`, `/auth`, and `/webhooks` to Cloud Run —
same-origin, so OAuth and cookies just work.

> You don't install anything: all the commands run in **Google Cloud Shell**, a
> terminal in your browser with `gcloud`, `firebase`, `node`, and `git`
> preinstalled. This is a guided, ~30-minute setup — do it with Claude, paste back
> anything that looks off.

## What you need first
- A Google account with **billing enabled** (Cloud Run + Cloud Build need it; the
  free tier covers low personal usage — you'll pay cents, if anything).
- Your **Google OAuth** Client ID + secret (the ones already in your `.env`).
- A **passphrase** you choose (no commas) — the only thing standing between the
  public URL and your board.

---

## 1. Database — Neon (free Postgres)
1. Sign up at **https://neon.tech** → create a project (region near you).
2. Copy the **connection string** (`postgres://…`). That's your `DATABASE_URL`.

## 2. Project — Firebase (which is also a Google Cloud project)
1. Go to **https://console.firebase.google.com** → **Add project** → name it
   `pipeline` (note the **Project ID** it assigns, e.g. `pipeline-4d2a1`).
2. In **Build → Hosting**, click **Get started** (you can stop after it's enabled).
3. Make sure **billing** is on for this project (Firebase **Blaze** plan — required
   for Cloud Run; still effectively free at your scale).

Your site URL will be **`https://<project-id>.web.app`** — note it; you'll use it
as both `PUBLIC_URL` and `WEB_URL`.

## 3. Open Cloud Shell and get the code
1. Open **https://console.cloud.google.com**, pick your `pipeline` project (top
   bar), then click the **terminal icon** (top-right) to open **Cloud Shell**.
2. In that terminal:
   ```bash
   git clone https://github.com/Jvtino/Pipeline.git
   cd Pipeline
   git checkout claude/new-session-7yxc79
   ```
3. Generate two secrets (run twice, copy each output):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

## 4. Deploy the API to Cloud Run
1. Create an `env.yaml` (Cloud Shell has a built-in editor: `cloudshell edit env.yaml`).
   Fill in your values — **`<project-id>` is yours from step 2**:
   ```yaml
   DATABASE_URL: "postgres://…from-neon…"
   PIPELINE_MASTER_KEY: "…first generated secret…"
   SESSION_SECRET: "…second generated secret…"
   GOOGLE_CLIENT_ID: "…apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET: "GOCSPX-…"
   LOGIN_PASSPHRASE: "…the passphrase you chose…"
   ALLOWED_EMAILS: "youremail@gmail.com"
   PUBLIC_URL: "https://<project-id>.web.app"
   WEB_URL: "https://<project-id>.web.app"
   ```
   `env.yaml` holds secrets — it's git-ignored; don't commit it.
2. Deploy (first run asks to enable a few APIs — say yes; it builds from the
   repo's `Dockerfile`):
   ```bash
   gcloud run deploy pipeline-api \
     --source . \
     --region us-central1 \
     --allow-unauthenticated \
     --env-vars-file env.yaml
   ```
   The **service name `pipeline-api`** and **region `us-central1`** must match
   `firebase.json` — keep them as-is, or change both places together.

## 5. Deploy the UI to Firebase Hosting
```bash
corepack pnpm@10.33.0 install --filter "@pipeline/*..."
corepack pnpm@10.33.0 --filter "@pipeline/*" build      # builds shared pkgs + apps/web/dist
firebase use <project-id>
firebase deploy --only hosting
```
This publishes `apps/web/dist` and wires the `/api` · `/auth` · `/webhooks`
rewrites to your Cloud Run service. Visit **`https://<project-id>.web.app`** — you
should see the **sign-in screen**.

## 6. Point Google sign-in at the new address
In **https://console.cloud.google.com/apis/credentials** → your **Pipeline local**
OAuth client → **Authorized redirect URIs** → **Add URI**:
```
https://<project-id>.web.app/auth/google/callback
```
Save. (Keep the `localhost:3001` one too if you still run locally.) Give Google a
minute to propagate.

## 7. Sign in and connect
1. Open `https://<project-id>.web.app`, sign in with your email + the passphrase.
2. **Connect ▾ → Connect Gmail** → approve. Your board fills in — now from the cloud.

---

## Notes
- **Secrets** live in Cloud Run's env (and Neon). `env.yaml` is git-ignored; you
  can delete it after deploying. To rotate later: edit env in the Cloud Run console
  or re-run the deploy with an updated `env.yaml`.
- **Cost**: Cloud Run scales to near-zero when idle; Neon's free tier is generous.
  Expect ~$0 for a single user. Watch the billing dashboard the first month.
- **The ~weekly Gmail reconnect still applies** until Google verification
  (`GOOGLE-VERIFICATION.md`) — it's tied to "Testing" mode, not to hosting.
- **Updating the app later**: in Cloud Shell, `git pull`, then re-run the step 4
  deploy (API) and/or step 5 build + `firebase deploy` (UI).
- **Opening it to other people** later means wiring real accounts (Clerk) and
  doing Google verification first — the allowlist/passphrase is a personal stopgap,
  not multi-user auth.
