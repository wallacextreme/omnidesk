use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct ScreenBoundsState {
    pub virtual_x: std::sync::atomic::AtomicI32,
    pub virtual_y: std::sync::atomic::AtomicI32,
    pub virtual_width: std::sync::atomic::AtomicI32,
    pub virtual_height: std::sync::atomic::AtomicI32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenFrameResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub virtual_left: i32,
    pub virtual_top: i32,
    pub virtual_width: i32,
    pub virtual_height: i32,
}

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
    const MOUSEEVENTF_VIRTUALDESK: u32 = 0x4000;
    const MOUSEEVENTF_ABSOLUTE: u32 = 0x8000;

    const SM_XVIRTUALSCREEN: i32 = 76;
    const SM_YVIRTUALSCREEN: i32 = 77;
    const SM_CXVIRTUALSCREEN: i32 = 78;
    const SM_CYVIRTUALSCREEN: i32 = 79;

    const SRCCOPY: u32 = 0x00CC0020;
    const HALFTONE: i32 = 4;
    const BI_RGB: u32 = 0;
    const DIB_RGB_COLORS: u32 = 0;

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
        fn GetDC(hwnd: isize) -> isize;
        fn ReleaseDC(hwnd: isize, hdc: isize) -> i32;
        fn OpenClipboard(hwnd_new_owner: *const c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn GetClipboardData(u_format: u32) -> *mut c_void;
        fn SetClipboardData(u_format: u32, h_mem: *mut c_void) -> *mut c_void;
        fn GetClipboardSequenceNumber() -> u32;
        fn MessageBoxW(hwnd: *const c_void, text: *const u16, caption: *const u16, u_type: u32) -> i32;
    }

    #[repr(C)]
    struct POINT {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct BITMAPINFOHEADER {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    #[repr(C)]
    struct RGBQUAD {
        rgb_blue: u8,
        rgb_green: u8,
        rgb_red: u8,
        rgb_reserved: u8,
    }

    #[repr(C)]
    struct BITMAPINFO {
        bmi_header: BITMAPINFOHEADER,
        bmi_colors: [RGBQUAD; 1],
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(hdc: isize) -> isize;
        fn DeleteDC(hdc: isize) -> i32;
        fn CreateCompatibleBitmap(hdc: isize, cx: i32, cy: i32) -> isize;
        fn SelectObject(hdc: isize, h: isize) -> isize;
        fn DeleteObject(ho: isize) -> i32;
        fn BitBlt(
            hdc: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            hdc_src: isize,
            x1: i32,
            y1: i32,
            rop: u32,
        ) -> i32;
        fn StretchBlt(
            hdc_dest: isize,
            x_dest: i32,
            y_dest: i32,
            w_dest: i32,
            h_dest: i32,
            hdc_src: isize,
            x_src: i32,
            y_src: i32,
            w_src: i32,
            h_src: i32,
            rop: u32,
        ) -> i32;
        fn SetStretchBltMode(hdc: isize, mode: i32) -> i32;
        fn SetBrushOrgEx(hdc: isize, x: i32, y: i32, lppt: *mut POINT) -> i32;
        fn GetDIBits(
            hdc: isize,
            hbm: isize,
            start: u32,
            c_lines: u32,
            lpv_bits: *mut u8,
            lpbmi: *mut BITMAPINFO,
            usage: u32,
        ) -> i32;
    }

    /// RAII guard guaranteeing GDI DC/Bitmap/Selection cleanup on every exit path
    /// so long remote sessions never exhaust Windows' 10,000 GDI object quota.
    struct GdiCaptureGuard {
        hdc_screen: isize,
        hdc_mem: isize,
        hbitmap: isize,
        old_obj: isize,
    }

    impl Drop for GdiCaptureGuard {
        fn drop(&mut self) {
            unsafe {
                if self.hdc_mem != 0 && self.old_obj != 0 {
                    SelectObject(self.hdc_mem, self.old_obj);
                    self.old_obj = 0;
                }
                if self.hbitmap != 0 {
                    DeleteObject(self.hbitmap);
                    self.hbitmap = 0;
                }
                if self.hdc_mem != 0 {
                    DeleteDC(self.hdc_mem);
                    self.hdc_mem = 0;
                }
                if self.hdc_screen != 0 {
                    ReleaseDC(0, self.hdc_screen);
                    self.hdc_screen = 0;
                }
            }
        }
    }

    #[link(name = "shell32")]
    extern "system" {
        fn DragQueryFileW(hdrop: *mut c_void, i_file: u32, lpsz_file: *mut u16, cch: u32) -> u32;
    }

    pub fn show_error_box(title: &str, body: &str) {
        let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
        let body_w: Vec<u16> = body.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let _ = MessageBoxW(std::ptr::null(), body_w.as_ptr(), title_w.as_ptr(), 0x10);
        }
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

    pub fn get_clipboard_sequence() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    pub fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
        if !open_clipboard_with_retry() {
            return Ok(Vec::new());
        }
        let mut paths = Vec::new();
        unsafe {
            let handle = GetClipboardData(CF_HDROP);
            if !handle.is_null() {
                let total = DragQueryFileW(handle, 0xFFFF_FFFF, std::ptr::null_mut(), 0);
                let limit = total.min(20);
                for idx in 0..limit {
                    let len = DragQueryFileW(handle, idx, std::ptr::null_mut(), 0);
                    if len == 0 || len > 32767 {
                        continue;
                    }
                    let mut buf: Vec<u16> = vec![0u16; (len as usize) + 1];
                    let copied = DragQueryFileW(handle, idx, buf.as_mut_ptr(), len + 1);
                    if copied > 0 {
                        let s = String::from_utf16_lossy(&buf[..(copied as usize)]);
                        if std::path::Path::new(&s).is_file() {
                            paths.push(s);
                        }
                    }
                }
            }
            let _ = CloseClipboard();
        }
        Ok(paths)
    }

    pub fn trigger_ctrl_v() {
        // Release stuck Alt / Shift / Win modifiers before synthesizing Ctrl+V
        for vk in [0x12u16, 0xA4, 0xA5, 0x10, 0xA0, 0xA1, 0x5B, 0x5C] {
            let ext = matches!(vk, 0xA5 | 0x5B | 0x5C);
            send_vk(vk, ext, false);
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
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

    pub fn virtual_screen_bounds() -> (i32, i32, i32, i32) {
        unsafe {
            let left = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let top = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            if w > 0 && h > 0 {
                (left, top, w, h)
            } else {
                let (pw, ph) = primary_screen_size();
                (0, 0, pw as i32, ph as i32)
            }
        }
    }

    /// Captures the entire virtual desktop into top-down 32-bit BGRA bytes.
    /// GdiCaptureGuard ensures SelectObject restoration and DeleteObject/DeleteDC/ReleaseDC
    /// run unconditionally on every exit path, preventing GDI handle exhaustion.
    pub fn capture_screen_bgra(
        max_width: u32,
    ) -> Result<(Vec<u8>, u32, u32, i32, i32, i32, i32), String> {
        let (v_left, v_top, v_w, v_h) = virtual_screen_bounds();
        if v_w <= 0 || v_h <= 0 {
            return Err("Invalid virtual screen dimensions".into());
        }

        let target_max_w = max_width.clamp(320, 3840) as i32;
        let (out_w, out_h) = if v_w > target_max_w {
            let scaled_h = (((v_h as i64) * (target_max_w as i64)) / (v_w as i64)).max(2) as i32;
            ((target_max_w & !1).max(2), (scaled_h & !1).max(2))
        } else {
            ((v_w.max(2) & !1).max(2), (v_h.max(2) & !1).max(2))
        };

        let mut guard = GdiCaptureGuard {
            hdc_screen: 0,
            hdc_mem: 0,
            hbitmap: 0,
            old_obj: 0,
        };

        unsafe {
            guard.hdc_screen = GetDC(0);
            if guard.hdc_screen == 0 {
                return Err("GetDC(0) returned null".into());
            }

            guard.hdc_mem = CreateCompatibleDC(guard.hdc_screen);
            if guard.hdc_mem == 0 {
                return Err("CreateCompatibleDC failed".into());
            }

            guard.hbitmap = CreateCompatibleBitmap(guard.hdc_screen, out_w, out_h);
            if guard.hbitmap == 0 {
                return Err("CreateCompatibleBitmap failed".into());
            }

            let prev = SelectObject(guard.hdc_mem, guard.hbitmap);
            if prev == 0 || prev == -1 {
                return Err("SelectObject failed".into());
            }
            guard.old_obj = prev;

            let blit_ok = if out_w != v_w || out_h != v_h {
                let _ = SetStretchBltMode(guard.hdc_mem, HALFTONE);
                let _ = SetBrushOrgEx(guard.hdc_mem, 0, 0, std::ptr::null_mut());
                StretchBlt(
                    guard.hdc_mem,
                    0,
                    0,
                    out_w,
                    out_h,
                    guard.hdc_screen,
                    v_left,
                    v_top,
                    v_w,
                    v_h,
                    SRCCOPY,
                )
            } else {
                BitBlt(
                    guard.hdc_mem,
                    0,
                    0,
                    out_w,
                    out_h,
                    guard.hdc_screen,
                    v_left,
                    v_top,
                    SRCCOPY,
                )
            };

            if blit_ok == 0 {
                return Err("BitBlt/StretchBlt screen capture failed".into());
            }

            // Deselect bitmap before calling GetDIBits as required by Win32 GDI
            SelectObject(guard.hdc_mem, guard.old_obj);
            guard.old_obj = 0;

            let mut bmi = BITMAPINFO {
                bmi_header: BITMAPINFOHEADER {
                    bi_size: size_of::<BITMAPINFOHEADER>() as u32,
                    bi_width: out_w,
                    bi_height: -out_h, // Negative height produces top-down BGRA rows
                    bi_planes: 1,
                    bi_bit_count: 32,
                    bi_compression: BI_RGB,
                    bi_size_image: 0,
                    bi_x_pels_per_meter: 0,
                    bi_y_pels_per_meter: 0,
                    bi_clr_used: 0,
                    bi_clr_important: 0,
                },
                bmi_colors: [RGBQUAD {
                    rgb_blue: 0,
                    rgb_green: 0,
                    rgb_red: 0,
                    rgb_reserved: 0,
                }],
            };

            let byte_len = (out_w as usize)
                .checked_mul(out_h as usize)
                .and_then(|px| px.checked_mul(4))
                .ok_or_else(|| "Captured frame buffer overflow".to_string())?;
            let mut pixels = vec![0u8; byte_len];

            let lines = GetDIBits(
                guard.hdc_mem,
                guard.hbitmap,
                0,
                out_h as u32,
                pixels.as_mut_ptr(),
                &mut bmi as *mut BITMAPINFO,
                DIB_RGB_COLORS,
            );
            if lines == 0 {
                return Err("GetDIBits failed".into());
            }

            drop(guard);
            Ok((pixels, out_w as u32, out_h as u32, v_left, v_top, v_w, v_h))
        }
    }

    fn clamp01(v: f64) -> f64 {
        v.clamp(0.0, 1.0)
    }

    fn compute_cursor_pos(x: f64, y: f64) -> (i32, i32, i32, i32) {
        let nx = clamp01(x);
        let ny = clamp01(y);
        let (v_left, v_top, v_w, v_h) = virtual_screen_bounds();
        let px = v_left + (nx * ((v_w - 1).max(1) as f64)).round() as i32;
        let py = v_top + (ny * ((v_h - 1).max(1) as f64)).round() as i32;
        let abs_x = (nx * 65535.0).round() as i32;
        let abs_y = (ny * 65535.0).round() as i32;
        (px, py, abs_x, abs_y)
    }

    fn make_mouse_input(dx: i32, dy: i32, mouse_data: u32, dw_flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            u: InputUnion {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouse_data,
                    dw_flags,
                    time: 0,
                    dw_extra_info: 0,
                },
            },
        }
    }

    fn send_mouse_move(x: f64, y: f64) {
        let (px, py, abs_x, abs_y) = compute_cursor_pos(x, y);
        let inp = make_mouse_input(
            abs_x,
            abs_y,
            0,
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        );
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
                let (px, py, abs_x, abs_y) = compute_cursor_pos(x, y);
                let dw_flags = match (btn, is_down) {
                    ("right", true) => MOUSEEVENTF_RIGHTDOWN,
                    ("right", false) => MOUSEEVENTF_RIGHTUP,
                    ("middle", true) => MOUSEEVENTF_MIDDLEDOWN,
                    ("middle", false) => MOUSEEVENTF_MIDDLEUP,
                    (_, true) => MOUSEEVENTF_LEFTDOWN,
                    (_, false) => MOUSEEVENTF_LEFTUP,
                };
                let coord_flags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
                let inputs = [
                    make_mouse_input(abs_x, abs_y, 0, MOUSEEVENTF_MOVE | coord_flags),
                    make_mouse_input(abs_x, abs_y, 0, dw_flags | coord_flags),
                ];
                unsafe {
                    let _ = SetCursorPos(px, py);
                    let _ = SendInput(
                        inputs.len() as u32,
                        inputs.as_ptr(),
                        size_of::<INPUT>() as i32,
                    );
                }
            }
            "mouse-dblclick" => {
                let x = packet.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let y = packet.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let btn = packet.get("button").and_then(|v| v.as_str()).unwrap_or("left");
                let (px, py, abs_x, abs_y) = compute_cursor_pos(x, y);
                let (down_flag, up_flag) = match btn {
                    "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
                    "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
                    _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
                };
                let coord_flags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
                let inputs = [
                    make_mouse_input(abs_x, abs_y, 0, MOUSEEVENTF_MOVE | coord_flags),
                    make_mouse_input(abs_x, abs_y, 0, down_flag | coord_flags),
                    make_mouse_input(abs_x, abs_y, 0, up_flag | coord_flags),
                    make_mouse_input(abs_x, abs_y, 0, down_flag | coord_flags),
                    make_mouse_input(abs_x, abs_y, 0, up_flag | coord_flags),
                ];
                unsafe {
                    let _ = SetCursorPos(px, py);
                    let _ = SendInput(
                        inputs.len() as u32,
                        inputs.as_ptr(),
                        size_of::<INPUT>() as i32,
                    );
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
        if kind == "release-all" {
            release_all();
            return;
        }
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

    fn encode_base64(input: &[u8]) -> String {
        const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
        let mut i = 0;
        while i < input.len() {
            let b0 = input[i] as u32;
            let b1 = if i + 1 < input.len() { input[i + 1] as u32 } else { 0 };
            let b2 = if i + 2 < input.len() { input[i + 2] as u32 } else { 0 };
            let triple = (b0 << 16) | (b1 << 8) | b2;
            out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
            out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
            out.push(if i + 1 < input.len() { TABLE[((triple >> 6) & 0x3F) as usize] as char } else { '=' });
            out.push(if i + 2 < input.len() { TABLE[(triple & 0x3F) as usize] as char } else { '=' });
            i += 3;
        }
        out
    }

    #[derive(serde::Serialize)]
    pub struct ClipboardFileEntry {
        pub id: String,
        pub name: String,
        pub size: u64,
    }

    fn clipboard_allowlist() -> &'static std::sync::Mutex<std::collections::HashMap<String, std::path::PathBuf>> {
        static MAP: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, std::path::PathBuf>>> =
            std::sync::OnceLock::new();
        MAP.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
    }

    #[tauri::command]
    pub fn get_clipboard_sequence() -> u32 {
        #[cfg(target_os = "windows")]
        {
            return win_input::get_clipboard_sequence();
        }
        #[cfg(not(target_os = "windows"))]
        0
    }

    #[tauri::command]
    pub async fn capture_screen_frame(
        max_width: Option<u32>,
        quality: Option<u8>,
        bounds_state: tauri::State<'_, super::ScreenBoundsState>,
    ) -> Result<super::ScreenFrameResult, String> {
        #[cfg(target_os = "windows")]
        {
            let target_w = max_width.unwrap_or(1280).clamp(320, 3840);
            let jpeg_quality = quality.unwrap_or(68).clamp(25, 95);
            let result = tokio::task::spawn_blocking(move || -> Result<super::ScreenFrameResult, String> {
                let (pixels, width, height, v_left, v_top, v_w, v_h) =
                    win_input::capture_screen_bgra(target_w)?;
                let mut jpeg_buf = Vec::with_capacity(64 * 1024);
                let encoder = jpeg_encoder::Encoder::new(&mut jpeg_buf, jpeg_quality);
                encoder
                    .encode(
                        &pixels,
                        width.min(u16::MAX as u32) as u16,
                        height.min(u16::MAX as u32) as u16,
                        jpeg_encoder::ColorType::Bgra,
                    )
                    .map_err(|e| format!("JPEG encode failed: {e}"))?;
                let mut data_url = String::with_capacity(23 + (jpeg_buf.len() * 4) / 3 + 4);
                data_url.push_str("data:image/jpeg;base64,");
                data_url.push_str(&encode_base64(&jpeg_buf));
                Ok(super::ScreenFrameResult {
                    data_url,
                    width,
                    height,
                    virtual_left: v_left,
                    virtual_top: v_top,
                    virtual_width: v_w,
                    virtual_height: v_h,
                })
            })
            .await
            .map_err(|e| format!("Screen capture worker failed: {e}"))??;

            bounds_state
                .virtual_x
                .store(result.virtual_left, std::sync::atomic::Ordering::Relaxed);
            bounds_state
                .virtual_y
                .store(result.virtual_top, std::sync::atomic::Ordering::Relaxed);
            bounds_state
                .virtual_width
                .store(result.virtual_width, std::sync::atomic::Ordering::Relaxed);
            bounds_state
                .virtual_height
                .store(result.virtual_height, std::sync::atomic::Ordering::Relaxed);
            return Ok(result);
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (max_width, quality, bounds_state);
            Err("Native GDI capture is only available on Windows".into())
        }
    }

    #[tauri::command]
    pub async fn read_clipboard_files() -> Result<Vec<ClipboardFileEntry>, String> {
        #[cfg(target_os = "windows")]
        {
            return tokio::task::spawn_blocking(move || -> Result<Vec<ClipboardFileEntry>, String> {
                static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
                let paths = win_input::read_clipboard_file_paths()?;
                let mut entries = Vec::new();
                let mut batch = Vec::new();
                for raw_path in paths {
                    let pb = std::path::PathBuf::from(&raw_path);
                    let Ok(meta) = std::fs::metadata(&pb) else { continue; };
                    if !meta.is_file() || meta.len() > 157_286_400 {
                        continue;
                    }
                    let name = pb
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "arquivo.bin".to_string());
                    let id = format!("tcf-{}", SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
                    batch.push((id.clone(), pb));
                    entries.push(ClipboardFileEntry {
                        id,
                        name,
                        size: meta.len(),
                    });
                }
                if let Ok(mut guard) = clipboard_allowlist().lock() {
                    for (k, v) in batch {
                        guard.insert(k, v);
                    }
                    if guard.len() > 80 {
                        let excess = guard.len() - 80;
                        let mut by_age: Vec<(u64, String)> = guard
                            .keys()
                            .map(|k| {
                                let num = k.strip_prefix("tcf-").and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                                (num, k.clone())
                            })
                            .collect();
                        by_age.sort_by_key(|(num, _)| *num);
                        for (_, old_key) in by_age.into_iter().take(excess) {
                            guard.remove(&old_key);
                        }
                    }
                }
                Ok(entries)
            })
            .await
            .map_err(|e| format!("Clipboard files worker failed: {e}"))?;
        }
        #[cfg(not(target_os = "windows"))]
        Ok(Vec::new())
    }

    #[tauri::command]
    pub async fn read_clipboard_file_chunk(id: String, offset: u64, length: u32) -> Result<String, String> {
        tokio::task::spawn_blocking(move || -> Result<String, String> {
            let path = {
                let guard = clipboard_allowlist()
                    .lock()
                    .map_err(|_| "Clipboard allowlist lock poisoned".to_string())?;
                guard.get(&id).cloned()
            }
            .ok_or_else(|| "Arquivo da área de transferência expirado ou não autorizado".to_string())?;

            use std::io::{Read, Seek, SeekFrom};
            let capped_len = (length as usize).clamp(1, 2 * 1024 * 1024);
            let mut f = std::fs::File::open(&path).map_err(|e| format!("Failed opening clipboard file: {e}"))?;
            f.seek(SeekFrom::Start(offset))
                .map_err(|e| format!("Failed seeking clipboard file: {e}"))?;
            let mut buf = vec![0u8; capped_len];
            let mut total_read = 0usize;
            while total_read < capped_len {
                let n = f
                    .read(&mut buf[total_read..])
                    .map_err(|e| format!("Failed reading clipboard file: {e}"))?;
                if n == 0 {
                    break;
                }
                total_read += n;
            }
            Ok(encode_base64(&buf[..total_read]))
        })
        .await
        .map_err(|e| format!("Clipboard chunk worker failed: {e}"))?
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
    pub async fn read_clipboard() -> Result<String, String> {
        #[cfg(target_os = "windows")]
        {
            return tokio::task::spawn_blocking(win_input::read_clipboard_text)
                .await
                .map_err(|e| format!("Read clipboard worker failed: {e}"))?;
        }
        #[cfg(not(target_os = "windows"))]
        Ok(String::new())
    }

    #[tauri::command]
    pub async fn write_clipboard(text: String) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            return tokio::task::spawn_blocking(move || win_input::write_clipboard_text(&text))
                .await
                .map_err(|e| format!("Write clipboard worker failed: {e}"))?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = text;
            Ok(())
        }
    }

    #[tauri::command]
    pub async fn save_received_file(
        file_name: String,
        data_b64: String,
        auto_paste: Option<bool>,
    ) -> Result<String, String> {
        tokio::task::spawn_blocking(move || -> Result<String, String> {
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
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    win_input::trigger_ctrl_v();
                }
            }
            #[cfg(not(target_os = "windows"))]
            let _ = auto_paste;

            Ok(final_str)
        })
        .await
        .map_err(|e| format!("Save file worker failed: {e}"))?
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    win_input::ensure_dpi_aware();

    if let Err(err) = tauri::Builder::default()
        .manage(ScreenBoundsState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_monitors,
            commands::capture_screen_frame,
            commands::inject_mouse_event,
            commands::inject_key_event,
            commands::release_all_inputs,
            commands::read_clipboard,
            commands::write_clipboard,
            commands::get_clipboard_sequence,
            commands::read_clipboard_files,
            commands::read_clipboard_file_chunk,
            commands::save_received_file
        ])
        .run(tauri::generate_context!())
    {
        #[cfg(target_os = "windows")]
        win_input::show_error_box(
            "OmniDesk - Erro ao iniciar",
            &format!(
                "Não foi possível inicializar a janela WebView2 do OmniDesk.\n\nNo Windows 7 (64 bits), certifique-se de instalar o Microsoft Edge WebView2 Runtime v109 (x64).\n\nDetalhes: {err}"
            ),
        );
        #[cfg(not(target_os = "windows"))]
        eprintln!("error while running tauri application: {err}");
    }
}
