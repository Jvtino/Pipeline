#!/bin/bash
# Pipeline — save your Microsoft (Outlook) OAuth credential (double-click in Finder).
# Outlook needs ONE value from the Azure portal: the Application (client) ID.
# There is NO secret (it's a public client). This writes it to the private .env
# file that start.command reads. No terminal knowledge needed.

cd "$(dirname "$0")" || exit 1
clear
echo "▦  Connect Outlook — save your Microsoft credential"
echo
echo "Paste one value from the Azure portal"
echo "(Microsoft Entra → App registrations → your app → Overview):"
echo "   • Application (client) ID — a UUID like 00000000-0000-0000-0000-000000000000"
echo
echo "(No client secret is needed — Outlook uses a public client.)"
echo

printf "Paste your Application (client) ID, then press Return:\n> "
read -r MID

# Trim surrounding whitespace.
MID="$(printf '%s' "$MID" | xargs)"

if [ -z "$MID" ]; then
  echo; echo "✗ Nothing pasted — nothing saved. Double-click to try again."
  read -r -p "Press Return to close."; exit 1
fi

# Write/refresh only the Microsoft line in .env, preserving anything else already there.
touch .env
grep -v -E '^MS_CLIENT_ID=' .env > .env.tmp 2>/dev/null || true
{
  cat .env.tmp 2>/dev/null
  echo "MS_CLIENT_ID=$MID"
} > .env
rm -f .env.tmp
chmod 600 .env 2>/dev/null

echo
echo "✓ Saved to .env (private — it's git-ignored, never committed)."
case "$MID" in
  *-*-*-*-*) : ;;
  *) echo "  ⚠️  A client ID is normally a UUID with dashes — double-check you pasted the Application (client) ID." ;;
esac
echo
echo "Next: double-click start.command (or close its window and reopen it) to"
echo "restart the app, then click  Connect ▾  →  Connect Outlook."
echo
read -r -p "Press Return to close."
