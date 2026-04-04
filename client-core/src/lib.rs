//! SOCKS5代理客户端核心库
//!
//! 提供跨平台的代理功能，可作为CLI或GUI的后端

pub mod config;
pub mod proxy;
pub mod state;
pub mod platform;

pub use config::{ClientConfig, ServerConfig};
pub use proxy::ProxyClient;
pub use state::{ProxyState, ProxyStatus, ConnectionGuard};

/// 代理客户端错误类型
pub type Result<T> = std::result::Result<T, anyhow::Error>;

/// 连接统计信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct TrafficStats {
    pub upload_bytes: u64,
    pub download_bytes: u64,
    pub connections: u32,
}

impl TrafficStats {
    pub fn new() -> Self {
        Self {
            upload_bytes: 0,
            download_bytes: 0,
            connections: 0,
        }
    }
}

impl Default for TrafficStats {
    fn default() -> Self {
        Self::new()
    }
}
