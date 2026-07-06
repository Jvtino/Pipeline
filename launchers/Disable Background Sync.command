#!/bin/zsh
# ============================================================================
#  Turn OFF always-local background sync. Double-click this once.
#
#  Stops and removes the LaunchAgent. Your board keeps whatever it has already
#  synced; new mail is only picked up when you open the Pipeline app. Re-enable
#  any time with "Enable Background Sync".
# ============================================================================
set -u
PLIST="$HOME/Library/LaunchAgents/com.pipeline.sync.plist"
if [ ! -f "$PLIST" ]; then
  echo "Background sync isn't installed — nothing to disable."
else
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST"
  echo "✅ Background sync is OFF. Open the Pipeline app to sync on demand."
fi
echo "Press any key to close…"; read -k1 2>/dev/null || read -n1
