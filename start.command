#!/bin/bash
# Pipeline — one-click local launcher for macOS.
# Double-click this file in Finder. It installs everything and opens the app in
# your browser. No terminal knowledge needed. Leave the window open while you use
# the app; close it (or press Control-C) to stop.

cd "$(dirname "$0")" || exit 1

say() { printf "\n\033[1m%s\033[0m\n" "$1"; }
pnpm_run() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@10.33.0 "$@"; }

clear
echo "▦  Pipeline — starting up"
echo "   (first run takes a couple of minutes; later runs are quick)"

# 1) Node.js must be installed.
if ! command -v node >/dev/null 2>&1; then
  say "Node.js isn't installed."
  echo "   1. Go to https://nodejs.org and click the big green \"LTS\" button."
  echo "   2. Install it (just keep clicking Continue)."
  echo "   3. Double-click this start.command file again."
  echo
  read -r -p "Press Return to close this window."
  exit 1
fi
echo "   ✓ Node $(node -v) found"

# 2) Install dependencies (uses pnpm via corepack — bundled with Node, no setup).
say "Installing dependencies…"
if ! pnpm_run install --filter "@pipeline/*..."; then
  pnpm_run install || { say "Install failed — see the messages above."; read -r -p "Press Return to close."; exit 1; }
fi

# 3) Build the shared packages.
say "Building…"
pnpm_run --filter "@pipeline/*" build || { say "Build failed — see the messages above."; read -r -p "Press Return to close."; exit 1; }

# 4) Start the API and the web app in the background.
say "Starting the app…"
pnpm_run --filter @pipeline/api dev > /tmp/pipeline-api.log 2>&1 &
API_PID=$!
pnpm_run --filter @pipeline/web dev > /tmp/pipeline-web.log 2>&1 &
WEB_PID=$!

# Stop both servers when this window is closed / interrupted.
trap 'echo; echo "Stopping…"; kill "$API_PID" "$WEB_PID" 2>/dev/null; pkill -f "tsx src/server.ts" 2>/dev/null; pkill -f "vite" 2>/dev/null; exit 0' INT TERM

# 5) Wait for BOTH the API and the web server to be ready, then open the browser.
echo "   Waiting for the servers to be ready…"
READY=""
for _ in $(seq 1 120); do
  if curl -fsS http://localhost:3001/api/health >/dev/null 2>&1 && curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 1
done
if [ -z "$READY" ]; then
  say "Hmm — a server didn't come up in time. Last lines of the API log:"
  tail -n 25 /tmp/pipeline-api.log 2>/dev/null
  echo "   (You can still try the browser; if it errors, reload after a few seconds.)"
fi
open "http://localhost:5173"

say "✅ Pipeline is running →  http://localhost:5173"
echo "   Your browser should have opened. If not, visit that address."
echo "   Logs: /tmp/pipeline-api.log  and  /tmp/pipeline-web.log"
echo
echo "   ⚠️  Keep this window open. To STOP the app, close this window or press Control-C."

# Keep the launcher alive so the servers keep running.
wait
