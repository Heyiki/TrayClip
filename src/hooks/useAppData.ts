import { useCallback, useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    backupData,
    clearHistory,
    deleteClip,
    deleteGroup,
    getConfig,
    listClips,
    listGroups,
    moveClipToGroup,
    hideWindow,
    pinToggle,
    recopyClip,
    restoreBackup,
    saveGroup,
    updateSettings,
} from "@/lib/api";
import { FALLBACK_BOOTSTRAP } from "@/lib/constants";
import type { AppSettings, BootstrapPayload, ClipGroup } from "@/lib/types";

export function useAppData() {
    const [state, setState] = useState<BootstrapPayload>(FALLBACK_BOOTSTRAP);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(() => {
        const saved = localStorage.getItem("trayclip-selected-group");
        if (saved === null || saved === "null") return null;
        const n = Number(saved);
        return Number.isNaN(n) ? null : n;
    });
    const [loaded, setLoaded] = useState(false);
    const [scrollResetKey, setScrollResetKey] = useState(0);
    const initialLoadDone = useRef(false);
    const settingsRef = useRef(state.settings);
    const selectedGroupIdRef = useRef(selectedGroupId);
    const isDragging = useRef(false);
    const clipsPageRef = useRef(1);
    const clipsHasMoreRef = useRef(false);
    const clipsLoadingRef = useRef(false);
    const clipsRequestIdRef = useRef(0);
    const clipsKeywordRef = useRef("");

    // Keep refs in sync
    useEffect(() => { settingsRef.current = state.settings; }, [state.settings]);
    useEffect(() => {
        selectedGroupIdRef.current = selectedGroupId;
        localStorage.setItem("trayclip-selected-group", String(selectedGroupId));
    }, [selectedGroupId]);

    // --- Data loading ---
    const loadConfig = useCallback(async () => {
        try {
            const cfg = await getConfig();
            setState((prev) => ({ ...prev, ...cfg }));
        } catch { /* ignore */ }
    }, []);

    const loadGroups = useCallback(async () => {
        try {
            const groups = await listGroups();
            setState((prev) => ({ ...prev, groups }));
        } catch { /* ignore */ }
    }, []);

    const loadClips = useCallback(async (groupId?: number | null, keyword?: string) => {
        const requestId = ++clipsRequestIdRef.current;
        clipsLoadingRef.current = true;
        try {
            const gid = groupId === undefined ? selectedGroupIdRef.current : groupId;
            const query = keyword === undefined ? clipsKeywordRef.current : keyword.trim();
            clipsKeywordRef.current = query;
            const clips = await listClips({ page: 1, page_size: 100, keyword: query || undefined, group_id: gid ?? undefined });
            if (requestId !== clipsRequestIdRef.current) return;
            clipsPageRef.current = 1;
            clipsHasMoreRef.current = clips.has_more;
            setState((prev) => ({ ...prev, clips }));
        } catch { /* ignore */ }
        finally {
            if (requestId === clipsRequestIdRef.current) clipsLoadingRef.current = false;
        }
    }, []);

    const loadMoreClips = useCallback(async () => {
        if (clipsLoadingRef.current || !clipsHasMoreRef.current) return;
        const requestId = clipsRequestIdRef.current;
        const nextPage = clipsPageRef.current + 1;
        const gid = selectedGroupIdRef.current;
        clipsLoadingRef.current = true;
        try {
            const nextClips = await listClips({
                page: nextPage,
                page_size: 100,
                keyword: clipsKeywordRef.current || undefined,
                group_id: gid ?? undefined,
            });
            if (requestId !== clipsRequestIdRef.current) return;
            clipsPageRef.current = nextPage;
            clipsHasMoreRef.current = nextClips.has_more;
            setState((prev) => ({
                ...prev,
                clips: {
                    items: [...prev.clips.items, ...nextClips.items],
                    total: nextClips.total,
                    has_more: nextClips.has_more,
                },
            }));
        } catch { /* ignore */ }
        finally {
            if (requestId === clipsRequestIdRef.current) clipsLoadingRef.current = false;
        }
    }, []);

    const loadAll = useCallback(async () => {
        const requestId = ++clipsRequestIdRef.current;
        clipsLoadingRef.current = true;
        for (let i = 0; i < 3; i++) {
            try {
                const [cfg, groups, clips] = await Promise.all([
                    getConfig(),
                    listGroups(),
                    listClips({
                        page: 1,
                        page_size: 100,
                        keyword: clipsKeywordRef.current || undefined,
                        group_id: selectedGroupIdRef.current ?? undefined,
                    }),
                ]);
                if (requestId !== clipsRequestIdRef.current) return;
                clipsPageRef.current = 1;
                clipsHasMoreRef.current = clips.has_more;
                setState({ ...cfg, groups, clips });
                clipsLoadingRef.current = false;
                return;
            } catch {
                if (i < 2) await new Promise((r) => setTimeout(r, 100));
            }
        }
        if (requestId === clipsRequestIdRef.current) clipsLoadingRef.current = false;
    }, []);

    // Startup: load everything, then show window
    useEffect(() => {
        void loadAll().then(() => setScrollResetKey((k) => k + 1)).finally(() => {
            initialLoadDone.current = true;
            setLoaded(true);
            const win = getCurrentWindow();
            void win.show();
            void win.setFocus();
        });
    }, [loadAll]);

    // Group switch: reload clips and scroll to top
    useEffect(() => {
        if (!initialLoadDone.current) return;
        void loadClips(selectedGroupId).then(() => setScrollResetKey((k) => k + 1));
    }, [selectedGroupId, loadClips]);

    // Reload on focus
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused && initialLoadDone.current && !isDragging.current) { void loadClips().then(() => setScrollResetKey((k) => k + 1)); }
        }).then((fn) => {
            if (cancelled) { fn(); return; }
            unlisten = fn;
        });
        return () => { cancelled = true; unlisten?.(); };
    }, [loadClips]);

    // --- Settings ---
    const saveSettings = useCallback(async (next: AppSettings) => {
        try {
            setState((current) => ({ ...current, settings: next }));
            const updated = await updateSettings(next);
            setState((current) => ({ ...current, settings: updated }));
            void emit("settings://changed", updated);
        } catch (e) {
            console.error("[TrayClip] saveSettings failed:", e);
        }
    }, []);

    // --- CRUD ---
    const createGroup = useCallback(async (name: string) => {
        if (state.groups.some((g) => g.name === name)) return;
        await saveGroup(null, name);
        await loadGroups();
    }, [state.groups, loadGroups]);

    const renameGroup = useCallback(async (groupId: number, name: string) => {
        if (state.groups.some((g) => g.name === name && g.id !== groupId)) return;
        await saveGroup(groupId, name);
        await loadGroups();
    }, [state.groups, loadGroups]);

    const deleteGroupConfirmed = useCallback(async (groupId: number) => {
        await deleteGroup(groupId);
        if (selectedGroupId === groupId) setSelectedGroupId(null);
        await Promise.all([loadGroups(), loadClips()]);
    }, [selectedGroupId, loadGroups, loadClips]);

    const deleteClipConfirmed = useCallback(async (clipId: number) => {
        await deleteClip(clipId);
        await loadClips();
    }, [loadClips]);

    const clearHistoryConfirmed = useCallback(async () => {
        await clearHistory();
        await loadClips();
    }, [loadClips]);

    const handleBackup = useCallback(async () => {
        const filePath = await save({
            filters: [{ name: "ZIP", extensions: ["zip"] }],
            defaultPath: `trayclip-backup-${new Date().toISOString().slice(0, 10)}.zip`,
        });
        if (!filePath) return;
        await backupData(filePath);
    }, []);

    const restoreConfirmed = useCallback(async () => {
        const filePath = await open({
            multiple: false,
            filters: [{ name: "TrayClip Backup", extensions: ["zip"] }],
        });
        if (!filePath) return;
        await restoreBackup(filePath as string);
        await loadAll();
    }, [loadAll]);

    const handleRecopy = useCallback(async (clipId: number) => {
        await recopyClip(clipId);
        if (settingsRef.current.quick_paste === 1) {
            await hideWindow(true);
            return;
        }
        if (settingsRef.current.quick_paste === 2) {
            await hideWindow(false);
            return;
        }
        await loadClips();
    }, [loadClips, settingsRef]);

    const handlePinToggle = useCallback((clipId: number, pinned: boolean) => {
        void pinToggle(clipId, pinned).then(() => loadClips());
    }, [loadClips]);

    const handleMoveGroup = useCallback((clipId: number, groupId: number | null) => {
        void moveClipToGroup(clipId, groupId).then(() => loadClips());
    }, [loadClips]);

    return {
        state,
        selectedGroupId,
        setSelectedGroupId,
        loaded,
        scrollResetKey,
        initialLoadDone,
        settingsRef,
        isDragging,
        loadConfig,
        loadClips,
        loadMoreClips,
        loadAll,
        saveSettings,
        createGroup,
        renameGroup,
        deleteGroupConfirmed,
        deleteClipConfirmed,
        clearHistoryConfirmed,
        handleBackup,
        restoreConfirmed,
        handleRecopy,
        handlePinToggle,
        handleMoveGroup,
    };
}
