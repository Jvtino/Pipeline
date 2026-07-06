#!/bin/zsh
# ============================================================================
#  Turn ON always-local background sync. Double-click this once.
#
#  Installs a macOS LaunchAgent that keeps Pipeline syncing your mailboxes in
#  the background (every 30 min) whenever your Mac is on and logged in — no
#  browser window needed. Turn it off any time with "Disable Background Sync".
# ============================================================================
set -u
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

# --- locate the repo (this file may live in the repo or on the Desktop) ------
REPO="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
[ -f "$REPO/pnpm-workspace.yaml" ] || REPO="$HOME/Pipeline"
if [ ! -f "$REPO/pnpm-workspace.yaml" ]; then
  echo "❌ Couldn't find your Pipeline folder. Open the Pipeline app once first, then run this."
  echo "Press any key to close…"; read -k1 2>/dev/null || read -n1; exit 1
fi
cd "$REPO"
echo "📁 Pipeline: $REPO"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/.volta/bin"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.fnm/node-versions/*/installation/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
pnpm_run() { COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@10.33.0 "$@"; }
command -v pnpm >/dev/null 2>&1 || command -v corepack >/dev/null 2>&1 || { echo "❌ pnpm/corepack not found. Open the Pipeline app once first."; read -k1 2>/dev/null || read -n1; exit 1; }

# --- make sure the app is installed + built so the agent can start it --------
echo "⚙️  Preparing… (first time only)"
[ -d node_modules ] || pnpm_run install --filter "@pipeline/*..." || pnpm_run install
pnpm_run -r --filter "./packages/*" build || { echo "❌ Build failed — see the output above."; read -k1 2>/dev/null || read -n1; exit 1; }

AGENT="$REPO/launchers/mac-app/sync-agent.sh"
chmod +x "$AGENT"
PLIST="$HOME/Library/LaunchAgents/com.pipeline.sync.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pipeline.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>exec "$AGENT" "$REPO"</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SYNC_INTERVAL_MS</key><string>1800000</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/PipelineSync.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/PipelineSync.log</string>
</dict>
</plist>
EOF

# Load it (reload if it was already installed). launchctl load -w is the widely
# compatible path across macOS versions.
launchctl unload "$PLIST" 2>/dev/null
launchctl load -w "$PLIST" 2>/dev/null && echo "✅ Background sync is ON." || echo "⚠️  Installed, but launchctl load reported an issue — it will start at your next login."
echo "   • Syncs every 30 min while your Mac is on and logged in."
echo "   • Log: ~/Library/Logs/PipelineSync.log"
echo "   • Turn it off with \"Disable Background Sync\"."
echo "Press any key to close…"; read -k1 2>/dev/null || read -n1
