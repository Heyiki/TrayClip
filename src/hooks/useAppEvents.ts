import { useEffect, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { hideWindow } from "@/lib/api";
import type { AppSettings, ConfirmState } from "@/lib/types";
import { useCloseWindowAction } from "@/hooks/useCloseWindowAction";

interface UseAppEventsParams {
    loadClips: (groupId?: number | null) => Promise<void>;
    settingsRef: RefObject<AppSettings>;
    scrollRef: RefObject<HTMLDivElement | null>;
    searchInputRef: RefObject<HTMLInputElement | null>;
    focusSearch: (selectText?: boolean) => void;
    confirm: ConfirmState | null;
    activeTab: string;
    search: string;
    setSearch: (value: string) => void;
    setConfirm: (state: ConfirmState | null) => void;
    t: {
        confirmClose: string;
        hideToTray: string;
        exitApp: string;
    };
}

export function useAppEvents({
                                 loadClips,
                                 settingsRef,
                                 scrollRef,
                                 searchInputRef,
                                 focusSearch,
                                 confirm,
                                 activeTab,
                                 search,
                                 setSearch,
                                 setConfirm,
                                 t,
                             }: UseAppEventsParams) {
    // Same handler the title bar uses, so `close_behavior` means one thing everywhere.
    const handleCloseWindow = useCloseWindowAction(settingsRef, setConfirm, t);

    // Tauri event listeners
    useEffect(() => {
        const unlistens: (() => void)[] = [];
        let cancelled = false;
        const register = (fn: () => void) => {
            if (cancelled) { fn(); return; }
            unlistens.push(fn);
        };

        // Copying several items in a row fires one event each. Coalescing them keeps the
        // list from being re-queried and re-rendered for every single event.
        let refreshTimer: number | undefined;
        void listen("clips://updated", () => {
            window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => { void loadClips(); }, 200);
        }).then(register);
        void listen("focus-main-search", () => {
            scrollRef.current?.scrollTo(0, 0);
            focusSearch(true);
        }).then(register);
        void listen("close-requested", () => {
            handleCloseWindow();
        }).then(register);

        return () => {
            cancelled = true;
            window.clearTimeout(refreshTimer);
            unlistens.forEach((fn) => fn());
        };
    }, [focusSearch, handleCloseWindow, loadClips, scrollRef]);

    // Escape key handler
    useEffect(() => {
        const handleKeydown = (event: KeyboardEvent) => {
            if (confirm || activeTab !== "clips") return;
            if (event.key !== "Escape") return;
            const target = event.target as HTMLElement | null;
            const isEditable = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
            const isSearchInput = target === searchInputRef.current;
            if (isEditable && !isSearchInput) return;
            event.preventDefault();
            if (search) { setSearch(""); focusSearch(false); return; }
            void hideWindow();
        };
        window.addEventListener("keydown", handleKeydown);
        return () => window.removeEventListener("keydown", handleKeydown);
    }, [activeTab, confirm, focusSearch, search, searchInputRef, setSearch]);

    // Scroll to top on search
    useEffect(() => { scrollRef.current?.scrollTo(0, 0); }, [search, scrollRef]);
}
