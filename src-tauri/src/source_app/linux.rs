use std::process::Command;

pub fn detect() -> Option<String> {
    // X11 exposes the active window and its PID through EWMH properties.
    // Wayland environments normally do not expose this information; in that
    // case xprop is unavailable or returns no window and capture continues.
    let active = Command::new("xprop")
        .args(["-root", "_NET_ACTIVE_WINDOW"])
        .output()
        .ok()?;
    if !active.status.success() {
        return None;
    }
    let active_text = String::from_utf8_lossy(&active.stdout);
    let window_id = active_text.split_whitespace().last()?.trim();
    if window_id == "0x0" {
        return None;
    }

    let window = Command::new("xprop")
        .args(["-id", window_id, "_NET_WM_PID"])
        .output()
        .ok()?;
    if !window.status.success() {
        return None;
    }
    let pid = String::from_utf8_lossy(&window.stdout)
        .split_whitespace()
        .last()?
        .parse::<u32>()
        .ok()?;
    let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let name = comm.trim().to_string();
    (!name.is_empty()).then_some(name)
}
