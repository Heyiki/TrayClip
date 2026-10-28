import type { BootstrapPayload, ClipContentType, ClipTypeFilter } from "./types";

// Mirrors `AppSettings::default()` on the Rust side; used only when the first IPC round trip
// fails, so a drifted value here is what the user sees until the next successful load.
export const FALLBACK_BOOTSTRAP: BootstrapPayload = {
    clips: { items: [], total: 0, has_more: false },
    groups: [],
    settings: {
        retention_limit: 200,
        launch_on_startup: false,
        pause_capture: false,
        locale: "zh-CN",
        accessibility_prompted: false,
        close_behavior: "hide",
        panel_position: "center",
        quick_paste: 0,
        url_toast: false,
        llm_enabled: false,
        llm_api_url: "",
        llm_api_key: "",
        llm_model: "",
        llm_ai_translate: false,
    },
    hotkeys: [],
};

/**
 * Maps the header's type filter onto the stored `content_type` values. `all` sends nothing, and
 * "text" needs two values because plain and rich text are stored separately.
 */
export const CLIP_TYPE_FILTER_VALUES: Record<ClipTypeFilter, ClipContentType[] | undefined> = {
    all: undefined,
    text: ["plain_text", "rich_text"],
    image: ["image"],
    file: ["file_paths"],
};
