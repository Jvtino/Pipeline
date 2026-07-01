#!/bin/zsh -l
# Pipeline — update from GitHub and run the web app. Double-click this file.
#
# Runs in a login shell so your PATH (including pnpm) is loaded. It finds the
# Pipeline repo, pulls the latest `main`, installs, builds, then starts the API
# (:3001) and web app (:5173) and opens your browser. Close the window or press
# Ctrl-C to stop.

set -u

say() { print -P "%F{cyan}$1%f"; }
die() { print -P "%F{red}$1%f"; print "Press any key to close…"; read -k1; exit 1; }

# --- locate the repo (works whether run from the repo or via a Desktop alias) ---
REPO="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [[ ! -f "$REPO/pnpm-workspace.yaml" ]]; then
  REPO="$(dirname "$(find "$HOME" -maxdepth 6 -name pnpm-workspace.yaml -path '*Pipeline*' 2>/dev/null | head -1)")"
fi
[[ -f "$REPO/pnpm-workspace.yaml" ]] || die "❌ Couldn't find your Pipeline folder. Keep this file inside it (or make a Desktop alias to it)."
cd "$REPO" || die "❌ Could not enter $REPO"
say "📁 Pipeline: $REPO"

# --- prerequisites ---
command -v git  >/dev/null 2>&1 || die "❌ git isn't installed."
command -v pnpm >/dev/null 2>&1 || die "❌ pnpm isn't installed. Run once in Terminal:  sudo corepack enable pnpm"

# --- update from GitHub (forces local to match origin/main) ---
say "⬇️  Updating from GitHub…"
if git fetch origin main --quiet && git checkout -f main --quiet 2>/dev/null && git reset --hard origin/main --quiet; then
  print "✓ Up to date with origin/main"
else
  print -P "%F{yellow}⚠️  Couldn't update (offline?) — running the version you already have.%f"
fi

# --- install + build (esbuild builds; electron is skipped — see pnpm-workspace.yaml) ---
say "📦 Installing dependencies…"
ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install || die "❌ Install failed. Copy the error above and send it over."
say "🔨 Building shared packages…"
pnpm --filter @pipeline/contracts build && pnpm --filter @pipeline/classify build || die "❌ Build failed."

# --- run: API in the background, web in the foreground, browser auto-opens ---
say "🚀 Starting Pipeline — API on :3001, web on :5173…"
pnpm --filter @pipeline/api dev &
API_PID=$!
trap 'print "Stopping…"; kill $API_PID 2>/dev/null' EXIT INT TERM
sleep 4
open "http://localhost:5173" 2>/dev/null
print -P "%F{green}✓ Opened http://localhost:5173%f  — close this window or press Ctrl-C to stop."
pnpm --filter @pipeline/web dev
