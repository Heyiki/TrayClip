use std::path::Path;

use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::{
        DataExchange::GetClipboardOwner,
        Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    },
    UI::WindowsAndMessaging::GetWindowThreadProcessId,
};

pub fn detect() -> Option<String> {
    let owner = unsafe { GetClipboardOwner() };
    if owner.is_null() {
        return None;
    }

    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(owner, &mut process_id) };
    if process_id == 0 {
        return None;
    }

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process.is_null() {
        return None;
    }

    let mut buffer = vec![0u16; 1024];
    let mut length = buffer.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) };
    unsafe { CloseHandle(process) };
    if ok == 0 || length == 0 {
        return None;
    }

    let path = String::from_utf16_lossy(&buffer[..length as usize]);
    let name = Path::new(&path).file_stem()?.to_string_lossy().trim().to_string();
    (!name.is_empty()).then_some(name)
}
