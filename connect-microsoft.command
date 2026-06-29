#!/bin/bash
# Pipeline — save your Microsoft (Outlook) OAuth credentials (double-click in Finder).
# It asks for the two values from your Azure app registration and writes them to a
# private .env file that start.command reads. No terminal knowledge needed.

cd "$(dirname "$0")" || exit 1
clear
echo "▦  Connect Outlook — save your Microsoft credentials"
echo
echo "Paste two values from the Azure portal"
echo "(App registrations → your app):"
echo "   • Application (client) ID — a long id like 11111111-2222-3333-4444-555555555555"
echo "   • Client secret VALUE     — created under Certificates & secrets (copy it immediately)"
echo

printf "1) Paste your Application (client) ID, then press Return:\n> "
read -r CID
printf "2) Paste your Client secret VALUE, then press Return:\n> "
read -r CSEC

# Trim surrounding whitespace.
CID="$(printf '%s' "$CID" | xargs)"
CSEC="$(printf '%s' "$CSEC" | xargs)"

if [ -z "$CID" ] || [ -z "$CSEC" ]; then
  echo; echo "✗ One of the values was empty — nothing saved. Double-click to try again."
  read -r -p "Press Return to close."; exit 1
fi

# Write/refresh only the Microsoft lines in .env, preserving anything else already there.
touch .env
grep -v -E '^(MS_CLIENT_ID|MS_CLIENT_SECRET)=' .env > .env.tmp 2>/dev/null || true
{
  cat .env.tmp 2>/dev/null
  echo "MS_CLIENT_ID=$CID"
  echo "MS_CLIENT_SECRET=$CSEC"
} > .env
rm -f .env.tmp
chmod 600 .env 2>/dev/null

echo
echo "✓ Saved to .env (private — it's git-ignored, never committed)."
case "$CID" in
  *-*-*-*-*) : ;;
  *) echo "  ⚠️  The Application (client) ID is normally a dashed id like 1111…-…-…-…-…555. Double-check you pasted the client ID (not the secret or directory id)." ;;
esac
echo
echo "Heads up: Azure shows the secret VALUE only once. If you copied the secret's"
echo "ID by mistake, create a new secret and re-run this."
echo
echo "Next: double-click start.command (or close its window and reopen it) to"
echo "restart the app, then click  Connect ▾  →  Connect Outlook."
echo
read -r -p "Press Return to close."
