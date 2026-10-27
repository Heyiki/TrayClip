#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod clipboard;
mod commands;
mod db;
mod models;
mod monitor;
mod paths;
mod placement;
mod source_app;

use anyhow::Context;
use app_state::AppState;
use parking_lot::{Mutex, RwLock};
use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

struct TrayState {
    tray: Mutex<Option<TrayIcon<tauri::Wry>>>,
}

fn apply_pending_restore(app: &tauri::AppHandle) {
    let resolver = app.path();

    // The same rule `AppPaths::resolve` applies on startup, shared through one function so a
    // restore can never land in a directory the app will not read back. Failing to find a
    // writable directory is not fatal here: the app still boots, and startup reports it.
    let Ok(root_dir) = paths::resolve_root_dir(app) else { return };

    // Check for marker in app_data_dir (writable) first, then root_dir (legacy)
    let marker = resolver.app_data_dir().ok()
        .map(|d| d.join(".restore-pending"))
        .filter(|p| p.exists())
        .unwrap_or_else(|| root_dir.join(".restore-pending"));
    let Ok(marker_content) = std::fs::read_to_string(&marker) else { return };

    // Only the first line is read. The destination is recomputed from the resolver above
    // instead of trusting a path written on disk, so a tampered marker cannot redirect the
    // restore (and its deletions) at an arbitrary directory.
    let staging_path = marker_content.lines().next().unwrap_or("").to_string();
    let staging_dir = std::path::PathBuf::from(&staging_path);

    if !staging_dir.exists() {
        let _ = std::fs::remove_file(&marker);
        return;
    }
    if !is_managed_staging_dir(&staging_dir) {
        eprintln!("[restore] refusing unmanaged staging dir: {}", staging_dir.display());
        let _ = std::fs::remove_file(&marker);
        return;
    }

    eprintln!("[restore] staging_dir={}, root_dir={}", staging_dir.display(), root_dir.display());

    // Both halves are staged before anything is replaced, so a corrupt archive or a failed
    // copy leaves the working data exactly as it was.
    let src_db = staging_dir.join("trayclip.db");
    let dst_db = root_dir.join("trayclip.db");
    let staged_db = root_dir.join("trayclip.db.new");
    let backup_db = root_dir.join("trayclip.db.old");
    let src_images = staging_dir.join("images");
    let dst_images = root_dir.join("images");
    let staged_images = root_dir.join("images.restore");
    let backup_images = root_dir.join("images.old");

    if !src_db.exists() {
        // Nothing restorable in the staging dir: drop it so the app keeps starting.
        eprintln!("[restore] source db not found at {}", src_db.display());
        let _ = std::fs::remove_dir_all(&staging_dir);
        let _ = std::fs::remove_file(&marker);
        return;
    }

    // --- Stage the database ---
    let _ = std::fs::remove_file(&staged_db);
    if let Err(e) = std::fs::copy(&src_db, &staged_db) {
        eprintln!("[restore] db copy to {} failed: {} — keeping staging for retry", staged_db.display(), e);
        let _ = std::fs::remove_file(&staged_db);
        return;
    }

    // A backup is an untrusted file until it is opened. Validation runs against the staged
    // copy while the live database is still in place; image paths are rebased onto the
    // current images dir in the same pass, so a restore also works after the app has moved
    // to another directory or another machine.
    match verify_and_rebase_db(&staged_db, &dst_images) {
        Ok(rewritten) => {
            if rewritten > 0 {
                eprintln!("[restore] rebased {} image path(s) onto {}", rewritten, dst_images.display());
            }
        }
        Err(e) => {
            eprintln!("[restore] restored database rejected: {} — current data kept", e);
            let _ = std::fs::remove_file(&staged_db);
            let _ = std::fs::remove_dir_all(&staging_dir);
            let _ = std::fs::remove_file(&marker);
            return;
        }
    }
    eprintln!("[restore] db staged and verified at {}", staged_db.display());

    // --- Stage the images ---
    let has_images = src_images.exists();
    if has_images {
        let _ = std::fs::remove_dir_all(&staged_images);
        let staged = std::fs::create_dir_all(&staged_images)
            .context("failed to create the images staging dir")
            .and_then(|_| copy_dir_recursive(&src_images, &staged_images));
        if let Err(e) = staged {
            eprintln!("[restore] image copy failed: {} — keeping staging for retry", e);
            let _ = std::fs::remove_dir_all(&staged_images);
            let _ = std::fs::remove_file(&staged_db);
            return;
        }
    }

    // --- Commit the database ---
    let had_db = dst_db.exists();
    let _ = std::fs::remove_file(&backup_db);
    if had_db {
        if let Err(e) = std::fs::rename(&dst_db, &backup_db) {
            eprintln!("[restore] cannot move current db aside: {} — keeping staging for retry", e);
            let _ = std::fs::remove_file(&staged_db);
            let _ = std::fs::remove_dir_all(&staged_images);
            return;
        }
        // Stale journals would shadow the restored database.
        let _ = std::fs::remove_file(root_dir.join("trayclip.db-wal"));
        let _ = std::fs::remove_file(root_dir.join("trayclip.db-shm"));
    }

    if let Err(e) = std::fs::rename(&staged_db, &dst_db) {
        eprintln!("[restore] atomic db replace failed: {} — rolling back", e);
        if had_db && backup_db.exists() {
            let _ = std::fs::rename(&backup_db, &dst_db);
        }
        let _ = std::fs::remove_file(&staged_db);
        let _ = std::fs::remove_dir_all(&staged_images);
        return;
    }

    // --- Commit the images ---
    if has_images {
        let had_images = dst_images.exists();
        let _ = std::fs::remove_dir_all(&backup_images);
        if had_images && std::fs::rename(&dst_images, &backup_images).is_err() {
            eprintln!("[restore] cannot move current images dir aside — rolling back");
            rollback_database_swap(&dst_db, &backup_db, &staged_images, had_db);
            return;
        }
        if let Err(e) = std::fs::rename(&staged_images, &dst_images) {
            eprintln!("[restore] images swap failed: {} — rolling back", e);
            if backup_images.exists() {
                let _ = std::fs::rename(&backup_images, &dst_images);
            }
            rollback_database_swap(&dst_db, &backup_db, &staged_images, had_db);
            return;
        }
    }

    // --- Everything is in place; drop the safety copies ---
    let _ = std::fs::remove_file(&backup_db);
    let _ = std::fs::remove_dir_all(&backup_images);
    let _ = std::fs::remove_dir_all(&staging_dir);
    let _ = std::fs::remove_file(&marker);
    // Also clean legacy marker location
    let _ = std::fs::remove_file(root_dir.join(".restore-pending"));
}

/// Copies a directory tree and reports every failure. A partial copy must never be
/// mistaken for a complete one, because the caller swaps the result in with a rename.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> anyhow::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        // Entries are written by our own extractor, so a link is unexpected; following one
        // could also recurse forever.
        if file_type.is_symlink() {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            std::fs::create_dir_all(&dst_path)?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// The staging path is read back from a file on disk, so it is untrusted: only a directory
/// this app created directly under the system temp dir may be copied from or deleted.
fn is_managed_staging_dir(path: &std::path::Path) -> bool {
    let Ok(temp) = std::env::temp_dir().canonicalize() else { return false };
    let Ok(canonical) = path.canonicalize() else { return false };
    canonical.parent() == Some(temp.as_path())
        && canonical
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("trayclip-restore-"))
}

/// Rejects anything that is not a healthy clipboard database and rebases the stored image
/// paths onto `images_dir`. Both happen while the live database is still untouched.
fn verify_and_rebase_db(db_path: &std::path::Path, images_dir: &std::path::Path) -> anyhow::Result<usize> {
    let rewritten = {
        let conn = rusqlite::Connection::open(db_path)
            .with_context(|| format!("failed to open staged database {}", db_path.display()))?;

        let problems: Vec<String> = {
            let mut statement = conn.prepare("PRAGMA quick_check")?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect::<Result<Vec<String>, _>>()?
        };
        if problems.len() != 1 || !problems[0].eq_ignore_ascii_case("ok") {
            anyhow::bail!("integrity check reported: {}", problems.join("; "));
        }

        // The very call `build_state` makes on the next launch. Anything that would stop
        // startup — a missing table, a missing column, an unreadable settings row — fails
        // here instead, while the live data is still untouched. Validation is also the
        // migration step: the staged copy leaves this function ready to open.
        db::initialize_database(&conn).context("staged database failed initialisation")?;

        rebase_image_paths(&conn, images_dir)?
    };

    // Opening a WAL database leaves sidecar files behind; they belong to the staged copy
    // and must not survive next to the database that gets swapped in.
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = db_path.as_os_str().to_owned();
        sidecar.push(suffix);
        let _ = std::fs::remove_file(std::path::PathBuf::from(sidecar));
    }

    Ok(rewritten)
}

fn rebase_image_paths(conn: &rusqlite::Connection, images_dir: &std::path::Path) -> anyhow::Result<usize> {
    let rows: Vec<(i64, String)> = {
        let mut statement = conn.prepare("SELECT id, image_path FROM clips WHERE image_path IS NOT NULL")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let mut update = conn.prepare("UPDATE clips SET image_path = ?1 WHERE id = ?2")?;
    let mut rewritten = 0;
    for (id, stored) in rows {
        let Some(name) = image_file_name(&stored) else { continue };
        let target = images_dir.join(name).to_string_lossy().into_owned();
        if target == stored {
            continue;
        }
        update.execute(rusqlite::params![target, id])?;
        rewritten += 1;
    }
    Ok(rewritten)
}

/// Only the file name of a stored image path is reliable across machines, and a backup may
/// come from an OS that uses a different separator.
fn image_file_name(stored: &str) -> Option<&str> {
    stored.rsplit(['/', '\\']).next().filter(|name| !name.is_empty())
}

/// Undoes the database half of the commit after the image half failed. The staging dir and
/// marker stay in place so the next launch can retry.
fn rollback_database_swap(
    dst_db: &std::path::Path,
    backup_db: &std::path::Path,
    staged_images: &std::path::Path,
    had_db: bool,
) {
    let _ = std::fs::remove_dir_all(staged_images);
    // Without a previous database there is nothing to protect, and the newly written one
    // already passed validation, so it is kept.
    if had_db && backup_db.exists() {
        let _ = std::fs::remove_file(dst_db);
        let _ = std::fs::rename(backup_db, dst_db);
    }
}

fn build_state(app: &tauri::AppHandle) -> anyhow::Result<AppState> {
    let paths = paths::AppPaths::resolve(app)?;
    let pool = db::create_pool(&paths)?;
    let settings = {
        let conn = pool.get().context("failed to get db connection")?;
        db::load_settings(&conn)?
    };
    Ok(AppState {
        pool,
        paths,
        settings: RwLock::new(settings),
        last_clip_signature: Mutex::new(None),
        image_cleanup_lock: Mutex::new(()),
        #[cfg(target_os = "windows")]
        previous_hwnd: Mutex::new(0),
        #[cfg(target_os = "linux")]
        clipboard: Mutex::new(arboard::Clipboard::new().context("failed to initialize clipboard")?),
    })
}

/// Size of the main window as configured in `tauri.conf.json`, in logical pixels. Used until
/// the platform reports the real size.
const MAIN_WINDOW_LOGICAL_WIDTH: f64 = 400.0;
const MAIN_WINDOW_LOGICAL_HEIGHT: f64 = 500.0;
/// Gap between the cursor and the window corner when `panel_position` is `follow_mouse`,
/// in logical pixels so it stays visually identical on displays of any scale.
const CURSOR_GAP_LOGICAL: f64 = 12.0;

/// The single place that decides where the main window appears. Startup positioning and
/// every `show()` go through it, so the window cannot land in two different spots.
///
/// The screen is the one under the pointer (see `placement`), which is what makes the hotkey
/// predictable on multi-display setups; the work area keeps the window clear of the macOS
/// menu bar and the Dock.
fn position_main_window(window: &tauri::WebviewWindow, panel_position: &str) {
    placement::place(
        window,
        panel_position,
        (MAIN_WINDOW_LOGICAL_WIDTH, MAIN_WINDOW_LOGICAL_HEIGHT),
        (CURSOR_GAP_LOGICAL, CURSOR_GAP_LOGICAL),
    );
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // If already visible and focused, do nothing
        if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
            return;
        }
        #[cfg(target_os = "windows")]
        {
            let state = app.state::<AppState>();
            let hwnd = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
            if !hwnd.is_null() {
                *state.previous_hwnd.lock() = hwnd as usize;
            }
        }
        let panel_position = app.state::<AppState>().settings.read().panel_position.clone();
        position_main_window(&window, &panel_position);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("focus-main-search", ());
    }
}

fn setup_tray(app: &tauri::App) -> anyhow::Result<()> {
    let show_item = MenuItemBuilder::new("显示窗口").id("show").build(app)?;
    let quit_item = MenuItemBuilder::new("退出").id("quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show_item, &quit_item]).build()?;

    #[cfg(target_os = "macos")]
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))
        .context("failed to load macOS tray template icon")?;

    #[cfg(not(target_os = "macos"))]
    let tray_icon = app
        .default_window_icon()
        .cloned()
        .context("default window icon is missing")?;

    let tray_builder = TrayIconBuilder::with_id("main")
        .icon(tray_icon)
        .menu(&menu)
        .tooltip("TrayClip")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "show" => {
                    show_main_window(app);
                }
                "quit" => {
                    // Both exit paths share quit_app so the shortcut teardown and the
                    // macOS force-exit watchdog always run.
                    commands::quit_app(app.clone());
                }
                _ => {}
            }
        });

    #[cfg(target_os = "macos")]
    let tray_builder = tray_builder.icon_as_template(true);

    let tray = tray_builder.build(app)?;

    *app.state::<TrayState>().tray.lock() = Some(tray);

    Ok(())
}

pub fn register_global_shortcuts(handle: &tauri::AppHandle) -> anyhow::Result<()> {
    let state = handle.state::<AppState>();
    let hotkeys = {
        let conn = state.pool.get();
        match conn {
            Ok(conn) => db::list_hotkeys(&conn).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    };

    for hotkey in &hotkeys {
        if hotkey.action_key != "open_main_window" {
            continue;
        }
        let Ok(shortcut) = hotkey.hotkey_value.parse::<tauri_plugin_global_shortcut::Shortcut>() else {
            continue;
        };
        let h = handle.clone();
        let _ = handle.global_shortcut().on_shortcut(
            shortcut,
            move |_app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    show_main_window(&h);
                }
            },
        );
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .setup(|app| {
            apply_pending_restore(app.handle());
            let state = build_state(app.handle()).context("failed to initialize app state")?;
            {
                let conn = state.pool.get().context("failed to get db connection for hotkey migration")?;
                db::migrate_quick_panel_hotkey_to_main_window(&conn)?;
            }
            app.manage(state);
            app.manage(TrayState {
                tray: Mutex::new(None),
            });
            {
                let state = app.state::<AppState>();
                #[cfg(target_os = "linux")]
                {
                    let mut cb = state.clipboard.lock();
                    if let Ok(Some(signature)) = clipboard::peek_signature_with_state(&state.paths, &mut cb) {
                        *state.last_clip_signature.lock() = Some(signature);
                    }
                }
                #[cfg(not(target_os = "linux"))]
                {
                    if let Ok(Some(signature)) = clipboard::peek_clipboard_signature(&state.paths) {
                        *state.last_clip_signature.lock() = Some(signature);
                    }
                }
            }
            monitor::spawn_clipboard_monitor(app.handle().clone());
            setup_tray(app).context("failed to setup tray")?;

            // Hide Dock icon on macOS — keep only the menu bar tray icon
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(window) = app.get_webview_window("main") {
                // Positioned before the frontend's first `show()`, so the initial window and
                // the hotkey-invoked one come from the same computation instead of relying
                // on where the platform happens to put a freshly created window.
                let panel_position = app.state::<AppState>().settings.read().panel_position.clone();
                position_main_window(&window, &panel_position);

                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.emit("close-requested", ());
                    }
                });
            }

            // Auto-hide url-toast window on focus loss
            if let Some(ut) = app.get_webview_window("url-toast") {
                let w = ut.clone();
                ut.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = w.hide();
                    }
                });
            }

            let handle = app.handle().clone();
            if let Err(e) = register_global_shortcuts(&handle) {
                eprintln!("failed to register global shortcuts: {}", e);
            }

            // Sync autostart in background to avoid blocking startup
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    use tauri_plugin_autostart::ManagerExt;
                    let state = handle.state::<AppState>();
                    let launch = handle.autolaunch();
                    let want_enabled = state.settings.read().launch_on_startup;
                    let currently_enabled = launch.is_enabled().unwrap_or(false);
                    if want_enabled && !currently_enabled {
                        let _ = launch.enable().map_err(|e| eprintln!("[autostart] enable failed: {}", e));
                    } else if !want_enabled && currently_enabled {
                        let _ = launch.disable().map_err(|e| eprintln!("[autostart] disable failed: {}", e));
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::list_clips,
            commands::get_clip_text,
            commands::list_groups,
            commands::recopy_clip,
            commands::recopy_image,
            commands::allow_image_preview,
            commands::pin_toggle,
            commands::save_group,
            commands::delete_group,
            commands::move_clip_to_group,
            commands::delete_clip,
            commands::clear_history,
            commands::update_settings,
            commands::update_hotkey_setting,
            commands::hide_window,
            commands::quit_app,
            commands::check_update,
            commands::unregister_all_shortcuts,
            commands::reload_global_shortcuts,
            commands::backup_data,
            commands::restore_backup,
            commands::bing_translate
        ])
        .run(tauri::generate_context!())
        .expect("error while running trayclip");
}

#[cfg(test)]
mod tests {
    use super::{image_file_name, verify_and_rebase_db};

    #[test]
    fn image_file_name_handles_both_separators() {
        assert_eq!(image_file_name(r"C:\data\images\abc.png"), Some("abc.png"));
        assert_eq!(image_file_name("/var/data/images/abc.png"), Some("abc.png"));
        assert_eq!(image_file_name("abc.png"), Some("abc.png"));
    }

    #[test]
    fn image_file_name_rejects_paths_without_a_file_name() {
        assert_eq!(image_file_name(""), None);
        assert_eq!(image_file_name(r"C:\data\images\"), None);
    }

    #[test]
    fn verify_and_rebase_db_rejects_files_that_are_not_databases() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("trayclip.db");
        std::fs::write(&db, b"definitely not sqlite").unwrap();

        assert!(verify_and_rebase_db(&db, dir.path()).is_err());
    }

    #[test]
    fn verify_and_rebase_db_rejects_tables_missing_columns() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("trayclip.db");
        let conn = rusqlite::Connection::open(&db).unwrap();
        // Every table but `clips` is complete. `CREATE TABLE IF NOT EXISTS` never alters an
        // existing table, so a short `clips` can only be caught by the queries the app runs
        // at startup - which is exactly what the validation now executes.
        conn.execute_batch(
            "CREATE TABLE clips (id INTEGER PRIMARY KEY, image_path TEXT);
             CREATE TABLE clip_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1), retention_limit INTEGER NOT NULL, launch_on_startup INTEGER NOT NULL, pause_capture INTEGER NOT NULL, locale TEXT NOT NULL, accessibility_prompted INTEGER NOT NULL, close_behavior TEXT NOT NULL DEFAULT 'hide');
             CREATE TABLE hotkey_settings (action_key TEXT PRIMARY KEY, hotkey_value TEXT NOT NULL);
             INSERT INTO app_settings(id, retention_limit, launch_on_startup, pause_capture, locale, accessibility_prompted) VALUES(1, 200, 0, 0, 'zh-CN', 0);",
        )
        .unwrap();
        drop(conn);

        assert!(verify_and_rebase_db(&db, dir.path()).is_err());
    }

    #[test]
    fn verify_and_rebase_db_accepts_a_real_schema_and_rebases_image_paths() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("trayclip.db");
        let conn = rusqlite::Connection::open(&db).unwrap();
        // Built by the same function the app uses, so the fixture cannot drift away from
        // the schema it is supposed to be exercising.
        crate::db::initialize_database(&conn).unwrap();
        conn.execute(
            "INSERT INTO clips(content_type, plain_text, summary, image_path, file_paths_json, source_app, is_pinned, is_truncated, created_at, updated_at, content_hash, position_updated_at)
             VALUES('image', NULL, 'shot', ?1, '[]', '-', 0, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'hash', '2026-01-01T00:00:00Z')",
            [r"C:\old\install\images\abc.png"],
        )
        .unwrap();
        drop(conn);

        assert_eq!(verify_and_rebase_db(&db, dir.path()).unwrap(), 1);

        let conn = rusqlite::Connection::open(&db).unwrap();
        let stored: String = conn
            .query_row("SELECT image_path FROM clips WHERE id = 1", [], |row| row.get(0))
            .unwrap();
        assert!(stored.ends_with("abc.png"));
        assert!(!stored.contains("install"));
    }
}
