#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
swift build -c release --package-path "$ROOT/native/StudioControl"
OUT="$ROOT/native/out"
APP="$OUT/Studio Control.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$OUT/StudioControl.iconset"
cp "$ROOT/native/StudioControl/.build/release/StudioControl" "$APP/Contents/MacOS/StudioControl"
swift "$ROOT/native/StudioControl/Icon.swift" "$OUT/icon.png"
for size in 16 32 128 256 512; do
 sips -z "$size" "$size" "$OUT/icon.png" --out "$OUT/StudioControl.iconset/icon_${size}x${size}.png" >/dev/null
 double=$((size * 2))
 sips -z "$double" "$double" "$OUT/icon.png" --out "$OUT/StudioControl.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$OUT/StudioControl.iconset" -o "$APP/Contents/Resources/StudioControl.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.agentboard.StudioControl</string>
<key>CFBundleName</key><string>Studio Control</string>
<key>CFBundleDisplayName</key><string>Studio Control</string>
<key>CFBundleExecutable</key><string>StudioControl</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>CFBundleVersion</key><string>2</string>
<key>CFBundleIconFile</key><string>StudioControl</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
codesign --verify --strict "$APP"
printf '%s\n' "$APP"
