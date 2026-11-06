# TrayClip Help

## Overview
TrayClip is a local clipboard manager built around history, grouping, pinning, quick search, and fast copy. It also includes theme switching, language switching, backup and restore, and optional AI enhancement settings.

## Window Operations
- Main window: open it from the system tray icon, tray menu, or a global hotkey.
- On launch or reopening: the clipboard list receives focus instead of the search box, so you can navigate with `↑` / `↓` immediately. Existing search text, group and type filters are preserved. Open dialogs and menus keep their focus.
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
- Rename group: right-click a group tag, choose Rename, enter a new name, then press `Enter` to confirm or `Esc` to cancel.
- Delete group: right-click a group tag, choose Delete group, and confirm. Records move back to ungrouped.
- Filter by group: click a group tag to filter records, or click `All` to show everything; `←` / `→` also switch groups.
- Move to group: use the group action in a record to choose a target group.

## Keyboard Shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Copy result 1 through 9 | `Ctrl+1` through `Ctrl+9` | `Command+1` through `Command+9` |
| Focus search and select existing search text | `Ctrl+F` | `Command+F` |
| Select a record in the list | `↑` / `↓` | `↑` / `↓` |
| Copy the selected record | `Enter` | `Enter` |
| Clear search; hide the window if search is empty | `Esc` | `Esc` |

- These are fixed, window-local shortcuts, not global hotkeys. Use them while the main window is focused and the clipboard list page is open; they do not copy records while TrayClip is hidden.
- Opening the window resets the list selection. The first `↑` or `↓` selects the first result; then `Enter` copies it. `Enter` alone does not automatically copy the first record.
- Number shortcuts follow the current list order after search, group and type filtering, including pinned records in that order. They always refer to the first nine results, not the first nine records in the scrolled viewport.
- If a numbered result does not exist, nothing is copied. Holding a number shortcut does not repeatedly copy.
- Number shortcuts also work while the search box is focused. Arrow keys remain input controls there; click the list to resume list navigation.
- Dialogs, menus and other editors, including group name editing and hotkey recording, do not trigger list-copy shortcuts. Search shortcuts do not interrupt dialogs, menus, other text editors or hotkey recording.
- Keyboard copying uses the same copy-after setting as the Copy button: None, Quick paste (Windows only), or Hide window.
- Double-click the record content area to copy quickly.
- Right-click a record to open the context menu.
- `Esc` clears search first and leaves focus in the search box; if search is already empty, it hides the window. In a dialog or editor, `Esc` follows that control's own behavior.

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
