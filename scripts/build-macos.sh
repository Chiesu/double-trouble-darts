#!/bin/zsh
# Creates a distributable .app without installing or opening it.
# Requires macOS with Apple Command Line Tools and a local checkout of this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This build requires macOS." >&2
  exit 1
fi
if ! command -v xcrun >/dev/null 2>&1 || ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "Install Apple Command Line Tools: xcode-select --install" >&2
  exit 1
fi
for required in Mac/main.swift Mac/Info.plist Web/index.html Web/app.js Web/styles.css Web/v4.css Web/soft-sport.css Web/engine/dart-stage.js Assets/AppIcon-1024.png; do
  if [[ ! -f "$ROOT/$required" ]]; then echo "Missing: $required" >&2; exit 1; fi
done
APP="$ROOT/dist/Double Trouble Darts.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Web"
cp "$ROOT/Mac/Info.plist" "$APP/Contents/Info.plist"
cp -R "$ROOT/Web/." "$APP/Contents/Resources/Web/"
plutil -lint "$APP/Contents/Info.plist" >/dev/null
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dt-darts.XXXXXXXX")"
trap 'rm -rf "$TMP"' EXIT
ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" "$ROOT/Assets/AppIcon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$(( size * 2 ))
  sips -s format png -z "$double" "$double" "$ROOT/Assets/AppIcon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns -o "$APP/Contents/Resources/AppIcon.icns" "$ICONSET"
xcrun swiftc -O "$ROOT/Mac/main.swift" \
  -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers \
  -o "$APP/Contents/MacOS/Double Trouble Darts"
chmod +x "$APP/Contents/MacOS/Double Trouble Darts"
# Ad-hoc signing is NOT Apple Developer ID signing/notarization.
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "Built: $APP"
echo "Unsigned/not notarized for public Gatekeeper purposes (ad-hoc signed)."
