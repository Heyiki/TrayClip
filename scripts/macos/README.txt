TrayClip - macOS 安装说明 / Installation Help
===========================================

简体中文
--------
1. 将 TrayClip.app 拖入 Applications（应用程序），再从应用程序中打开。
2. 请根据 Mac 处理器选择安装包：Apple Silicon 使用 aarch64，Intel 使用 x64。

当前安装包使用临时签名，尚未经过 Apple Developer ID 签名和公证，
首次打开时可能提示“无法验证开发者”或“Apple 无法检查其是否包含恶意软件”。

仅在确认安装包来自 https://github.com/Heyiki/TrayClip/releases 且可信时：
先尝试打开一次，再进入“系统设置 > 隐私与安全性”，选择“仍要打开”。

也可以在 Mac 的“终端”中逐行执行：

xattr -r -d com.apple.quarantine "/Applications/TrayClip.app"
open "/Applications/TrayClip.app"

上述路径假定应用已安装到系统的“应用程序”目录；安装到其他位置时请修改路径。
此命令只移除 TrayClip 的下载隔离标记，不会补充签名或证明应用安全。
不需要关闭系统的 Gatekeeper，也不要对其他目录批量执行。
如果提示“会损害你的电脑”、检测到恶意软件或移除标记后仍无法打开，
请停止操作并通过 GitHub Issues 反馈，不要继续绕过安全检查。

English
-------
1. Drag TrayClip.app into Applications, then open it from Applications.
2. Choose aarch64 for Apple Silicon or x64 for an Intel Mac.

This build is ad-hoc signed, without Apple Developer ID signing or notarization.
On first launch, macOS may report an unidentified developer or say that Apple
cannot check the app for malicious software.

Only proceed if you trust the installer and downloaded it from:
https://github.com/Heyiki/TrayClip/releases
Try opening the app once, then go to System Settings > Privacy & Security
and choose Open Anyway.

Alternatively, run these commands one at a time in Terminal on your Mac:

xattr -r -d com.apple.quarantine "/Applications/TrayClip.app"
open "/Applications/TrayClip.app"

These paths assume the app is installed in the system Applications folder.
Adjust them if you installed it elsewhere.
The command only removes TrayClip's download quarantine flag. It does not
sign the app or verify its safety. Do not disable Gatekeeper system-wide
or run the command against other directories.
If macOS says the app will damage your computer, detects malware, or the app
still cannot open, stop and report the issue on GitHub instead of bypassing
further security checks.

https://github.com/Heyiki/TrayClip/issues
