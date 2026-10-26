use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClipContentType {
    PlainText,
    RichText,
    Image,
    FilePaths,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipRecord {
    pub id: i64,
    pub content_type: ClipContentType,
    pub plain_text: Option<String>,
    pub rich_text: Option<String>,
    pub summary: String,
    pub image_path: Option<String>,
    pub file_paths: Vec<String>,
    pub source_app: String,
    pub is_pinned: bool,
    pub is_truncated: bool,
    pub group_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
}

/// One row of the history list. Full text is deliberately absent: a page of fifty clips can
/// hold megabytes of text, and every refresh would serialize all of it over IPC. `preview`
/// is enough to render the card and to spot a URL or a JSON head; the full text is fetched
/// on demand through `get_clip_text`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipListItem {
    pub id: i64,
    pub content_type: ClipContentType,
    pub preview: String,
    pub preview_truncated: bool,
    /// Whether the stored text contains a link. Computed by SQL over the full text, so the
    /// menu entry survives a link that starts past the preview cut.
    pub has_url: bool,
    pub summary: String,
    pub image_path: Option<String>,
    pub file_paths: Vec<String>,
    pub source_app: String,
    pub is_pinned: bool,
    pub is_truncated: bool,
    pub group_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipGroup {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub retention_limit: i64,
    pub launch_on_startup: bool,
    pub pause_capture: bool,
    pub locale: String,
    pub accessibility_prompted: bool,
    pub close_behavior: String,
    pub panel_position: String,
    pub quick_paste: i64,
    pub url_toast: bool,
    #[serde(default)]
    pub llm_enabled: bool,
    #[serde(default)]
    pub llm_api_url: String,
    #[serde(default)]
    pub llm_api_key: String,
    #[serde(default)]
    pub llm_model: String,
    #[serde(default)]
    pub llm_ai_translate: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            retention_limit: 200,
            launch_on_startup: false,
            pause_capture: false,
            locale: "zh-CN".into(),
            accessibility_prompted: false,
            close_behavior: "hide".into(),
            panel_position: "center".into(),
            quick_paste: 0,
            url_toast: false,
            llm_enabled: false,
            llm_api_url: String::new(),
            llm_api_key: String::new(),
            llm_model: String::new(),
            llm_ai_translate: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeySetting {
    pub action_key: String,
    pub hotkey_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListClipsRequest {
    pub page: i64,
    pub page_size: i64,
    pub keyword: Option<String>,
    pub group_id: Option<i64>,
    pub pinned_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListClipsResponse {
    pub items: Vec<ClipListItem>,
    pub total: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigPayload {
    pub settings: AppSettings,
    pub hotkeys: Vec<HotkeySetting>,
}

#[derive(Debug, Clone)]
pub struct NewClipRecord {
    pub content_type: ClipContentType,
    pub plain_text: Option<String>,
    pub rich_text: Option<String>,
    pub summary: String,
    pub image_path: Option<String>,
    pub file_paths: Vec<String>,
    pub source_app: String,
    pub is_truncated: bool,
    pub content_hash: String,
}
