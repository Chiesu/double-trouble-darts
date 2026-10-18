#!/bin/zsh
# Double Trouble V4. Build locally. Replace the app, NEVER the club database.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
APP_NAME="Double Trouble Darts.app"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/$APP_NAME"
DATA_DIR="$HOME/Library/Application Support/Double Trouble Darts"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/double-trouble-build.XXXXXXXX")"
trap 'rm -rf "$TMP"' EXIT
APP="$TMP/$APP_NAME"
printf '\n  DOUBLE TROUBLE 4.1 / SOFT SPORT\n'
printf '  -----------------------------------------\n\n'
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Run this installer on your Mac. The browser preview works on other systems."
  exit 1
fi
if ! command -v xcrun >/dev/null 2>&1 || ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "Apple Command Line Tools are needed once, as in V3."
  echo "Run: xcode-select --install"
  echo "After installation, run this file again."
  exit 1
fi
if pgrep -x "Double Trouble Darts" >/dev/null 2>&1 || pgrep -f "/Contents/MacOS/Double Trouble Darts([[:space:]]|$)" >/dev/null 2>&1; then
  echo "Quit Double Trouble first (Command+Q), then run this installer again."
  exit 1
fi
for required in Mac/main.swift Mac/Info.plist Web/index.html Web/app.js Web/styles.css Web/v4.css Web/soft-sport.css Web/engine/dart-stage.js Assets/AppIcon-1024.png; do
  if [[ ! -f "$ROOT/$required" ]]; then echo "Missing: $required. Extract the complete ZIP and try again."; exit 1; fi
done
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Web" "$DEST_DIR"
cp "$ROOT/Mac/Info.plist" "$APP/Contents/Info.plist"
# V4 has multiple local resources. Copy the ENTIRE Web folder, not just V3's three files.
cp -R "$ROOT/Web/." "$APP/Contents/Resources/Web/"
plutil -lint "$APP/Contents/Info.plist" >/dev/null
ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" "$ROOT/Assets/AppIcon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$(( size * 2 ))
  sips -s format png -z "$double" "$double" "$ROOT/Assets/AppIcon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns -o "$APP/Contents/Resources/AppIcon.icns" "$ICONSET"
printf '  Building the native macOS application...\n'
xcrun swiftc -O "$ROOT/Mac/main.swift" \
  -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers \
  -o "$APP/Contents/MacOS/Double Trouble Darts"
chmod +x "$APP/Contents/MacOS/Double Trouble Darts"
codesign --force --deep --sign - "$APP" >/dev/null
codesign --verify --deep --strict "$APP"
# Snapshot immediately before replacing V3. Failure to back up aborts the update.
if [[ -f "$DATA_DIR/club.json" ]]; then
  BACKUPS="$DATA_DIR/Pre-Update Backups"
  mkdir -p "$BACKUPS"
  BACKUP="$BACKUPS/club-before-V4.1-$(date +%Y%m%d-%H%M%S).json"
  cp -p "$DATA_DIR/club.json" "$BACKUP"
  printf '  Pre-update backup: %s\n' "$BACKUP"
fi
# Build/sign succeeded. Keep the previous app until the replacement is complete.
if [[ -d "$DEST" ]]; then mv "$DEST" "$TMP/Previous.app"; fi
if ! mv "$APP" "$DEST"; then
  if [[ -d "$TMP/Previous.app" ]]; then mv "$TMP/Previous.app" "$DEST"; fi
  echo "Update failed. The previous application was restored. Club data was not changed."
  exit 1
fi
printf '\n  INSTALLED: %s\n' "$DEST"
printf '  DATA: ~/Library/Application Support/Double Trouble Darts/club.json\n'
printf '  Open the app normally from now on. No server, Python, Node or internet needed.\n'
printf '  Once V4.1 opens correctly, you can delete this extracted installer folder.\n\n'
open "$DEST"
