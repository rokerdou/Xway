//! SOCKS5代理服务端（远程）
//!
//! 架构：
//! 1. 监听远程客户端的加密连接
//! 2. 接收客户端加密请求并解密获取目标地址
//! 3. 连接到目标服务器
//! 4. 将目标服务器的流量加密后返回给客户端

mod config;
mod server;
mod defense;

use anyhow::Result;
use tracing::info;
use tracing_subscriber;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    info!("🚀 SOCKS5代理服务端启动中...");

    // 解析命令行参数
    let args: Vec<String> = std::env::args().collect();
    let config_path = if args.len() >= 3 && args[1] == "--config" {
        // 使用命令行指定的配置文件
        args[2].clone()
    } else {
        // 使用默认路径
        "config/server.toml".to_string()
    };

    // 加载配置
    let config = match config::ServerConfig::from_file(&config_path) {
        Ok(cfg) => {
            info!("⚙️  配置加载成功: {}", config_path);
            cfg
        }
        Err(e) => {
            info!("⚠️  无法加载配置文件 ({}), 使用默认配置: {}", config_path, e);
            config::ServerConfig::default_config()
        }
    };

    // 🔍 打印认证配置（用于调试）
    info!("🔐 认证配置: enabled={}, shared_secret=\"{}\"",
          config.auth.enabled,
          config.auth.shared_secret);

    info!("🎯 监听地址: {}:{}", config.server.listen_addr, config.server.listen_port);

    // 创建服务端
    let server = server::ProxyServer::new(config)?;

    // 启动服务端
    server.run().await?;

    Ok(())
}
