//! 客户端配置管理

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use anyhow::Result;
use shared::AuthConfig;

/// 客户端配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientConfig {
    /// 远程服务器列表
    #[serde(default)]
    pub servers: Vec<ServerConfig>,
    /// 本地设置
    pub local: LocalSettings,
    /// 日志设置
    pub logging: LoggingSettings,
    /// 认证设置
    pub auth: AuthConfig,
}

/// 单个服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// 服务器ID
    #[serde(default)]
    pub id: u64,
    /// 服务器地址
    pub host: String,
    /// 服务器端口
    pub port: u16,
    /// 是否启用
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool { true }

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
fn default_log_level() -> String { "info".to_string() }
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

    /// 保存配置到文件
    pub fn save_to_file<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let content = toml::to_string_pretty(self)
            .map_err(|e| anyhow::anyhow!("序列化配置失败: {}", e))?;
        std::fs::write(path, content)
            .map_err(|e| anyhow::anyhow!("写入配置文件失败: {}", e))?;
        Ok(())
    }

    /// 获取默认配置文件路径
    pub fn default_config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("socks5-proxy")
            .join("client.toml")
    }

    /// 创建默认配置
    pub fn default_config() -> Self {
        Self {
            servers: vec![
                ServerConfig {
                    id: 1,
                    host: "127.0.0.1".to_string(),
                    port: 1080,
                    enabled: true,
                }
            ],
            local: LocalSettings {
                listen_addr: "127.0.0.1".to_string(),
                listen_port: 1081,
            },
            logging: LoggingSettings {
                level: default_log_level(),
                log_dir: default_log_dir(),
            },
            auth: AuthConfig::default(),
        }
    }

    /// 获取第一个启用的服务器
    pub fn get_active_server(&self) -> Option<&ServerConfig> {
        self.servers.iter().find(|s| s.enabled).or_else(|| self.servers.first())
    }

    /// 加载或创建默认配置
    pub fn load_or_create() -> Result<Self> {
        let path = Self::default_config_path();

        if path.exists() {
            Self::from_file(&path)
        } else {
            // 创建配置目录
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            let config = Self::default_config();
            config.save_to_file(&path)?;
            Ok(config)
        }
    }
}
