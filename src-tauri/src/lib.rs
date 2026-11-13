use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

#[cfg(target_os = "windows")]
mod win_input {
    use std::ffi::c_void;
    use std::mem::size_of;

    const INPUT_MOUSE: u32 = 0;
    const INPUT_KEYBOARD: u32 = 1;
    const MOUSEEVENTF_MOVE: u32 = 0x0001;
    const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
    const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
    const MOUSEEVENTF_RIGHTDOWN: u32 = 0x0008;
    const MOUSEEVENTF_RIGHTUP: u32 = 0x0010;
    const MOUSEEVENTF_MIDDLEDOWN: u32 = 0x0020;
    const MOUSEEVENTF_MIDDLEUP: u32 = 0x0040;
    const MOUSEEVENTF_WHEEL: u32 = 0x0800;
    const MOUSEEVENTF_HWHEEL: u32 = 0x01000;
    const MOUSEEVENTF_ABSOLUTE: u32 = 0x8000;

    const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const KEYEVENTF_UNICODE: u32 = 0x0004;

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct MOUSEINPUT {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct KEYBDINPUT {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct HARDWAREINPUT {
        u_msg: u32,
        w_param_l: u16,
        w_param_h: u16,
    }

    #[repr(C)]
    union InputUnion {
        mi: MOUSEINPUT,
        ki: KEYBDINPUT,
        hi: HARDWAREINPUT,
    }

    #[repr(C)]
    struct INPUT {
        r#type: u32,
        u: InputUnion,
    }

    #[link(name = "user32")]
    extern "system" {
        fn SendInput(c_inputs: u32, p_inputs: *const INPUT, cb_size: i32) -> u32;
        fn GetSystemMetrics(n_index: i32) -> i32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn LockWorkStation() -> i32;
        fn SetProcessDPIAware() -> i32;
        fn OpenClipboard(hwnd_new_owner: *const c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn GetClipboardData(u_format: u32) -> *mut c_void;
        fn SetClipboardData(u_format: u32, h_mem: *mut c_void) -> *mut c_void;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(u_flags: u32, dw_bytes: usize) -> *mut c_void;
        fn GlobalLock(h_mem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(h_mem: *mut c_void) -> i32;
        fn GlobalSize(h_mem: *mut c_void) -> usize;
        fn GlobalFree(h_mem: *mut c_void) -> *mut c_void;
    }

    const CF_UNICODETEXT: u32 = 13;
    const CF_HDROP: u32 = 15;
    const GMEM_MOVEABLE: u32 = 0x0002;
    const GMEM_ZEROINIT: u32 = 0x0040;

    #[repr(C)]
    struct DROPFILES {
        p_files: u32,
        pt_x: i32,
        pt_y: i32,
        f_nc: i32,
        f_wide: i32,
    }

    fn open_clipboard_with_retry() -> bool {
        for _ in 0..5 {
            if unsafe { OpenClipboard(std::ptr::null()) } != 0 {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }

    pub fn read_clipboard_text() -> Result<String, String> {
        if !open_clipboard_with_retry() {
            return Ok(String::new());
        }
        let result = unsafe {
            let handle = GetClipboardData(CF_UNICODETEXT);
            if handle.is_null() {
                String::new()
            } else {
                let ptr = GlobalLock(handle) as *const u16;
                if ptr.is_null() {
                    String::new()
                } else {
                    let max_words = GlobalSize(handle) / 2;
                    let slice = std::slice::from_raw_parts(ptr, max_words);
                    let len = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
                    let text = String::from_utf16_lossy(&slice[..len]);
                    let _ = GlobalUnlock(handle);
                    text
                }
            }
        };
        unsafe {
            let _ = CloseClipboard();
        }
        Ok(result)
    }

    pub fn write_clipboard_text(text: &str) -> Result<(), String> {
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes_len = wide.len() * size_of::<u16>();

        if !open_clipboard_with_retry() {
            return Err("Failed to open Windows clipboard".into());
        }
        let res = unsafe {
            let _ = EmptyClipboard();
            let h_mem = GlobalAlloc(GMEM_MOVEABLE, bytes_len);
            if h_mem.is_null() {
                Err("GlobalAlloc failed for clipboard text".into())
            } else {
                let dst = GlobalLock(h_mem) as *mut u16;
                if dst.is_null() {
                    let _ = GlobalFree(h_mem);
                    Err("GlobalLock failed for clipboard text".into())
                } else {
                    std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
                    let _ = GlobalUnlock(h_mem);
                    if SetClipboardData(CF_UNICODETEXT, h_mem).is_null() {
                        let _ = GlobalFree(h_mem);
                        Err("SetClipboardData failed for clipboard text".into())
                    } else {
                        Ok(())
                    }
                }
            }
        };
        unsafe {
            let _ = CloseClipboard();
        }
        res
    }

    pub fn set_clipboard_file_drop(path: &str) -> Result<(), String> {
        let mut wide: Vec<u16> = path.encode_utf16().collect();
        wide.push(0);
        wide.push(0);
        let header_size = size_of::<DROPFILES>();
        let total_bytes = header_size + wide.len() * size_of::<u16>();

        if !open_clipboard_with_retry() {
            return Err("Failed to open Windows clipboard".into());
        }
        let res = unsafe {
            let _ = EmptyClipboard();
            let h_mem = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_bytes);
            if h_mem.is_null() {
                Err("GlobalAlloc failed for CF_HDROP".into())
            } else {
                let dst = GlobalLock(h_mem) as *mut u8;
                if dst.is_null() {
                    let _ = GlobalFree(h_mem);
                    Err("GlobalLock failed for CF_HDROP".into())
                } else {
                    let header = DROPFILES {
                        p_files: header_size as u32,
                        pt_x: 0,
                        pt_y: 0,
                        f_nc: 0,
                        f_wide: 1,
                    };
                    std::ptr::copy_nonoverlapping(
                        (&header as *const DROPFILES) as *const u8,
                        dst,
                        header_size,
                    );
                    std::ptr::copy_nonoverlapping(
                        wide.as_ptr() as *const u8,
                        dst.add(header_size),
                        wide.len() * size_of::<u16>(),
                    );
                    let _ = GlobalUnlock(h_mem);
                    if SetClipboardData(CF_HDROP, h_mem).is_null() {
                        let _ = GlobalFree(h_mem);
                        Err("SetClipboardData failed for CF_HDROP".into())
                    } else {
                        Ok(())
                    }
                }
            }
        };
        unsafe {
            let _ = CloseClipboard();
        }
        res
    }

    pub fn trigger_ctrl_v() {
        send_vk(0x11, false, true);  // VK_CONTROL down
        send_vk(0x56, false, true);  // V down
        send_vk(0x56, false, false); // V up
        send_vk(0x11, false, false); // VK_CONTROL up
    }

    pub fn ensure_dpi_aware() {
        unsafe {
            let _ = SetProcessDPIAware();
        }
    }

    pub fn primary_screen_size() -> (u32, u32) {
        unsafe {
            let w = GetSystemMetrics(0).max(1) as u32;
            let h = GetSystemMetrics(1).max(1) as u32;
            (w, h)
        }
    }

    fn clamp01(v: f64) -> f64 {
        v.clamp(0.0, 1.0)
    }

    fn send_mouse_move(x: f64, y: f64) {
        let nx = clamp01(x);
        let ny = clamp01(y);
        let (w, h) = primary_screen_size();
        let px = (nx * ((w.saturating_sub(1)) as f64)).round() as i32;
        let py = (ny * ((h.saturating_sub(1)) as f64)).round() as i32;
        let abs_x = (nx * 65535.0).round() as i32;
        let abs_y = (ny * 65535.0).round() as i32;

        let inp = INPUT {
            r#type: INPUT_MOUSE,
            u: InputUnion {
                mi: MOUSEINPUT {
                    dx: abs_x,
                    dy: abs_y,
                    mouse_data: 0,
                    dw_flags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        };
        unsafe {
            let _ = SetCursorPos(px, py);
            let _ = SendInput(1, &inp as *const INPUT, size_of::<INPUT>() as i32);
        }
    }

    pub fn handle_mouse(packet: &serde_json::Value) {
        let kind = packet.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "mouse-move" => {
                let x = packet.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let y = packet.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                send_mouse_move(x, y);
            }
            "mouse-down" | "mouse-up" => {
                let x = packet.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let y = packet.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let btn = packet.get("button").and_then(|v| v.as_str()).unwrap_or("left");
                let is_down = kind == "mouse-down";
                send_mouse_move(x, y);
                let dw_flags = match (btn, is_down) {
                    ("right", true) => MOUSEEVENTF_RIGHTDOWN,
                    ("right", false) => MOUSEEVENTF_RIGHTUP,
                    ("middle", true) => MOUSEEVENTF_MIDDLEDOWN,
                    ("middle", false) => MOUSEEVENTF_MIDDLEUP,
                    (_, true) => MOUSEEVENTF_LEFTDOWN,
                    (_, false) => MOUSEEVENTF_LEFTUP,
                };
                let inp = INPUT {
                    r#type: INPUT_MOUSE,
                    u: InputUnion {
                        mi: MOUSEINPUT {
                            dx: 0,
                            dy: 0,
                            mouse_data: 0,
                            dw_flags,
                            time: 0,
                            dw_extra_info: 0,
                        },
                    },
                };
                unsafe {
                    let _ = SendInput(1, &inp as *const INPUT, size_of::<INPUT>() as i32);
                }
            }
            "mouse-wheel" => {
                let dx = packet.get("deltaX").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let dy = packet.get("deltaY").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if dy.abs() > 0.001 {
                    let amount = (-dy * 120.0).round() as i32;
                    let inp = INPUT {
                        r#type: INPUT_MOUSE,
                        u: InputUnion {
                            mi: MOUSEINPUT {
                                dx: 0,
                                dy: 0,
                                mouse_data: amount as u32,
                                dw_flags: MOUSEEVENTF_WHEEL,
                                time: 0,
                                dw_extra_info: 0,
                            },
                        },
                    };
                    unsafe {
                        let _ = SendInput(1, &inp as *const INPUT, size_of::<INPUT>() as i32);
                    }
                }
                if dx.abs() > 0.001 {
                    let amount = (dx * 120.0).round() as i32;
                    let inp = INPUT {
                        r#type: INPUT_MOUSE,
                        u: InputUnion {
                            mi: MOUSEINPUT {
                                dx: 0,
                                dy: 0,
                                mouse_data: amount as u32,
                                dw_flags: MOUSEEVENTF_HWHEEL,
                                time: 0,
                                dw_extra_info: 0,
                            },
                        },
                    };
                    unsafe {
                        let _ = SendInput(1, &inp as *const INPUT, size_of::<INPUT>() as i32);
                    }
                }
            }
            _ => {}
        }
        let _unused: *const c_void = std::ptr::null();
        let _ = _unused;
    }

    fn send_vk(vk: u16, extended: bool, is_down: bool) {
        let mut flags = if is_down { 0 } else { KEYEVENTF_KEYUP };
        if extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        let inp = INPUT {
            r#type: INPUT_KEYBOARD,
            u: InputUnion {
                ki: KEYBDINPUT {
                    w_vk: vk,
                    w_scan: 0,
                    dw_flags: flags,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        };
        unsafe {
            let _ = SendInput(1, &inp as *const INPUT, size_of::<INPUT>() as i32);
        }
    }

    fn send_unicode(ch: u16, is_down: bool) {
        let flags = KEYEVENTF_UNICODE | if is_down { 0 } else { KEYEVENTF_KEYUP };
        let inp = INPUT {
            r#type: INPUT_KEYBOARD,
            u: InputUnion {
                ki: KEYBDINPUT {
                    w_vk: 0,
                    w_scan: ch,
                    dw_flags: flags,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        };
        unsafe {
            let _ = SendInput(1, &inp as *const INPUT, size_of::<INPUT>() as i32);
        }
    }

    fn resolve_vk(code: &str, key: &str) -> (u16, bool) {
        if let Some(rest) = code.strip_prefix("Key") {
            if let Some(ch) = rest.chars().next() {
                if rest.len() == 1 && ch.is_ascii_alphabetic() {
                    return (ch.to_ascii_uppercase() as u16, false);
                }
            }
        }
        if let Some(rest) = code.strip_prefix("Digit") {
            if let Some(ch) = rest.chars().next() {
                if rest.len() == 1 && ch.is_ascii_digit() {
                    return (ch as u16, false);
                }
            }
        }
        match code {
            "Enter" => (0x0D, false),
            "NumpadEnter" => (0x0D, true),
            "Escape" => (0x1B, false),
            "Backspace" => (0x08, false),
            "Tab" => (0x09, false),
            "Space" => (0x20, false),
            "CapsLock" => (0x14, false),
            "ShiftLeft" => (0xA0, false),
            "ShiftRight" => (0xA1, false),
            "ControlLeft" => (0xA2, false),
            "ControlRight" => (0xA3, true),
            "AltLeft" => (0xA4, false),
            "AltRight" => (0xA5, true),
            "MetaLeft" => (0x5B, true),
            "MetaRight" => (0x5C, true),
            "Insert" => (0x2D, true),
            "Delete" => (0x2E, true),
            "Home" => (0x24, true),
            "End" => (0x23, true),
            "PageUp" => (0x21, true),
            "PageDown" => (0x22, true),
            "ArrowLeft" => (0x25, true),
            "ArrowUp" => (0x26, true),
            "ArrowRight" => (0x27, true),
            "ArrowDown" => (0x28, true),
            "Semicolon" => (0xBA, false),
            "Equal" => (0xBB, false),
            "Comma" => (0xBC, false),
            "Minus" => (0xBD, false),
            "Period" => (0xBE, false),
            "Slash" => (0xBF, false),
            "Backquote" => (0xC0, false),
            "BracketLeft" => (0xDB, false),
            "Backslash" => (0xDC, false),
            "BracketRight" => (0xDD, false),
            "Quote" => (0xDE, false),
            "IntlBackslash" => (0xE2, false),
            "IntlRo" => (0xC1, false),
            _ => match key {
                "Enter" => (0x0D, false),
                "Escape" => (0x1B, false),
                "Backspace" => (0x08, false),
                "Tab" => (0x09, false),
                " " => (0x20, false),
                _ => (0, false),
            },
        }
    }

    pub fn handle_key(packet: &serde_json::Value) {
        let kind = packet.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "special-key" {
            match packet.get("action").and_then(|v| v.as_str()).unwrap_or("") {
                "esc" => {
                    send_vk(0x1B, false, true);
                    send_vk(0x1B, false, false);
                }
                "lock" => unsafe {
                    let _ = LockWorkStation();
                },
                "ctrl-alt-del" => {
                    send_vk(0xA2, false, true);
                    send_vk(0xA0, false, true);
                    send_vk(0x1B, false, true);
                    send_vk(0x1B, false, false);
                    send_vk(0xA0, false, false);
                    send_vk(0xA2, false, false);
                }
                _ => {}
            }
            return;
        }

        let is_down = kind == "key-down";
        if kind != "key-down" && kind != "key-up" {
            return;
        }
        let key = packet.get("key").and_then(|v| v.as_str()).unwrap_or("");
        let code = packet.get("code").and_then(|v| v.as_str()).unwrap_or("");
        let mut chars = key.chars();
        if let (Some(ch), None) = (chars.next(), chars.next()) {
            if (ch as u32) > 127 && (ch as u32) <= 0xFFFF {
                send_unicode(ch as u16, is_down);
                return;
            }
        }
        let (vk, ext) = resolve_vk(code, key);
        if vk != 0 {
            send_vk(vk, ext, is_down);
        }
    }

    pub fn release_all() {
        for vk in [0x10u16, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C] {
            let ext = matches!(vk, 0xA3 | 0xA5 | 0x5B | 0x5C);
            send_vk(vk, ext, false);
        }
        for flag in [MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_MIDDLEUP] {
            let inp = INPUT {
                r#type: INPUT_MOUSE,
                u: InputUnion {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouse_data: 0,
                        dw_flags: flag,
                        time: 0,
                        dw_extra_info: 0,
                    },
                },
            };
            unsafe {
                let _ = SendInput(1, &inp as *const INPUT, size_of::<INPUT>() as i32);
            }
        }
    }
}

pub mod commands {
    #[cfg(target_os = "windows")]
    use super::win_input;
    use super::MonitorInfo;

    #[tauri::command]
    pub fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
        #[cfg(target_os = "windows")]
        let (width, height) = win_input::primary_screen_size();
        #[cfg(not(target_os = "windows"))]
        let (width, height) = (1920u32, 1080u32);

        Ok(vec![MonitorInfo {
            id: "display-0".into(),
            name: "Primary Display".into(),
            width,
            height,
            is_primary: true,
        }])
    }

    #[tauri::command]
    pub fn inject_mouse_event(packet: serde_json::Value) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        win_input::handle_mouse(&packet);
        #[cfg(not(target_os = "windows"))]
        let _ = packet;
        Ok(())
    }

    #[tauri::command]
    pub fn inject_key_event(packet: serde_json::Value) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        win_input::handle_key(&packet);
        #[cfg(not(target_os = "windows"))]
        let _ = packet;
        Ok(())
    }

    #[tauri::command]
    pub fn release_all_inputs() -> Result<(), String> {
        #[cfg(target_os = "windows")]
        win_input::release_all();
        Ok(())
    }

    fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
        let mut out = Vec::with_capacity(input.len() * 3 / 4);
        let mut buf: u32 = 0;
        let mut bits: u8 = 0;
        for b in input.bytes() {
            if b.is_ascii_whitespace() {
                continue;
            }
            if b == b'=' {
                break;
            }
            let val: u32 = match b {
                b'A'..=b'Z' => (b - b'A') as u32,
                b'a'..=b'z' => (b - b'a' + 26) as u32,
                b'0'..=b'9' => (b - b'0' + 52) as u32,
                b'+' => 62,
                b'/' => 63,
                _ => return Err("Invalid base64 character".into()),
            };
            buf = (buf << 6) | val;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push(((buf >> bits) & 0xFF) as u8);
            }
        }
        Ok(out)
    }

    fn sanitize_filename(raw: &str) -> String {
        let base = raw.rsplit(['/', '\\']).next().unwrap_or("arquivo.bin");
        let cleaned: String = base
            .chars()
            .map(|ch| {
                if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                    '_'
                } else {
                    ch
                }
            })
            .collect();
        let trimmed = cleaned.trim().trim_matches('.');
        if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
            "arquivo.bin".to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn unique_dest_path(dir: &std::path::Path, safe_name: &str) -> std::path::PathBuf {
        let candidate = dir.join(safe_name);
        if !candidate.exists() {
            return candidate;
        }
        let p = std::path::Path::new(safe_name);
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("arquivo");
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
        for idx in 1..1000 {
            let next_name = if ext.is_empty() {
                format!("{stem} ({idx})")
            } else {
                format!("{stem} ({idx}).{ext}")
            };
            let next_path = dir.join(next_name);
            if !next_path.exists() {
                return next_path;
            }
        }
        dir.join(format!("{}-{}", std::time::UNIX_EPOCH.elapsed().map(|d| d.as_secs()).unwrap_or(0), safe_name))
    }

    #[tauri::command]
    pub fn read_clipboard() -> Result<String, String> {
        #[cfg(target_os = "windows")]
        {
            return win_input::read_clipboard_text();
        }
        #[cfg(not(target_os = "windows"))]
        Ok(String::new())
    }

    #[tauri::command]
    pub fn write_clipboard(text: String) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            return win_input::write_clipboard_text(&text);
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = text;
            Ok(())
        }
    }

    #[tauri::command]
    pub fn save_received_file(
        file_name: String,
        data_b64: String,
        auto_paste: Option<bool>,
    ) -> Result<String, String> {
        let bytes = decode_base64(&data_b64)?;
        let safe_name = sanitize_filename(&file_name);
        let base_home = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let dest_dir = base_home.join("Downloads").join("OmniDesk");
        std::fs::create_dir_all(&dest_dir).map_err(|e| format!("Failed creating OmniDesk folder: {e}"))?;
        let final_path = unique_dest_path(&dest_dir, &safe_name);
        std::fs::write(&final_path, &bytes).map_err(|e| format!("Failed saving file: {e}"))?;

        let final_str = final_path.to_string_lossy().to_string();
        #[cfg(target_os = "windows")]
        {
            let _ = win_input::set_clipboard_file_drop(&final_str);
            if auto_paste.unwrap_or(false) {
                std::thread::sleep(std::time::Duration::from_millis(60));
                win_input::trigger_ctrl_v();
            }
        }
        #[cfg(not(target_os = "windows"))]
        let _ = auto_paste;

        Ok(final_str)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    win_input::ensure_dpi_aware();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_monitors,
            commands::inject_mouse_event,
            commands::inject_key_event,
            commands::release_all_inputs,
            commands::read_clipboard,
            commands::write_clipboard,
            commands::save_received_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
