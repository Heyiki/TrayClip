#[cfg(target_os = "linux")]
use arboard::Clipboard;
use parking_lot::{Mutex, RwLock};
use r2d2::Pool;
use rusqlite::Connection;

use crate::{models::AppSettings, paths::AppPaths};

pub struct SqliteConnectionManager {
    path: std::path::PathBuf,
}

impl SqliteConnectionManager {
    pub fn file(path: impl Into<std::path::PathBuf>) -> Self {
        Self { path: path.into() }
    }
}

impl r2d2::ManageConnection for SqliteConnectionManager {
    type Connection = Connection;
    type Error = rusqlite::Error;

    fn connect(&self) -> Result<Connection, rusqlite::Error> {
        let conn = Connection::open(&self.path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;")?;
        Ok(conn)
    }

    fn is_valid(&self, conn: &mut Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch("SELECT 1")
    }

    fn has_broken(&self, _conn: &mut Connection) -> bool {
        false
    }
}

pub type DbPool = Pool<SqliteConnectionManager>;

pub struct AppState {
    pub pool: DbPool,
    pub paths: AppPaths,
    pub settings: RwLock<AppSettings>,
    pub last_clip_signature: Mutex<Option<String>>,
    /// Held by backup for its whole run. Image cleanup paths take it too, so a retention
    /// pass cannot delete a file while an archive is reading it.
    pub image_cleanup_lock: Mutex<()>,
    #[cfg(target_os = "windows")]
    pub previous_hwnd: Mutex<usize>,
    #[cfg(target_os = "linux")]
    pub clipboard: Mutex<Clipboard>,
}
