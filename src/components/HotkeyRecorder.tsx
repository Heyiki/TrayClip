import { useCallback, useEffect, useRef, useState } from "react";
import type { HotkeyActionKey } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { unregisterAllShortcuts, reloadGlobalShortcuts } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);

const DEFAULT_HOTKEYS: Record<HotkeyActionKey, string> = {
  open_main_window: isMac ? "Ctrl+P" : "Ctrl+Shift+V",
};

const SPECIAL_KEYS: Record<string, string> = { " ": "Space" };

function normalizeKey(key: string): string {
  return SPECIAL_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

function formatModifiers(event: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (event.metaKey) mods.push("Meta");
  return mods;
}

function isModifierKey(key: string): boolean {
  return ["Control", "Alt", "Shift", "Meta"].includes(key);
}

const MAC_SYMBOLS: Record<string, string> = { Meta: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃", Space: "Space" };

function formatHotkeyDisplay(combo: string): string {
  if (!isMac) return combo;
  return combo.split("+").map((p) => MAC_SYMBOLS[p] ?? p).join("");
}

interface HotkeyRecorderProps {
  actionKey: HotkeyActionKey;
  currentValue: string;
  onSave: (actionKey: HotkeyActionKey, hotkeyValue: string) => void;
}

export function HotkeyRecorder({ actionKey, currentValue, onSave }: HotkeyRecorderProps) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const blurTimerRef = useRef<number | null>(null);

  const stopRecording = useCallback((reload = true) => {
    setRecording(false);
    setPreview("");
    if (reload) void reloadGlobalShortcuts();
  }, []);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
      void reloadGlobalShortcuts();
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { stopRecording(true); return; }
      if (isModifierKey(e.key)) { setPreview(formatModifiers(e).join("+") + "+"); return; }
      const parts = formatModifiers(e);
      parts.push(normalizeKey(e.key));
      const combo = parts.join("+");
      stopRecording(false);
      onSave(actionKey, combo);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recording, actionKey, onSave, stopRecording]);

  // The delay lets a click on another control land before recording ends, so the timer
  // has to survive re-renders and be cancelled when the panel closes instead.
  const handleBlur = () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = window.setTimeout(() => {
      blurTimerRef.current = null;
      stopRecording(true);
    }, 150);
  };

  return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
                className={`cursor-pointer rounded-md px-2 py-1 text-center font-mono text-[11px] transition-colors ${
                    recording
                        ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                        : "bg-muted text-foreground/70 hover:text-foreground"
                }`}
                tabIndex={0}
                onClick={() => { setRecording(true); setPreview(t.pressHotkey); void unregisterAllShortcuts(); }}
                onBlur={handleBlur}
            >
              {recording ? preview : formatHotkeyDisplay(currentValue)}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{recording ? t.pressHotkey : t.restoreDefault}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
  );
}

export { DEFAULT_HOTKEYS };
