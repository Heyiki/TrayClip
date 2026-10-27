//! Window placement shared by the main window and the URL toast.
//!
//! Two rules keep multi-display setups predictable:
//!
//! 1. The screen comes from the pointer, not from the window. A hidden window keeps sitting
//!    on whichever display it was last shown on, so anchoring to it puts the window back on
//!    the old display while the user is looking at another one.
//! 2. Every number lives in the units `set_position` consumes: physical pixels on
//!    Windows/Linux, points on macOS. The macOS runtime fabricates a "physical" space by
//!    scaling each display's points by that display's own factor, so displays with different
//!    scales overlap in it - points are the only space shared by all of them, and
//!    `Position::Logical` takes points as-is.

use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, Position};
#[cfg(not(target_os = "macos"))]
use tauri::{PhysicalPosition, Position};

/// One screen's usable rectangle (the work area: no menu bar, Dock or taskbar).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Screen {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Working units per logical point: 1.0 on macOS, the display scale elsewhere.
    pub units_per_point: f64,
}

impl Screen {
    /// The screen under the pointer, so the window opens where the user is looking. Falls
    /// back to the screen the window sits on and then to the primary one, which is what
    /// keeps an unplugged display from stranding the window off-screen.
    pub(crate) fn under_cursor<R: Runtime>(window: &WebviewWindow<R>) -> Option<Self> {
        if let Some((x, y)) = cursor_position(window) {
            // `monitor_from_point` works in the same space `cursor_position` reports.
            if let Ok(Some(monitor)) = window.monitor_from_point(x, y) {
                return Some(Self::of(&monitor));
            }
        }

        window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten())
            .map(|monitor| Self::of(&monitor))
    }

    fn of(monitor: &tauri::Monitor) -> Self {
        let area = monitor.work_area();
        // A zero-sized work area means the platform reported nothing usable; the full screen
        // is a better answer than a point-sized rectangle.
        let (x, y, width, height) = if area.size.width > 0 && area.size.height > 0 {
            (area.position.x, area.position.y, area.size.width as i32, area.size.height as i32)
        } else {
            let position = monitor.position();
            let size = monitor.size();
            (position.x, position.y, size.width as i32, size.height as i32)
        };
        let scale = monitor.scale_factor();

        #[cfg(target_os = "macos")]
        {
            // Reported values are this display's points scaled by its own factor, so they
            // only invert back to points with the same factor.
            let points = |value: i32| value as f64 / scale;
            Self {
                x: points(x),
                y: points(y),
                width: points(width),
                height: points(height),
                units_per_point: 1.0,
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            Self {
                x: x as f64,
                y: y as f64,
                width: width as f64,
                height: height as f64,
                units_per_point: scale,
            }
        }
    }
}

/// Pointer position in the same units `Screen` uses.
pub(crate) fn cursor_position<R: Runtime>(window: &WebviewWindow<R>) -> Option<(f64, f64)> {
    let cursor = window.cursor_position().ok()?;

    #[cfg(target_os = "macos")]
    {
        // The macOS runtime multiplies the AppKit point coordinates by the primary display's
        // scale factor, while points are what `monitor_from_point` matches and what
        // `Position::Logical` consumes.
        let primary_scale = window
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(1.0);
        Some((cursor.x / primary_scale, cursor.y / primary_scale))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some((cursor.x, cursor.y))
    }
}

/// Settles the window's top-left corner: centered in `screen`, or next to the pointer with
/// `offset` applied when `panel_position` is `follow_mouse` and a pointer position is known.
pub(crate) fn resolve(
    panel_position: &str,
    size: (f64, f64),
    screen: &Screen,
    cursor: Option<(f64, f64)>,
    offset: (f64, f64),
) -> (f64, f64) {
    // The upper bound never drops below the origin: a window larger than the screen must stay
    // at the top-left corner instead of inverting the clamp range.
    let max_x = (screen.x + screen.width - size.0).max(screen.x);
    let max_y = (screen.y + screen.height - size.1).max(screen.y);

    if panel_position == "follow_mouse" {
        if let Some((cursor_x, cursor_y)) = cursor {
            return (
                (cursor_x + offset.0).clamp(screen.x, max_x),
                (cursor_y + offset.1).clamp(screen.y, max_y),
            );
        }
    }

    (
        // Centering is clamped too: a window larger than the screen would otherwise hang off
        // the top-left corner, hiding the part the user actually needs.
        (screen.x + (screen.width - size.0) / 2.0).clamp(screen.x, max_x),
        (screen.y + (screen.height - size.1) / 2.0).clamp(screen.y, max_y),
    )
}

/// Places a `fallback_size` window following `panel_position`, with `offset_logical` as the
/// gap between the pointer and the window corner when it follows the mouse.
pub(crate) fn place<R: Runtime>(
    window: &WebviewWindow<R>,
    panel_position: &str,
    fallback_size: (f64, f64),
    offset_logical: (f64, f64),
) {
    let Some(screen) = Screen::under_cursor(window) else { return };

    // Sizes and gaps are configured in logical points; the screen tells how many working
    // units one point is worth on the display the window is about to land on.
    let logical_size = logical_size(window, fallback_size);
    let size = (
        logical_size.0 * screen.units_per_point,
        logical_size.1 * screen.units_per_point,
    );
    let offset = (
        offset_logical.0 * screen.units_per_point,
        offset_logical.1 * screen.units_per_point,
    );

    let (x, y) = resolve(panel_position, size, &screen, cursor_position(window), offset);
    apply(window, x, y);
}

/// The window's size in logical points, read from the window so it cannot drift away from
/// `tauri.conf.json`; `fallback` covers a window the platform has not sized yet.
fn logical_size<R: Runtime>(window: &WebviewWindow<R>, fallback: (f64, f64)) -> (f64, f64) {
    let Ok(size) = window.inner_size() else { return fallback };
    if size.width == 0 || size.height == 0 {
        return fallback;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    (size.width as f64 / scale, size.height as f64 / scale)
}

fn apply<R: Runtime>(window: &WebviewWindow<R>, x: f64, y: f64) {
    #[cfg(target_os = "macos")]
    let _ = window.set_position(Position::Logical(LogicalPosition { x, y }));

    #[cfg(not(target_os = "macos"))]
    let _ = window.set_position(Position::Physical(PhysicalPosition {
        x: x.round() as i32,
        y: y.round() as i32,
    }));
}

#[cfg(test)]
mod tests {
    use super::{resolve, Screen};

    fn screen(x: f64, y: f64, width: f64, height: f64, units_per_point: f64) -> Screen {
        Screen { x, y, width, height, units_per_point }
    }

    #[test]
    fn centers_within_the_given_screen() {
        let bounds = screen(100.0, 50.0, 1920.0, 1080.0, 2.0);
        let size = (400.0, 500.0);

        assert_eq!(resolve("center", size, &bounds, None, (12.0, 12.0)), (860.0, 340.0));
    }

    #[test]
    fn centers_on_a_retina_screen_using_points() {
        // 2560x1600 points would be a 5K display; the point is that the arithmetic never
        // mixes in the scale factor - the caller already converted the size.
        let bounds = screen(0.0, 0.0, 2560.0, 1600.0, 1.0);

        assert_eq!(resolve("center", (400.0, 500.0), &bounds, None, (12.0, 12.0)), (1080.0, 550.0));
    }

    #[test]
    fn follows_the_cursor_with_the_offset_applied() {
        let bounds = screen(0.0, 0.0, 2560.0, 1600.0, 2.0);

        assert_eq!(
            resolve("follow_mouse", (800.0, 1000.0), &bounds, Some((1000.0, 200.0)), (24.0, 24.0)),
            (1024.0, 224.0)
        );
    }

    #[test]
    fn follows_the_cursor_and_clamps_inside_the_screen() {
        let bounds = screen(0.0, 0.0, 400.0, 500.0, 1.0);

        assert_eq!(
            resolve("follow_mouse", (400.0, 500.0), &bounds, Some((390.0, 490.0)), (12.0, 12.0)),
            (0.0, 0.0)
        );
    }

    #[test]
    fn keeps_a_window_larger_than_the_screen_at_its_origin() {
        let bounds = screen(0.0, 0.0, 300.0, 200.0, 1.0);

        assert_eq!(resolve("center", (400.0, 500.0), &bounds, None, (12.0, 12.0)), (0.0, 0.0));
        assert_eq!(
            resolve("follow_mouse", (400.0, 500.0), &bounds, Some((150.0, 100.0)), (12.0, 12.0)),
            (0.0, 0.0)
        );
    }

    #[test]
    fn centers_on_a_screen_with_a_negative_origin() {
        // A display placed to the left of the primary one reports negative coordinates.
        let bounds = screen(-1920.0, -200.0, 1920.0, 1080.0, 1.0);

        assert_eq!(resolve("center", (400.0, 500.0), &bounds, None, (12.0, 12.0)), (-1160.0, 90.0));
    }
}
