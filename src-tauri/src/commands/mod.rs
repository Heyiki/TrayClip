use std::io::{Read as _, Write as _};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{app_state::AppState, clipboard, db, models::{AppSettings, BootstrapPayload, ClipGroup, ConfigPayload, HotkeySetting, ListClipsRequest, ListClipsResponse, PermissionState}};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, KEYEVENTF_KEYUP, VK_CONTROL,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

fn runtime_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(target_os = "windows")]
fn resolve_hide_window_action(paste_after: bool, previous_hwnd: usize) -> Option<usize> {
    if paste_after && previous_hwnd != 0 {
        return Some(previous_hwnd);
    }
    None
}

fn recopy_clip_impl(state: &State<'_, AppState>, clip_id: i64) -> Result<(), String> {
    let record = {
        let conn = state.pool.get().map_err(runtime_error)?;
        let record = db::get_clip_by_id(&conn, clip_id).map_err(runtime_error)?;
        db::mark_clip_used(&conn, clip_id).map_err(runtime_error)?;
        record
    };
    #[cfg(target_os = "linux")]
    {
        let mut cb = state.clipboard.lock();
        clipboard::write_clipboard_with_state(&record, &mut cb).map_err(runtime_error)
    }
    #[cfg(not(target_os = "linux"))]
    {
        clipboard::write_clipboard(&record).map_err(runtime_error)
    }
}

#[tauri::command]
pub fn get_bootstrap(state: State<'_, AppState>, group_id: Option<i64>) -> Result<BootstrapPayload, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    let clips = db::list_clips(&conn, &ListClipsRequest { page: 1, page_size: 100, keyword: None, group_id, pinned_only: Some(false) }).map_err(runtime_error)?;
    let groups = db::list_groups(&conn).map_err(runtime_error)?;
    let settings = db::load_settings(&conn).map_err(runtime_error)?;
    let hotkeys = db::list_hotkeys(&conn).map_err(runtime_error)?;
    let permissions = state.permissions.read().clone();

    Ok(BootstrapPayload { clips, groups, settings, hotkeys, permissions })
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<ConfigPayload, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    let settings = db::load_settings(&conn).map_err(runtime_error)?;
    let hotkeys = db::list_hotkeys(&conn).map_err(runtime_error)?;
    let permissions = state.permissions.read().clone();
    Ok(ConfigPayload { settings, hotkeys, permissions })
}

#[tauri::command]
pub fn list_clips(state: State<'_, AppState>, payload: ListClipsRequest) -> Result<ListClipsResponse, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::list_clips(&conn, &payload).map_err(runtime_error)
}

#[tauri::command]
pub fn list_groups(state: State<'_, AppState>) -> Result<Vec<ClipGroup>, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::list_groups(&conn).map_err(runtime_error)
}

#[tauri::command]
pub fn recopy_clip(state: State<'_, AppState>, clip_id: i64) -> Result<(), String> {
    recopy_clip_impl(&state, clip_id)
}

#[tauri::command]
pub fn recopy_image(state: State<'_, AppState>, file_path: String) -> Result<(), String> {
    #[cfg(not(target_os = "linux"))]
    let _ = &state;

    #[cfg(target_os = "linux")]
    {
        let mut cb = state.clipboard.lock();
        clipboard::write_image_path_with_state(&file_path, &mut cb).map_err(runtime_error)
    }
    #[cfg(not(target_os = "linux"))]
    {
        clipboard::write_image_path(&file_path).map_err(runtime_error)
    }
}

#[tauri::command]
pub fn pin_toggle(state: State<'_, AppState>, clip_id: i64, pinned: bool) -> Result<(), String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::pin_toggle(&conn, clip_id, pinned).map_err(runtime_error)
}

#[tauri::command]
pub fn save_group(state: State<'_, AppState>, group_id: Option<i64>, group_name: String) -> Result<ClipGroup, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::save_group(&conn, group_id, group_name.trim()).map_err(runtime_error)
}

#[tauri::command]
pub fn delete_group(state: State<'_, AppState>, group_id: i64) -> Result<(), String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::delete_group(&conn, group_id).map_err(runtime_error)
}

#[tauri::command]
pub fn move_clip_to_group(state: State<'_, AppState>, clip_id: i64, group_id: Option<i64>) -> Result<(), String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::move_clip_to_group(&conn, clip_id, group_id).map_err(runtime_error)
}

#[tauri::command]
pub fn delete_clip(state: State<'_, AppState>, app: AppHandle, clip_id: i64) -> Result<(), String> {
    let image_path = {
        let conn = state.pool.get().map_err(runtime_error)?;
        db::delete_clip(&conn, clip_id).map_err(runtime_error)?
    };
    if let Some(path) = image_path {
        let _ = std::fs::remove_file(path);
    }
    let _ = app.emit("clips://updated", ());
    Ok(())
}

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let images = {
        let conn = state.pool.get().map_err(runtime_error)?;
        db::clear_history(&conn).map_err(runtime_error)?
    };
    for path in images {
        let _ = std::fs::remove_file(path);
    }
    let _ = app.emit("clips://updated", ());
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::load_settings(&conn).map_err(runtime_error)
}

#[tauri::command]
pub fn update_settings(app: AppHandle, state: State<'_, AppState>, payload: AppSettings) -> Result<AppSettings, String> {
    let (next_settings, removed_images) = {
        let conn = state.pool.get().map_err(runtime_error)?;
        db::save_settings(&conn, &payload).map_err(runtime_error)?
    };
    for path in removed_images {
        let _ = std::fs::remove_file(path);
    }
    // Sync launch_on_startup to OS autostart
    {
        let launch = app.autolaunch();
        let want = next_settings.launch_on_startup;
        let current = launch.is_enabled().unwrap_or(false);
        if want && !current {
            let _ = launch.enable().map_err(|e| eprintln!("[autostart] enable failed: {}", e));
        } else if !want && current {
            let _ = launch.disable().map_err(|e| eprintln!("[autostart] disable failed: {}", e));
        }
    }
    *state.settings.write() = next_settings.clone();
    let _ = app.emit("clips://updated", ());
    Ok(next_settings)
}

#[tauri::command]
pub fn get_hotkeys(state: State<'_, AppState>) -> Result<Vec<HotkeySetting>, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::list_hotkeys(&conn).map_err(runtime_error)
}

#[tauri::command]
pub fn update_hotkey_setting(state: State<'_, AppState>, action_key: String, hotkey_value: String) -> Result<HotkeySetting, String> {
    if action_key != "open_main_window" {
        return Err("unsupported hotkey action".into());
    }
    let conn = state.pool.get().map_err(runtime_error)?;
    db::save_hotkey(&conn, &action_key, &hotkey_value).map_err(runtime_error)
}

#[tauri::command]
pub fn unregister_all_shortcuts(handle: AppHandle) -> Result<(), String> {
    handle.global_shortcut().unregister_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reload_global_shortcuts(handle: AppHandle) -> Result<(), String> {
    // Unregister all existing shortcuts
    let _ = handle.global_shortcut().unregister_all();
    // Re-register from DB
    crate::register_global_shortcuts(&handle).map_err(|e| e.to_string())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &std::path::Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
) -> anyhow::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = format!("{}/{}", prefix, entry.file_name().to_string_lossy());
        if path.is_dir() {
            add_dir_to_zip(zip, &path, &name, options)?;
        } else {
            zip.start_file(&name, options)?;
            let bytes = std::fs::read(&path)?;
            zip.write_all(&bytes)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn backup_data(state: State<'_, AppState>, save_path: String) -> Result<String, String> {
    let paths = &state.paths;

    // Force WAL checkpoint so all committed data is in the main .db file
    {
        let conn = state.pool.get().map_err(runtime_error)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").map_err(|e: rusqlite::Error| e.to_string())?;
    }

    let file = std::fs::File::create(&save_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // Add database
    zip.start_file("trayclip.db", options).map_err(|e| e.to_string())?;
    let db_bytes = std::fs::read(&paths.db_path).map_err(|e| e.to_string())?;
    zip.write_all(&db_bytes).map_err(|e| e.to_string())?;

    // Add images
    if paths.images_dir.exists() {
        add_dir_to_zip(&mut zip, &paths.images_dir, "images", options).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(save_path)
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, state: State<'_, AppState>, zip_path: String) -> Result<(), String> {
    let staging_dir = std::env::temp_dir().join("trayclip-restore-staging");

    // Clean up any previous staging
    if staging_dir.exists() {
        std::fs::remove_dir_all(&staging_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

    // Extract zip to staging
    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let entry_name = entry.name().to_string();
        let out_path = safe_zip_entry_path(&staging_dir, &entry_name)?;

        if entry_name.ends_with('/') {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            std::fs::write(&out_path, &buf).map_err(|e| e.to_string())?;
        }
    }

    // Write restore marker with both staging and destination paths
    // so apply_pending_restore uses the same root_dir as AppPaths::resolve
    let marker_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&marker_dir).map_err(|e| e.to_string())?;
    let marker_path = marker_dir.join(".restore-pending");
    let marker_content = format!("{}\n{}", staging_dir.display(), state.paths.root_dir.display());
    std::fs::write(&marker_path, marker_content).map_err(|e| e.to_string())?;

    // Restart the app
    app.restart();
}

fn safe_zip_entry_path(root: &std::path::Path, entry_name: &str) -> Result<std::path::PathBuf, String> {
    let entry_path = std::path::Path::new(entry_name);
    if entry_name.is_empty() {
        return Err("backup contains an empty entry path".to_string());
    }

    for component in entry_path.components() {
        match component {
            std::path::Component::Prefix(_)
            | std::path::Component::RootDir
            | std::path::Component::ParentDir => {
                return Err(format!("backup contains an unsafe entry path: {}", entry_name));
            }
            std::path::Component::CurDir | std::path::Component::Normal(_) => {}
        }
    }

    Ok(root.join(entry_path))
}

fn normalize_windows_path(file_path: &str) -> String {
    if let Some(stripped) = file_path.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{}", stripped);
    }
    if let Some(stripped) = file_path.strip_prefix("\\\\?\\") {
        return stripped.to_string();
    }
    file_path.to_string()
}

fn mime_from_path(file_path: &str) -> &'static str {
    let lower = file_path.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".tif") || lower.ends_with(".tiff") {
        "image/tiff"
    } else {
        "image/png"
    }
}

#[tauri::command]
pub fn load_image_data_url(file_path: String) -> Result<String, String> {
    let normalized = normalize_windows_path(&file_path);
    let bytes = std::fs::read(&normalized).map_err(|err| err.to_string())?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime_from_path(&normalized), encoded))
}

#[tauri::command]
pub fn get_permissions(state: State<'_, AppState>) -> Result<PermissionState, String> {
    Ok(state.permissions.read().clone())
}

#[tauri::command]
pub fn request_accessibility_permission(_state: State<'_, AppState>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

#[tauri::command]
pub fn hide_window(app: AppHandle, state: State<'_, AppState>, paste_after: Option<bool>) -> Result<(), String> {
    if let Some(window) = app.webview_windows().get("main").cloned() {
        let _ = window.hide();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        let _ = paste_after;
    }
    #[cfg(target_os = "windows")]
    if let Some(hwnd) = resolve_hide_window_action(paste_after.unwrap_or(false), *state.previous_hwnd.lock()) {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            unsafe { SetForegroundWindow(hwnd as *mut _) };
            std::thread::sleep(std::time::Duration::from_millis(50));
            let _ = simulate_paste();
        });
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    let _ = app.global_shortcut().unregister_all();
    app.exit(0);

    // Force exit after a short delay to prevent zombie processes on macOS
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(500));
        std::process::exit(0);
    });
}

#[cfg(target_os = "windows")]
fn make_key_input(vk: u16, flags: u32) -> INPUT {
    let mut input: INPUT = unsafe { std::mem::zeroed() };
    input.r#type = INPUT_KEYBOARD;
    input.Anonymous.ki.wVk = vk;
    input.Anonymous.ki.dwFlags = flags;
    input
}

#[tauri::command]
pub fn simulate_paste() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let inputs = [
            make_key_input(VK_CONTROL, 0),
            make_key_input(0x56, 0), // 'V'
            make_key_input(0x56, KEYEVENTF_KEYUP),
            make_key_input(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            return Err("SendInput failed".into());
        }
    }
    Ok(())
}

/// Generic helper that works with any runtime — callable from monitor or commands.
pub fn show_url_toast_window<R: tauri::Runtime>(app: &AppHandle<R>, url: &str) {
    if let Some(window) = app.webview_windows().get("url-toast").cloned() {
        let _ = window.emit("url-toast://show", url);
        // Position at mouse cursor, clamped to monitor bounds
        if let Ok(pos) = window.cursor_position() {
            let toast_w = 220;
            let toast_h = 44;
            let mut x = pos.x as i32 + 16;
            let mut y = pos.y as i32 - 50;
            if let Ok(Some(monitor)) = window.current_monitor() {
                let mp = monitor.position();
                let ms = monitor.size();
                x = x.clamp(mp.x, mp.x + ms.width as i32 - toast_w);
                y = y.clamp(mp.y, mp.y + ms.height as i32 - toast_h);
            }
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn show_url_toast(app: AppHandle, url: String) -> Result<(), String> {
    show_url_toast_window(&app, &url);
    Ok(())
}

// --- Bing Translate ---

const EDGE_TRANSLATE_URL: &str = "https://edge.microsoft.com/translate/translatetext";

const EDGE_TRANSLATE_HEADERS: &[(&str, &str)] = &[
    ("Accept", "application/json, text/plain, */*"),
    ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"),
    ("pragma", "no-cache"),
    ("priority", "u=1, i"),
    ("x-edge-shopping-flag", "1"),
    ("content-type", "application/json"),
];

#[allow(dead_code)]
const BING_AUTH_URL: &str = "https://edge.microsoft.com/translate/auth";
#[allow(dead_code)]
const BING_TRANSLATE_URL: &str = "https://api-edge.cognitive.microsofttranslator.com/translate";

#[allow(dead_code)]
const BING_COMMON_HEADERS: &[(&str, &str)] = &[
    ("Accept", "application/json, text/plain, */*"),
    ("Accept-Language", "zh-CN"),
    ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) time-translate/0.9.15 Chrome/104.0.5112.124 Electron/20.3.8 Safari/537.36"),
    ("sec-ch-ua", "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"104\""),
    ("sec-ch-ua-mobile", "?0"),
    ("sec-ch-ua-platform", "\"Windows\""),
    ("Sec-Fetch-Site", "cross-site"),
    ("Sec-Fetch-Mode", "cors"),
    ("Sec-Fetch-Dest", "empty"),
];

#[allow(dead_code)]
struct BingTokenCache {
    token: String,
    expiry: std::time::Instant,
}

#[allow(dead_code)]
static BING_TOKEN: std::sync::OnceLock<std::sync::Mutex<BingTokenCache>> = std::sync::OnceLock::new();

#[allow(dead_code)]
async fn get_bing_token(client: &reqwest::Client) -> Result<String, String> {
    let cache = BING_TOKEN.get_or_init(|| std::sync::Mutex::new(BingTokenCache {
        token: String::new(),
        expiry: std::time::Instant::now(),
    }));
    {
        let cached = cache.lock().unwrap();
        if !cached.token.is_empty() && std::time::Instant::now() < cached.expiry {
            return Ok(cached.token.clone());
        }
    }

    let mut req = client.get(BING_AUTH_URL);
    for (k, v) in BING_COMMON_HEADERS {
        req = req.header(*k, *v);
    }
    let resp = req.send().await.map_err(|e| format!("Bing auth request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Bing auth failed: {}", resp.status()));
    }
    let token = resp.text().await.map_err(|e| format!("Bing auth read failed: {}", e))?.trim().to_string();
    if token.is_empty() {
        return Err("Bing auth returned empty token".into());
    }

    let mut cached = cache.lock().unwrap();
    *cached = BingTokenCache {
        token: token.clone(),
        expiry: std::time::Instant::now() + std::time::Duration::from_secs(9 * 60),
    };
    Ok(token)
}

#[tauri::command]
pub async fn bing_translate(text: String, from: String, to: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let mut params = vec![
        ("to", to.as_str()),
        ("isEnterpriseClient", "false"),
    ];
    if !from.is_empty() && from != "auto" {
        params.push(("from", from.as_str()));
    }

    let mut req = client.post(EDGE_TRANSLATE_URL).query(&params);
    for (k, v) in EDGE_TRANSLATE_HEADERS {
        req = req.header(*k, *v);
    }
    let resp = req
        .json(&serde_json::json!([text]))
        .send()
        .await
        .map_err(|e| format!("Bing translate request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Bing translate failed: {}", resp.status()));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| format!("Bing translate parse failed: {}", e))?;
    let translated = data[0]["translations"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(translated)
}

#[cfg(test)]
mod tests {
    use super::{resolve_hide_window_action, safe_zip_entry_path};
    use std::path::Path;

    #[test]
    fn resolve_hide_window_action_returns_hide_only_when_paste_disabled() {
        assert_eq!(resolve_hide_window_action(false, 123), None);
    }

    #[test]
    fn resolve_hide_window_action_returns_previous_hwnd_when_paste_enabled() {
        assert_eq!(resolve_hide_window_action(true, 456), Some(456));
    }

    #[test]
    fn safe_zip_entry_path_accepts_paths_inside_staging_root() {
        let root = Path::new("staging");
        assert_eq!(safe_zip_entry_path(root, "images/icon.png").unwrap(), root.join("images/icon.png"));
    }

    #[test]
    fn safe_zip_entry_path_rejects_traversal_and_absolute_paths() {
        let root = Path::new("staging");
        assert!(safe_zip_entry_path(root, "../outside.txt").is_err());
        assert!(safe_zip_entry_path(root, "images/../../outside.txt").is_err());
        assert!(safe_zip_entry_path(root, "/absolute.txt").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn safe_zip_entry_path_rejects_windows_absolute_paths() {
        let root = Path::new("staging");
        assert!(safe_zip_entry_path(root, "C:\\outside.txt").is_err());
        assert!(safe_zip_entry_path(root, r"\\server\share\outside.txt").is_err());
    }
}

const GITHUB_REPO: &str = "Heyiki/TrayClip";

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest_version: String,
    pub download_url: String,
    pub body: String,
}

#[tauri::command]
pub fn get_installer_type() -> String {
    static CACHED: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    CACHED.get_or_init(|| {
        #[cfg(target_os = "windows")]
        { detect_windows_install_type().to_string() }
        #[cfg(not(target_os = "windows"))]
        { "unknown".to_string() }
    }).clone()
}

#[tauri::command]
pub async fn check_update(current_version: String, installer_type: String) -> Result<UpdateInfo, String> {
    let info = tauri::async_runtime::spawn_blocking(move || {
        let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);

        let mut cmd = std::process::Command::new("curl");
        cmd.args(["-sL", "-H", "User-Agent: trayclip", &url]);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let output = cmd.output()
            .map_err(|e| format!("Failed to run curl: {}", e))?;

        if !output.status.success() {
            return Err(format!("curl exited with status {}", output.status));
        }

        let json: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let tag = json["tag_name"].as_str().unwrap_or("").trim_start_matches('v');
        let body = json["body"].as_str().unwrap_or("").to_string();
        let has_update = version_compare(tag, &current_version);

        let assets = json["assets"].as_array().map(|a| a.as_slice()).unwrap_or(&[]);
        let effective_type = if installer_type.is_empty() { "exe" } else { &installer_type };
        let download_url = find_asset_url(assets, effective_type).unwrap_or_else(|| {
            json["html_url"].as_str().unwrap_or("").to_string()
        });

        Ok(UpdateInfo {
            has_update,
            latest_version: tag.to_string(),
            download_url,
            body,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    info
}

#[cfg(target_os = "windows")]
fn detect_windows_install_type() -> &'static str {
    use std::process::Command;

    let nsis_check = Command::new("reg")
        .args([
            "query",
            "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TrayClip",
            "/ve",
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output();

    if let Ok(output) = nsis_check {
        if output.status.success() {
            return "exe";
        }
    }

    let msi_check = Command::new("reg")
        .args([
            "query",
            "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{com.trayclip.app}",
            "/ve",
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output();

    if let Ok(output) = msi_check {
        if output.status.success() {
            return "msi";
        }
    }

    // Default to exe for new installs
    "exe"
}

fn find_asset_url(assets: &[serde_json::Value], _installer_type: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    let suffixes: &[&str] = if _installer_type == "msi" {
        &[".msi", ".exe"]
    } else {
        &[".exe", ".msi"]
    };

    #[cfg(target_os = "macos")]
    let suffixes: &[&str] = &[".dmg"];

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let suffixes: &[&str] = &[".AppImage"];

    for suffix in suffixes {
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            let url = asset["browser_download_url"].as_str().unwrap_or("");
            if name.ends_with(suffix) && !url.is_empty() {
                return Some(url.to_string());
            }
        }
    }
    None
}

fn version_compare(latest: &str, current: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.').filter_map(|p| p.parse().ok()).collect()
    };
    let l = parse(latest);
    let c = parse(current);
    for i in 0..l.len().max(c.len()) {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv > cv { return true; }
        if lv < cv { return false; }
    }
    false
}
