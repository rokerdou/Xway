//! SOCKS5代理服务端核心实现
//!
//! 架构：
//! - 接受客户端加密连接
//! - 解密客户端请求获取目标地址
//! - 连接到目标服务器
//! - 双向加密转发

use crate::config::ServerConfig;
use shared::{AuthPacket, KingObj, Result, TargetAddr};
use tokio::net::{TcpListener, TcpStream};
use tracing::{info, error, debug};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;

/// SOCKS5代理服务端
pub struct ProxyServer {
    /// 服务端配置
    config: Arc<ServerConfig>,
    /// 连接信号量（限制最大连接数）
    semaphore: Arc<Semaphore>,
}

impl ProxyServer {
    /// 创建新的代理服务端
    pub fn new(config: ServerConfig) -> Result<Self> {
        let semaphore = Arc::new(Semaphore::new(config.server.max_connections));

        Ok(Self {
            config: Arc::new(config),
            semaphore,
        })
    }

    /// 启动服务端
    pub async fn run(&self) -> Result<()> {
        use std::net::{IpAddr, Ipv4Addr, SocketAddr};

        let bind_addr = SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0)),
            self.config.server.listen_port
        );
        let listener = TcpListener::bind(bind_addr).await?;

        info!("🎯 SOCKS5代理服务端监听: {}", bind_addr);
        info!("📊 最大连接数: {}", self.config.server.max_connections);

        loop {
            // 接受客户端连接
            let (client_stream, client_addr) = listener.accept().await?;

            // 获取信号量许可
            let permit = self.semaphore.clone().acquire_owned().await.unwrap();

            debug!("📥 新的客户端连接: {}", client_addr);

            // 处理连接
            let config = self.config.clone(); // Arc克隆是零成本的
            tokio::spawn(async move {
                let _permit = permit; // 持有许可直到连接结束

                if let Err(e) = handle_client_connection(client_stream, client_addr, config).await {
                    error!("❌ 连接处理错误 [{}]: {}", client_addr, e);
                }
            });
        }
    }
}

/// 处理客户端连接
async fn handle_client_connection(
    mut client_stream: TcpStream,
    client_addr: std::net::SocketAddr,
    config: Arc<ServerConfig>,
) -> anyhow::Result<()> {
    debug!("🔌 开始处理客户端连接: {}", client_addr);

    // 步骤1: 验证客户端认证（如果启用）
    if config.auth.enabled {
        debug!("🔐 开始验证客户端认证 [{}]", client_addr);
        // 为认证创建独立的解密器
        let mut auth_decryptor = KingObj::new();
        match verify_client_auth(&mut client_stream, &mut auth_decryptor, &config).await {
            Ok(username) => {
                debug!("✅ 客户端认证成功: {} [{}]", username, client_addr);
            }
            Err(e) => {
                error!("❌ 客户端认证失败 [{}]: {}", client_addr, e);
                return Err(e);
            }
        }
    }

    // 步骤2: 读取目标地址（加密的）
    // 为目标地址创建新的解密器（每次连接使用独立的解密器）
    let mut addr_decryptor = KingObj::new();
    let target_addr = match read_target_address(&mut client_stream, &mut addr_decryptor).await {
        Ok(addr) => addr,
        Err(e) => {
            error!("❌ 读取目标地址失败 [{}]: {}", client_addr, e);
            return Err(e.into());
        }
    };

    info!("🎯 客户端请求连接到: {:?}", target_addr);

    // 步骤3: 连接到目标服务器
    let target_stream = match connect_to_target(&target_addr).await {
        Ok(s) => s,
        Err(e) => {
            error!("❌ 无法连接到目标服务器 {:?}: {}", target_addr, e);
            return Err(e.into());
        }
    };

    info!("✅ 成功连接到目标服务器");

    // 步骤4: 开始数据转发（客户端 <-> 目标，带加密/解密）
    info!("🔄 开始数据转发 [{}]", client_addr);
    relay_with_encryption(client_stream, target_stream, &config).await?;

    Ok(())
}

/// 设置 TCP Keep-Alive
///
/// 启用 TCP Keep-Alive 以检测死连接（网络中断）
/// - 60 秒后开始探测
/// - 每 10 秒探测一次
fn set_tcp_keepalive(stream: &TcpStream) -> std::io::Result<()> {
    use socket2::SockRef;

    let socket = SockRef::from(stream);

    #[cfg(unix)]
    {
        use socket2::TcpKeepalive;
        let keepalive = TcpKeepalive::new()
            .with_time(Duration::from_secs(60))    // 60 秒后开始探测
            .with_interval(Duration::from_secs(10)); // 每 10 秒探测一次

        socket.set_tcp_keepalive(&keepalive)?;
        debug!("✓ TCP Keep-Alive 已启用 (60s start, 10s interval)");
    }

    #[cfg(not(unix))]
    {
        debug!("✓ TCP Keep-Alive 设置（非Unix系统）");
    }

    Ok(())
}

/// 读取目标地址（加密的）
async fn read_target_address(
    stream: &mut TcpStream,
    decryptor: &mut KingObj,
) -> anyhow::Result<TargetAddr> {
    // 读取长度（2字节，大端序）
    let mut len_buffer = [0u8; 2];
    stream.read_exact(&mut len_buffer).await?;
    let len = u16::from_be_bytes(len_buffer) as usize;

    // 读取加密的地址数据
    let mut encrypted = vec![0u8; len];
    stream.read_exact(&mut encrypted).await?;

    debug!("读取到 {} 字节的加密目标地址", len);

    // 解密地址数据
    decryptor.decode(&mut encrypted, len)?;

    // 解析目标地址
    // 格式：类型(1) + 地址 + 端口(2)
    let addr_type = encrypted[0];

    match addr_type {
        0x01 => {
            // IPv4
            if encrypted.len() < 7 {
                return Err(anyhow::anyhow!("IPv4地址数据不完整"));
            }
            let ip = std::net::Ipv4Addr::new(encrypted[1], encrypted[2], encrypted[3], encrypted[4]);
            let port = u16::from_be_bytes([encrypted[5], encrypted[6]]);
            Ok(TargetAddr::Ipv4(ip, port))
        }
        0x03 => {
            // 域名
            if encrypted.len() < 3 {
                return Err(anyhow::anyhow!("域名地址数据不完整"));
            }
            let domain_len = encrypted[1] as usize;
            if encrypted.len() < 2 + domain_len + 2 {
                return Err(anyhow::anyhow!("域名地址数据不完整"));
            }
            let domain = String::from_utf8_lossy(&encrypted[2..2 + domain_len]).to_string();
            let port = u16::from_be_bytes([
                encrypted[2 + domain_len],
                encrypted[2 + domain_len + 1],
            ]);
            Ok(TargetAddr::Domain(domain, port))
        }
        0x04 => {
            // IPv6
            if encrypted.len() < 19 {
                return Err(anyhow::anyhow!("IPv6地址数据不完整"));
            }
            let mut ip_bytes = [0u8; 16];
            ip_bytes.copy_from_slice(&encrypted[1..17]);
            let ip = std::net::Ipv6Addr::from(ip_bytes);
            let port = u16::from_be_bytes([encrypted[17], encrypted[18]]);
            Ok(TargetAddr::Ipv6(ip, port))
        }
        _ => Err(anyhow::anyhow!("不支持的地址类型: {}", addr_type)),
    }
}

/// 连接到目标服务器
async fn connect_to_target(dest_addr: &TargetAddr) -> anyhow::Result<TcpStream> {
    let addr_str = match dest_addr {
        TargetAddr::Ipv4(ip, port) => format!("{}:{}", ip, port),
        TargetAddr::Domain(domain, port) => format!("{}:{}", domain, port),
        TargetAddr::Ipv6(ip, port) => format!("{}:{}", ip, port),
    };

    let stream = TcpStream::connect(&addr_str).await?;
    Ok(stream)
}
///
/// 架构：
/// - 客户端 -> 目标：读取客户端加密数据，解密后发送到目标
/// - 目标 -> 客户端：读取目标数据，加密后发送给客户端
async fn relay_with_encryption(
    mut client_stream: TcpStream,
    mut target_stream: TcpStream,
    config: &ServerConfig,
) -> Result<()> {
    // 启用 TCP Keep-Alive
    if let Err(e) = set_tcp_keepalive(&client_stream) {
        debug!("设置客户端 Keep-Alive 失败: {}", e);
    }
    if let Err(e) = set_tcp_keepalive(&target_stream) {
        debug!("设置目标 Keep-Alive 失败: {}", e);
    }

    let mut client_decryptor = KingObj::new();
    let mut client_encryptor = KingObj::new();

    let (mut client_reader, mut client_writer) = client_stream.split();
    let (mut target_reader, mut target_writer) = target_stream.split();

    let buffer_size = config.relay.max_buffer_size;
    let read_timeout = Duration::from_secs(config.server.timeout_seconds);

    debug!("✓ 读写超时设置为: {} 秒", config.server.timeout_seconds);

    // 客户端 -> 目标（解密）
    let c2t = async move {
        let mut len_buffer = [0u8; 2];
        // 优化：在循环外预分配缓冲区，重用内存减少分配次数
        let mut buffer = Vec::with_capacity(buffer_size);

        loop {
            // 【修复】添加超时：读取加密数据长度
            let result = timeout(read_timeout, client_reader.read_exact(&mut len_buffer)).await;
            match result {
                Ok(Ok(_)) => {}
                _ => {
                    debug!("客户端->目标: 读取长度超时或错误，断开连接");
                    break;
                }
            }

            let len = u16::from_be_bytes(len_buffer) as usize;

            // 优化：重用缓冲区，resize在capacity足够时不会重新分配
            buffer.clear();
            buffer.resize(len, 0);

            // 【修复】添加超时：读取加密数据
            let result = timeout(read_timeout, client_reader.read_exact(&mut buffer)).await;
            match result {
                Ok(Ok(_)) => {}
                _ => {
                    debug!("客户端->目标: 读取数据超时或错误，断开连接");
                    break;
                }
            }

            debug!("客户端->目标: {} 字节（加密）", len);

            // 解密数据
            client_decryptor.decode(&mut buffer, len)?;

            // 【修复】添加超时：发送到目标服务器
            let result = timeout(read_timeout, target_writer.write_all(&buffer)).await;
            match result {
                Ok(Ok(_)) => {}
                _ => {
                    debug!("客户端->目标: 发送数据超时或错误，断开连接");
                    break;
                }
            }
        }

        Ok::<(), anyhow::Error>(())
    };

    // 目标 -> 客户端（加密）
    let t2c = async move {
        let mut buffer = vec![0u8; buffer_size];

        loop {
            // 【修复】添加超时：读取目标服务器数据
            let result = timeout(read_timeout, target_reader.read(&mut buffer)).await;
            let n = match result {
                Ok(Ok(n)) => n,
                _ => {
                    debug!("目标->客户端: 读取数据超时或错误，断开连接");
                    break;
                }
            };

            if n == 0 {
                debug!("目标->客户端: 对端关闭连接");
                break;
            }

            debug!("目标->客户端: {} 字节", n);

            // 加密数据
            client_encryptor.encode(&mut buffer, n)?;

            // 【修复】添加超时：发送长度前缀到客户端
            let len = n as u16;
            let result = timeout(read_timeout, client_writer.write_all(&len.to_be_bytes())).await;
            match result {
                Ok(Ok(_)) => {}
                _ => {
                    debug!("目标->客户端: 发送长度超时或错误，断开连接");
                    break;
                }
            }

            // 【修复】添加超时：发送数据到客户端
            let result = timeout(read_timeout, client_writer.write_all(&buffer[..n])).await;
            match result {
                Ok(Ok(_)) => {}
                _ => {
                    debug!("目标->客户端: 发送数据超时或错误，断开连接");
                    break;
                }
            }
        }

        Ok::<(), anyhow::Error>(())
    };

    // 并发执行双向转发
    tokio::select! {
        res = c2t => {
            if let Err(e) = res {
                debug!("客户端->目标 转发结束: {}", e);
            }
        }
        res = t2c => {
            if let Err(e) = res {
                debug!("目标->客户端 转发结束: {}", e);
            }
        }
    }

    Ok(())
}

/// 验证客户端认证
///
/// 读取并验证加密的认证包
async fn verify_client_auth(
    stream: &mut TcpStream,
    decryptor: &mut KingObj,
    config: &ServerConfig,
) -> anyhow::Result<String> {
    // 🔍 打印服务端使用的密钥（用于调试）
    debug!("🔑 服务端使用密钥: \"{}\"", config.auth.shared_secret);

    // 读取长度（2字节）
    let mut len_buffer = [0u8; 2];
    stream.read_exact(&mut len_buffer).await?;
    let len = u16::from_be_bytes(len_buffer) as usize;

    // 读取加密的认证包
    let mut encrypted = vec![0u8; len];
    stream.read_exact(&mut encrypted).await?;

    debug!("📦 收到认证包: {} 字节（加密后）", len);

    // 解密认证包
    decryptor.decode(&mut encrypted, len)?;

    debug!("🔓 解密成功，开始反序列化...");

    // 反序列化并验证
    let auth_packet = AuthPacket::deserialize(&encrypted)?;

    debug!("👤 反序列化成功，用户名: {}", auth_packet.username);

    // 验证认证包
    auth_packet.verify(
        config.auth.shared_secret.as_bytes(),
        config.auth.max_time_diff_secs,
    )?;

    debug!("✅ 认证包验证成功");

    Ok(auth_packet.username)
}
