import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, ExternalLink, FolderOpen, LoaderCircle, RotateCcw, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cancelOcrInstall, getOcrStatus, installOcr, isOcrInstalling, recognizeClipImage, type OcrProgress, type OcrStatus } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface OcrDialogProps {
    clipId: number;
    imagePath: string;
    onClose: () => void;
}

export function OcrDialog({ clipId, imagePath, onClose }: OcrDialogProps) {
    const { t } = useTranslation();
    const [phase, setPhase] = useState<"checking" | "download" | "installing" | "working" | "done" | "error">("checking");
    const [text, setText] = useState("");
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const [status, setStatus] = useState<OcrStatus | null>(null);
    const [progress, setProgress] = useState<OcrProgress | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const active = useRef(true);
    const busy = useRef(false);

    const run = useCallback(async () => {
        if (busy.current) return;
        busy.current = true;
        setPhase("working");
        setError("");
        try {
            const result = await recognizeClipImage(clipId, imagePath);
            if (active.current) {
                setText(result);
                setPhase("done");
            }
        } catch (reason) {
            if (active.current) {
                setError(String(reason));
                setPhase("error");
            }
        } finally {
            busy.current = false;
        }
    }, [clipId, imagePath]);

    const install = useCallback(async (offline: boolean) => {
        if (busy.current) return;
        busy.current = true;
        setError("");
        let installed = false;
        try {
            const archive = offline ? await open({ multiple: false, directory: false,
                filters: [{ name: "OCR engine", extensions: ["zip"] }] }) : null;
            if (offline && !archive) return;
            setPhase("installing");
            setProgress(null);
            await installOcr(archive, (next) => { if (active.current) setProgress(next); });
            installed = true;
        } catch (reason) {
            if (active.current) {
                setError(String(reason).includes("OCR download cancelled") ? "" : String(reason));
                setPhase("download");
                try { setStatus(await getOcrStatus()); } catch { /* Keep the previous status for retry. */ }
            }
        } finally {
            busy.current = false;
        }
        if (installed && active.current) void run();
    }, [run]);

    useEffect(() => {
        active.current = true;
        let cancelled = false;
        if (isOcrInstalling()) {
            void install(false);
        } else {
            void getOcrStatus().then((next) => {
                if (cancelled) return;
                setStatus(next);
                if (next.engine_ready && next.models_ready) void run();
                else setPhase("download");
            }).catch((reason) => {
                if (!cancelled) {
                    setError(String(reason));
                    setPhase("error");
                }
            });
        }
        return () => { cancelled = true; active.current = false; };
    }, [install, run]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setError("");
        } catch {
            setError(t.ocrCopyFailed);
        }
    };

    const downloadInBrowser = async () => {
        if (!status?.engine_url) return;
        setError("");
        try {
            await openUrl(status.engine_url);
        } catch (reason) {
            if (active.current) setError(String(reason));
        }
    };

    const cancelDownload = async () => {
        setCancelling(true);
        try {
            await cancelOcrInstall();
        } catch (reason) {
            if (active.current) setError(String(reason));
        } finally {
            if (active.current) setCancelling(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                className="max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[360px] overflow-y-auto"
                onContextMenu={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onPointerDownOutside={(event) => event.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle className="text-sm">{t.ocrTitle}</DialogTitle>
                    <DialogDescription className="sr-only">{t.ocrTitle}</DialogDescription>
                </DialogHeader>
                {phase === "checking" || phase === "working" || phase === "installing" ? (
                    <div role="status" className="space-y-2 py-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <LoaderCircle className="size-4 shrink-0 animate-spin" />
                            <span>{phase === "checking" ? t.ocrChecking : phase === "working" ? t.ocrRecognizing
                                : progress?.phase === "models" ? t.ocrDownloadingModels
                                    : progress?.phase === "verifying" ? t.ocrVerifying : t.ocrDownloading}</span>
                        </div>
                        {phase === "installing" && progress && progress.phase !== "verifying" ? (
                            <>
                                <p className="break-all text-xs">{progress.name}</p>
                                <p className="text-xs tabular-nums">{formatBytes(progress.downloaded)}
                                    {progress.total ? ` / ${formatBytes(progress.total)}` : ""}</p>
                                {progress.total ? <progress className="h-1.5 w-full" max={progress.total} value={progress.downloaded} /> : null}
                            </>
                        ) : null}
                        {phase === "installing" && progress && progress.phase !== "verifying" ? (
                            <Button size="sm" variant="outline" disabled={cancelling} onClick={() => void cancelDownload()}>
                                <X className="size-4" />{cancelling ? t.ocrCancelling : t.ocrCancelDownload}
                            </Button>
                        ) : null}
                    </div>
                ) : phase === "download" ? (
                    <>
                        <p className="text-sm text-muted-foreground">{t.ocrDownloadPrompt}</p>
                        {status?.engine_available ? (
                            <>
                                <p className="break-all text-xs text-muted-foreground">
                                    {status.engine_ready ? t.ocrEngineReady : `${t.ocrEngine}: ${status.engine_version} (${formatBytes(status.engine_bytes ?? 0)})`}
                                    <br />{t.ocrMissingModels}: {status.missing_models} ({formatBytes(status.missing_model_bytes)})
                                    {!status.engine_ready && status.engine_asset ? <><br />{status.engine_asset}</> : null}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Button size="sm" onClick={() => void install(false)}>
                                        <Download className="size-4" />{t.ocrDownload}
                                    </Button>
                                    {!status.engine_ready && status.engine_url ? <Button size="sm" variant="outline" onClick={() => void downloadInBrowser()}>
                                        <ExternalLink className="size-4" />{t.ocrBrowserDownload}
                                    </Button> : null}
                                    {!status.engine_ready ? <Button size="sm" variant="outline" onClick={() => void install(true)}>
                                        <FolderOpen className="size-4" />{t.ocrImport}
                                    </Button> : null}
                                </div>
                            </>
                        ) : <p role="alert" className="break-words text-xs text-destructive">{t.ocrUnavailable}</p>}
                    </>
                ) : phase === "done" ? (
                    <>
                        <textarea
                            aria-label={t.ocrTitle}
                            className="h-48 min-h-24 w-full resize-y rounded-md border bg-background p-2.5 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={text}
                            placeholder={t.ocrEmpty}
                            onChange={(event) => { setText(event.target.value); setCopied(false); }}
                        />
                        <Button size="sm" disabled={!text.trim()} onClick={() => void copy()}>
                            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                            {copied ? t.copiedToClipboard : t.copyResult}
                        </Button>
                    </>
                ) : (
                    <Button size="sm" variant="outline" onClick={() => void run()}>
                        <RotateCcw className="size-4" />{t.ocrRetry}
                    </Button>
                )}
                {error ? <p role="alert" className="break-words text-xs text-destructive [overflow-wrap:anywhere]">{t.ocrFailed}: {error}</p> : null}
            </DialogContent>
        </Dialog>
    );
}

function formatBytes(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
