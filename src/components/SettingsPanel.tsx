import { useEffect, useMemo, useState } from "react";
import type { AppSettings, HotkeyActionKey, HotkeySetting } from "@/lib/types";
import { useTranslation, type Locale } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { DebouncedInput } from "@/components/DebouncedInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { HotkeyRecorder, DEFAULT_HOTKEYS } from "@/components/HotkeyRecorder";
import type { QuickPasteBehavior } from "@/lib/types";

const isWindows = typeof navigator !== "undefined" && /Win/.test(navigator.platform ?? navigator.userAgent);

interface SettingsPanelProps {
  settings: AppSettings;
  hotkeys: HotkeySetting[];
  onSettingsChange: (next: AppSettings) => void;
  onHotkeyChange: (actionKey: HotkeyActionKey, hotkeyValue: string) => void;
  onBackup: () => void;
  onRestore: () => void;
  onClearHistory: () => void;
}

export function SettingsPanel({
                                settings,
                                hotkeys,
                                onSettingsChange,
                                onHotkeyChange,
                                onBackup,
                                onRestore,
                                onClearHistory,
                              }: SettingsPanelProps) {
  const { t, locale, setLocale } = useTranslation();
  const hotkeyMap = useMemo(() => new Map(hotkeys.map((h) => [h.action_key, h.hotkey_value])), [hotkeys]);
  const [retentionDraft, setRetentionDraft] = useState(() => String(settings.retention_limit));
  const quickPasteBehavior = isWindows
      ? settings.quick_paste
      : settings.quick_paste === 1
          ? 2
          : settings.quick_paste;

  useEffect(() => {
    setRetentionDraft(String(settings.retention_limit));
  }, [settings.retention_limit]);

  const retentionValue = Math.max(5, Math.min(10000, Number(retentionDraft) || 5));
  const retentionDirty = retentionValue !== settings.retention_limit;

  const applyRetentionLimit = () => {
    if (!retentionDirty) {
      setRetentionDraft(String(settings.retention_limit));
      return;
    }
    onSettingsChange({ ...settings, retention_limit: retentionValue });
  };

  return (
      <div className="flex flex-col gap-3 p-3">
        {/* Data Management */}
        <Card size="sm" className="border border-border/50 bg-card p-2.5">
          <h3 className="mb-2 border-l-2 border-foreground/10 pl-2 text-xs font-medium text-foreground/60">
            {t.dataManagement}
          </h3>

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.retentionLimit}</label>
            <div className="flex items-center gap-1.5">
              <Input
                  type="number"
                  className="w-[72px] text-right text-xs"
                  min={5}
                  max={10000}
                  value={retentionDraft}
                  onChange={(e) => setRetentionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      applyRetentionLimit();
                    } else if (e.key === "Escape") {
                      setRetentionDraft(String(settings.retention_limit));
                    }
                  }}
              />
              <Button
                  variant="outline"
                  size="sm"
                  className="px-2 text-[11px]"
                  disabled={!retentionDirty}
                  onClick={applyRetentionLimit}
              >
                {t.apply}
              </Button>
            </div>
          </div>
          <Separator />

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.pauseCapture}</label>
            <Switch
                checked={settings.pause_capture}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, pause_capture: checked })}
            />
          </div>
          <Separator />

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.copyAfterBehavior}</label>
            <Select
                value={String(quickPasteBehavior)}
                onValueChange={(v) => onSettingsChange({ ...settings, quick_paste: Number(v) as QuickPasteBehavior })}
            >
              <SelectTrigger className="w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0" className="text-xs">{t.copyAfterNone}</SelectItem>
                {isWindows ? <SelectItem value="1" className="text-xs">{t.copyAfterQuickPaste}</SelectItem> : null}
                <SelectItem value="2" className="text-xs">{t.copyAfterHideWindow}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.urlToast}</label>
            <Switch
                checked={settings.url_toast}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, url_toast: checked })}
            />
          </div>
          <Separator />

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.backupData}</label>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="text-xs" onClick={onBackup}>{t.backup}</Button>
              <Button variant="outline" size="sm" className="text-xs" onClick={onRestore}>{t.restore}</Button>
            </div>
          </div>
          <Separator />

          <div className="flex items-center justify-between py-1.5">
            <label className="text-xs text-destructive">{t.clearHistory}</label>
            <Button variant="destructive" size="sm" className="text-xs" onClick={onClearHistory}>{t.clear}</Button>
          </div>
        </Card>

        {/* AI Enhancement */}
        <Card size="sm" className="border border-border/50 bg-card p-2.5">
          <h3 className="mb-2 border-l-2 border-foreground/10 pl-2 text-xs font-medium text-foreground/60">
            {t.aiEnhancement}
          </h3>

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.enableAi}</label>
            <Switch
                checked={settings.llm_enabled}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, llm_enabled: checked })}
            />
          </div>
          <Separator />

          <div className={settings.llm_enabled ? "" : "pointer-events-none opacity-50"}>
            <div className="flex items-center justify-between py-1.5">
              <label className="text-[13px] text-foreground/80">{t.llmApiUrl}</label>
              <DebouncedInput
                  className="w-[180px] text-xs"
                  placeholder="https://api.openai.com/v1"
                  title={t.llmApiUrlHint}
                  disabled={!settings.llm_enabled}
                  value={settings.llm_api_url}
                  onChange={(v) => onSettingsChange({ ...settings, llm_api_url: v })}
              />
            </div>
            <Separator />

            <div className="flex items-center justify-between py-1.5">
              <label className="text-[13px] text-foreground/80">{t.llmApiKey}</label>
              <DebouncedInput
                  type="password"
                  className="w-[180px] text-xs"
                  placeholder="sk-..."
                  disabled={!settings.llm_enabled}
                  value={settings.llm_api_key}
                  onChange={(v) => onSettingsChange({ ...settings, llm_api_key: v })}
              />
            </div>
            <Separator />

            <div className="flex items-center justify-between py-1.5">
              <label className="text-[13px] text-foreground/80">{t.llmModel}</label>
              <DebouncedInput
                  className="w-[180px] text-xs"
                  placeholder="gpt-4o-mini"
                  disabled={!settings.llm_enabled}
                  value={settings.llm_model}
                  onChange={(v) => onSettingsChange({ ...settings, llm_model: v })}
              />
            </div>
            <Separator />

            <div className="flex items-center justify-between py-1.5">
              <label className="text-[13px] text-foreground/80">{t.aiTranslate}</label>
              <Switch
                  disabled={!settings.llm_enabled}
                  checked={settings.llm_ai_translate}
                  onCheckedChange={(checked) => onSettingsChange({ ...settings, llm_ai_translate: checked })}
              />
            </div>
          </div>
        </Card>

        {/* System Behavior */}
        <Card size="sm" className="border border-border/50 bg-card p-2.5">
          <h3 className="mb-2 border-l-2 border-foreground/10 pl-2 text-xs font-medium text-foreground/60">
            {t.systemBehavior}
          </h3>

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.launchOnStartup}</label>
            <Switch
                checked={settings.launch_on_startup}
                onCheckedChange={(checked) => onSettingsChange({ ...settings, launch_on_startup: checked })}
            />
          </div>
          <Separator />

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.closeBehavior}</label>
            <Select
                value={settings.close_behavior}
                onValueChange={(v) => onSettingsChange({ ...settings, close_behavior: v as "hide" | "exit" | "ask" })}
            >
              <SelectTrigger className="w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hide" className="text-xs">{t.hideToTrayRecommended}</SelectItem>
                <SelectItem value="exit" className="text-xs">{t.exitDirectly}</SelectItem>
                <SelectItem value="ask" className="text-xs">{t.askEveryTime}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{t.panelPosition}</label>
            <Select
                value={settings.panel_position}
                onValueChange={(v) => onSettingsChange({ ...settings, panel_position: v as "center" | "follow_mouse" })}
            >
              <SelectTrigger className="w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="center" className="text-xs">{t.centerScreen}</SelectItem>
                <SelectItem value="follow_mouse" className="text-xs">{t.followMouse}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />

          <div className="flex items-center justify-between py-1.5">
            <label className="text-[13px] text-foreground/80">{locale === "en" ? "Language" : "语言"}</label>
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger className="w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN" className="text-xs">中文</SelectItem>
                <SelectItem value="en" className="text-xs">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Hotkeys */}
        <Card size="sm" className="border border-border/50 bg-card p-2.5">
          <h3 className="mb-2 border-l-2 border-foreground/10 pl-2 text-xs font-medium text-foreground/60">
            {t.hotkeys}
          </h3>

          <div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[13px] text-foreground/80">{t.openMainWindow}</span>
              <div className="flex items-center gap-1.5">
                <HotkeyRecorder
                    actionKey="open_main_window"
                    currentValue={hotkeyMap.get("open_main_window") ?? DEFAULT_HOTKEYS.open_main_window}
                    onSave={onHotkeyChange}
                />
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-[11px] text-muted-foreground"
                    onClick={() => onHotkeyChange("open_main_window", DEFAULT_HOTKEYS.open_main_window)}
                >
                  {t.restoreDefault}
                </Button>
              </div>
            </div>
            <Separator />
          </div>
        </Card>
      </div>
  );
}
