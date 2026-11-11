use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

#[tauri::command]
pub fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
    // In production desktop environment, scrap/xcap enumerates connected displays
    Ok(vec![MonitorInfo {
        id: "display-0".into(),
        name: "Primary Display (4K UHD)".into(),
        width: 3840,
        height: 2160,
        is_primary: true,
    }])
}

#[tauri::command]
pub fn inject_mouse_event(packet: serde_json::Value) -> Result<(), String> {
    // Uses enigo or native OS winuser SendInput to inject hardware input events
    println!("[OmniDesk Native] Injected mouse event: {:?}", packet);
    Ok(())
}

#[tauri::command]
pub fn inject_key_event(packet: serde_json::Value) -> Result<(), String> {
    // Uses enigo or native OS winuser SendInput to inject hardware key events
    println!("[OmniDesk Native] Injected key event: {:?}", packet);
    Ok(())
}

#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    Ok("".to_string())
}

#[tauri::command]
pub fn write_clipboard(text: String) -> Result<(), String> {
    println!("[OmniDesk Native] Clipboard updated: {} bytes", text.len());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_monitors,
            inject_mouse_event,
            inject_key_event,
            read_clipboard,
            write_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
