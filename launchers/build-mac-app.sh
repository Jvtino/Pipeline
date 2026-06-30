#!/bin/bash
# Assemble "Pipeline.app" (+ a Finder-friendly .zip) from the source in
# launchers/mac-app/ and the repo's logo icon (build/icon.icns). Run from the
# repo root:   bash launchers/build-mac-app.sh
# Output lands in dist-app/ (git-ignored). The .app is unsigned, so on first
# open the user right-clicks → Open once (Gatekeeper); after that it installs a
# de-quarantined copy on the Desktop and opens on a plain double-click.
set -e
cd "$(dirname "$0")/.."   # repo root

SRC="launchers/mac-app"
OUT="dist-app"
APP="$OUT/Pipeline.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$SRC/Info.plist" "$APP/Contents/Info.plist"
cp "$SRC/PipelinePreview" "$APP/Contents/MacOS/PipelinePreview"
chmod +x "$APP/Contents/MacOS/PipelinePreview"
cp "build/icon.icns" "$APP/Contents/Resources/icon.icns"

cd "$OUT"
rm -f "Pipeline.zip"
if command -v ditto >/dev/null 2>&1; then
  ditto -c -k --sequesterRsrc --keepParent "Pipeline.app" "Pipeline.zip"
else
  zip -ry "Pipeline.zip" "Pipeline.app" >/dev/null
fi
echo "Built: $OUT/Pipeline.app  and  $OUT/Pipeline.zip"
