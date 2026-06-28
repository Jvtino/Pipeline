#!/bin/bash
# Pipeline — save your Google OAuth credentials (double-click this in Finder).
# It asks for the two values from Google Cloud Console and writes them to a
# private .env file that start.command reads. No terminal knowledge needed.

cd "$(dirname "$0")" || exit 1
clear
echo "▦  Connect Gmail — save your Google credentials"
echo
echo "Paste two values from Google Cloud Console"
echo "(APIs & Services → Credentials → your OAuth client):"
echo "   • Client ID      — ends with .apps.googleusercontent.com"
echo "   • Client secret  — starts with GOCSPX-"
echo

printf "1) Paste your Client ID, then press Return:\n> "
read -r CID
printf "2) Paste your Client secret, then press Return:\n> "
read -r CSEC

# Trim surrounding whitespace.
CID="$(printf '%s' "$CID" | xargs)"
CSEC="$(printf '%s' "$CSEC" | xargs)"

if [ -z "$CID" ] || [ -z "$CSEC" ]; then
  echo; echo "✗ One of the values was empty — nothing saved. Double-click to try again."
  read -r -p "Press Return to close."; exit 1
fi

# Write/refresh only the Google lines in .env, preserving anything else already there.
touch .env
grep -v -E '^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET)=' .env > .env.tmp 2>/dev/null || true
{
  cat .env.tmp 2>/dev/null
  echo "GOOGLE_CLIENT_ID=$CID"
  echo "GOOGLE_CLIENT_SECRET=$CSEC"
} > .env
rm -f .env.tmp
chmod 600 .env 2>/dev/null

echo
echo "✓ Saved to .env (private — it's git-ignored, never committed)."
case "$CID" in
  *.apps.googleusercontent.com) : ;;
  *) echo "  ⚠️  A Client ID normally ends in .apps.googleusercontent.com — double-check you pasted the ID (not the secret or project id)." ;;
esac
echo
echo "Next: double-click start.command (or close its window and reopen it) to"
echo "restart the app, then click  Connect ▾  →  Connect Gmail."
echo
read -r -p "Press Return to close."
