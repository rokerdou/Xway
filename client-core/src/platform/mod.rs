//! 平台相关代码
//!
//! 此模块提供平台抽象，为未来移动端支持预留

#[cfg_attr(target_os = "linux", path = "linux.rs")]
#[cfg_attr(target_os = "macos", path = "macos.rs")]
#[cfg_attr(target_os = "windows", path = "windows.rs")]
#[cfg_attr(target_os = "ios", path = "ios.rs")]
#[cfg_attr(target_os = "android", path = "android.rs")]
mod platform_impl;

use std::path::PathBuf;

/// 获取应用配置目录
pub fn get_config_dir() -> PathBuf {
    platform_impl::get_config_dir()
}

/// 获取应用数据目录
pub fn get_data_dir() -> PathBuf {
    platform_impl::get_data_dir()
}

/// 是否支持系统托盘
pub fn supports_system_tray() -> bool {
    platform_impl::supports_system_tray()
}

/// 是否支持开机自启动
pub fn supports_autostart() -> bool {
    platform_impl::supports_autostart()
}

/// 检测是否为移动平台
pub fn is_mobile() -> bool {
    cfg!(target_os = "ios") || cfg!(target_os = "android")
}

/// 检测是否为桌面平台
pub fn is_desktop() -> bool {
    cfg!(target_os = "windows") || cfg!(target_os = "macos") || cfg!(target_os = "linux")
}
