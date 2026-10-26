use std::path::PathBuf;

use anyhow::Context;
use tauri::Manager;

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub db_path: PathBuf,
    pub images_dir: PathBuf,
}

/// The one place that decides where the data directory lives. Normal startup and the
/// pending-restore pass both call this, so they can never pick different directories on the
/// same machine.
///
/// macOS keeps data in `app_data_dir()`, because `resource_dir()` is inside the .app bundle
/// and gets replaced on update. Windows/Linux prefer `resource_dir()/data`, which survives
/// updates, and fall back to `app_data_dir()`.
pub fn resolve_root_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> anyhow::Result<PathBuf> {
    let resolver = app.path();

    #[cfg(target_os = "macos")]
    let candidate_dirs = [
        resolver.app_data_dir().context("failed to resolve app data directory")?,
    ];

    #[cfg(not(target_os = "macos"))]
    let install_dir = resolver
        .resource_dir()
        .or_else(|_| resolver.app_config_dir())
        .or_else(|_| resolver.app_data_dir())
        .context("failed to resolve application directories")?;

    #[cfg(not(target_os = "macos"))]
    let candidate_dirs = [
        install_dir.join("data"),
        resolver.app_data_dir().context("failed to resolve app data directory")?,
    ];

    candidate_dirs
        .iter()
        .find(|dir| dir.join("trayclip.db").exists())
        .cloned()
        .or_else(|| {
            candidate_dirs
                .iter()
                .find(|dir| std::fs::create_dir_all(dir).is_ok())
                .cloned()
        })
        .context("failed to create writable data directory")
}

impl AppPaths {
    pub fn resolve<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> anyhow::Result<Self> {
        let root_dir = resolve_root_dir(app)?;

        let db_path = root_dir.join("trayclip.db");
        let images_dir = root_dir.join("images");

        std::fs::create_dir_all(&images_dir)?;

        Ok(Self { db_path, images_dir })
    }
}
