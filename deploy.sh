#!/usr/bin/env bash
# One-shot redeploy of Pipeline — UI on Firebase Hosting, API on Cloud Run.
#
# Run it from Google Cloud Shell, inside the repo:
#     bash deploy.sh                 # uses the Firebase project already selected
#     bash deploy.sh pipeline-2ba19  # or pass your project id explicitly
#
# It pulls the latest code, rebuilds the shared packages + web UI, redeploys the
# API container, and publishes the UI. Safe to re-run any time you ship a change.
set -euo pipefail

PNPM="corepack pnpm@10.33.0"
SERVICE="pipeline-api"     # must match the rewrite target in firebase.json
REGION="us-central1"       # ditto
PROJECT="${1:-}"           # optional Firebase/GCP project id

cd "$(dirname "$0")"

# Point BOTH halves at the same project. Without this the API (Cloud Run) would
# follow gcloud's active project, which may differ from the Firebase one.
if [ -n "$PROJECT" ]; then
  echo "▶ Targeting project: $PROJECT"
  gcloud config set project "$PROJECT" >/dev/null
fi

echo "▶ 1/5  Pulling the latest code…"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git pull origin "$BRANCH"

if [ ! -f env.yaml ]; then
  echo "✗ env.yaml not found in $(pwd)."
  echo "  It holds your secrets (DATABASE_URL, GOOGLE_*, MS_*, LOGIN_PASSPHRASE, …)"
  echo "  and is git-ignored, so it doesn't ship with the repo. Create it first —"
  echo "  see docs/DEPLOY-FIREBASE.md §4."
  exit 1
fi

echo "▶ 2/5  Installing dependencies…"
$PNPM install --filter "@pipeline/*..."

echo "▶ 3/5  Building shared packages + the web UI…"
$PNPM --filter "@pipeline/*" build

echo "▶ 4/5  Deploying the API to Cloud Run ($SERVICE / $REGION)…"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --env-vars-file env.yaml

echo "▶ 5/5  Deploying the UI to Firebase Hosting…"
[ -n "$PROJECT" ] && firebase use "$PROJECT"
firebase deploy --only hosting

echo
echo "✓ Done."
echo "  Open your site, then click  Connect ▾ → Rebuild board  once so your"
echo "  applications re-derive with the new per-message history (this is what"
echo "  powers the click-to-expand timeline and the auto Notes & Contacts)."
