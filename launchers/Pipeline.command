#!/bin/bash
# ============================================================================
#  Pipeline — Desktop launcher (GitHub-first)
#  Double-click this file. It downloads the latest Pipeline from GitHub,
#  keeps your local copy in sync, then starts the app in your browser.
#
#  You never edit files by hand: GitHub is the source of truth. This launcher
#  is itself stored in the repo (launchers/Pipeline.command) and updates its
#  own Desktop copy on every run.
#
#  Leave the Terminal window open while you use the app. Close it to stop.
# ============================================================================

REPO_URL="https://github.com/Jvtino/Pipeline.git"
APP_DIR="$HOME/Pipeline"        # local working copy (managed automatically)
BRANCH="main"
NAME="Pipeline"

# Make common Node/Homebrew install locations visible to this script.
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$1"; }
die()  { printf "\n\033[1m%s\033[0m\n" "$1"; read -r -p "Press Return to close this window."; exit 1; }

clear
echo "▦  $NAME — starting up (everything comes from GitHub)"

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
   2. Install it (keep clicking Continue).
   3. Double-click this icon again."
fi

# 2) Download on first run; afterwards sync to the latest GitHub version.
if [ ! -d "$APP_DIR/.git" ]; then
  say "First run — downloading $NAME from GitHub…"
  git clone "$REPO_URL" "$APP_DIR" || die "Download failed — check your internet connection and try again."
fi

cd "$APP_DIR" || die "Could not open $APP_DIR."

say "Getting the latest version from GitHub…"
git fetch origin "$BRANCH" --quiet || echo "   (couldn't reach GitHub — using the copy you already have)"

if [ -z "$(git status --porcelain)" ]; then
  # Clean working copy → make it match GitHub exactly. Your secrets and data
  # (.env, accounts, local DB) are git-ignored, so they are never touched.
  git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -B "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH" --quiet && echo "   ✓ Up to date with GitHub"
else
  echo "   ⚠ You have local edits — leaving them alone and running your current copy."
fi

# 3) Keep this Desktop launcher current with the version stored in the repo.
SELF_SRC="$APP_DIR/launchers/$NAME.command"
SELF_DST="$HOME/Desktop/$NAME.command"
if [ -f "$SELF_SRC" ] && ! cmp -s "$SELF_SRC" "$SELF_DST" 2>/dev/null; then
  cp "$SELF_SRC" "$SELF_DST" 2>/dev/null && chmod +x "$SELF_DST" 2>/dev/null \
    && echo "   ✓ Updated this Desktop launcher"
fi

# 4) Hand off to the in-repo launcher, which installs, builds, and runs.
if [ -x "$APP_DIR/start.command" ]; then
  exec "$APP_DIR/start.command"
else
  die "The app's start script is missing from the download. Try double-clicking again."
fi
