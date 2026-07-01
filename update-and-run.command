#!/bin/zsh -l
# Pipeline — update from GitHub and run the web app. Double-click this file.
#
# Runs in a login shell so your PATH (including pnpm) is loaded. It finds the
# Pipeline repo, pulls the latest `main`, installs, builds, then starts the API
# (:3001) and web app (:5173) and opens your browser. Close the window or press
# Ctrl-C to stop.

set -u
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0  # let corepack fetch the pinned pnpm silently (no Y/n prompt)
export ELECTRON_SKIP_BINARY_DOWNLOAD=1    # the web/API app never needs the Electron binary

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

# --- install + build ---
# pnpm is pinned (package.json "packageManager") so corepack uses a known-good
# version. If a stricter pnpm still exits non-zero purely because it SKIPPED the
# optional esbuild/electron build scripts, that's harmless for the web app — we
# continue. Any other failure triggers one clean reinstall, then gives up.
say "📦 Installing dependencies…"
LOG="${TMPDIR:-/tmp}/pipeline-install.log"
pnpm install 2>&1 | tee "$LOG"
if [[ ${pipestatus[1]} -ne 0 ]]; then
  if grep -q "ERR_PNPM_IGNORED_BUILDS" "$LOG"; then
    print -P "%F{yellow}↳ pnpm skipped optional build scripts (esbuild/electron) — harmless here, continuing.%f"
  else
    say "↳ Install hiccup — retrying with a clean install…"
    rm -rf node_modules packages/*/node_modules apps/*/node_modules
    pnpm install 2>&1 | tee "$LOG"
    [[ ${pipestatus[1]} -eq 0 ]] || die "❌ Install failed. Copy the error above and send it over."
  fi
fi
say "🔨 Building shared packages…"
# Build ALL workspace packages (pnpm resolves the dependency order). The API imports
# @pipeline/db, crypto, license, providers and sync too — not just contracts/classify —
# and each resolves to its compiled dist/. A partial build leaves the API unable to
# start: its :3001 refuses connections and the web app's /auth + /api proxy calls fail.
pnpm --filter "./packages/*" build || die "❌ Build failed."

# --- load your mailbox OAuth keys from .env (written by connect-google/outlook.command) ---
# Export ONLY the OAuth vars — deliberately NOT DATABASE_URL / PUBLIC_URL / etc.,
# so a leftover .env placeholder can't knock the app out of local (persistent) mode.
if [[ -f .env ]]; then
  loaded=""
  for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MS_CLIENT_ID MS_TENANT; do
    v="$(grep -E "^${k}=" .env | tail -1 | cut -d= -f2-)"
    if [[ -n "$v" ]]; then export "$k=$v"; loaded="$loaded $k"; fi
  done
  [[ -n "$loaded" ]] && say "🔑 Loaded mailbox keys from .env:$loaded" \
    || print -P "%F{yellow}ℹ️  No mailbox keys in .env yet — double-click connect-google.command or connect-outlook.command to add one.%f"
else
  print -P "%F{yellow}ℹ️  No .env yet — to connect real mail, double-click connect-google.command / connect-outlook.command first.%f"
fi

# --- run: API in the background, web in the foreground, browser auto-opens ---
say "🚀 Starting Pipeline — API on :3001, web on :5173…"
pnpm --filter @pipeline/api dev &
API_PID=$!
trap 'print "Stopping…"; kill $API_PID 2>/dev/null' EXIT INT TERM
sleep 4
open "http://localhost:5173" 2>/dev/null
print -P "%F{green}✓ Opened http://localhost:5173%f  — close this window or press Ctrl-C to stop."
pnpm --filter @pipeline/web dev
