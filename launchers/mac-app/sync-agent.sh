#!/bin/zsh
# ============================================================================
#  Pipeline background-sync agent.
#
#  Run by the macOS LaunchAgent com.pipeline.sync (installed via
#  "Enable Background Sync.command"). Keeps the Pipeline API running in the
#  background so every connected mailbox is synced on a timer even when the
#  Desktop app window is closed — as long as your Mac is on and logged in.
#
#  It runs the SAME API the Desktop app uses (port 3001, the persistent PGlite
#  data dir), so exactly one process ever owns the local database: the Desktop
#  app reuses this one instead of starting its own.
#
#  It deliberately does NOT `git pull` — an unattended process must not swap its
#  own code mid-run. Updates land when you open the Desktop app (that pulls).
# ============================================================================
set -u
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
# Every 30 minutes by default; the LaunchAgent may override via the environment.
export SYNC_INTERVAL_MS="${SYNC_INTERVAL_MS:-1800000}"

REPO="${1:-$HOME/Pipeline}"
cd "$REPO" 2>/dev/null || { echo "sync-agent: no repo at $REPO"; exit 1; }

# LaunchAgents run with a bare environment — rebuild a PATH that finds node/pnpm.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/.volta/bin"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.fnm/node-versions/*/installation/bin "$HOME"/Library/Application\ Support/fnm/node-versions/*/installation/bin; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
export PATH
pnpm_run() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@10.33.0 "$@"; }

command -v node >/dev/null 2>&1 || { echo "sync-agent: node not found on PATH"; exit 1; }

# Reuse the app's local secrets + PGlite dir; create them if the app never ran.
touch .env
grep -q '^PGLITE_DIR=' .env || echo "PGLITE_DIR=$REPO/.pipeline-data" >> .env
grep -q '^PIPELINE_MASTER_KEY=' .env || echo "PIPELINE_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" >> .env
grep -q '^SESSION_SECRET=' .env || echo "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" >> .env
chmod 600 .env 2>/dev/null
set -a; . ./.env; set +a
export SYNC_INTERVAL_MS   # our interval wins even though .env doesn't define it

# Workspace packages must be built (the API imports their dist). Best-effort so
# an offline corepack fetch can't crash-loop the agent when they're already built.
pnpm_run -r --filter "./packages/*" build >/dev/null 2>&1 || true

echo "=== $(date) — Pipeline background sync starting (interval ${SYNC_INTERVAL_MS}ms) ==="
# exec so launchd tracks the API directly; KeepAlive restarts it if it ever exits.
exec pnpm_run --filter @pipeline/api start
