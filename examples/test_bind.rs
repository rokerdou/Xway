#[tokio::main]
async fn main() -> anyhow::Result<()> {
    use client_core::ClientConfig;
    use std::net::SocketAddr;
    use tokio::net::TcpListener;

    println!("=== 测试程序：检查1081端口绑定 ===\n");

    // 加载配置
    let config = ClientConfig::load_or_create()?;
    println!("配置监听端口: {}", config.local.listen_port);

    // 尝试绑定端口
    let bind_addr = SocketAddr::new(
        std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)),
        config.local.listen_port
    );

    println!("尝试绑定到: {}", bind_addr);

    match TcpListener::bind(bind_addr).await {
        Ok(listener) => {
            println!("✅ 成功绑定到 {}", bind_addr);
            println!("本地地址: {:?}", listener.local_addr()?);

            // 检查活动服务器
            if let Some(server) = config.get_active_server() {
                println!("活动服务器: {}:{}", server.host, server.port);
            }

            // 保持监听一段时间
            println!("\n保持监听5秒...");
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            println!("测试成功");
        }
        Err(e) => {
            eprintln!("❌ 绑定失败: {}", e);
            eprintln!("错误类型: {:?}", e.kind());
            return Err(e.into());
        }
    }

    Ok(())
}
