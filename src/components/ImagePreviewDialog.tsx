import { ChevronLeft, ChevronRight, Copy, Image as ImageIcon } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

interface ImagePreviewDialogProps {
    open: boolean;
    src: string | null;
    index: number;
    total: number;
    onOpenChange: (open: boolean) => void;
    onPrevious: () => void;
    onNext: () => void;
    onCopy?: () => void;
    copyError?: string | null;
}

export function ImagePreviewDialog({
                                       open,
                                       src,
                                       index,
                                       total,
                                       onOpenChange,
                                       onPrevious,
                                       onNext,
                                       onCopy,
                                       copyError,
                                   }: ImagePreviewDialogProps) {
    const { t } = useTranslation();
    const hasPrevious = index > 0;
    const hasNext = index < total - 1;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-[calc(100%-2rem)] gap-3 p-3 sm:max-w-[720px]"
                onContextMenu={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" && hasPrevious) onPrevious();
                    if (event.key === "ArrowRight" && hasNext) onNext();
                }}
            >
                <DialogTitle className="flex min-w-0 items-center gap-1.5 pr-9 text-sm">
                    <ImageIcon className="h-4 w-4" />
                    {t.imagePreview}
                    {total > 1 ? (
                        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              {t.imagePreviewCount(index + 1, total)}
            </span>
                    ) : null}
                </DialogTitle>
                <DialogDescription className="sr-only">{t.imagePreview}</DialogDescription>
                <div className="relative flex max-h-[70vh] min-h-[180px] items-center justify-center overflow-auto rounded-md bg-muted/40 p-2">
                    {src ? (
                        <img
                            src={src}
                            alt={t.imagePreview}
                            className="max-h-[66vh] max-w-full object-contain"
                        />
                    ) : (
                        <span className="text-xs text-muted-foreground">{t.imagePreviewUnavailable}</span>
                    )}
                    {hasPrevious ? (
                        <Button variant="secondary" size="icon" className="absolute left-2 top-1/2 -translate-y-1/2 shadow-sm" title={t.previousImage} aria-label={t.previousImage} onClick={onPrevious}>
                            <ChevronLeft />
                        </Button>
                    ) : null}
                    {hasNext ? (
                        <Button variant="secondary" size="icon" className="absolute right-2 top-1/2 -translate-y-1/2 shadow-sm" title={t.nextImage} aria-label={t.nextImage} onClick={onNext}>
                            <ChevronRight />
                        </Button>
                    ) : null}
                </div>
                {onCopy ? (
                    <DialogFooter className="-mx-3 -mb-3 p-3">
                        {copyError ? <span className="mr-auto text-xs text-destructive">{copyError}</span> : null}
                        <Button variant="outline" size="sm" onClick={onCopy} disabled={!src}>
                            <Copy />
                            {t.copyImage}
                        </Button>
                    </DialogFooter>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
