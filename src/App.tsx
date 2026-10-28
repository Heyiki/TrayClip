import { useCallback, useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import {
  updateHotkey,
} from "@/lib/api";
import type { ClipGroup, ClipTypeFilter, TabKey } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { useAppData } from "@/hooks/useAppData";
import { useAppEvents } from "@/hooks/useAppEvents";
import { useCloseWindowAction } from "@/hooks/useCloseWindowAction";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { WindowBar } from "@/components/WindowBar";
import { GroupBar } from "@/components/GroupBar";
import { ClipList } from "@/components/ClipList";
import { ClipTypeToken } from "@/components/ClipTypeToken";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUpdater } from "@/hooks/useUpdater";
import { UpdateDialog } from "@/components/UpdateDialog";
import { Toast } from "@/components/ui/toast";

const APP_VERSION = import.meta.env.TAURI_ENV_VERSION ?? "0.0.0";

function AboutPanel() {
  const { t } = useTranslation();
  const [version, setVersion] = useState(APP_VERSION);
  useEffect(() => { void getVersion().then(setVersion).catch(() => {}); }, []);

  return (
      <ScrollArea className="flex-1">
        <div className="p-3">
          <Card className="border border-border/50 bg-card p-4">
            <div className="mb-3 flex justify-center">
              <img src="/logo.png" alt="TrayClip" width={64} height={64} className="rounded-xl" />
            </div>
            <h2 className="mb-1.5 text-sm font-semibold">{t.aboutTitle}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{t.aboutDesc}</p>
            <ul className="space-y-1.5 text-[13px] text-muted-foreground">
              <li>{t.aboutVersion(version)}</li>
              <li>{t.aboutStorage}</li>
              <li>{t.aboutPlatform}</li>
              <li>{t.aboutLicense}</li>
              <li>
                Github:{" "}
                <a
                    href="https://github.com/Heyiki/TrayClip"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                >
                  https://github.com/Heyiki/TrayClip
                </a>
              </li>
            </ul>
          </Card>
        </div>
      </ScrollArea>
  );
}

export default function App() {
  const { t, locale, setLocale } = useTranslation();
  const data = useAppData();
  const updater = useUpdater();
  const { confirm, setConfirm, handleConfirm, handleCancel } = useConfirmDialog();
  const handleWindowClose = useCloseWindowAction(data.settingsRef, setConfirm, t);

  // UI state
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [searchResetKey, setSearchResetKey] = useState(0);
  const previousQueryRef = useRef("");
  const [activeTab, setActiveTab] = useState<TabKey>("clips");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("trayclip-theme") as "light" | "dark") || "light";
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback((selectText = false) => {
    setActiveTab("clips");
    window.requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      if (selectText) input.select();
    });
  }, []);

  // Event listeners
  useAppEvents({
    loadClips: data.loadClips,
    settingsRef: data.settingsRef,
    scrollRef,
    searchInputRef,
    focusSearch,
    confirm,
    activeTab,
    search,
    setSearch,
    setConfirm,
    t,
  });

  // Theme sync
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("trayclip-theme", theme);
    void emit("theme://changed", theme);
  }, [theme]);

  // Search and group filtering share one backend query so a single interaction
  // cannot trigger two competing first-page requests.
  useEffect(() => {
    if (!data.loaded || !data.initialLoadDone.current) return;
    const queryKey = `${data.selectedGroupId ?? "all"}:${data.typeFilter}:${debouncedSearch}`;
    if (previousQueryRef.current === "") {
      previousQueryRef.current = queryKey;
      return;
    }
    if (previousQueryRef.current === queryKey) return;
    previousQueryRef.current = queryKey;
    void data.loadClips(data.selectedGroupId, debouncedSearch).then(() => setSearchResetKey((key) => key + 1));
  }, [data.initialLoadDone, data.loadClips, data.loaded, data.selectedGroupId, data.typeFilter, debouncedSearch]);

  // --- Confirm-based actions ---
  const removeGroup = useCallback((group: ClipGroup) => {
    setConfirm({
      message: t.confirmDeleteGroup(group.name),
      variant: "destructive",
      onConfirm: () => data.deleteGroupConfirmed(group.id),
    });
  }, [data.deleteGroupConfirmed, setConfirm, t]);

  const handleDeleteClip = useCallback((clipId: number) => {
    setConfirm({
      message: t.confirmDeleteClip,
      variant: "destructive",
      onConfirm: () => data.deleteClipConfirmed(clipId),
    });
  }, [data.deleteClipConfirmed, setConfirm, t]);

  const handleClearHistory = useCallback(() => {
    setConfirm({
      message: t.confirmClearHistory,
      variant: "destructive",
      onConfirm: () => data.clearHistoryConfirmed(),
    });
  }, [data.clearHistoryConfirmed, setConfirm, t]);

  const handleRestore = useCallback(() => {
    setConfirm({
      message: t.confirmRestore,
      confirmLabel: t.restore,
      variant: "destructive",
      onConfirm: () => data.restoreConfirmed(),
    });
  }, [data.restoreConfirmed, setConfirm, t]);

  const typeLabels: Record<ClipTypeFilter, string> = {
    all: "",
    text: t.filterText,
    image: t.contentType.image,
    file: t.filterFile,
  };
  const activeTypeLabel = typeLabels[data.typeFilter];
  const filterActive = Boolean(debouncedSearch.trim()) || data.typeFilter !== "all" || data.selectedGroupId !== null;
  const clearFilters = useCallback(() => {
    setSearch("");
    data.setTypeFilter("all");
    data.setSelectedGroupId(null);
  }, [data.setSelectedGroupId, data.setTypeFilter]);

  return (
      <main className="flex h-screen flex-col overflow-hidden rounded-xl bg-background text-foreground">
        <WindowBar
            theme={theme}
            onTabChange={setActiveTab}
            onThemeToggle={() => setTheme((th) => (th === "light" ? "dark" : "light"))}
            onLanguageToggle={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
            onClose={() => void handleWindowClose()}
            onCheckUpdate={() => void updater.check()}
            updateAvailable={Boolean(updater.update)}
            updateChecking={updater.checking}
            onDragStart={() => { data.isDragging.current = true; }}
            onDragEnd={() => { data.isDragging.current = false; }}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          {!data.loaded ? null : activeTab === "clips" ? (
              <>
                {/* Search + Groups */}
                <div className="flex-shrink-0 border-b border-border/50 bg-muted">
                  {/* The count belongs to the current query, so it rides on the search row instead
                      of costing a row of its own in a 400x500 window. */}
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-lg border border-border/60 bg-card px-1.5 transition-colors focus-within:border-primary/30">
                      <ClipTypeToken
                          value={data.typeFilter}
                          label={activeTypeLabel}
                          onChange={data.setTypeFilter}
                          onClosed={() => searchInputRef.current?.focus()}
                      />
                      <input
                          ref={searchInputRef}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder={activeTypeLabel ? t.searchInType(activeTypeLabel) : t.searchPlaceholder}
                          className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
                      />
                    </div>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                      {t.recordsCount(data.state.clips.total)}
                    </span>
                  </div>

                  <GroupBar
                      groups={data.state.groups}
                      selectedGroupId={data.selectedGroupId}
                      onSelect={data.setSelectedGroupId}
                      onCreate={(name) => void data.createGroup(name)}
                      onRename={(id, name) => void data.renameGroup(id, name)}
                      onDelete={removeGroup}
                  />
                </div>

                {/* Clip list */}
                <ClipList
                    clips={data.state.clips.items}
                    scrollResetKey={data.scrollResetKey + searchResetKey}
                    groups={data.state.groups}
                    settings={data.state.settings}
                    scrollRef={scrollRef}
                    onRecopy={data.handleRecopy}
                    onPinToggle={data.handlePinToggle}
                    onMoveGroup={data.handleMoveGroup}
                    onDelete={handleDeleteClip}
                    onLoadMore={data.loadMoreClips}
                    filtered={filterActive}
                    onClearFilters={clearFilters}
                />
              </>
          ) : null}

          {data.loaded && activeTab === "settings" ? (
              <ScrollArea className="flex-1">
                <SettingsPanel
                    settings={data.state.settings}
                    hotkeys={data.state.hotkeys}
                    onSettingsChange={data.saveSettings}
                    onHotkeyChange={(actionKey, hotkeyValue) =>
                        void updateHotkey(actionKey, hotkeyValue).then(() => data.loadConfig())
                    }
                    onBackup={() => void data.handleBackup()}
                    onRestore={() => handleRestore()}
                    onClearHistory={() => handleClearHistory()}
                />
              </ScrollArea>
          ) : null}

          {data.loaded && activeTab === "about" ? <AboutPanel /> : null}
        </div>

        <UpdateDialog
            update={updater.update}
            checking={updater.checking}
            open={updater.open}
            onOpenChange={updater.setOpen}
        />
        <Toast message={updater.notice} onDismiss={updater.dismissNotice} />
        {/* Confirm Dialog */}
        {confirm ? (
            <ConfirmDialog
                open
                message={confirm.message}
                confirmLabel={confirm.confirmLabel}
                cancelLabel={confirm.cancelLabel}
                variant={confirm.variant}
                onConfirm={() => void handleConfirm()}
                onCancel={() => void handleCancel()}
            />
        ) : null}

      </main>
  );
}
