//! iOS 平台实现（预留）

use std::path::PathBuf;

pub fn get_config_dir() -> PathBuf {
    // iOS 应用沙盒路径
    PathBuf::from("/var/mobile/Containers/Data/Application/config")
}

pub fn get_data_dir() -> PathBuf {
    // iOS 应用沙盒路径
    PathBuf::from("/var/mobile/Containers/Data/Application/data")
}

pub fn supports_system_tray() -> bool {
    // iOS 不支持系统托盘
    false
}

pub fn supports_autostart() -> bool {
    // iOS 不支持开机自启动
    false
}
