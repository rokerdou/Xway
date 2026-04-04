#[tokio::main]
async fn main() {
    use tokio::net::TcpListener;
    use std::net::SocketAddr;

    println!("=== 测试 TcpListener::bind() 行为 ===\n");

    // 第一次绑定
    let addr: SocketAddr = "127.0.0.1:1081".parse().unwrap();
    println!("1. 第一次绑定端口 {}", addr);

    match TcpListener::bind(&addr).await {
        Ok(listener1) => {
            println!("   ✓ 第一次绑定成功");

            // 等待一下
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

            // 第二次绑定（应该失败）
            println!("\n2. 第二次绑定端口 {} (应该立即失败)", addr);
            let start = std::time::Instant::now();

            match TcpListener::bind(&addr).await {
                Ok(_) => println!("   ✗ 第二次绑定竟然成功了（不应该）"),
                Err(e) => {
                    let elapsed = start.elapsed();
                    println!("   ✓ 第二次绑定失败");
                    println!("   错误: {}", e);
                    println!("   耗时: {:?}", elapsed);
                    println!("   错误类型: {:?}", e.kind());

                    if elapsed.as_millis() < 100 {
                        println!("   ✓ 错误是立即返回的（< 100ms）");
                    } else {
                        println!("   ✗ 错误返回太慢了（> 100ms）");
                    }
                }
            }

            // 保持监听
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
        Err(e) => {
            println!("   ✗ 第一次绑定失败: {}", e);
        }
    }
}
