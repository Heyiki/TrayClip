use std::time::Duration;
use anyhow::Context;
use chrono::Utc;
use r2d2::Pool;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::app_state::{DbPool, SqliteConnectionManager};
use crate::{models::{AppSettings, ClipContentType, ClipGroup, ClipRecord, HotkeySetting, ListClipsRequest, ListClipsResponse, NewClipRecord}, paths::AppPaths};

pub const SCHEMA_VERSION: i64 = 1;
#[cfg(target_os = "macos")]
pub const DEFAULT_MAIN_WINDOW_HOTKEY: &str = "Ctrl+P";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_MAIN_WINDOW_HOTKEY: &str = "Ctrl+Shift+V";

pub fn create_pool(paths: &AppPaths) -> anyhow::Result<DbPool> {
    let manager = SqliteConnectionManager::file(&paths.db_path);
    let pool = Pool::builder()
        .max_size(4)
        .connection_timeout(Duration::from_secs(5))
        .build(manager)?;
    // Run migrations on the first connection
    {
        let conn = pool.get()?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL,
                plain_text TEXT,
                rich_text TEXT,
                summary TEXT NOT NULL,
                image_path TEXT,
                file_paths_json TEXT NOT NULL DEFAULT '[]',
                source_app TEXT NOT NULL DEFAULT '—',
                is_pinned INTEGER NOT NULL DEFAULT 0,
                is_truncated INTEGER NOT NULL DEFAULT 0,
                group_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                content_hash TEXT NOT NULL,
                position_updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS clip_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                retention_limit INTEGER NOT NULL,
                launch_on_startup INTEGER NOT NULL,
                pause_capture INTEGER NOT NULL,
                locale TEXT NOT NULL,
                accessibility_prompted INTEGER NOT NULL,
                close_behavior TEXT NOT NULL DEFAULT 'hide'
            );
            CREATE TABLE IF NOT EXISTS hotkey_settings (
                action_key TEXT PRIMARY KEY,
                hotkey_value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_clips_group_id ON clips(group_id);
            CREATE INDEX IF NOT EXISTS idx_clips_is_pinned ON clips(is_pinned);
            CREATE INDEX IF NOT EXISTS idx_clips_content_hash ON clips(content_hash);
            "
        )?;
        ensure_defaults(&conn)?;
        mark_schema_version(&conn)?;
    }
    Ok(pool)
}

fn mark_schema_version(conn: &Connection) -> anyhow::Result<()> {
    let exists: Option<i64> = conn
        .query_row("SELECT version FROM schema_migrations WHERE version = ?1", [SCHEMA_VERSION], |row| row.get(0))
        .optional()?;

    if exists.is_none() {
        conn.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES(?1, ?2)",
            params![SCHEMA_VERSION, Utc::now().to_rfc3339()],
        )?;
    }

    Ok(())
}

fn ensure_defaults(conn: &Connection) -> anyhow::Result<()> {
    // Migration: add close_behavior column if missing
    let has_column: bool = conn
        .prepare("SELECT close_behavior FROM app_settings LIMIT 0")
        .is_ok();
    if !has_column {
        let _ = conn.execute("ALTER TABLE app_settings ADD COLUMN close_behavior TEXT NOT NULL DEFAULT 'hide'", []);
    }

    // Migration: add panel_position column if missing
    let has_panel_pos: bool = conn
        .prepare("SELECT panel_position FROM app_settings LIMIT 0")
        .is_ok();
    if !has_panel_pos {
        let _ = conn.execute("ALTER TABLE app_settings ADD COLUMN panel_position TEXT NOT NULL DEFAULT 'center'", []);
    }

    // Migration: add quick_paste column if missing
    let has_quick_paste: bool = conn
        .prepare("SELECT quick_paste FROM app_settings LIMIT 0")
        .is_ok();
    if !has_quick_paste {
        let _ = conn.execute("ALTER TABLE app_settings ADD COLUMN quick_paste INTEGER NOT NULL DEFAULT 0", []);
    }

    // Migration: add url_toast column if missing
    let has_url_toast: bool = conn
        .prepare("SELECT url_toast FROM app_settings LIMIT 0")
        .is_ok();
    if !has_url_toast {
        let _ = conn.execute("ALTER TABLE app_settings ADD COLUMN url_toast INTEGER NOT NULL DEFAULT 0", []);
    }

    // Migration: add llm_config column if missing
    let has_llm_config: bool = conn
        .prepare("SELECT llm_config FROM app_settings LIMIT 0")
        .is_ok();
    if !has_llm_config {
        let _ = conn.execute("ALTER TABLE app_settings ADD COLUMN llm_config TEXT NOT NULL DEFAULT '{}'", []);
    }

    conn.execute(
        "INSERT OR IGNORE INTO app_settings(id, retention_limit, launch_on_startup, pause_capture, locale, accessibility_prompted, close_behavior, panel_position, quick_paste, url_toast, llm_config)
         VALUES(1, 200, 0, 0, 'zh-CN', 0, 'hide', 'center', 0, 0, '{}')",
        [],
    )?;

    conn.execute(
        "INSERT OR IGNORE INTO hotkey_settings(action_key, hotkey_value) VALUES('open_main_window', ?1)",
        [DEFAULT_MAIN_WINDOW_HOTKEY],
    )?;
    Ok(())
}

pub fn migrate_quick_panel_hotkey_to_main_window(conn: &Connection) -> anyhow::Result<()> {
    let quick_panel_hotkey: Option<String> = conn
        .query_row(
            "SELECT hotkey_value FROM hotkey_settings WHERE action_key = 'open_quick_panel'",
            [],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(hotkey_value) = quick_panel_hotkey {
        conn.execute("DELETE FROM hotkey_settings WHERE action_key = 'open_main_window'", [])?;
        conn.execute(
            "INSERT INTO hotkey_settings(action_key, hotkey_value) VALUES('open_main_window', ?1)",
            [hotkey_value],
        )?;
    } else {
        conn.execute(
            "INSERT OR IGNORE INTO hotkey_settings(action_key, hotkey_value) VALUES('open_main_window', ?1)",
            [DEFAULT_MAIN_WINDOW_HOTKEY],
        )?;
    }

    conn.execute("DELETE FROM hotkey_settings WHERE action_key = 'open_quick_panel'", [])?;
    Ok(())
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct LlmConfigStore {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    api_url: String,
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    ai_translate: bool,
}

fn normalize_quick_paste(value: i64) -> i64 {
    match value {
        1 | 2 => value,
        _ => 0,
    }
}

pub fn load_settings(conn: &Connection) -> anyhow::Result<AppSettings> {
    let result = conn.query_row(
        "SELECT retention_limit, launch_on_startup, pause_capture, locale, accessibility_prompted, close_behavior, panel_position, quick_paste, url_toast, llm_config FROM app_settings WHERE id = 1",
        [],
        |row| {
            let llm_json: String = row.get(9)?;
            let llm: LlmConfigStore = serde_json::from_str(&llm_json).unwrap_or_default();
            Ok(AppSettings {
                retention_limit: row.get(0)?,
                launch_on_startup: row.get::<_, i64>(1)? == 1,
                pause_capture: row.get::<_, i64>(2)? == 1,
                locale: row.get(3)?,
                accessibility_prompted: row.get::<_, i64>(4)? == 1,
                close_behavior: row.get(5)?,
                panel_position: row.get(6)?,
                quick_paste: normalize_quick_paste(row.get::<_, i64>(7)?),
                url_toast: row.get::<_, i64>(8)? == 1,
                llm_enabled: llm.enabled,
                llm_api_url: llm.api_url,
                llm_api_key: llm.api_key,
                llm_model: llm.model,
                llm_ai_translate: llm.ai_translate,
            })
        },
    );
    result.context("failed to load app settings")
}

pub fn save_settings(conn: &Connection, settings: &AppSettings) -> anyhow::Result<(AppSettings, Vec<String>)> {
    let llm_config = LlmConfigStore {
        enabled: settings.llm_enabled,
        api_url: settings.llm_api_url.clone(),
        api_key: settings.llm_api_key.clone(),
        model: settings.llm_model.clone(),
        ai_translate: settings.llm_ai_translate,
    };
    let quick_paste = normalize_quick_paste(settings.quick_paste);
    let llm_json = serde_json::to_string(&llm_config)?;
    conn.execute(
        "UPDATE app_settings SET retention_limit = ?1, launch_on_startup = ?2, pause_capture = ?3, locale = ?4, accessibility_prompted = ?5, close_behavior = ?6, panel_position = ?7, quick_paste = ?8, url_toast = ?9, llm_config = ?10 WHERE id = 1",
        params![settings.retention_limit, settings.launch_on_startup as i64, settings.pause_capture as i64, settings.locale, settings.accessibility_prompted as i64, settings.close_behavior, settings.panel_position, quick_paste, settings.url_toast as i64, llm_json],
    )?;
    let removed_images = cleanup_overflow(conn, settings.retention_limit)?;
    Ok((load_settings(conn)?, removed_images))
}

pub fn list_hotkeys(conn: &Connection) -> anyhow::Result<Vec<HotkeySetting>> {
    let mut statement = conn.prepare("SELECT action_key, hotkey_value FROM hotkey_settings ORDER BY action_key ASC")?;
    let rows = statement.query_map([], |row| Ok(HotkeySetting { action_key: row.get(0)?, hotkey_value: row.get(1)? }))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn save_hotkey(conn: &Connection, action_key: &str, hotkey_value: &str) -> anyhow::Result<HotkeySetting> {
    let conflict: Option<String> = conn
        .query_row(
            "SELECT action_key FROM hotkey_settings WHERE hotkey_value = ?1 AND action_key != ?2",
            params![hotkey_value, action_key],
            |row| row.get(0),
        )
        .optional()?;

    if conflict.is_some() {
        anyhow::bail!("快捷键冲突");
    }

    conn.execute(
        "INSERT INTO hotkey_settings(action_key, hotkey_value) VALUES(?1, ?2)
         ON CONFLICT(action_key) DO UPDATE SET hotkey_value = excluded.hotkey_value",
        params![action_key, hotkey_value],
    )?;

    Ok(HotkeySetting {
        action_key: action_key.to_string(),
        hotkey_value: hotkey_value.to_string(),
    })
}

pub fn list_groups(conn: &Connection) -> anyhow::Result<Vec<ClipGroup>> {
    let mut statement = conn.prepare("SELECT id, name, created_at, updated_at FROM clip_groups ORDER BY id ASC")?;
    let rows = statement.query_map([], |row| {
        Ok(ClipGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn save_group(conn: &Connection, group_id: Option<i64>, group_name: &str) -> anyhow::Result<ClipGroup> {
    let now = Utc::now().to_rfc3339();
    match group_id {
        Some(id) => {
            conn.execute("UPDATE clip_groups SET name = ?1, updated_at = ?2 WHERE id = ?3", params![group_name, now, id])?;
            get_group(conn, id)
        }
        None => {
            conn.execute("INSERT INTO clip_groups(name, created_at, updated_at) VALUES(?1, ?2, ?2)", params![group_name, now])?;
            get_group(conn, conn.last_insert_rowid())
        }
    }
}

pub fn get_group(conn: &Connection, group_id: i64) -> anyhow::Result<ClipGroup> {
    conn.query_row(
        "SELECT id, name, created_at, updated_at FROM clip_groups WHERE id = ?1",
        [group_id],
        |row| {
            Ok(ClipGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    ).context("failed to load group")
}

pub fn delete_group(conn: &Connection, group_id: i64) -> anyhow::Result<()> {
    conn.execute("UPDATE clips SET group_id = NULL WHERE group_id = ?1", [group_id])?;
    conn.execute("DELETE FROM clip_groups WHERE id = ?1", [group_id])?;
    Ok(())
}

pub fn move_clip_to_group(conn: &Connection, clip_id: i64, group_id: Option<i64>) -> anyhow::Result<()> {
    conn.execute("UPDATE clips SET group_id = ?1, updated_at = ?2 WHERE id = ?3", params![group_id, Utc::now().to_rfc3339(), clip_id])?;
    Ok(())
}

pub fn pin_toggle(conn: &Connection, clip_id: i64, pinned: bool) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE clips SET is_pinned = ?1, position_updated_at = ?2, updated_at = ?2 WHERE id = ?3",
        params![pinned as i64, Utc::now().to_rfc3339(), clip_id],
    )?;
    Ok(())
}

fn map_clip(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipRecord> {
    let raw_type: String = row.get(1)?;
    let content_type = match raw_type.as_str() {
        "plain_text" => ClipContentType::PlainText,
        "rich_text" => ClipContentType::RichText,
        "image" => ClipContentType::Image,
        "file_paths" => ClipContentType::FilePaths,
        _ => ClipContentType::PlainText,
    };
    let file_paths_json: String = row.get(6)?;
    let file_paths: Vec<String> = serde_json::from_str(&file_paths_json).unwrap_or_default();

    Ok(ClipRecord {
        id: row.get(0)?,
        content_type,
        plain_text: row.get(2)?,
        rich_text: row.get(3)?,
        summary: row.get(4)?,
        image_path: row.get(5)?,
        file_paths,
        source_app: row.get(7)?,
        is_pinned: row.get::<_, i64>(8)? == 1,
        is_truncated: row.get::<_, i64>(9)? == 1,
        group_id: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        last_used_at: row.get(13)?,
    })
}

pub fn get_clip_by_id(conn: &Connection, clip_id: i64) -> anyhow::Result<ClipRecord> {
    conn.query_row(
        "SELECT id, content_type, plain_text, rich_text, summary, image_path, file_paths_json, source_app, is_pinned, is_truncated, group_id, created_at, updated_at, last_used_at FROM clips WHERE id = ?1",
        [clip_id],
        map_clip,
    ).context("failed to load clip")
}

pub fn list_clips(conn: &Connection, request: &ListClipsRequest) -> anyhow::Result<ListClipsResponse> {
    let page = request.page.max(1);
    let page_size = request.page_size.clamp(1, 100);
    let offset = (page - 1) * page_size;
    let keyword = request.keyword.clone().unwrap_or_default().to_lowercase();
    let like_keyword = format!("%{}%", keyword);
    let group_id = request.group_id;
    let pinned_only = request.pinned_only.unwrap_or(false) as i64;

    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM clips WHERE (?1 = '' OR LOWER(COALESCE(plain_text, '') || ' ' || summary) LIKE ?2) AND (?3 IS NULL OR group_id = ?3) AND (?4 = 0 OR is_pinned = 1)",
        params![keyword, like_keyword, group_id, pinned_only],
        |row| row.get(0),
    )?;

    let mut statement = conn.prepare(
        "SELECT id, content_type, plain_text, rich_text, summary, image_path, file_paths_json, source_app, is_pinned, is_truncated, group_id, created_at, updated_at, last_used_at FROM clips WHERE (?1 = '' OR LOWER(COALESCE(plain_text, '') || ' ' || summary) LIKE ?2) AND (?3 IS NULL OR group_id = ?3) AND (?4 = 0 OR is_pinned = 1) ORDER BY is_pinned DESC, position_updated_at DESC, id DESC LIMIT ?5 OFFSET ?6",
    )?;
    let rows = statement.query_map(params![keyword, like_keyword, group_id, pinned_only, page_size, offset], map_clip)?;
    let items = rows.collect::<Result<Vec<_>, _>>()?;

    Ok(ListClipsResponse {
        has_more: offset + page_size < total,
        items,
        total,
    })
}

pub fn delete_clip(conn: &Connection, clip_id: i64) -> anyhow::Result<Option<String>> {
    let image_path: Option<Option<String>> = conn.query_row("SELECT image_path FROM clips WHERE id = ?1", [clip_id], |row| row.get(0)).optional()?;
    conn.execute("DELETE FROM clips WHERE id = ?1", [clip_id])?;
    Ok(image_path.flatten())
}

pub fn clear_history(conn: &Connection) -> anyhow::Result<Vec<String>> {
    let mut statement = conn.prepare("SELECT image_path FROM clips WHERE is_pinned = 0 AND image_path IS NOT NULL")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    let image_paths = rows.collect::<Result<Vec<_>, _>>()?;
    conn.execute("DELETE FROM clips WHERE is_pinned = 0", [])?;
    Ok(image_paths)
}

pub fn compute_hash(content_type: &ClipContentType, plain_text: &Option<String>, rich_text: &Option<String>, file_paths: &[String], summary: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(serde_json::to_string(content_type).unwrap_or_default());
    hasher.update(plain_text.clone().unwrap_or_default());
    hasher.update(rich_text.clone().unwrap_or_default());
    hasher.update(summary);
    hasher.update(file_paths.join("\n"));
    format!("{:x}", hasher.finalize())
}

fn content_type_key(content_type: &ClipContentType) -> &'static str {
    match content_type {
        ClipContentType::PlainText => "plain_text",
        ClipContentType::RichText => "rich_text",
        ClipContentType::Image => "image",
        ClipContentType::FilePaths => "file_paths",
    }
}

pub fn ingest_clip(conn: &Connection, settings: &AppSettings, payload: NewClipRecord) -> anyhow::Result<Vec<String>> {
    let now = Utc::now().to_rfc3339();
    let content_type = content_type_key(&payload.content_type);
    let existing_clip_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM clips WHERE content_type = ?1 AND content_hash = ?2 ORDER BY position_updated_at DESC, id DESC LIMIT 1",
            params![content_type, payload.content_hash],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(clip_id) = existing_clip_id {
        conn.execute(
            "UPDATE clips SET plain_text = ?1, rich_text = ?2, summary = ?3, image_path = ?4, file_paths_json = ?5, source_app = ?6, is_truncated = ?7, updated_at = ?8, position_updated_at = ?8 WHERE id = ?9",
            params![payload.plain_text, payload.rich_text, payload.summary, payload.image_path, serde_json::to_string(&payload.file_paths)?, payload.source_app, payload.is_truncated as i64, now, clip_id],
        )?;
        conn.execute(
            "DELETE FROM clips WHERE content_type = ?1 AND content_hash = ?2 AND id != ?3",
            params![content_type, payload.content_hash, clip_id],
        )?;
        // UPDATE doesn't increase count, skip overflow check
        return Ok(Vec::new());
    }

    conn.execute(
        "INSERT INTO clips(content_type, plain_text, rich_text, summary, image_path, file_paths_json, source_app, is_pinned, is_truncated, group_id, created_at, updated_at, last_used_at, content_hash, position_updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, NULL, ?9, ?9, NULL, ?10, ?9)",
        params![content_type, payload.plain_text, payload.rich_text, payload.summary, payload.image_path, serde_json::to_string(&payload.file_paths)?, payload.source_app, payload.is_truncated as i64, now, payload.content_hash],
    )?;
    let images = cleanup_overflow(conn, settings.retention_limit)?;
    Ok(images)
}

pub fn cleanup_overflow(conn: &Connection, retention_limit: i64) -> anyhow::Result<Vec<String>> {
    let count = conn.query_row("SELECT COUNT(*) FROM clips", [], |row| row.get::<_, i64>(0))?;
    let overflow = count - retention_limit;
    if overflow <= 0 {
        return Ok(Vec::new());
    }

    let mut statement = conn.prepare("SELECT image_path FROM clips WHERE is_pinned = 0 ORDER BY position_updated_at ASC LIMIT ?1")?;
    let image_paths: Vec<String> = statement
        .query_map([overflow], |row| row.get::<_, Option<String>>(0))?
        .filter_map(|r| r.ok().flatten())
        .collect();

    conn.execute(
        "DELETE FROM clips WHERE id IN (SELECT id FROM clips WHERE is_pinned = 0 ORDER BY position_updated_at ASC LIMIT ?1)",
        [overflow],
    )?;

    Ok(image_paths)
}

pub fn mark_clip_used(conn: &Connection, clip_id: i64) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE clips SET last_used_at = ?1, updated_at = ?1, position_updated_at = ?1 WHERE id = ?2",
        params![Utc::now().to_rfc3339(), clip_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_app_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                retention_limit INTEGER NOT NULL,
                launch_on_startup INTEGER NOT NULL,
                pause_capture INTEGER NOT NULL,
                locale TEXT NOT NULL,
                accessibility_prompted INTEGER NOT NULL,
                close_behavior TEXT NOT NULL DEFAULT 'hide',
                panel_position TEXT NOT NULL DEFAULT 'center',
                quick_paste INTEGER NOT NULL DEFAULT 0,
                url_toast INTEGER NOT NULL DEFAULT 0,
                llm_config TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL,
                plain_text TEXT,
                rich_text TEXT,
                summary TEXT NOT NULL,
                image_path TEXT,
                file_paths_json TEXT NOT NULL DEFAULT '[]',
                source_app TEXT NOT NULL DEFAULT '—',
                is_pinned INTEGER NOT NULL DEFAULT 0,
                is_truncated INTEGER NOT NULL DEFAULT 0,
                group_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                content_hash TEXT NOT NULL,
                position_updated_at TEXT NOT NULL
            );
            ",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO app_settings(id, retention_limit, launch_on_startup, pause_capture, locale, accessibility_prompted, close_behavior, panel_position, quick_paste, url_toast, llm_config)
             VALUES(1, 200, 0, 0, 'zh-CN', 0, 'hide', 'center', 0, 0, '{}')",
            [],
        )
        .unwrap();
        conn
    }

    fn setup_hotkey_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE hotkey_settings (
                action_key TEXT PRIMARY KEY,
                hotkey_value TEXT NOT NULL
            );
            ",
        )
        .unwrap();
        conn
    }

    fn insert_clip(conn: &Connection, id: i64, image_path: Option<&str>, position_updated_at: &str) {
        conn.execute(
            "INSERT INTO clips(id, content_type, plain_text, rich_text, summary, image_path, file_paths_json, source_app, is_pinned, is_truncated, group_id, created_at, updated_at, last_used_at, content_hash, position_updated_at)
             VALUES(?1, 'image', NULL, NULL, ?2, ?3, '[]', '—', 0, 0, NULL, ?4, ?4, NULL, ?5, ?4)",
            params![id, format!("clip-{id}"), image_path, position_updated_at, format!("hash-{id}")],
        )
        .unwrap();
    }

    #[test]
    fn migrate_quick_panel_hotkey_promotes_value_to_main_window() {
        let conn = setup_hotkey_conn();
        conn.execute(
            "INSERT INTO hotkey_settings(action_key, hotkey_value) VALUES(?1, ?2)",
            params!["open_main_window", "Ctrl+Shift+Space"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO hotkey_settings(action_key, hotkey_value) VALUES(?1, ?2)",
            params!["open_quick_panel", "Ctrl+Shift+V"],
        )
        .unwrap();

        migrate_quick_panel_hotkey_to_main_window(&conn).unwrap();

        let rows = list_hotkeys(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].action_key, "open_main_window");
        assert_eq!(rows[0].hotkey_value, "Ctrl+Shift+V");
    }

    #[test]
    fn migrate_quick_panel_hotkey_keeps_existing_main_when_quick_panel_missing() {
        let conn = setup_hotkey_conn();
        conn.execute(
            "INSERT INTO hotkey_settings(action_key, hotkey_value) VALUES(?1, ?2)",
            params!["open_main_window", "Ctrl+Shift+Space"],
        )
        .unwrap();

        migrate_quick_panel_hotkey_to_main_window(&conn).unwrap();

        let rows = list_hotkeys(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].action_key, "open_main_window");
        assert_eq!(rows[0].hotkey_value, "Ctrl+Shift+Space");
    }

    #[test]
    fn save_settings_prunes_overflow_and_returns_deleted_image_paths() {
        let conn = setup_app_conn();
        insert_clip(&conn, 1, Some("D:/images/oldest.png"), "2024-01-01T00:00:00Z");
        insert_clip(&conn, 2, None, "2024-01-01T00:00:01Z");
        insert_clip(&conn, 3, Some("D:/images/newest.png"), "2024-01-01T00:00:02Z");

        let mut settings = load_settings(&conn).unwrap();
        settings.retention_limit = 2;

        let (saved, removed_images) = save_settings(&conn, &settings).unwrap();

        assert_eq!(saved.retention_limit, 2);
        assert_eq!(removed_images, vec!["D:/images/oldest.png".to_string()]);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM clips", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 2);

        let remaining_ids: Vec<i64> = conn
            .prepare("SELECT id FROM clips ORDER BY id ASC")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(remaining_ids, vec![2, 3]);
    }

    #[test]
    fn load_settings_preserves_copy_after_behavior_values() {
        let conn = setup_app_conn();

        conn.execute("UPDATE app_settings SET quick_paste = 1 WHERE id = 1", []).unwrap();
        assert_eq!(load_settings(&conn).unwrap().quick_paste, 1);

        conn.execute("UPDATE app_settings SET quick_paste = 2 WHERE id = 1", []).unwrap();
        assert_eq!(load_settings(&conn).unwrap().quick_paste, 2);
    }

    #[test]
    fn cleanup_overflow_skips_null_image_paths_and_keeps_image_paths_for_deleted_rows() {
        let conn = setup_app_conn();
        insert_clip(&conn, 1, None, "2024-01-01T00:00:00Z");
        insert_clip(&conn, 2, Some("D:/images/second.png"), "2024-01-01T00:00:01Z");
        insert_clip(&conn, 3, Some("D:/images/third.png"), "2024-01-01T00:00:02Z");

        let removed_images = cleanup_overflow(&conn, 1).unwrap();

        assert_eq!(removed_images, vec!["D:/images/second.png".to_string()]);

        let remaining_ids: Vec<i64> = conn
            .prepare("SELECT id FROM clips ORDER BY id ASC")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(remaining_ids, vec![3]);
    }
}
