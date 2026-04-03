//! SOCKS5代理服务端（远程）
//!
//! 架构：
//! 1. 监听远程客户端的加密连接
//! 2. 接收客户端加密请求并解密获取目标地址
//! 3. 连接到目标服务器
//! 4. 将目标服务器的流量加密后返回给客户端

mod config;
mod server;

use anyhow::Result;
use tracing::{info, error};
use tracing_subscriber;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    info!("🚀 SOCKS5代理服务端启动中...");

    // 加载配置
    let config = match config::ServerConfig::from_file("config/server.toml") {
        Ok(cfg) => {
            info!("⚙️  配置加载成功");
            cfg
        }
        Err(e) => {
            info!("⚠️  无法加载配置文件，使用默认配置: {}", e);
            config::ServerConfig::default_config()
        }
    };

    info!("🎯 监听地址: {}:{}", config.server.listen_addr, config.server.listen_port);

    // 创建服务端
    let server = server::ProxyServer::new(config)?;

    // 启动服务端
    server.run().await?;

    Ok(())
}
