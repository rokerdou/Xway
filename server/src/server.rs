//! SOCKS5代理服务端核心实现
//!
//! 架构：
//! - 接受客户端加密连接
//! - 解密客户端请求获取目标地址
//! - 连接到目标服务器
//! - 双向加密转发

use crate::config::ServerConfig;
use crate::defense::{DefenseConfig, DefenseManager};
use shared::{
    decode_obfuscated_frame, generate_first_auth_byte, AuthPacket, FrameCodec, Result, TargetAddr,
    DEFAULT_MAX_PADDING, MAX_FRAME_BODY_LEN,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::sync::Semaphore;
use tokio::time::timeout;
use tracing::{debug, error, info, warn};

/// SOCKS5代理服务端
pub struct ProxyServer {
    /// 服务端配置
    config: Arc<ServerConfig>,
    /// 连接信号量（限制最大连接数）
    semaphore: Arc<Semaphore>,
    /// DPI防御管理器
    defense: Arc<DefenseManager>,
}

static AUTH_REPLAY_CACHE: OnceLock<Mutex<HashMap<[u8; 32], u64>>> = OnceLock::new();

impl ProxyServer {
    /// 创建新的代理服务端
    pub fn new(config: ServerConfig) -> Result<Self> {
        config.auth.validate()?;
        let semaphore = Arc::new(Semaphore::new(config.server.max_connections));

        // 创建DPI防御管理器
        let defense_config = DefenseConfig {
            rate_limit_window: Duration::from_secs(60),
            max_connections_per_window: 10,
            max_auth_failures: 3,
            initial_ban_duration: Duration::from_secs(300),
            ban_multiplier: 2,
            max_ban_duration: Duration::from_secs(86400),
        };
        let defense = Arc::new(DefenseManager::new(defense_config));

        // 启动定期清理任务
        let defense_cleanup = defense.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                defense_cleanup.cleanup().await;
                debug!("已清理过期的防御记录");
            }
        });

        Ok(Self {
            config: Arc::new(config),
            semaphore,
            defense,
        })
    }

    /// 启动服务端
    pub async fn run(&self) -> Result<()> {
        let bind_addr = format!(
            "{}:{}",
            self.config.server.listen_addr, self.config.server.listen_port
        );
        let listener = TcpListener::bind(bind_addr).await?;
        let bind_addr = listener.local_addr()?;

        info!("🎯 SOCKS5代理服务端监听: {}", bind_addr);
        info!("📊 最大连接数: {}", self.config.server.max_connections);

        loop {
            // 接受客户端连接
            let (client_stream, client_addr) = listener.accept().await?;

            // 获取信号量许可
            let permit = self.semaphore.clone().acquire_owned().await.unwrap();

            debug!("📥 新的客户端连接: {}", client_addr);

            // 处理连接
            let config = self.config.clone();
            let defense = self.defense.clone();
            tokio::spawn(async move {
                let _permit = permit; // 持有许可直到连接结束

                if let Err(e) =
                    handle_client_connection(client_stream, client_addr, config, defense).await
                {
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
    defense: Arc<DefenseManager>,
) -> anyhow::Result<()> {
    debug!("🔌 开始处理客户端连接: {}", client_addr);

    // 🛡️ 步骤0: DPI防御检查（仅在启用IP封禁时执行）
    let client_ip = client_addr.ip();
    if config.server.enable_ip_ban {
        if defense.is_banned(client_ip).await {
            warn!("⚠️  拒绝被封禁IP的连接: {}", client_addr);
            return Err(anyhow::anyhow!("IP已被封禁"));
        }

        // 记录连接尝试
        if let Err(e) = defense.record_connection(client_ip).await {
            warn!("⚠️  连接被拒绝: {} - {}", client_addr, e);
            return Err(anyhow::anyhow!(e));
        }
    } else {
        debug!("🔓 IP封禁功能已禁用（配置: enable_ip_ban=false）");
    }

    // 步骤1: 验证客户端认证（如果启用）
    if config.auth.enabled {
        debug!("🔐 开始验证客户端认证 [{}]", client_addr);
        match verify_client_auth(&mut client_stream, &config).await {
            Ok(username) => {
                debug!("✅ 客户端认证成功: {} [{}]", username, client_addr);
            }
            Err(e) => {
                error!("❌ 客户端认证失败 [{}]: {}", client_addr, e);
                // 记录鉴权失败（仅在启用IP封禁时）
                if config.server.enable_ip_ban {
                    defense.record_auth_failure(client_ip).await;
                }
                return Err(e);
            }
        }
    }

    // 步骤2: 读取目标地址（加密的）
    let target_addr = match read_target_address(&mut client_stream, &config).await {
        Ok(addr) => addr,
        Err(e) => {
            error!("❌ 读取目标地址失败 [{}]: {}", client_addr, e);
            return Err(e);
        }
    };

    info!("🎯 客户端请求连接到: {:?}", target_addr);

    // 步骤3: 连接到目标服务器
    let target_stream = match connect_to_target(&target_addr).await {
        Ok(s) => s,
        Err(e) => {
            error!("❌ 无法连接到目标服务器 {:?}: {}", target_addr, e);
            return Err(e);
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
            .with_time(Duration::from_secs(60)) // 60 秒后开始探测
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
    config: &ServerConfig,
) -> anyhow::Result<TargetAddr> {
    let payload = read_obfuscated_payload(stream, config).await?;
    let mut reader = payload.as_slice();
    Ok(TargetAddr::decode(&mut reader)?)
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

    let (mut client_reader, mut client_writer) = client_stream.split();
    let (mut target_reader, mut target_writer) = target_stream.split();

    let buffer_size = config.relay.max_buffer_size;
    let read_timeout = Duration::from_secs(config.server.timeout_seconds);
    let max_payload_size = buffer_size.min(16 * 1024);
    let inbound_codec = FrameCodec::new(
        config.auth.shared_secret.as_bytes(),
        config.auth.max_time_diff_secs,
    )?;
    let outbound_codec = FrameCodec::new(
        config.auth.shared_secret.as_bytes(),
        config.auth.max_time_diff_secs,
    )?;

    debug!("✓ 读写超时设置为: {} 秒", config.server.timeout_seconds);

    // 客户端 -> 目标（解密）
    let c2t = async move {
        loop {
            let buffer = match timeout(
                read_timeout,
                read_obfuscated_payload_with_codec(&mut client_reader, &inbound_codec),
            )
            .await
            {
                Ok(Ok(payload)) => payload,
                _ => {
                    debug!("客户端->目标: 读取加密帧超时或错误，断开连接");
                    break;
                }
            };

            debug!("客户端->目标: {} 字节", buffer.len());

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
        let mut buffer = vec![0u8; max_payload_size];

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

            let result = timeout(
                read_timeout,
                write_obfuscated_payload_with_codec(
                    &mut client_writer,
                    &buffer[..n],
                    config,
                    &outbound_codec,
                ),
            )
            .await;
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
    config: &ServerConfig,
) -> anyhow::Result<String> {
    let payload = read_obfuscated_payload(stream, config).await?;

    // 反序列化并验证
    let auth_packet = AuthPacket::deserialize(&payload)?;

    debug!("👤 反序列化成功，用户名: {}", auth_packet.username);

    // 验证认证包
    auth_packet.verify(
        config.auth.shared_secret.as_bytes(),
        config.auth.max_time_diff_secs,
    )?;
    reject_replayed_auth(&auth_packet, config.auth.max_time_diff_secs).await?;

    debug!("✅ 认证包验证成功");

    Ok(auth_packet.username)
}

async fn reject_replayed_auth(
    auth_packet: &AuthPacket,
    max_time_diff_secs: u64,
) -> anyhow::Result<()> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(auth_packet.timestamp);
    let min_timestamp = now.saturating_sub(max_time_diff_secs);
    let cache = AUTH_REPLAY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().await;

    cache.retain(|_, timestamp| *timestamp >= min_timestamp);
    if cache.contains_key(&auth_packet.hmac) {
        return Err(anyhow::anyhow!("认证包重放"));
    }
    cache.insert(auth_packet.hmac, auth_packet.timestamp);
    Ok(())
}

fn current_auth_byte(config: &ServerConfig) -> u8 {
    let shared_secret_byte = config
        .auth
        .shared_secret
        .as_bytes()
        .first()
        .copied()
        .unwrap_or(0);
    generate_first_auth_byte(shared_secret_byte)
}

async fn write_obfuscated_payload_with_codec<W>(
    writer: &mut W,
    payload: &[u8],
    config: &ServerConfig,
    codec: &FrameCodec,
) -> anyhow::Result<()>
where
    W: AsyncWrite + Unpin,
{
    let frame = codec.encode(payload, current_auth_byte(config), DEFAULT_MAX_PADDING)?;
    writer.write_all(&frame).await?;
    Ok(())
}

async fn read_obfuscated_payload<R>(
    reader: &mut R,
    config: &ServerConfig,
) -> anyhow::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut prefix = [0u8; 6];
    reader.read_exact(&mut prefix).await?;

    let mut len_buffer = [0u8; 2];
    reader.read_exact(&mut len_buffer).await?;
    let body_len = u16::from_be_bytes(len_buffer) as usize;
    if body_len > MAX_FRAME_BODY_LEN {
        return Err(anyhow::anyhow!("加密帧长度超出限制"));
    }

    let mut frame = Vec::with_capacity(8 + body_len);
    frame.extend_from_slice(&prefix);
    frame.extend_from_slice(&len_buffer);
    frame.resize(8 + body_len, 0);
    reader.read_exact(&mut frame[8..]).await?;

    let (payload, _) = decode_obfuscated_frame(
        &frame,
        config.auth.shared_secret.as_bytes(),
        config.auth.max_time_diff_secs,
    )?;
    Ok(payload)
}

async fn read_obfuscated_payload_with_codec<R>(
    reader: &mut R,
    codec: &FrameCodec,
) -> anyhow::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let mut prefix = [0u8; 6];
    reader.read_exact(&mut prefix).await?;

    let mut len_buffer = [0u8; 2];
    reader.read_exact(&mut len_buffer).await?;
    let body_len = u16::from_be_bytes(len_buffer) as usize;
    if body_len > MAX_FRAME_BODY_LEN {
        return Err(anyhow::anyhow!("加密帧长度超出限制"));
    }

    let mut frame = Vec::with_capacity(8 + body_len);
    frame.extend_from_slice(&prefix);
    frame.extend_from_slice(&len_buffer);
    frame.resize(8 + body_len, 0);
    reader.read_exact(&mut frame[8..]).await?;

    let (payload, _) = codec.decode(&frame)?;
    Ok(payload)
}
