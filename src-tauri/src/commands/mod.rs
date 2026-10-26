use std::io::Read as _;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::{app_state::AppState, clipboard, db, models::{AppSettings, ClipGroup, ConfigPayload, HotkeySetting, ListClipsRequest, ListClipsResponse}};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, KEYEVENTF_KEYUP, VK_CONTROL,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

fn runtime_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Whether an already canonicalized path sits inside an already canonicalized `root`.
///
/// The root is resolved by the caller rather than here because a batch cleanup would
/// otherwise re-open the same directory once per file. Pass the result of
/// [`canonicalize`](std::fs::canonicalize) for the images directory, nothing else.
///
/// `direct_child` narrows it to an immediate file of `root`: managed images are stored flat
/// under `images/`, so anything deeper is not ours to delete. Preview uses plain containment,
/// because a recorded file path may point into a subfolder the user copied from. Both rules
/// live here so "inside the images directory" has exactly one meaning per call site.
fn is_within_canonical_root(root: &std::path::Path, canonical: &std::path::Path, direct_child: bool) -> bool {
    if direct_child {
        return canonical.parent() == Some(root);
    }
    canonical.starts_with(root)
}

/// Resolves the managed images directory, reporting `None` when it is unavailable. Cleanup
/// must refuse to delete in that case: without a resolved root there is no way to tell our
/// own files apart from an arbitrary path, which is the whole point of the whitelist.
fn canonical_images_root(images_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    images_dir.canonicalize().ok()
}

/// Deletes a file only when it is a direct child of the managed images directory.
/// A restored backup can carry arbitrary `image_path` values, so paths read back
/// from the database are never trusted for deletion.
fn remove_managed_image(images_root: &std::path::Path, file_path: &str) -> bool {
    let path = std::path::Path::new(file_path);
    let Ok(canonical) = path.canonicalize() else {
        // File is already gone — nothing to delete.
        return true;
    };
    if !is_within_canonical_root(images_root, &canonical, true) {
        eprintln!("[cleanup] refused to delete file outside images dir: {}", path.display());
        return false;
    }
    match std::fs::remove_file(&canonical) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("[cleanup] failed to delete {}: {}", canonical.display(), e);
            false
        }
    }
}

/// Deletes a batch of managed images. Backup holds the same lock for its whole run, so a
/// retention pass cannot pull a file out from under an archive that is being written.
pub(crate) fn remove_managed_images(state: &AppState, image_paths: Vec<String>) {
    let _guard = state.image_cleanup_lock.lock();
    if image_paths.is_empty() {
        return;
    }
    // Resolved once for the whole batch; an unavailable directory refuses every file in it.
    let Some(images_root) = canonical_images_root(&state.paths.images_dir) else {
        eprintln!("[cleanup] images dir unavailable: {}", state.paths.images_dir.display());
        return;
    };
    for file_path in image_paths {
        remove_managed_image(&images_root, &file_path);
    }
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
pub fn get_config(state: State<'_, AppState>) -> Result<ConfigPayload, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    let settings = db::load_settings(&conn).map_err(runtime_error)?;
    let hotkeys = db::list_hotkeys(&conn).map_err(runtime_error)?;
    Ok(ConfigPayload { settings, hotkeys })
}

#[tauri::command]
pub fn list_clips(state: State<'_, AppState>, payload: ListClipsRequest) -> Result<ListClipsResponse, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::list_clips(&conn, &payload).map_err(runtime_error)
}

#[tauri::command]
pub fn get_clip_text(state: State<'_, AppState>, clip_id: i64) -> Result<String, String> {
    let conn = state.pool.get().map_err(runtime_error)?;
    db::get_clip_text(&conn, clip_id).map_err(runtime_error)
}

/// Grants the webview read access to one image path and reports whether it can be loaded.
/// Paths inside the managed images directory are already covered by the static asset scope;
/// a path elsewhere is only granted when the user has actually copied it, which keeps this
/// from becoming a general file reader.
#[tauri::command]
pub fn allow_image_preview(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<bool, String> {
    let Ok(canonical) = std::fs::canonicalize(&path) else { return Ok(false) };
    if !canonical.is_file() {
        return Ok(false);
    }
    // A missing images directory simply means this path is not one of our managed images,
    // so the recorded-path check below still gets to decide.
    let images_root = canonical_images_root(&state.paths.images_dir);
    if images_root
        .as_deref()
        .is_some_and(|root| is_within_canonical_root(root, &canonical, false))
    {
        // The static scope already covers this one.
        return Ok(true);
    }

    let conn = state.pool.get().map_err(runtime_error)?;
    if !is_recorded_file_path(&conn, &path)? {
        return Ok(false);
    }

    let scope = app.asset_protocol_scope();
    // The webview resolves the URL built from the original string, which is not always the
    // canonical form, so both spellings are granted.
    let _ = scope.allow_file(std::path::Path::new(&path));
    let _ = scope.allow_file(&canonical);
    Ok(true)
}

fn is_recorded_file_path(conn: &rusqlite::Connection, path: &str) -> Result<bool, String> {
    let mut statement = conn
        .prepare(
            "SELECT 1 FROM clips, json_each(CASE WHEN json_valid(clips.file_paths_json) THEN clips.file_paths_json ELSE '[]' END) AS entry WHERE entry.value = ?1 LIMIT 1",
        )
        .map_err(runtime_error)?;
    let mut rows = statement.query([path]).map_err(runtime_error)?;
    Ok(rows.next().map_err(runtime_error)?.is_some())
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
pub fn delete_clip(state: State<'_, AppState>, clip_id: i64) -> Result<(), String> {
    let image_path = {
        let conn = state.pool.get().map_err(runtime_error)?;
        db::delete_clip(&conn, clip_id).map_err(runtime_error)?
    };
    if let Some(path) = image_path {
        remove_managed_images(&state, vec![path]);
    }
    Ok(())
}

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    let images = {
        let conn = state.pool.get().map_err(runtime_error)?;
        db::clear_history(&conn).map_err(runtime_error)?
    };
    remove_managed_images(&state, images);
    Ok(())
}

#[tauri::command]
pub fn update_settings(app: AppHandle, state: State<'_, AppState>, payload: AppSettings) -> Result<AppSettings, String> {
    let (next_settings, removed_images) = {
        let conn = state.pool.get().map_err(runtime_error)?;
        db::save_settings(&conn, &payload).map_err(runtime_error)?
    };
    remove_managed_images(&state, removed_images);
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
    Ok(next_settings)
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
        let file_type = entry.file_type()?;
        // A link would either duplicate the target inside the archive or send the walk in
        // circles. Restore writes plain files anyway, so links carry no value here.
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let name = format!("{}/{}", prefix, entry.file_name().to_string_lossy());
        if file_type.is_dir() {
            add_dir_to_zip(zip, &path, &name, options)?;
        } else {
            zip.start_file(&name, options)?;
            // Streamed: a single screenshot must not have to fit in memory to be backed up.
            let mut file = std::fs::File::open(&path)?;
            std::io::copy(&mut file, zip)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn backup_data(state: State<'_, AppState>, save_path: String) -> Result<String, String> {
    let paths = &state.paths;

    // Held until the archive is closed: a retention pass or a manual delete would otherwise
    // remove an image file while it is being read.
    let _cleanup_guard = state.image_cleanup_lock.lock();

    // Snapshot first. The live database cannot simply be copied: rows committed since the
    // last checkpoint live in the `-wal` file, and the checkpoint that was supposed to flush
    // them can silently report "busy" and leave them behind.
    let snapshot = tempfile::Builder::new()
        .prefix("trayclip-backup-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let snapshot_db = snapshot.path().join("trayclip.db");
    {
        let conn = state.pool.get().map_err(runtime_error)?;
        db::snapshot_database(&conn, &snapshot_db).map_err(runtime_error)?;
    }

    // Refuse here rather than write an archive that restore would reject later.
    let db_bytes = std::fs::metadata(&snapshot_db).map_err(|e| e.to_string())?.len();
    let (images_bytes, files) = measure_dir(&paths.images_dir).map_err(|e| e.to_string())?;
    check_backup_limits(db_bytes, images_bytes, files)?;

    let file = std::fs::File::create(&save_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // Add database
    zip.start_file("trayclip.db", options).map_err(|e| e.to_string())?;
    let mut db_file = std::fs::File::open(&snapshot_db).map_err(|e| e.to_string())?;
    std::io::copy(&mut db_file, &mut zip).map_err(|e| e.to_string())?;

    // Add images
    if paths.images_dir.exists() {
        add_dir_to_zip(&mut zip, &paths.images_dir, "images", options).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(save_path)
}

/// Restore is the only path that writes attacker-controlled bytes to disk in bulk,
/// so the archive gets bounded instead of trusted.
const MAX_BACKUP_ENTRIES: usize = 20_000;
/// One image. The database is restored whole or not at all, so it gets its own budget.
const MAX_BACKUP_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
/// One `MAX_RETENTION_LIMIT` worth of 1 MiB text clips is an order of magnitude past a
/// single image, and the database cannot be split across entries the way images can.
const MAX_DATABASE_BYTES: u64 = 1024 * 1024 * 1024;
/// Deliberately generous: a screenshot-heavy history of 200 clips easily passes 1 GiB.
/// The streaming copy keeps peak memory independent of this number, so the limit only
/// bounds the temporary disk usage.
const MAX_BACKUP_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// The database is the one entry that has to arrive complete, so it may use the database
/// budget; every other entry in an archive is an image.
fn entry_byte_limit(entry_name: &str) -> u64 {
    if entry_name == "trayclip.db" {
        MAX_DATABASE_BYTES
    } else {
        MAX_BACKUP_ENTRY_BYTES
    }
}

/// Returns how many bytes the current entry may consume. `declared_bytes` comes from
/// the archive itself, so it is only used for an early rejection — the hard limit is
/// enforced while copying.
fn restore_entry_budget(total_written: u64, declared_bytes: u64, entry_name: &str) -> Result<u64, String> {
    let budget = entry_byte_limit(entry_name).min(MAX_BACKUP_TOTAL_BYTES.saturating_sub(total_written));
    if declared_bytes > budget {
        return Err(format!(
            "backup entry {} exceeds the restore size limit: {} bytes declared, {} allowed",
            entry_name, declared_bytes, budget
        ));
    }
    Ok(budget)
}

/// Backup is the mirror of restore, so it applies the same limits before the first byte is
/// written instead of producing an archive that restore would refuse to read.
fn check_backup_limits(db_bytes: u64, images_bytes: u64, files: usize) -> Result<(), String> {
    if db_bytes > MAX_DATABASE_BYTES {
        return Err(format!(
            "history database is too large to back up: {} bytes, {} allowed",
            db_bytes, MAX_DATABASE_BYTES
        ));
    }
    // Entries are the database plus one per file; empty directories are not stored.
    if files + 1 > MAX_BACKUP_ENTRIES {
        return Err(format!(
            "history contains too many files to back up: {}, at most {} are supported",
            files,
            MAX_BACKUP_ENTRIES - 1
        ));
    }
    let total = db_bytes.saturating_add(images_bytes);
    if total > MAX_BACKUP_TOTAL_BYTES {
        return Err(format!(
            "backup would exceed the restore size limit: {} bytes, {} allowed",
            total, MAX_BACKUP_TOTAL_BYTES
        ));
    }
    Ok(())
}

/// Total size and file count of a tree, skipping links exactly like `add_dir_to_zip` so the
/// estimate matches what actually gets written. Metadata only: the cost is proportional to
/// the number of files, not to their size.
fn measure_dir(dir: &std::path::Path) -> std::io::Result<(u64, usize)> {
    let mut bytes = 0u64;
    let mut files = 0usize;
    if !dir.exists() {
        return Ok((0, 0));
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let (nested_bytes, nested_files) = measure_dir(&entry.path())?;
            bytes += nested_bytes;
            files += nested_files;
        } else {
            bytes += entry.metadata()?.len();
            files += 1;
        }
    }
    Ok((bytes, files))
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, state: State<'_, AppState>, zip_path: String) -> Result<(), String> {
    // Randomly named staging directory under the system temp dir: the path cannot be
    // predicted (and therefore pre-created as a junction/symlink) by another process.
    let staging = tempfile::Builder::new()
        .prefix("trayclip-restore-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let staging_dir = staging.path().to_path_buf();

    // Extract zip to staging
    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if archive.len() > MAX_BACKUP_ENTRIES {
        return Err(format!(
            "backup contains {} entries, at most {} are supported",
            archive.len(),
            MAX_BACKUP_ENTRIES
        ));
    }

    let mut total_bytes: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let entry_name = entry.name().to_string();
        let out_path = safe_zip_entry_path(&staging_dir, &entry_name)?;

        if entry_name.ends_with('/') {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let budget = restore_entry_budget(total_bytes, entry.size(), &entry_name)?;
        let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        // Stream with a hard cap so the real decompressed size stays bounded even when
        // the archive declares a smaller size than it actually expands to.
        let written = match std::io::copy(&mut entry.by_ref().take(budget + 1), &mut out) {
            Ok(written) => written,
            Err(e) => {
                drop(out);
                let _ = std::fs::remove_file(&out_path);
                return Err(e.to_string());
            }
        };
        drop(out);
        if written > budget {
            let _ = std::fs::remove_file(&out_path);
            return Err(format!(
                "backup entry {} exceeds the restore size limit ({} bytes)",
                entry_name, budget
            ));
        }
        total_bytes += written;
    }

    // Write the restore marker. Only the first line (the staging path) is consumed now —
    // the destination is recomputed on startup — but the second line is kept so that an
    // older build can still interpret a marker written by this one.
    let marker_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&marker_dir).map_err(|e| e.to_string())?;
    let marker_path = marker_dir.join(".restore-pending");
    // The data directory is derived from the database path so the two cannot disagree.
    let root_dir = state.paths.db_path.parent().unwrap_or(std::path::Path::new(""));
    let marker_content = format!("{}\n{}", staging_dir.display(), root_dir.display());
    std::fs::write(&marker_path, marker_content).map_err(|e| e.to_string())?;

    // The staging directory has to outlive this process: apply_pending_restore
    // consumes it on the next launch and removes it afterwards.
    let _kept_staging = staging.keep();

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

/// Not an IPC command: quick paste drives it from `hide_window`, and the webview has no
/// reason to synthesize Ctrl+V on its own.
fn simulate_paste() -> Result<(), String> {
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

// --- HTTP ---

/// Every outbound request shares one client so the connect/read timeouts apply
/// uniformly — a stalled server must never leave a command pending forever.
const HTTP_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const HTTP_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const HTTP_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

fn http_client() -> reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(HTTP_CONNECT_TIMEOUT)
                .read_timeout(HTTP_READ_TIMEOUT)
                .timeout(HTTP_REQUEST_TIMEOUT)
                .user_agent(concat!("trayclip/", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_else(|e| {
                    eprintln!("[http] failed to build client: {} — using defaults", e);
                    reqwest::Client::new()
                })
        })
        .clone()
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

#[tauri::command]
pub async fn bing_translate(text: String, from: String, to: String) -> Result<String, String> {
    let client = http_client();
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
    use super::{
        check_backup_limits, restore_entry_budget, resolve_hide_window_action, safe_zip_entry_path,
        MAX_BACKUP_ENTRY_BYTES, MAX_BACKUP_ENTRIES, MAX_BACKUP_TOTAL_BYTES, MAX_DATABASE_BYTES,
    };
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

    #[test]
    fn restore_entry_budget_caps_single_entry_and_total() {
        const IMAGE: &str = "images/a.png";
        const DB: &str = "trayclip.db";

        // Fresh restore: the per-entry limit is the binding constraint.
        assert_eq!(restore_entry_budget(0, 1024, IMAGE).unwrap(), MAX_BACKUP_ENTRY_BYTES);
        assert!(restore_entry_budget(0, MAX_BACKUP_ENTRY_BYTES + 1, IMAGE).is_err());

        // The database is allowed more than an image, which is what lets a fat history
        // round-trip through backup and restore.
        assert_eq!(restore_entry_budget(0, MAX_DATABASE_BYTES, DB).unwrap(), MAX_DATABASE_BYTES);
        assert!(restore_entry_budget(0, MAX_DATABASE_BYTES + 1, DB).is_err());

        // The total budget wins once it has less room left than one entry.
        let nearly_full = MAX_BACKUP_TOTAL_BYTES - 10;
        assert_eq!(restore_entry_budget(nearly_full, 10, IMAGE).unwrap(), 10);
        assert!(restore_entry_budget(nearly_full, 11, IMAGE).is_err());

        // Nothing left at all: only a zero-byte entry still fits.
        assert_eq!(restore_entry_budget(MAX_BACKUP_TOTAL_BYTES, 0, IMAGE).unwrap(), 0);
        assert!(restore_entry_budget(MAX_BACKUP_TOTAL_BYTES, 1, IMAGE).is_err());
    }

    #[test]
    fn check_backup_limits_accepts_exactly_what_restore_accepts() {
        assert!(check_backup_limits(MAX_DATABASE_BYTES, 0, 0).is_ok());
        assert!(check_backup_limits(0, MAX_BACKUP_TOTAL_BYTES, 0).is_ok());
        assert!(check_backup_limits(0, 0, MAX_BACKUP_ENTRIES - 1).is_ok());

        assert!(check_backup_limits(MAX_DATABASE_BYTES + 1, 0, 0).is_err());
        assert!(check_backup_limits(0, MAX_BACKUP_TOTAL_BYTES + 1, 0).is_err());
        assert!(check_backup_limits(0, 0, MAX_BACKUP_ENTRIES).is_err());
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
pub async fn check_update(current_version: String, installer_type: String) -> Result<UpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);
    let response = http_client()
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to request releases: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Releases request failed: {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
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
