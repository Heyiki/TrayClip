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
        let bytes = image.bytes.as_ref();
        if bytes.len() > 10 * 1024 * 1024 {
            return Ok(None);
        }
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
        let bytes = image.bytes.as_ref();
        if bytes.len() > 10 * 1024 * 1024 {
            return Ok(None);
        }
        return Ok(Some(format!("{:x}", Sha256::digest(bytes))));
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

fn write_image_path_with_clipboard(file_path: &str, clipboard: &mut Clipboard) -> anyhow::Result<()> {
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
            anyhow::bail!("failed to open clipboard");
        }
        let _scope = ClipboardScope;
        EmptyClipboard();
        if SetClipboardData(CF_HDROP, handle).is_null() {
            anyhow::bail!("failed to set clipboard data");
        }

        Ok(())
    }
}
