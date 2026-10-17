//! SOCKS5代理客户端
//!
//! 在本地提供SOCKS5服务，将流量加密后转发到远程服务端

use anyhow::Result;
use client_core::{ClientConfig, ProxyClient};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .init();

    info!("🚀 SOCKS5代理客户端启动中...");

    // 加载配置
    let config = match ClientConfig::from_file("config/client.toml") {
        Ok(cfg) => {
            info!("⚙️  配置加载成功");
            info!(
                "📡 远程服务端: {}:{}",
                cfg.get_active_server()
                    .map(|s| s.host.as_str())
                    .unwrap_or("none"),
                cfg.get_active_server().map(|s| s.port).unwrap_or(0)
            );
            info!(
                "🔌 本地监听: {}:{}",
                cfg.local.listen_addr, cfg.local.listen_port
            );
            cfg
        }
        Err(e) => {
            info!("⚠️  无法加载配置文件，使用默认配置: {}", e);
            ClientConfig::default_config()
        }
    };

    // 创建客户端
    let mut client = ProxyClient::new(config)?;
    client.start().await?;
    tokio::signal::ctrl_c().await?;
    client.stop().await?;

    Ok(())
}
