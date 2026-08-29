import { useEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AppSettings, ClipGroup, ClipRecord } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { ClipCard } from "@/components/ClipCard";

interface ClipListProps {
    clips: ClipRecord[];
    groups: ClipGroup[];
    settings: AppSettings;
    scrollRef?: React.RefObject<HTMLDivElement | null>;
    onRecopy: (clipId: number) => void;
    onPinToggle: (clipId: number, pinned: boolean) => void;
    onMoveGroup: (clipId: number, groupId: number | null) => void;
    onDelete: (clipId: number) => void;
    onLoadMore?: () => Promise<void>;
    scrollResetKey: number;
}

export function ClipList({
                             clips,
                             groups,
                             settings,
                             scrollRef,
                             onRecopy,
                             onPinToggle,
                             onMoveGroup,
                             onDelete,
                             onLoadMore,
                             scrollResetKey,
                         }: ClipListProps) {
    const { t } = useTranslation();
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const selectedIndexRef = useRef(selectedIndex);
    const pendingDeltaRef = useRef(0);
    const flushRafRef = useRef(0);
    const internalRef = useRef<HTMLDivElement>(null);
    const scrollElement = scrollRef ?? internalRef;

    const virtualizer = useVirtualizer({
        count: clips.length,
        getScrollElement: () => scrollElement.current,
        estimateSize: () => 90,
        overscan: 5,
        measureElement: (el) => {
            const style = window.getComputedStyle(el);
            const margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
            return el.getBoundingClientRect().height + margin;
        },
    });

    useEffect(() => {
        setSelectedIndex(-1);
        selectedIndexRef.current = -1;
        virtualizer.scrollToIndex(0, { align: "start" });
    }, [scrollResetKey]);

    useEffect(() => {
        if (!onLoadMore) return;
        const element = scrollElement.current;
        if (!element) return;
        const handleScroll = () => {
            const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
            if (distanceToBottom < 240) void onLoadMore();
        };
        element.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
        return () => element.removeEventListener("scroll", handleScroll);
    }, [clips.length, onLoadMore, scrollElement]);

    useEffect(() => {
        const handleKeydown = (e: KeyboardEvent) => {
            if (clips.length === 0) return;
            if (e.key === "Enter" && selectedIndexRef.current >= 0 && clips[selectedIndexRef.current]) {
                e.preventDefault();
                onRecopy(clips[selectedIndexRef.current].id);
                return;
            }
            const target = e.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                pendingDeltaRef.current += 1;
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                pendingDeltaRef.current -= 1;
            } else {
                return;
            }
            if (!flushRafRef.current) {
                flushRafRef.current = requestAnimationFrame(() => {
                    flushRafRef.current = 0;
                    const delta = pendingDeltaRef.current;
                    pendingDeltaRef.current = 0;
                    if (delta === 0) return;
                    setSelectedIndex((prev) => {
                        const next = prev === -1 ? 0 : prev + delta;
                        const clamped = Math.max(0, Math.min(clips.length - 1, next));
                        selectedIndexRef.current = clamped;
                        virtualizer.scrollToIndex(clamped, { align: "auto" });
                        return clamped;
                    });
                });
            }
        };
        document.addEventListener("keydown", handleKeydown, true);
        return () => {
            document.removeEventListener("keydown", handleKeydown, true);
            cancelAnimationFrame(flushRafRef.current);
        };
    }, [clips, onRecopy, virtualizer]);

    const measureRef = useCallback(
        (el: HTMLDivElement | null) => {
            if (el) virtualizer.measureElement(el);
        },
        [virtualizer],
    );

    if (clips.length === 0) {
        return (
            <div className="flex w-full flex-1 flex-col items-center justify-center gap-1 p-8">
                <p className="text-xs text-muted-foreground/40">{t.emptyRecords}</p>
            </div>
        );
    }

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <div ref={scrollElement} className="w-full flex-1 overflow-y-auto">
            <div className="flex w-full flex-col gap-1.5 px-1.5 pt-1.5 pb-1.5">
                <div
                    style={{
                        height: virtualizer.getTotalSize(),
                        width: "100%",
                        position: "relative",
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                        }}
                    >
                        {virtualItems.map((virtualRow) => (
                            <div
                                key={virtualRow.key}
                                data-index={virtualRow.index}
                                ref={measureRef}
                                className="group mb-1.5"
                                data-selected={virtualRow.index === selectedIndex ? "" : undefined}
                            >
                                <ClipCard
                                    clip={clips[virtualRow.index]}
                                    selected={virtualRow.index === selectedIndex}
                                    groups={groups}
                                    settings={settings}
                                    onRecopy={onRecopy}
                                    onPinToggle={onPinToggle}
                                    onMoveGroup={onMoveGroup}
                                    onDelete={onDelete}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
