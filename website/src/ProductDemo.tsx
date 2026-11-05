import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { Locale, Messages } from "./i18n";

export function ProductDemo({ t, locale, dark }: { t: Messages; locale: Locale; dark: boolean }) {
    const frame = useRef<HTMLIFrameElement>(null);
    const [notice, setNotice] = useState<"copied" | "copyFailed" | "reset" | "unavailable" | null>(null);
    const sendPreferences = useCallback(() => {
        frame.current?.contentWindow?.postMessage({ type: "trayclip-demo-preferences", locale, theme: dark ? "dark" : "light" }, location.origin);
    }, [locale, dark]);
    useEffect(() => {
        sendPreferences();
        const receive = (event: MessageEvent) => {
            if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
            if (event.data?.type === "trayclip-demo-ready") sendPreferences();
            if (event.data?.type === "trayclip-demo-status" && ["copied", "copyFailed", "reset", "unavailable"].includes(event.data.key)) setNotice(event.data.key);
        };
        window.addEventListener("message", receive);
        return () => window.removeEventListener("message", receive);
    }, [sendPreferences]);
    return <div className="demo-presentation">
        <iframe ref={frame} className="product-demo" data-theme={dark ? "dark" : "light"}
                src={`${import.meta.env.BASE_URL}demo.html`} title={t.demo.title}
                allow="clipboard-write" onLoad={sendPreferences} />
        <div className="demo-outside">
            <span role="status" aria-live="polite">{notice ? t.demo[notice] : t.demo.localOnly}</span>
            <button title={t.demo.resetAction} aria-label={t.demo.resetAction} onClick={() =>
                frame.current?.contentWindow?.postMessage({ type: "trayclip-demo-reset" }, location.origin)}><RotateCcw size={15} /></button>
        </div>
    </div>;
}
