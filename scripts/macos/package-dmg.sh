#!/usr/bin/env bash
set -euo pipefail

package_dmg() (
    set -euo pipefail
    local dmg="$1" readme="$2"
    if [[ ! -f "$dmg" || ! -f "$readme" ]]; then
        echo "DMG or installation README not found." >&2
        exit 1
    fi

    local work_dir mount_dir mounted=false
    work_dir="$(mktemp -d)"
    mount_dir="$work_dir/mounted"
    cleanup() {
        if [[ "$mounted" == true ]]; then
            hdiutil detach "$mount_dir" >/dev/null || true
        fi
        rm -rf "$work_dir"
    }
    trap cleanup EXIT
    mkdir "$mount_dir"

    # Work on a copy so packaging or verification failures leave the original intact.
    hdiutil convert "$dmg" -format UDRW -o "$work_dir/editable.dmg" >/dev/null
    hdiutil attach "$work_dir/editable.dmg" -nobrowse -noautoopen \
        -mountpoint "$mount_dir" >/dev/null
    mounted=true
    cp "$readme" "$mount_dir/README.txt"
    osascript - "$mount_dir" <<'APPLESCRIPT'
on run argv
    set dmgFolder to POSIX file (item 1 of argv) as alias
    tell application "Finder"
        open dmgFolder
        set dmgWindow to container window of dmgFolder
        set current view of dmgWindow to icon view
        set bounds of dmgWindow to {200, 120, 860, 560}
        set arrangement of icon view options of dmgWindow to not arranged
        set icon size of icon view options of dmgWindow to 64
        set position of item "TrayClip.app" of dmgFolder to {180, 150}
        set position of item "Applications" of dmgFolder to {480, 150}
        set position of item "README.txt" of dmgFolder to {330, 300}
        update dmgFolder without registering applications
        close dmgWindow
    end tell
end run
APPLESCRIPT
    sync
    hdiutil detach "$mount_dir" >/dev/null
    mounted=false
    hdiutil convert "$work_dir/editable.dmg" -format UDZO \
        -o "$work_dir/final.dmg" >/dev/null

    hdiutil attach "$work_dir/final.dmg" -readonly -nobrowse -noautoopen \
        -mountpoint "$mount_dir" >/dev/null
    mounted=true
    cmp "$readme" "$mount_dir/README.txt"
    [[ -d "$mount_dir/TrayClip.app" ]]
    [[ "$(readlink "$mount_dir/Applications")" == "/Applications" ]]
    codesign --verify --deep --strict "$mount_dir/TrayClip.app"
    hdiutil detach "$mount_dir" >/dev/null
    mounted=false
    mv -f "$work_dir/final.dmg" "$dmg"
    echo "Added and verified README.txt in $dmg"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    if [[ "$(uname -s)" != "Darwin" || "${1:-}" != "build" ]]; then
        echo "This wrapper is only for macOS Tauri release builds." >&2
        exit 1
    fi
    target=""
    previous=""
    for argument in "$@"; do
        if [[ "$previous" == "--target" ]]; then target="$argument"; fi
        case "$argument" in --target=*) target="${argument#--target=}" ;; esac
        previous="$argument"
    done
    case "$target" in
        aarch64-apple-darwin|x86_64-apple-darwin) ;;
        *) echo "Unsupported macOS target: $target" >&2; exit 1 ;;
    esac
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$script_dir/../.."
    npm run tauri -- "$@"
    shopt -s nullglob
    dmgs=("src-tauri/target/$target/release/bundle/dmg/"*.dmg)
    if [[ "${#dmgs[@]}" != 1 ]]; then
        echo "Expected exactly one DMG for $target; found ${#dmgs[@]}." >&2
        exit 1
    fi
    package_dmg "${dmgs[0]}" "$script_dir/README.txt"
fi
