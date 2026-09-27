#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

/// Returns the application that most likely owns the current clipboard.
/// Platform support is best-effort; an unknown owner must never block capture.
pub fn detect() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        return windows::detect();
    }
    #[cfg(target_os = "macos")]
    {
        return macos::detect();
    }
    #[cfg(target_os = "linux")]
    {
        return linux::detect();
    }
    #[allow(unreachable_code)]
    None
}
