# TrayClip Help

## Overview
TrayClip is a local clipboard manager built around history, grouping, pinning, quick search, and fast copy. It also includes theme switching, language switching, backup and restore, and optional AI enhancement settings.

## Window Operations
- Main window: open it from the system tray icon, tray menu, or a global hotkey.
- Window position: the main window can open centered on the screen or follow the mouse, based on Settings.
- Close behavior: closing the main window normally hides it to the tray, and this can be changed in Settings.

## Clipboard Records
- Auto capture: TrayClip records clipboard content automatically, including plain text, rich text, images, and file paths.
- Copy back: click the Copy button or double-click the record content area to write it back to the clipboard.
- Context menu: right-click a record for quick actions. JSON content supports formatted copy, and URLs can be opened directly.
- Pinning: pinned records are kept from auto cleanup.
- Delete: records can be removed permanently after confirmation.
- Search: the search box filters by content, source app, and file path.
- Image preview: image records show thumbnails, and image files referenced in file paths can preview too.
- Content truncation: long text is truncated and marked as truncated.

## Group Management
- New group: click the `+` button on the group bar, enter a name, and press `Enter`.
- Rename group: double-click a group tag, enter a new name, and press `Enter` to confirm or `Esc` to cancel.
- Delete group: right-click a group tag and confirm deletion. Records move back to ungrouped.
- Filter by group: click a group tag to filter records, or click `All` to show everything.
- Move to group: use the group action in a record to choose a target group.

## Keyboard Shortcuts
- Use `↑` / `↓` to select records, then press `Enter` to copy the selected item.
- Double-click the record content area to copy quickly.
- Right-click a record to open the context menu.
- `Esc` clears search first; if search is already empty, it hides the window.
- The main window auto-selects the first visible item on open, so `Enter` can copy immediately.

## Settings
- Hotkeys: customize the main window hotkey, then restore the default when needed.
- Retention limit: set the maximum number of retained records from 5 to 10000.
- Pause capture: temporarily stop clipboard capture.
- Copy after behavior: choose None, Quick paste, or Hide window. Windows shows all three options; non-Windows shows None and Hide window.
- URL toast: show a toast notification when copied content contains a URL.
- Launch on startup: start TrayClip automatically when the system starts.
- Close behavior: choose hide to tray, exit directly, or ask every time.
- Window position: choose screen center or follow mouse.
- Theme and language: switch light/dark theme and interface language from the title bar.
- Data backup: export all records, groups, and settings as a ZIP backup.
- Data restore: import a previously exported ZIP backup. This replaces all current data and restarts the app.
- Clear history: remove all non-pinned records.
- AI enhancement: configure API URL, API Key, model name, and AI translation options.

## About
The About page shows the version, storage location, supported platforms, license, and update checker.

## Files
- `README.md` and `README_ZH.md` cover the project overview and usage at a glance.
- `HELP.md` and `HELP_ZH.md` provide the full help reference for English and Chinese readers.
