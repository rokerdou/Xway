//! Android 平台实现（预留）

use std::path::PathBuf;

pub fn get_config_dir() -> PathBuf {
    // Android 应用内部存储路径
    PathBuf::from("/data/data/com.socks5proxy/files/config")
}

pub fn get_data_dir() -> PathBuf {
    // Android 应用内部存储路径
    PathBuf::from("/data/data/com.socks5proxy/files/data")
}

pub fn supports_system_tray() -> bool {
    // Android 使用通知栏，不是系统托盘
    false
}

pub fn supports_autostart() -> bool {
    // Android 可以通过 BroadcastReceiver 实现
    true
}
