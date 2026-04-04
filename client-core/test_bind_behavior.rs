#[tokio::main]
async fn main() {
    use tokio::net::TcpListener;
    use std::net::SocketAddr;

    println!("=== 测试 TcpListener::bind() 行为 ===\n");

    let addr: SocketAddr = "127.0.0.1:19999".parse().unwrap();
    println!("1. 第一次绑定端口 {}", addr);

    match TcpListener::bind(&addr).await {
        Ok(_listener1) => {
            println!("   ✓ 第一次绑定成功");
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

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

            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
        Err(e) => {
            println!("   ✗ 第一次绑定失败: {}", e);
        }
    }
}
