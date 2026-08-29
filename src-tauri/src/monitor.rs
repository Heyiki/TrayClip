use tauri::{AppHandle, Emitter, Manager, Runtime};

use clipboard_master::{ClipboardHandler, CallbackResult, Master};

use crate::{app_state::AppState, clipboard, db, commands};

#[cfg(target_os = "windows")]
use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;

fn extract_url(text: &str) -> Option<String> {
    let start = text.find("https://").or_else(|| text.find("http://"))?;
    let rest = &text[start..];
    let end = rest.find(|c: char| c.is_whitespace()).unwrap_or(rest.len());
    let url = &rest[..end];
    let after_proto = &url[url.find("://").unwrap() + 3..];
    if after_proto.is_empty() { return None; }
    let host = after_proto.split('/').next().unwrap_or("");
    if host.is_empty() || host.starts_with(':') { return None; }
    if host == "localhost" || host.starts_with("localhost:") { return Some(url.to_string()); }
    if host.split(':').next().unwrap_or("").split('.').all(|p| p.parse::<u8>().is_ok()) { return Some(url.to_string()); }
    if host.contains('.') { return Some(url.to_string()); }
    None
}

#[cfg(target_os = "linux")]
fn try_read_clipboard(state: &AppState) -> Option<(String, crate::models::NewClipRecord)> {
    let mut cb = state.clipboard.try_lock()?;
    clipboard::read_clipboard_with_state(&state.paths, &mut cb).ok().flatten()
}

#[cfg(not(target_os = "linux"))]
fn try_read_clipboard(state: &AppState) -> Option<(String, crate::models::NewClipRecord)> {
    clipboard::read_clipboard(&state.paths).ok().flatten()
}

struct Monitor<R: Runtime> {
    app: AppHandle<R>,
    paused: bool,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    last_toast_seq: u32,
}

impl<R: Runtime> ClipboardHandler for Monitor<R> {
    fn on_clipboard_change(&mut self) -> CallbackResult {
        let state = self.app.state::<AppState>();
        let settings = state.settings.read().clone();

        if settings.pause_capture {
            self.paused = true;
            return CallbackResult::Next;
        }

        // First change after resume: just sync signature, skip processing
        if self.paused {
            self.paused = false;
            if let Some((sig, _)) = try_read_clipboard(&state) {
                *state.last_clip_signature.lock() = Some(sig);
            }
            #[cfg(target_os = "windows")]
            { self.last_toast_seq = unsafe { GetClipboardSequenceNumber() }; }
            return CallbackResult::Next;
        }

        let Some((signature, clip)) = try_read_clipboard(&state) else {
            return CallbackResult::Next;
        };

        let mut last_signature = state.last_clip_signature.lock();

        // URL toast — independent of DB dedup
        if settings.url_toast {
            if let Some(url) = clip.plain_text.as_deref().and_then(extract_url) {
                // Windows: sequence number — fires on every copy including identical re-copies
                #[cfg(target_os = "windows")]
                {
                    let seq = unsafe { GetClipboardSequenceNumber() };
                    if seq != self.last_toast_seq {
                        self.last_toast_seq = seq;
                        commands::show_url_toast_window(&self.app, &url);
                    }
                }
                // Non-Windows: signature — only fires when content changes
                #[cfg(not(target_os = "windows"))]
                {
                    if last_signature.as_ref() != Some(&signature) {
                        commands::show_url_toast_window(&self.app, &url);
                    }
                }
            }
        }

        // Ingest into DB only when content actually changed
        if last_signature.as_ref() != Some(&signature) {
            let mut ingest_result = Err(anyhow::anyhow!("clipboard ingest did not run"));
            for attempt in 0..3 {
                ingest_result = match state.pool.get() {
                    Ok(conn) => db::ingest_clip(&conn, &settings, clip.clone()),
                    Err(e) => Err(anyhow::anyhow!("failed to get db connection: {}", e)),
                };
                if ingest_result.is_ok() || attempt == 2 {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }

            match ingest_result {
                Ok(cleanup_images) => {
                    for image in cleanup_images {
                        let _ = std::fs::remove_file(image);
                    }
                    *last_signature = Some(signature);
                    let _ = self.app.emit("clips://updated", ());
                }
                Err(e) => {
                    eprintln!("[clipboard-monitor] failed to ingest clipboard content: {}", e);
                }
            }
        }

        CallbackResult::Next
    }

    fn on_clipboard_error(&mut self, error: std::io::Error) -> CallbackResult {
        eprintln!("[clipboard-monitor] error: {}", error);
        CallbackResult::Next
    }
}

pub fn spawn_clipboard_monitor<R: Runtime>(app: AppHandle<R>) {
    let handler = Monitor {
        app,
        paused: false,
        last_toast_seq: 0,
    };

    std::thread::spawn(move || {
        let mut master = Master::new(handler);
        if let Err(e) = master.run() {
            eprintln!("[clipboard-monitor] stopped: {}", e);
        }
    });
}
