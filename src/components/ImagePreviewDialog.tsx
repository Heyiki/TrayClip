import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Image as ImageIcon, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
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

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

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
    const [zoom, setZoom] = useState(1);
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
    const imageViewportRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
    const [dragging, setDragging] = useState(false);
    const hasPrevious = index > 0;
    const hasNext = index < total - 1;

    useEffect(() => {
        if (!open) return;
        setZoom(1);
        setImageSize(null);
    }, [open, src]);

    const changeZoom = (delta: number, anchor?: { x: number; y: number }) => {
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((zoom + delta).toFixed(2))));
        if (nextZoom === zoom) return;

        const viewport = imageViewportRef.current;
        const imageFrame = viewport?.firstElementChild as HTMLDivElement | null;
        if (!viewport || !imageFrame || !imageSize) {
            setZoom(nextZoom);
            return;
        }

        const viewportRect = viewport.getBoundingClientRect();
        const imageRect = imageFrame.getBoundingClientRect();
        const anchorX = anchor?.x ?? viewport.clientWidth / 2;
        const anchorY = anchor?.y ?? viewport.clientHeight / 2;
        const imagePointX = (anchorX - (imageRect.left - viewportRect.left)) / zoom;
        const imagePointY = (anchorY - (imageRect.top - viewportRect.top)) / zoom;

        setZoom(nextZoom);
        requestAnimationFrame(() => {
            const nextImageRect = imageFrame.getBoundingClientRect();
            viewport.scrollLeft += nextImageRect.left - viewportRect.left + imagePointX * nextZoom - anchorX;
            viewport.scrollTop += nextImageRect.top - viewportRect.top + imagePointY * nextZoom - anchorY;
        });
    };

    const endDrag = () => {
        dragRef.current = null;
        setDragging(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-[calc(100%-2rem)] gap-3 p-3 sm:max-w-[720px]"
                onContextMenu={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" && hasPrevious) onPrevious();
                    if (event.key === "ArrowRight" && hasNext) onNext();
                    if (event.key === "+" || event.key === "=") changeZoom(ZOOM_STEP);
                    if (event.key === "-") changeZoom(-ZOOM_STEP);
                    if (event.key === "0") setZoom(1);
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
                <div
                    className="relative h-[min(60vh,320px)] min-w-0 w-full overflow-hidden rounded-md bg-muted/40"
                    onWheel={(event) => {
                        if (!event.ctrlKey) return;
                        event.preventDefault();
                        const viewport = imageViewportRef.current;
                        if (!viewport) return;
                        const viewportRect = viewport.getBoundingClientRect();
                        changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, {
                            x: event.clientX - viewportRect.left,
                            y: event.clientY - viewportRect.top,
                        });
                    }}
                >
                    <div
                        ref={imageViewportRef}
                        className={`flex h-full w-full overflow-auto p-2 ${zoom > 1 ? `items-start justify-start ${dragging ? "cursor-grabbing" : "cursor-grab"}` : "items-center justify-center"}`}
                        onPointerDown={(event) => {
                            if (zoom <= 1 || event.button !== 0) return;
                            const viewport = imageViewportRef.current;
                            if (!viewport) return;
                            event.preventDefault();
                            viewport.setPointerCapture(event.pointerId);
                            dragRef.current = {
                                pointerId: event.pointerId,
                                startX: event.clientX,
                                startY: event.clientY,
                                scrollLeft: viewport.scrollLeft,
                                scrollTop: viewport.scrollTop,
                            };
                            setDragging(true);
                        }}
                        onPointerMove={(event) => {
                            const drag = dragRef.current;
                            const viewport = imageViewportRef.current;
                            if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
                            viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
                            viewport.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
                        }}
                        onPointerUp={(event) => {
                            if (dragRef.current?.pointerId !== event.pointerId) return;
                            imageViewportRef.current?.releasePointerCapture(event.pointerId);
                            endDrag();
                        }}
                        onPointerCancel={endDrag}
                    >
                        {src ? (
                            imageSize ? (
                                <div
                                    className="flex shrink-0 items-center justify-center"
                                    style={{ width: imageSize.width * zoom, height: imageSize.height * zoom }}
                                >
                                    <img
                                        src={src}
                                        alt={t.imagePreview}
                                        className="h-full w-full object-contain"
                                    />
                                </div>
                            ) : (
                                <img
                                    src={src}
                                    alt={t.imagePreview}
                                    className="max-h-full max-w-full object-contain"
                                    onLoad={(event) => {
                                        const { width, height } = event.currentTarget.getBoundingClientRect();
                                        setImageSize({ width, height });
                                    }}
                                />
                            )
                        ) : (
                            <span className="text-xs text-muted-foreground">{t.imagePreviewUnavailable}</span>
                        )}
                    </div>
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
                    {src ? (
                        <div className="absolute bottom-2 left-1/2 flex h-7 -translate-x-1/2 items-center rounded-md border bg-background/90 p-0.5 shadow-sm backdrop-blur-sm">
                            <Button variant="ghost" size="icon" className="h-6 w-6" title={t.zoomOut} aria-label={t.zoomOut} disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(-ZOOM_STEP)}>
                                <ZoomOut className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title={t.resetZoom} aria-label={t.resetZoom} disabled={zoom === 1} onClick={() => setZoom(1)}>
                                <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-10 text-center font-mono text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title={t.zoomIn} aria-label={t.zoomIn} disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(ZOOM_STEP)}>
                                <ZoomIn className="h-3.5 w-3.5" />
                            </Button>
                        </div>
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
