import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LLMResultDialogProps {
    loading: boolean;
    action: string;
    result: string | null;
    error: string | null;
    onCopy: () => void;
    onClose: () => void;
}

export function LLMResultDialog({
                                    loading,
                                    action,
                                    result,
                                    error,
                                    onCopy,
                                    onClose,
                                }: LLMResultDialogProps) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        onCopy();
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-[360px]" onContextMenu={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="text-sm">{t.aiResult}</DialogTitle>
                    <DialogDescription className="sr-only">{t.aiResult}</DialogDescription>
                </DialogHeader>

                {loading ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                        {action ? `${action}...` : t.aiProcessing}
                    </p>
                ) : error ? (
                    <p className="py-4 text-sm text-destructive">{error}</p>
                ) : (
                    <ScrollArea className="max-h-[200px]">
            <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted p-2.5 font-sans text-xs leading-relaxed">
              {result}
            </pre>
                    </ScrollArea>
                )}

                <p className="text-center text-[11px] text-muted-foreground">{t.aiDisclaimer}</p>

                {!loading && !error && result ? (
                    <Button
                        size="sm"
                        className="w-full"
                        onClick={handleCopy}
                    >
                        {copied ? (
                            <><Check className="mr-1.5 h-3.5 w-3.5" /> {t.copiedToClipboard}</>
                        ) : (
                            <><Copy className="mr-1.5 h-3.5 w-3.5" /> {t.copyResult}</>
                        )}
                    </Button>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
