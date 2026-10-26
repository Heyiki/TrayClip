import { invoke } from "@tauri-apps/api/core";
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
