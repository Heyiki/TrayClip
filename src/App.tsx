import { useCallback, useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkUpdate,
  hideWindow,
  quitApp,
  updateHotkey,
} from "@/lib/api";
import type { ClipGroup, TabKey } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { useAppData } from "@/hooks/useAppData";
import { useAppEvents } from "@/hooks/useAppEvents";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { WindowBar } from "@/components/WindowBar";
import { GroupBar } from "@/components/GroupBar";
import { ClipList } from "@/components/ClipList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";

const APP_VERSION = import.meta.env.TAURI_ENV_VERSION ?? "0.0.0";

function AboutPanel() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{
    has_update: boolean;
    latest_version: string;
    download_url: string;
    body: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    setChecking(true);
    setResult(null);
    setError(null);
    try {
      const runtimeVersion = await getVersion();
      const info = await checkUpdate(runtimeVersion, "exe");
      setResult(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

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
              <li>{t.aboutVersion(APP_VERSION)}</li>
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
            <div className="mt-3">
              <button
                  className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  onClick={() => void handleCheck()}
                  disabled={checking}
              >
                {checking ? t.checking : t.checkUpdate}
              </button>
            </div>
            {result ? (
                <div className="mt-3">
                  {result.has_update ? (
                      <>
                        <p className="text-sm font-medium text-primary">{t.newVersion(result.latest_version)}</p>
                        {result.body ? (
                            <pre className="mt-1.5 max-h-[120px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted p-2 text-xs text-muted-foreground">
                      {result.body}
                    </pre>
                        ) : null}
                        <a
                            href={result.download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-xs text-primary hover:underline"
                        >
                          {t.goToDownload}
                        </a>
                      </>
                  ) : (
                      <p className="mt-2 text-xs text-muted-foreground">{t.upToDate}</p>
                  )}
                </div>
            ) : null}
            {error ? <p className="mt-2 text-xs text-destructive">{t.checkFailed(error)}</p> : null}
          </Card>
        </div>
      </ScrollArea>
  );
}

export default function App() {
  const { t, locale, setLocale } = useTranslation();
  const data = useAppData();
  const { confirm, setConfirm, handleConfirm, handleCancel } = useConfirmDialog();

  // UI state
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [searchResetKey, setSearchResetKey] = useState(0);
  const previousSearchRef = useRef("");
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

  // Search is performed by the backend so pagination covers all matches.
  useEffect(() => {
    if (!data.loaded || !data.initialLoadDone.current || previousSearchRef.current === debouncedSearch) return;
    previousSearchRef.current = debouncedSearch;
    void data.loadClips(data.selectedGroupId, debouncedSearch).then(() => setSearchResetKey((key) => key + 1));
  }, [data.initialLoadDone, data.loadClips, data.loaded, data.selectedGroupId, debouncedSearch]);

  // --- Confirm-based actions ---
  const handleWindowClose = useCallback(async () => {
    const behavior = data.settingsRef.current.close_behavior;
    if (behavior === "hide") { await hideWindow(); return; }
    if (behavior === "exit") { await quitApp(); return; }
    setConfirm({
      message: t.confirmClose,
      confirmLabel: t.hideToTray,
      cancelLabel: t.exitApp,
      onConfirm: async () => { await hideWindow(); },
      onCancel: async () => { await quitApp(); },
    });
  }, [data.settingsRef, setConfirm, t]);

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

  return (
      <main className="flex h-screen flex-col overflow-hidden rounded-xl bg-background text-foreground">
        <WindowBar
            theme={theme}
            onTabChange={setActiveTab}
            onThemeToggle={() => setTheme((th) => (th === "light" ? "dark" : "light"))}
            onLanguageToggle={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
            onClose={() => void handleWindowClose()}
            onDragStart={() => { data.isDragging.current = true; }}
            onDragEnd={() => { data.isDragging.current = false; }}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          {!data.loaded ? null : activeTab === "clips" ? (
              <>
                {/* Search + Groups */}
                <div className="flex-shrink-0 border-b border-border/50 bg-muted">
                  <div className="px-3 py-1.5">
                    <Input
                        ref={searchInputRef}
                        placeholder={t.searchPlaceholder}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-7 rounded-lg border border-border/60 bg-card dark:bg-card text-xs placeholder:text-muted-foreground/50 focus-visible:border-primary/30"
                    />
                  </div>

                  <GroupBar
                      groups={data.state.groups}
                      selectedGroupId={data.selectedGroupId}
                      onSelect={data.setSelectedGroupId}
                      onCreate={(name) => void data.createGroup(name)}
                      onRename={(id, name) => void data.renameGroup(id, name)}
                      onDelete={removeGroup}
                  />

                  {/* Record count */}
                  <div className="flex-shrink-0 px-3 pb-1.5">
              <span className="text-[10px] text-muted-foreground/50">
                {t.recordsCount(data.state.clips.total)}
              </span>
                  </div>
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
