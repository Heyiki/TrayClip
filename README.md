# TrayClip

<div align="center">
  <img src="public/logo.png" alt="TrayClip" width="128" />
</div>

<p align="center">
  TrayClip is a local-only clipboard manager focused on history, groups, pinning, hotkeys, and fast recall from the main window. No online services are required.
</p>

---

<div align="center">

English | [简体中文](README_ZH.md)

</div>

<div align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb.svg?logo=react" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178c6.svg?logo=typescript" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-1.75-9978c6.svg?logo=rust" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-3018c6.svg?logo=tauri" />
</div>

---

## Features

- Local-only storage, data stays on your machine
- Clipboard history with plain text, rich text, images, and file paths
- Group management, pinning, and auto cleanup by retention limit
- Main window: hotkey activation, search, and fast copy in one place
- Light / dark theme toggle and interface language switching
- System tray resident behavior with configurable close action
- Data backup and restore for migration or reinstall
- Supports Windows / macOS / Linux

## Settings

- Retention limit: 5 to 10000
- Pause clipboard capture
- Copy after behavior: None / Quick paste / Hide window
- URL toast
- Launch on startup
- Close behavior: hide to tray / exit directly / ask every time
- Window position: center of screen / follow mouse
- AI enhancement: API URL, API Key, model name, AI translation
- Hotkeys: customizable for the main window

## Hotkeys

| Function | Windows / Linux | macOS |
| --- | --- | --- |
| Open main window | `Ctrl+Shift+V` | `⌃+P` |

Hotkeys can be customized in Settings.

## Help

- [HELP.md](HELP.md)
- [HELP_ZH.md](HELP_ZH.md)

## Prerequisites

- Node.js 22+
- Rust 1.75+
- npm 10+

## Development

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run build
npm run tauri:build
```

## Project Structure

- `src/` Frontend (React + TypeScript)
- `src-tauri/` Desktop backend (Rust + Tauri v2)

## License

[MIT](LICENSE)
