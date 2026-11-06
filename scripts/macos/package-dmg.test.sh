#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/package-dmg.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "SKIP: DMG integration tests require macOS and hdiutil."
    exit 0
fi

work_dir="$(mktemp -d)"
mount_dir="$work_dir/mounted"
cleanup() {
    if mountpoint_output="$(hdiutil info)" && [[ "$mountpoint_output" == *"$mount_dir"* ]]; then
        hdiutil detach "$mount_dir" >/dev/null
    fi
    rm -rf "$work_dir"
}
trap cleanup EXIT

app="$work_dir/source/TrayClip.app"
mkdir -p "$app/Contents/MacOS" "$mount_dir"
cp /usr/bin/true "$app/Contents/MacOS/TrayClip"
printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TrayClip</string>
<key>CFBundleIdentifier</key><string>com.trayclip.dmg-test</string>
<key>CFBundleName</key><string>TrayClip</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>' > "$app/Contents/Info.plist"
codesign --force --sign - "$app"
ln -s /Applications "$work_dir/source/Applications"
hdiutil create -volname TrayClip -srcfolder "$work_dir/source" \
    -format UDZO "$work_dir/TrayClip test.dmg" >/dev/null

package_dmg "$work_dir/TrayClip test.dmg" "$script_dir/README.txt"

hdiutil attach "$work_dir/TrayClip test.dmg" -readonly -nobrowse \
    -mountpoint "$mount_dir" >/dev/null
cmp "$script_dir/README.txt" "$mount_dir/README.txt"
cmp "$app/Contents/MacOS/TrayClip" "$mount_dir/TrayClip.app/Contents/MacOS/TrayClip"
[[ "$(readlink "$mount_dir/Applications")" == "/Applications" ]]
codesign --verify --deep --strict "$mount_dir/TrayClip.app"
hdiutil detach "$mount_dir" >/dev/null

cp "$work_dir/TrayClip test.dmg" "$work_dir/missing-readme.dmg"
if package_dmg "$work_dir/missing-readme.dmg" "$work_dir/missing.txt"; then
    echo "FAIL: Missing README must fail packaging." >&2
    exit 1
fi
cmp "$work_dir/TrayClip test.dmg" "$work_dir/missing-readme.dmg"
echo "PASS: README included, app signature and Applications link preserved, paths with spaces supported, failure leaves original intact."
