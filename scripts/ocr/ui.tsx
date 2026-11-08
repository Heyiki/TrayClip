import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Channel } from "@tauri-apps/api/core";
import { OcrDialog } from "../../src/components/OcrDialog";
import { I18nProvider } from "../../src/lib/i18n";
import "../../src/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
localStorage.setItem("trayclip-locale", params.get("locale") ?? "zh-CN");
let attempts = 0;
let ready = params.has("ready");
let installing = false;
let cancelDownload: (() => void) | null = null;
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
mockIPC(async (cmd, payload) => {
    if (Array.isArray(payload) || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
        throw new Error(`Expected an object payload for ${cmd}`);
    }
    if (cmd === "get_ocr_status") return {
        engine_available: !params.has("unavailable"), engine_ready: ready || params.has("engine"),
        models_ready: ready || params.has("models"), engine_bytes: 10 * 1024 * 1024,
        missing_models: ready || params.has("models") ? 0 : 3,
        missing_model_bytes: ready || params.has("models") ? 0 : 16_189_007,
        engine_version: "0.1.0", engine_asset: "trayclip-ocr-0.1.0-test.zip",
        engine_url: params.has("unavailable") ? null : "https://github.com/Heyiki/TrayClip/releases/download/v0.3.2/trayclip-ocr-0.1.0-x86_64-pc-windows-msvc.zip",
    };
    if (cmd === "plugin:opener|open_url") {
        if (params.has("browserfail")) throw new Error("Browser unavailable");
        document.getElementById("root")!.dataset.openedUrl = String(payload?.url);
        return null;
    }
    if (cmd === "plugin:dialog|open") return params.has("cancel") ? null : "C:/offline/engine.zip";
    if (cmd === "cancel_ocr_install") {
        cancelDownload?.();
        return null;
    }
    if (cmd === "install_ocr") {
        if (installing) throw new Error("Another OCR request is running");
        installing = true;
        const root = document.getElementById("root")!;
        root.dataset.installCalls = String(Number(root.dataset.installCalls ?? 0) + 1);
        try {
            if (params.has("offline") && payload?.archivePath !== "C:/offline/engine.zip") throw new Error("Expected offline archive");
            const progress = payload?.onProgress as Channel<unknown>;
            progress.onmessage({ phase: "engine", name: "engine.zip", downloaded: 512, total: 1024 });
            if (params.has("slow") && !payload?.archivePath) await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 2000);
                cancelDownload = () => {
                    clearTimeout(timer);
                    reject(new Error("OCR download cancelled"));
                };
            });
            await pause();
            if (params.has("fail") && attempts++ === 0) throw new Error("Network unavailable");
            if (!params.has("models")) {
                progress.onmessage({ phase: "models", name: "model.onnx", downloaded: 512, total: null });
                await pause();
            }
            progress.onmessage({ phase: "verifying", name: "", downloaded: 0, total: null });
            await pause();
            ready = true;
            root.dataset.installFinished = "true";
            return null;
        } finally { installing = false; cancelDownload = null; }
    }
    if (cmd === "recognize_clip_image") {
        if (!ready) throw new Error("Components not installed");
        await pause();
        return params.has("empty") ? "" : "TrayClip \u56fe\u7247\u8bc6\u522b\nHello OCR";
    }
    throw new Error(`Unexpected command: ${cmd}`);
}, { shouldMockEvents: true });
function Fixture() {
    const [visible, setVisible] = useState(true);
    return <I18nProvider>{visible
        ? <OcrDialog clipId={1} imagePath="test.png" onClose={() => setVisible(false)} />
        : <button onClick={() => setVisible(true)}>Closed</button>
    }</I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
