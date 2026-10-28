import { ExternalLink, LoaderCircle } from "lucide-react";
import type { UpdateInfo } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
    update: UpdateInfo | null;
    checking: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function UpdateDialog({ update, checking, open, onOpenChange }: Props) {
    const { t } = useTranslation();
    if (!update) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 rounded-lg">
                <DialogHeader className="shrink-0 pr-6">
                    <DialogTitle className="text-sm">{t.newVersion(update.latest_version)}</DialogTitle>
                    <DialogDescription className="sr-only">{t.viewUpdate}</DialogDescription>
                </DialogHeader>
                <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words border-y border-border py-3 font-sans text-xs leading-relaxed [overflow-wrap:anywhere]">
          {update.body || t.updateNoNotes}
        </pre>
                {checking ? (
                    <div role="status" className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        {t.checking}
                    </div>
                ) : null}
                <div className="flex shrink-0 justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>{t.updateLater}</Button>
                    <Button size="sm" asChild>
                        <a href={update.download_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t.goToDownload}
                        </a>
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
