#!/bin/bash
# ============================================================================
#  Pipeline — Preview launcher (macOS)
#
#  Double-click this icon. It downloads the redesigned Pipeline from GitHub,
#  starts it on your Mac, and opens it in your browser so you can look around.
#  No terminal knowledge needed. First run takes a couple of minutes; after
#  that it's quick.
#
#  Leave the little black window open while you use the app. Close it (or press
#  Control-C) to stop.
# ============================================================================

REPO_URL="https://github.com/Jvtino/Pipeline.git"
BRANCH="claude/ui-pipeline-merge-o2duyr"   # the branch with the new UI + sync
APP_DIR="$HOME/Pipeline"                    # local working copy (managed for you)
WEB_URL="http://localhost:5173"

# Make common Node/Homebrew install locations visible to this script.
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$1"; }
die()  { printf "\n\033[1m%s\033[0m\n" "$1"; read -r -p "Press Return to close this window."; exit 1; }
pnpm_run() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@10.33.0 "$@"; }

clear
echo "▦  Pipeline — opening the preview"
echo "   (first run takes a couple of minutes; later runs are quick)"

# 1) Required tools, with friendly install hints.
if ! command -v git >/dev/null 2>&1; then
  die "Git isn't installed yet.
   A box may have just popped up offering to install the Command Line Tools —
   click Install, wait for it to finish, then double-click this icon again.
   (If no box appeared, open Terminal and run:  xcode-select --install )"
fi
if ! command -v node >/dev/null 2>&1; then
  die "Node.js isn't installed.
   1. Go to https://nodejs.org and click the big green \"LTS\" button.
   2. Install it (just keep clicking Continue).
   3. Double-click this icon again."
fi
echo "   ✓ Node $(node -v) found"

# 2) Download on first run; afterwards sync to the latest version of the branch.
if [ ! -d "$APP_DIR/.git" ]; then
  if [ -e "$APP_DIR" ]; then
    die "A folder already exists at $APP_DIR but it isn't a Pipeline checkout.
   Move or rename it, then double-click this icon again."
  fi
  say "First run — downloading Pipeline from GitHub…"
  git clone "$REPO_URL" "$APP_DIR" || die "Download failed — check your internet connection and try again."
fi

cd "$APP_DIR" || die "Could not open $APP_DIR."

say "Getting the latest preview from GitHub…"
# Force this checkout ONTO the preview branch (the redesign isn't on main yet);
# handles a copy previously left on main or on an older commit.
if git fetch origin "$BRANCH" --quiet; then
  git checkout -q -B "$BRANCH" "origin/$BRANCH" 2>/dev/null || git checkout -q "$BRANCH" 2>/dev/null || true
  git reset --hard "origin/$BRANCH" --quiet 2>/dev/null
  echo "   ✓ Showing the latest preview — ${BRANCH} @ $(git rev-parse --short HEAD)"
else
  echo "   ⚠ Couldn't reach GitHub — running the copy you already have ($(git rev-parse --short HEAD 2>/dev/null))."
fi

# 3) One-time local secrets so a connected mailbox + your board survive restarts.
#    (.env is git-ignored — it's private and never committed.)
ensure_env_line() {
  local var="$1" val="$2"
  if ! grep -qE "^${var}=.+" .env 2>/dev/null; then
    grep -v -E "^${var}=" .env > .env.tmp 2>/dev/null || true
    { cat .env.tmp 2>/dev/null; echo "${var}=${val}"; } > .env
    rm -f .env.tmp
  fi
}
touch .env
ensure_env_line PIPELINE_MASTER_KEY "$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
ensure_env_line SESSION_SECRET      "$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
ensure_env_line PGLITE_DIR          "$APP_DIR/.pipeline-data"
chmod 600 .env 2>/dev/null
set -a; . ./.env; set +a   # load creds (if any) + the secrets just provisioned

# 4) Keep a copy of this launcher on the Desktop so the icon stays put.
SELF_SRC="$APP_DIR/launchers/Pipeline Preview.command"
SELF_DST="$HOME/Desktop/Pipeline Preview.command"
if [ -f "$SELF_SRC" ] && ! cmp -s "$SELF_SRC" "$SELF_DST" 2>/dev/null; then
  cp "$SELF_SRC" "$SELF_DST" 2>/dev/null && chmod +x "$SELF_DST" 2>/dev/null \
    && echo "   ✓ Put a Pipeline Preview icon on your Desktop"
fi

# 5) Install dependencies + build the shared packages.
say "Installing dependencies…"
pnpm_run install --filter "@pipeline/*..." || pnpm_run install \
  || die "Install failed — see the messages above."
say "Building…"
pnpm_run -r --filter "./packages/*" build || die "Build failed — see the messages above."

# 6) Start the API and the web app in the background.
say "Starting the app…"
pnpm_run --filter @pipeline/api dev > /tmp/pipeline-api.log 2>&1 &
API_PID=$!
pnpm_run --filter @pipeline/web dev > /tmp/pipeline-web.log 2>&1 &
WEB_PID=$!

# Stop both servers when this window is closed / interrupted.
trap 'echo; echo "Stopping…"; kill "$API_PID" "$WEB_PID" 2>/dev/null; pkill -f "tsx src/server.ts" 2>/dev/null; pkill -f "vite" 2>/dev/null; exit 0' INT TERM

# 7) Wait for BOTH servers, then open the browser.
echo "   Waiting for the servers to be ready…"
READY=""
for _ in $(seq 1 150); do
  if curl -fsS http://localhost:3001/api/health >/dev/null 2>&1 && curl -fsS "$WEB_URL/" >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 1
done
if [ -z "$READY" ]; then
  say "Hmm — a server didn't come up in time. Last lines of the API log:"
  tail -n 25 /tmp/pipeline-api.log 2>/dev/null
  echo "   (You can still try the browser; if it errors, reload after a few seconds.)"
fi
open "$WEB_URL"

say "✅ Pipeline is running →  $WEB_URL"
echo "   Your browser should have opened. If not, visit that address."
echo "   It opens on the demo board; click  Connect Outlook / Connect Gmail  to add"
echo "   your real mail (see CONNECT-MAILBOX.md for the one-time setup)."
echo
echo "   ⚠️  Keep this window open. To STOP the app, close this window or press Control-C."

# Keep the launcher alive so the servers keep running.
wait
