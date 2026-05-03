//! 服务端配置管理

use serde::{Deserialize, Serialize};
use std::path::Path;
use anyhow::Result;
use shared::AuthConfig;

/// 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// 服务器设置
    pub server: ServerSettings,
    /// 日志设置
    pub logging: LoggingSettings,
    /// 认证设置
    pub auth: AuthConfig,
    /// 中继设置
    pub relay: RelaySettings,
}

/// 服务器基本设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSettings {
    /// 监听地址
    pub listen_addr: String,
    /// 监听端口
    pub listen_port: u16,
    /// 最大连接数
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
    /// 超时时间（秒）
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    /// 是否启用IP封禁（Docker部署时应禁用，因为看到的是内网IP）
    #[serde(default = "default_enable_ip_ban")]
    pub enable_ip_ban: bool,
}

/// 日志设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingSettings {
    /// 日志级别
    #[serde(default = "default_log_level")]
    pub level: String,
    /// 日志目录
    #[serde(default = "default_log_dir")]
    pub log_dir: String,
    /// 最大日志文件数
    #[serde(default = "default_max_log_files")]
    pub max_log_files: usize,
}

/// 中继设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelaySettings {
    /// 最大缓冲区大小
    #[serde(default = "default_buffer_size")]
    pub max_buffer_size: usize,
    /// 是否启用流量统计
    #[serde(default = "default_traffic_stats")]
    pub enable_traffic_stats: bool,
}

// 默认值函数
fn default_max_connections() -> usize { 1000 }
fn default_timeout() -> u64 { 80 }  // 读写超时 80 秒
fn default_enable_ip_ban() -> bool { false }  // 默认禁用IP封禁（Docker友好）
fn default_log_level() -> String { "info".to_string() }
fn default_log_dir() -> String { "./logs".to_string() }
fn default_max_log_files() -> usize { 7 }
fn default_buffer_size() -> usize { 8192 }
fn default_traffic_stats() -> bool { true }

impl ServerConfig {
    /// 从文件加载配置
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("无法读取配置文件: {}", e))?;
        let config: ServerConfig = toml::from_str(&content)
            .map_err(|e| anyhow::anyhow!("解析配置文件失败: {}", e))?;
        Ok(config)
    }

    /// 保存配置到文件
    ///
    /// 注意：此方法预留用于将来可能需要的配置保存功能（如运行时备份配置）
    #[allow(dead_code)]
    pub fn save_to_file<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let content = toml::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    /// 创建默认配置
    pub fn default_config() -> Self {
        Self {
            server: ServerSettings {
                listen_addr: "0.0.0.0".to_string(),
                listen_port: 1080,
                max_connections: default_max_connections(),
                timeout_seconds: default_timeout(),
                enable_ip_ban: default_enable_ip_ban(),
            },
            logging: LoggingSettings {
                level: default_log_level(),
                log_dir: default_log_dir(),
                max_log_files: default_max_log_files(),
            },
            auth: AuthConfig::default(),
            relay: RelaySettings {
                max_buffer_size: default_buffer_size(),
                enable_traffic_stats: default_traffic_stats(),
            },
        }
    }
}
