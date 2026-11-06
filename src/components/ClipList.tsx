import { useEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AppSettings, ClipGroup, ClipListItem } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { ClipCard } from "@/components/ClipCard";
import { Button } from "@/components/ui/button";
import { hasKeyboardOverlay, hasPrimaryModifier } from "@/lib/keyboard";

interface ClipListProps {
    clips: ClipListItem[];
    groups: ClipGroup[];
    showGroupName?: boolean;
    settings: AppSettings;
    scrollRef?: React.RefObject<HTMLDivElement | null>;
    onRecopy: (clipId: number) => void;
    onPinToggle: (clipId: number, pinned: boolean) => void;
    onMoveGroup: (clipId: number, groupId: number | null) => void;
    onDelete: (clipId: number) => void;
    onLoadMore?: () => Promise<void>;
    scrollResetKey: number;
    /** Whether a keyword, a group or a type narrows the list; drives the empty state copy. */
    filtered?: boolean;
    onClearFilters?: () => void;
}

export function ClipList({
                             clips,
                             groups,
                             showGroupName = true,
                             settings,
                             scrollRef,
                             onRecopy,
                             onPinToggle,
                             onMoveGroup,
                             onDelete,
                             onLoadMore,
                             scrollResetKey,
                             filtered = false,
                             onClearFilters,
                         }: ClipListProps) {
    const { t } = useTranslation();
    const [now, setNow] = useState(Date.now);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const selectedIndexRef = useRef(selectedIndex);
    const pendingDeltaRef = useRef(0);
    const flushRafRef = useRef(0);
    const internalRef = useRef<HTMLDivElement>(null);
    const scrollElement = scrollRef ?? internalRef;

    useEffect(() => {
        setNow(Date.now());
    }, [clips]);

    useEffect(() => {
        const refresh = () => {
            if (!document.hidden) setNow(Date.now());
        };
        const timer = window.setInterval(refresh, 60_000);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, []);

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
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
        pendingDeltaRef.current = 0;
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
            if (clips.length === 0 || e.defaultPrevented || e.isComposing || document.hidden || hasKeyboardOverlay()) return;
            const target = e.target instanceof HTMLElement ? e.target : null;
            // The type filter popup and the group strip own Enter and the arrow keys while they
            // have focus; without this the list would recopy a clip or move its selection
            // underneath them.
            if (target?.closest(
                "[data-slot='select-content'], [data-slot='select-trigger'], [data-slot='dropdown-menu-content'], "
                + "[data-slot='dropdown-menu-trigger'], [data-slot='context-menu-content'], [data-slot='group-bar']",
            )) return;
            const editable = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
            if (editable && !target?.matches("[data-clip-search]")) return;
            if (hasPrimaryModifier(e) && /^[1-9]$/.test(e.key)) {
                e.preventDefault();
                const clip = clips[Number(e.key) - 1];
                if (clip && !e.repeat) onRecopy(clip.id);
                return;
            }
            if (editable || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            // Focused row controls handle Enter themselves, independent of the arrow selection.
            if (target?.closest("[data-clip-card]") && e.key === "Enter") return;
            if (e.key === "Enter" && selectedIndexRef.current >= 0 && clips[selectedIndexRef.current]) {
                e.preventDefault();
                onRecopy(clips[selectedIndexRef.current].id);
                return;
            }
            if (!target) return;
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
            flushRafRef.current = 0;
            pendingDeltaRef.current = 0;
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
            <div ref={scrollElement} tabIndex={-1} data-clip-list className="flex w-full flex-1 flex-col items-center justify-center gap-2 p-8 outline-none">
                <p className="text-xs text-muted-foreground/40">{filtered ? t.emptyFiltered : t.emptyRecords}</p>
                {filtered && onClearFilters ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-primary hover:bg-primary/10"
                        onClick={onClearFilters}
                    >
                        {t.clearFilters}
                    </Button>
                ) : null}
            </div>
        );
    }

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <div ref={scrollElement} tabIndex={-1} data-clip-list className="w-full flex-1 overflow-y-auto outline-none">
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
                                    now={now}
                                    groups={groups}
                                    showGroupName={showGroupName}
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
