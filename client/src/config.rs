//! 客户端配置管理

use serde::{Deserialize, Serialize};
use std::path::Path;
use anyhow::Result;

/// 客户端配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientConfig {
    /// 远程服务端设置
    pub server: RemoteServerSettings,
    /// 本地设置
    pub local: LocalSettings,
    /// 日志设置
    pub logging: LoggingSettings,
}

/// 远程服务端设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteServerSettings {
    /// 远程服务器地址
    pub remote_server: String,
    /// 远程服务器端口
    pub remote_port: u16,
}

/// 本地设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSettings {
    /// 监听地址
    pub listen_addr: String,
    /// 监听端口
    pub listen_port: u16,
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
}

// 默认值函数
fn default_log_level() -> String { "debug".to_string() }
fn default_log_dir() -> String { "./logs".to_string() }

impl ClientConfig {
    /// 从文件加载配置
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("无法读取配置文件: {}", e))?;
        let config: ClientConfig = toml::from_str(&content)
            .map_err(|e| anyhow::anyhow!("解析配置文件失败: {}", e))?;
        Ok(config)
    }

    /// 创建默认配置
    pub fn default_config() -> Self {
        Self {
            server: RemoteServerSettings {
                remote_server: "127.0.0.1".to_string(),
                remote_port: 1080,
            },
            local: LocalSettings {
                listen_addr: "127.0.0.1".to_string(),
                listen_port: 1081,
            },
            logging: LoggingSettings {
                level: default_log_level(),
                log_dir: default_log_dir(),
            },
        }
    }
}
