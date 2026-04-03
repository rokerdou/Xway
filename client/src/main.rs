//! SOCKS5代理客户端
//!
//! 在本地提供SOCKS5服务，将流量加密后转发到远程服务端

mod config;
mod client;

use anyhow::Result;
use tracing::{info, error};
use tracing_subscriber;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .init();

    info!("🚀 SOCKS5代理客户端启动中...");

    // 加载配置
    let config = match config::ClientConfig::from_file("config/client.toml") {
        Ok(cfg) => {
            info!("⚙️  配置加载成功");
            info!("📡 远程服务端: {}:{}", cfg.server.remote_server, cfg.server.remote_port);
            info!("🔌 本地监听: {}:{}", cfg.local.listen_addr, cfg.local.listen_port);
            cfg
        }
        Err(e) => {
            info!("⚠️  无法加载配置文件，使用默认配置: {}", e);
            config::ClientConfig::default_config()
        }
    };

    // 创建客户端
    let client = client::ProxyClient::new(config)?;

    // 启动客户端
    client.run().await?;

    Ok(())
}
