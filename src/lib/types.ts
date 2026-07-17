export type ClipContentType = "plain_text" | "rich_text" | "image" | "file_paths";

export interface ClipRecord {
  id: number;
  content_type: ClipContentType;
  plain_text: string | null;
  rich_text: string | null;
  summary: string;
  image_path: string | null;
  file_paths: string[];
  source_app: string;
  is_pinned: boolean;
  is_truncated: boolean;
  group_id: number | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface ClipGroup {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export type QuickPasteBehavior = 0 | 1 | 2;

export interface AppSettings {
  retention_limit: number;
  launch_on_startup: boolean;
  pause_capture: boolean;
  locale: string;
  accessibility_prompted: boolean;
  close_behavior: "hide" | "exit" | "ask";
  panel_position: "center" | "follow_mouse";
  quick_paste: QuickPasteBehavior;
  url_toast: boolean;
  llm_enabled: boolean;
  llm_api_url: string;
  llm_api_key: string;
  llm_model: string;
  llm_ai_translate: boolean;
}

export type HotkeyActionKey = "open_main_window";

export interface HotkeySetting {
  action_key: HotkeyActionKey;
  hotkey_value: string;
}

export interface ListClipsRequest {
  page: number;
  page_size: number;
  keyword?: string;
  group_id?: number | null;
  pinned_only?: boolean;
}

export interface ListClipsResponse {
  items: ClipRecord[];
  total: number;
  has_more: boolean;
}

export interface PermissionState {
  accessibility_granted: boolean;
  accessibility_required_for_paste: boolean;
}

export interface BootstrapPayload {
  clips: ListClipsResponse;
  groups: ClipGroup[];
  settings: AppSettings;
  hotkeys: HotkeySetting[];
  permissions: PermissionState;
}

export interface ConfigPayload {
  settings: AppSettings;
  hotkeys: HotkeySetting[];
  permissions: PermissionState;
}

export type TabKey = "clips" | "settings" | "about";

export interface ConfirmState {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => Promise<void> | void;
  onCancel?: () => Promise<void> | void;
}
