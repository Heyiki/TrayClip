# TrayClip

<div align="center">
  <img src="public/logo.png" alt="TrayClip" width="128" />
</div>

<p align="center">
  TrayClip 是一款纯本地剪贴板工具，专注于历史记录、分组、置顶、快捷键和主窗口快速调用，不依赖任何线上接口。
</p>

---

<div align="center">

[English](README.md) | 简体中文

</div>

<div align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb.svg?logo=react" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178c6.svg?logo=typescript" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-1.75-9978c6.svg?logo=rust" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-3018c6.svg?logo=tauri" />
</div>

---

## 特性

- 纯本地存储，数据保留在用户本机，不依赖云端服务
- 剪贴板历史记录，支持纯文本、富文本、图片和文件路径
- 分组管理、置顶、按历史条数自动清理
- 主窗口：支持快捷键呼出、搜索和快速复制
- 亮色 / 暗色主题切换，支持界面语言切换
- 托盘常驻，窗口关闭时可隐藏到托盘或直接退出
- 支持数据备份和恢复，便于迁移或重装
- 支持 Windows / macOS / Linux

## 设置项

- 历史记录保留条数：5 到 10000
- 暂停采集剪贴板
- 复制后行为：无 / 快捷粘贴 / 隐藏窗口
- 链接提示
- 开机自动启动
- 关闭窗口行为：隐藏到托盘 / 直接退出 / 每次询问
- 窗口呼出位置：屏幕中间 / 跟随鼠标
- AI 增强：API 地址、API Key、模型名称、AI 翻译
- 快捷键：可自定义主窗口快捷键

## 快捷键

| 功能 | Windows / Linux | macOS |
| --- | --- | --- |
| 打开主窗口 | `Ctrl+Shift+V` | `⌃+P` |

快捷键可以在设置页中重新录入。

## 帮助文档

- [HELP.md](HELP.md)
- [HELP_ZH.md](HELP_ZH.md)

## 开发环境

- Node.js 22+
- Rust 1.75+
- npm 10+

## 启动

```bash
npm install
npm run tauri:dev
```

## 构建

```bash
npm run build
npm run tauri:build
```

## 目录

- `src/` 前端界面（React + TypeScript）
- `src-tauri/` 桌面端后端（Rust + Tauri v2）

## 开源协议

[MIT](LICENSE)
