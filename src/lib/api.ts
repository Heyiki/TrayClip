import { Channel, invoke } from "@tauri-apps/api/core";
import type { AppSettings, ClipGroup, ConfigPayload, HotkeyActionKey, HotkeySetting, ListClipsRequest, ListClipsResponse } from "./types";

export const getConfig = () => invoke<ConfigPayload>("get_config");
export const listClips = (payload: ListClipsRequest) => invoke<ListClipsResponse>("list_clips", { payload });
export const getClipText = (clipId: number) => invoke<string>("get_clip_text", { clipId });
export const listGroups = () => invoke<ClipGroup[]>("list_groups");
export const pinToggle = (clipId: number, pinned: boolean) => invoke("pin_toggle", { clipId, pinned });
export const recopyClip = (clipId: number) => invoke("recopy_clip", { clipId });
export const recopyImage = (filePath: string) => invoke("recopy_image", { filePath });
/**
 * Reports whether the webview may load this image, granting the asset protocol access when
 * the path lives outside the managed images directory. Only paths recorded in the history
 * are granted, so this cannot be used as a general file reader.
 */
export const allowImagePreview = (path: string) => invoke<boolean>("allow_image_preview", { path });
export interface OcrStatus {
  engine_available: boolean;
  engine_ready: boolean;
  models_ready: boolean;
  engine_bytes: number | null;
  missing_models: number;
  missing_model_bytes: number;
  engine_version: string | null;
  engine_asset: string | null;
  engine_url: string | null;
}
export interface OcrProgress {
  phase: "engine" | "models" | "verifying";
  name: string;
  downloaded: number;
  total: number | null;
}
export const getOcrStatus = () => invoke<OcrStatus>("get_ocr_status");
let ocrInstallPromise: Promise<void> | null = null;
let ocrInstallProgress: OcrProgress | null = null;
let reportOcrProgress: ((progress: OcrProgress) => void) | null = null;
export const isOcrInstalling = () => ocrInstallPromise !== null;
export const cancelOcrInstall = async () => {
  const installation = ocrInstallPromise;
  if (!installation) return;
  await invoke<void>("cancel_ocr_install");
  // Wait for backend cleanup and the job lock before enabling import/retry.
  await installation.catch(() => {});
};
export const installOcr = (archivePath: string | null, onProgress: (progress: OcrProgress) => void) => {
  // A reopened dialog follows the existing job instead of starting another IPC request.
  reportOcrProgress = onProgress;
  if (ocrInstallPromise) {
    if (ocrInstallProgress) onProgress(ocrInstallProgress);
    return ocrInstallPromise;
  }
  const channel = new Channel<OcrProgress>();
  channel.onmessage = (progress) => {
    ocrInstallProgress = progress;
    reportOcrProgress?.(progress);
  };
  ocrInstallPromise = invoke<void>("install_ocr", { archivePath, onProgress: channel }).finally(() => {
    ocrInstallPromise = null;
    ocrInstallProgress = null;
    reportOcrProgress = null;
  });
  return ocrInstallPromise;
};
export const recognizeClipImage = (clipId: number, imagePath: string) =>
    invoke<string>("recognize_clip_image", { clipId, imagePath });
export const saveGroup = (groupId: number | null, groupName: string) => invoke<ClipGroup>("save_group", { groupId, groupName });
export const deleteGroup = (groupId: number) => invoke("delete_group", { groupId });
export const moveClipToGroup = (clipId: number, groupId: number | null) => invoke("move_clip_to_group", { clipId, groupId });
export const deleteClip = (clipId: number) => invoke("delete_clip", { clipId });
export const clearHistory = () => invoke("clear_history");
export const updateSettings = (payload: AppSettings) => invoke<AppSettings>("update_settings", { payload });
export const updateHotkey = async (actionKey: HotkeyActionKey, hotkeyValue: string) => {
  const result = await invoke<HotkeySetting>("update_hotkey_setting", { actionKey, hotkeyValue });
  await invoke("reload_global_shortcuts");
  return result;
};
export const unregisterAllShortcuts = () => invoke("unregister_all_shortcuts");
export const reloadGlobalShortcuts = () => invoke("reload_global_shortcuts");
export const hideWindow = (pasteAfter = false) => invoke("hide_window", { pasteAfter });
export const quitApp = () => invoke("quit_app");

export interface UpdateInfo {
  has_update: boolean;
  latest_version: string;
  download_url: string;
  body: string;
}

export const checkUpdate = (currentVersion: string, installerType: string) => invoke<UpdateInfo>("check_update", { currentVersion, installerType });

export const backupData = (savePath: string) => invoke<string>("backup_data", { savePath });

export const restoreBackup = (zipPath: string) => invoke<void>("restore_backup", { zipPath });

export const bingTranslate = (text: string, from: string, to: string) => invoke<string>("bing_translate", { text, from, to });
