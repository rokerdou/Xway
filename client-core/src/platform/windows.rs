//! Windows 平台实现

use std::path::PathBuf;

pub fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("C:\\Temp"))
        .join("socks5-proxy")
}

pub fn get_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("C:\\Temp"))
        .join("socks5-proxy")
}

pub fn supports_system_tray() -> bool {
    true
}

pub fn supports_autostart() -> bool {
    true
}
