use std::{
    borrow::Cow,
    fs::File,
    io::BufWriter,
    path::PathBuf,
};

#[cfg(target_os = "windows")]
use std::path::Path;

#[cfg(target_os = "windows")]
use std::ffi::OsStr;

use anyhow::Context;
use arboard::{Clipboard, ImageData};
use sha2::{Digest, Sha256};

use crate::{
    db,
    models::{ClipContentType, ClipRecord, NewClipRecord},
    paths::AppPaths,
};

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

#[cfg(target_os = "windows")]
use std::ptr;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::GlobalFree,
    System::{
        DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData},
        Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
    },
    UI::Shell::{DragQueryFileW, HDROP},
};

#[cfg(target_os = "windows")]
const CF_HDROP: u32 = 15;

#[cfg(not(target_os = "linux"))]
pub fn read_clipboard(paths: &AppPaths) -> anyhow::Result<Option<(String, NewClipRecord)>> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    read_clipboard_with_clipboard(paths, &mut clipboard)
}

#[cfg(target_os = "linux")]
pub fn read_clipboard_with_state(paths: &AppPaths, clipboard: &mut Clipboard) -> anyhow::Result<Option<(String, NewClipRecord)>> {
    read_clipboard_with_clipboard(paths, clipboard)
}

fn read_clipboard_with_clipboard(paths: &AppPaths, clipboard: &mut Clipboard) -> anyhow::Result<Option<(String, NewClipRecord)>> {
    #[cfg(target_os = "windows")]
    if let Some(file_paths) = read_windows_file_paths()? {
        if !file_paths.is_empty() {
            let summary = summarize_file_paths(&file_paths);
            let content_hash = db::compute_hash(&ClipContentType::FilePaths, &None, &None, &file_paths, &summary);
            return Ok(Some((
                content_hash.clone(),
                NewClipRecord {
                    content_type: ClipContentType::FilePaths,
                    plain_text: None,
                    rich_text: None,
                    summary,
                    image_path: None,
                    file_paths,
                    source_app: "—".into(),
                    is_truncated: false,
                    content_hash,
                },
            )));
        }
    }

    if let Ok(text) = clipboard.get_text() {
        if text.trim().is_empty() {
            return Ok(None);
        }

        let (content_type, plain_text, file_paths) = classify_text(&text);
        let is_truncated = plain_text.as_ref().is_some_and(|value| value.len() > 1024 * 1024);
        let truncated_text = plain_text.map(|value| truncate_to_1mb(&value));
        let summary = summarize_text(truncated_text.as_deref().unwrap_or(&text));
        let content_hash = db::compute_hash(&content_type, &truncated_text, &None, &file_paths, &summary);
        return Ok(Some((
            content_hash.clone(),
            NewClipRecord {
                content_type,
                plain_text: truncated_text,
                rich_text: None,
                summary,
                image_path: None,
                file_paths,
                source_app: "—".into(),
                is_truncated,
                content_hash,
            },
        )));
    }

    if let Ok(image) = clipboard.get_image() {
        // Bounded by pixel count, exactly like the paste path. The old byte cap here was
        // 10 MiB, which is only 2.6 MP once RGBA is accounted for — it silently dropped
        // every 2560x1440 screenshot.
        if ensure_image_data_size(&image).is_err() {
            return Ok(None);
        }
        let bytes = image.bytes.as_ref();
        let width = image.width;
        let height = image.height;
        let content_hash = format!("{:x}", Sha256::digest(bytes));
        let image_path = save_image(paths, image, &content_hash)?;
        return Ok(Some((
            content_hash.clone(),
            NewClipRecord {
                content_type: ClipContentType::Image,
                plain_text: None,
                rich_text: None,
                summary: format!("图片 {}x{}", width, height),
                image_path: Some(image_path.to_string_lossy().to_string()),
                file_paths: Vec::new(),
                source_app: "—".into(),
                is_truncated: false,
                content_hash,
            },
        )));
    }

    Ok(None)
}

#[cfg(not(target_os = "linux"))]
pub fn peek_clipboard_signature(_paths: &AppPaths) -> anyhow::Result<Option<String>> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    peek_signature_with_clipboard(_paths, &mut clipboard)
}

#[cfg(target_os = "linux")]
pub fn peek_signature_with_state(_paths: &AppPaths, clipboard: &mut Clipboard) -> anyhow::Result<Option<String>> {
    peek_signature_with_clipboard(_paths, clipboard)
}

fn peek_signature_with_clipboard(_paths: &AppPaths, clipboard: &mut Clipboard) -> anyhow::Result<Option<String>> {
    #[cfg(target_os = "windows")]
    if let Some(file_paths) = read_windows_file_paths()? {
        if !file_paths.is_empty() {
            let summary = summarize_file_paths(&file_paths);
            let content_hash = db::compute_hash(&ClipContentType::FilePaths, &None, &None, &file_paths, &summary);
            return Ok(Some(content_hash));
        }
    }

    if let Ok(text) = clipboard.get_text() {
        if text.trim().is_empty() {
            return Ok(None);
        }
        let (content_type, plain_text, file_paths) = classify_text(&text);
        let truncated_text = plain_text.map(|value| truncate_to_1mb(&value));
        let summary = summarize_text(truncated_text.as_deref().unwrap_or(&text));
        let content_hash = db::compute_hash(&content_type, &truncated_text, &None, &file_paths, &summary);
        return Ok(Some(content_hash));
    }

    if let Ok(image) = clipboard.get_image() {
        if ensure_image_data_size(&image).is_err() {
            return Ok(None);
        }
        return Ok(Some(format!("{:x}", Sha256::digest(image.bytes.as_ref()))));
    }

    Ok(None)
}

#[cfg(not(target_os = "linux"))]
pub fn write_clipboard(record: &ClipRecord) -> anyhow::Result<()> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    write_clipboard_with_clipboard(record, &mut clipboard)
}

#[cfg(target_os = "linux")]
pub fn write_clipboard_with_state(record: &ClipRecord, clipboard: &mut Clipboard) -> anyhow::Result<()> {
    write_clipboard_with_clipboard(record, clipboard)
}

#[cfg(not(target_os = "linux"))]
pub fn write_image_path(file_path: &str) -> anyhow::Result<()> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    write_image_path_with_clipboard(file_path, &mut clipboard)
}

#[cfg(target_os = "linux")]
pub fn write_image_path_with_state(file_path: &str, clipboard: &mut Clipboard) -> anyhow::Result<()> {
    write_image_path_with_clipboard(file_path, clipboard)
}

/// Decoded RGBA costs `width * height * 4` bytes, so a few hundred kilobytes of PNG can
/// still expand into gigabytes. Both limits are read from the header, before any pixel
/// data is decoded.
const MAX_IMAGE_EDGE: u32 = 8192;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

fn ensure_image_dimensions(width: u32, height: u32) -> anyhow::Result<()> {
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || pixels > MAX_IMAGE_PIXELS {
        anyhow::bail!(
            "image is too large: {}x{} ({} px), the limit is {}x{} or {} px",
            width,
            height,
            pixels,
            MAX_IMAGE_EDGE,
            MAX_IMAGE_EDGE,
            MAX_IMAGE_PIXELS
        );
    }
    Ok(())
}

fn ensure_file_image_dimensions(file_path: &str) -> anyhow::Result<()> {
    let (width, height) = image::ImageReader::open(file_path)
        .with_context(|| format!("failed to open image: {}", file_path))?
        .with_guessed_format()
        .with_context(|| format!("failed to detect image format: {}", file_path))?
        .into_dimensions()
        .with_context(|| format!("failed to read image dimensions: {}", file_path))?;
    ensure_image_dimensions(width, height)
}

/// Same limits for images that are already decoded, so capturing a screenshot and pasting
/// it back can never disagree about what counts as too large. `try_from` keeps an
/// out-of-range dimension from being truncated into a small, accepted one.
fn ensure_image_data_size(image: &ImageData<'_>) -> anyhow::Result<()> {
    ensure_image_dimensions(
        u32::try_from(image.width).unwrap_or(u32::MAX),
        u32::try_from(image.height).unwrap_or(u32::MAX),
    )
}

fn write_image_path_with_clipboard(file_path: &str, clipboard: &mut Clipboard) -> anyhow::Result<()> {
    // Check the header first: `image::open` would otherwise decode the whole thing, and a
    // 20000x20000 PNG needs 1.6 GB once converted to RGBA8.
    ensure_file_image_dimensions(file_path)?;
    let image = image::open(file_path)
        .with_context(|| format!("failed to open image: {}", file_path))?
        .into_rgba8();
    let width = image.width() as usize;
    let height = image.height() as usize;
    clipboard.set_image(ImageData {
        width,
        height,
        bytes: Cow::Owned(image.into_vec()),
    })?;
    Ok(())
}

fn write_clipboard_with_clipboard(record: &ClipRecord, clipboard: &mut Clipboard) -> anyhow::Result<()> {
    match record.content_type {
        ClipContentType::PlainText | ClipContentType::RichText => {
            clipboard.set_text(record.plain_text.clone().unwrap_or_else(|| record.summary.clone()))?;
        }
        ClipContentType::FilePaths => {
            #[cfg(target_os = "windows")]
            {
                if set_windows_file_paths(&record.file_paths).is_ok() {
                    return Ok(());
                }
            }
            clipboard.set_text(record.file_paths.join("\n"))?;
        }
        ClipContentType::Image => {
            if let Some(path) = &record.image_path {
                ensure_file_image_dimensions(path)?;
                let image = image::open(path)?.into_rgba8();
                let width = image.width() as usize;
                let height = image.height() as usize;
                clipboard.set_image(ImageData {
                    width,
                    height,
                    bytes: Cow::Owned(image.into_vec()),
                })?;
            }
        }
    }

    Ok(())
}

fn classify_text(text: &str) -> (ClipContentType, Option<String>, Vec<String>) {
    let lines: Vec<String> = text
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    let absolute_paths = lines.iter().filter(|value| PathBuf::from(value).is_absolute()).count();

    if !lines.is_empty() && absolute_paths == lines.len() {
        return (ClipContentType::FilePaths, None, lines);
    }

    (ClipContentType::PlainText, Some(text.to_string()), Vec::new())
}

fn truncate_to_1mb(text: &str) -> String {
    const LIMIT: usize = 1024 * 1024;
    if text.len() <= LIMIT {
        return text.to_string();
    }
    // Find the last valid char boundary at or before LIMIT
    let mut end = LIMIT;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

fn summarize_text(text: &str) -> String {
    let trimmed = text.replace(['\r', '\n'], " ");
    let mut chars = trimmed.chars();
    let mut summary: String = chars.by_ref().take(120).collect();
    if chars.next().is_some() {
        summary.push_str("...");
    }
    summary
}

#[cfg(target_os = "windows")]
fn summarize_file_paths(file_paths: &[String]) -> String {
    match file_paths.len() {
        0 => "文件".into(),
        1 => {
            let path = Path::new(&file_paths[0]);
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&file_paths[0]);
            format!("文件 {}", name)
        }
        count => format!("{} 个文件", count),
    }
}

fn save_image(paths: &AppPaths, image: ImageData<'_>, digest: &str) -> anyhow::Result<PathBuf> {
    let output_path = paths.images_dir.join(format!("{}.png", digest));
    if output_path.exists() {
        return Ok(output_path);
    }

    // The payload is already decoded by `get_image`, but a header claiming an absurd
    // pixel count would still be turned into a matching buffer right below.
    ensure_image_data_size(&image)?;

    let buffer = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(image.width as u32, image.height as u32, image.bytes.into_owned())
        .context("failed to construct image buffer")?;
    let file = File::create(&output_path)?;
    let mut writer = BufWriter::new(file);
    image::DynamicImage::ImageRgba8(buffer).write_to(&mut writer, image::ImageFormat::Png)?;
    Ok(output_path)
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct DropFiles {
    p_files: u32,
    pt: Point,
    f_nc: i32,
    f_wide: i32,
}

#[cfg(target_os = "windows")]
struct ClipboardScope;

#[cfg(target_os = "windows")]
impl Drop for ClipboardScope {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}

#[cfg(target_os = "windows")]
fn read_windows_file_paths() -> anyhow::Result<Option<Vec<String>>> {
    unsafe {
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Ok(None);
        }
        let _scope = ClipboardScope;
        let handle = GetClipboardData(CF_HDROP);
        if handle.is_null() {
            return Ok(None);
        }

        let hdrop = handle as HDROP;
        let count = DragQueryFileW(hdrop, u32::MAX, ptr::null_mut(), 0);
        if count == 0 {
            return Ok(None);
        }

        let mut file_paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let length = DragQueryFileW(hdrop, index, ptr::null_mut(), 0);
            if length == 0 {
                continue;
            }
            let mut buffer = vec![0u16; length as usize + 1];
            let written = DragQueryFileW(hdrop, index, buffer.as_mut_ptr(), buffer.len() as u32);
            if written == 0 {
                continue;
            }
            let path = String::from_utf16_lossy(&buffer[..written as usize]);
            file_paths.push(path);
        }

        if file_paths.is_empty() {
            Ok(None)
        } else {
            Ok(Some(file_paths))
        }
    }
}

#[cfg(target_os = "windows")]
fn set_windows_file_paths(file_paths: &[String]) -> anyhow::Result<()> {
    if file_paths.is_empty() {
        anyhow::bail!("empty file list");
    }

    unsafe {
        let mut wide_payload: Vec<u16> = Vec::new();
        for path in file_paths {
            wide_payload.extend(OsStr::new(path).encode_wide());
            wide_payload.push(0);
        }
        wide_payload.push(0);

        let bytes = std::mem::size_of::<DropFiles>() + wide_payload.len() * std::mem::size_of::<u16>();
        let handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if handle.is_null() {
            anyhow::bail!("failed to allocate clipboard memory");
        }

        let locked = GlobalLock(handle) as *mut u8;
        if locked.is_null() {
            GlobalFree(handle);
            anyhow::bail!("failed to lock clipboard memory");
        }

        let header = locked as *mut DropFiles;
        (*header).p_files = std::mem::size_of::<DropFiles>() as u32;
        (*header).pt = Point { x: 0, y: 0 };
        (*header).f_nc = 0;
        (*header).f_wide = 1;

        let payload_ptr = locked.add(std::mem::size_of::<DropFiles>()) as *mut u16;
        ptr::copy_nonoverlapping(wide_payload.as_ptr(), payload_ptr, wide_payload.len());
        GlobalUnlock(handle);

        if OpenClipboard(ptr::null_mut()) == 0 {
            GlobalFree(handle);
            anyhow::bail!("failed to open clipboard");
        }
        let _scope = ClipboardScope;
        EmptyClipboard();
        if SetClipboardData(CF_HDROP, handle).is_null() {
            // Ownership only transfers to the system when the call succeeds, so every
            // failure path above and here has to release the block itself.
            GlobalFree(handle);
            anyhow::bail!("failed to set clipboard data");
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::ensure_image_dimensions;

    #[test]
    fn ensure_image_dimensions_accepts_typical_screenshots() {
        assert!(ensure_image_dimensions(1920, 1080).is_ok());
        // 2560x1440 is 14 MiB as RGBA: the old byte cap used to drop it.
        assert!(ensure_image_dimensions(2560, 1440).is_ok());
        assert!(ensure_image_dimensions(3840, 2160).is_ok());
        // Exactly at the pixel budget, still inside the edge limit.
        assert!(ensure_image_dimensions(8000, 5000).is_ok());
    }

    #[test]
    fn ensure_image_dimensions_rejects_pixel_overrun() {
        assert!(ensure_image_dimensions(8001, 5000).is_err());
    }

    #[test]
    fn ensure_image_dimensions_rejects_edge_overrun_and_empty_sizes() {
        assert!(ensure_image_dimensions(8193, 100).is_err());
        assert!(ensure_image_dimensions(100, 8193).is_err());
        assert!(ensure_image_dimensions(0, 100).is_err());
        assert!(ensure_image_dimensions(100, 0).is_err());
    }
}
