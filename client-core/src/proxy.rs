//! SOCKS5代理客户端核心逻辑

use crate::{ClientConfig, ConnectionGuard, ProxyStatus, Result};
use shared::{
    generate_first_auth_byte, read_encrypted_frame, write_encrypted_frame, AuthPacket, ClientHello,
    ConnectResponse, FrameCodec, SessionDirection, DEFAULT_MAX_PADDING,
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use tracing::{debug, error, info};

/// SOCKS5代理客户端
pub struct ProxyClient {
    /// 客户端配置
    config: Arc<ClientConfig>,
    /// 连接信号量
    semaphore: Arc<Semaphore>,
    /// 状态管理
    status: ProxyStatus,
    /// 运行句柄
    handle: Option<tokio::task::JoinHandle<()>>,
    /// 停止信号
    shutdown_tx: Option<tokio::sync::broadcast::Sender<()>>,
    /// TCP监听器（在启动时创建，用于验证端口）
    listener: Option<std::sync::Arc<tokio::sync::Mutex<TcpListener>>>,
}

impl ProxyClient {
    /// 创建新的代理客户端
    pub fn new(config: ClientConfig) -> Result<Self> {
        config.auth.validate()?;
        let semaphore = Arc::new(Semaphore::new(100));

        Ok(Self {
            config: Arc::new(config),
            semaphore,
            status: ProxyStatus::new(),
            handle: None,
            shutdown_tx: None,
            listener: None,
        })
    }

    /// 启动代理客户端
    pub async fn start(&mut self) -> Result<()> {
        if self.status.get_state().await.is_running() {
            info!("代理已在运行，跳过启动");
            return Ok(());
        }

        info!("开始启动代理客户端...");
        self.status
            .set_state(crate::state::ProxyState::Starting)
            .await;

        // 【关键修复】先同步绑定端口，确保端口可用
        info!("步骤1: 绑定端口...");
        let listener = match self.bind_port().await {
            Ok(l) => {
                info!("步骤1完成: 端口绑定成功");
                l
            }
            Err(e) => {
                error!("步骤1失败: {}", e);
                self.status
                    .set_state(crate::state::ProxyState::Stopped)
                    .await;
                return Err(e);
            }
        };

        info!("步骤2: 创建异步任务...");

        let (shutdown_tx, shutdown_rx) = tokio::sync::broadcast::channel(1);
        self.shutdown_tx = Some(shutdown_tx.clone());

        let config = self.config.clone();
        let semaphore = self.semaphore.clone();
        let status = self.status.clone();

        let handle = tokio::spawn(async move {
            if let Err(e) =
                run_proxy_with_listener(listener, config, semaphore, status, shutdown_rx).await
            {
                error!("代理运行错误: {}", e);
            }
        });

        self.handle = Some(handle);
        self.status
            .set_state(crate::state::ProxyState::Running)
            .await;

        info!("步骤2完成: 异步任务已创建");
        info!("✓ SOCKS5代理客户端已启动");
        Ok(())
    }

    /// 停止代理客户端
    pub async fn stop(&mut self) -> Result<()> {
        if !self.status.get_state().await.is_running() {
            return Ok(());
        }

        self.status
            .set_state(crate::state::ProxyState::Stopping)
            .await;

        // 发送停止信号
        if let Some(tx) = &self.shutdown_tx {
            let _ = tx.send(());
        }

        // 等待任务结束
        if let Some(handle) = self.handle.take() {
            let _ = handle.await;
        }

        self.listener = None;
        self.status
            .set_state(crate::state::ProxyState::Stopped)
            .await;
        info!("SOCKS5代理客户端已停止");
        Ok(())
    }

    /// 绑定监听端口（同步操作，确保端口可用）
    async fn bind_port(&self) -> Result<TcpListener> {
        let bind_addr: SocketAddr = format!(
            "{}:{}",
            self.config.local.listen_addr, self.config.local.listen_port
        )
        .parse()
        .map_err(|e| anyhow::anyhow!("无效的本地监听地址: {}", e))?;

        info!("尝试绑定端口: {}", bind_addr);

        let listener = TcpListener::bind(&bind_addr).await.map_err(|e| {
            // 记录详细错误
            error!("绑定端口失败: {}", e);

            // 提供详细的错误信息，包括常见错误的中文说明
            let error_msg = if e.kind() == std::io::ErrorKind::AddrInUse {
                format!("端口{}已被占用，请检查是否有其他程序正在使用", bind_addr)
            } else if e.kind() == std::io::ErrorKind::PermissionDenied {
                format!("权限不足，无法绑定端口{}", bind_addr)
            } else {
                format!("绑定端口{}失败: {}", bind_addr, e)
            };
            anyhow::anyhow!("{}", error_msg)
        })?;

        info!("✓ 端口绑定成功: {}", bind_addr);
        Ok(listener)
    }

    /// 获取状态
    pub fn status(&self) -> &ProxyStatus {
        &self.status
    }

    /// 更新配置
    pub async fn update_config(&mut self, config: ClientConfig) -> Result<()> {
        let was_running = self.status.get_state().await.is_running();

        if was_running {
            self.stop().await?;
        }

        self.config = Arc::new(config);

        if was_running {
            self.start().await?;
        }

        Ok(())
    }
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

/// 使用已绑定的listener运行代理服务器
async fn run_proxy_with_listener(
    listener: TcpListener,
    config: Arc<ClientConfig>,
    semaphore: Arc<Semaphore>,
    status: ProxyStatus,
    mut shutdown_rx: tokio::sync::broadcast::Receiver<()>,
) -> Result<()> {
    info!("SOCKS5代理客户端监听: {}", listener.local_addr()?);

    // 显示所有配置的服务器
    if let Some(active_server) = config.get_active_server() {
        info!("活动服务器: {}:{}", active_server.host, active_server.port);
    }
    for server in &config.servers {
        info!(
            "配置服务器: {}:{} [{}]",
            server.host,
            server.port,
            if server.enabled { "启用" } else { "禁用" }
        );
    }

    loop {
        tokio::select! {
            // 接受连接
            result = listener.accept() => {
                match result {
                    Ok((local_stream, local_addr)) => {
                        let permit = semaphore.clone().acquire_owned().await.unwrap();
                        let config = config.clone();
                        let status = status.clone();

                        tokio::spawn(async move {
                            let _permit = permit;
                            if let Err(e) = handle_local_connection(local_stream, local_addr, config, status).await {
                                error!("连接处理错误 [{}]: {}", local_addr, e);
                            }
                        });
                    }
                    Err(e) => {
                        error!("接受连接失败: {}", e);
                    }
                }
            }
            // 接收停止信号
            _ = shutdown_rx.recv() => {
                info!("收到停止信号");
                break;
            }
        }
    }

    Ok(())
}

/// 处理本地连接
async fn handle_local_connection(
    mut local_stream: TcpStream,
    local_addr: SocketAddr,
    config: Arc<ClientConfig>,
    status: ProxyStatus,
) -> anyhow::Result<()> {
    debug!("开始处理本地连接: {}", local_addr);

    // 增加连接计数
    status.increment_connections();

    // 创建连接守卫，确保函数结束时自动减少连接计数
    // 无论函数从哪个路径返回（正常、错误、panic），guard 的 Drop 都会被调用
    let _guard = ConnectionGuard::new(&status);

    // SOCKS5握手
    if let Err(e) = handle_socks5_handshake(&mut local_stream).await {
        error!("SOCKS5握手失败 [{}]: {}", local_addr, e);
        return Err(e);
    }

    debug!("SOCKS5握手成功 [{}]", local_addr);

    // 读取SOCKS5请求
    let target_addr = match read_socks5_request(&mut local_stream).await {
        Ok(addr) => addr,
        Err(e) => {
            error!("读取SOCKS5请求失败 [{}]: {}", local_addr, e);
            return Err(e);
        }
    };

    info!("收到SOCKS5请求: {:?}", target_addr);

    // 连接到远程服务端
    let mut remote_stream = match connect_to_remote_server(&config).await {
        Ok(s) => s,
        Err(e) => {
            error!("无法连接到远程服务端: {}", e);
            return Err(e);
        }
    };

    info!("成功连接到远程服务端");

    let codecs = establish_session(&mut remote_stream, &target_addr, &config).await?;
    let response = read_payload(&mut remote_stream, &codecs.download).await?;
    if ConnectResponse::decode(&response)? != ConnectResponse::Success {
        send_socks5_response(&mut local_stream, 0x05).await?;
        anyhow::bail!("remote server could not connect to target");
    }
    send_socks5_response(&mut local_stream, 0x00).await?;

    // 数据转发
    info!("开始数据转发 [{}]", local_addr);
    relay_with_encryption(local_stream, remote_stream, &config, &status, codecs).await?;

    Ok(())
}

/// 处理SOCKS5握手
async fn handle_socks5_handshake(stream: &mut TcpStream) -> anyhow::Result<()> {
    let mut header = [0u8; 2];
    stream.read_exact(&mut header).await?;
    if header[0] != 0x05 {
        anyhow::bail!("不支持的SOCKS版本: {}", header[0]);
    }
    if header[1] == 0 {
        anyhow::bail!("SOCKS5 method list is empty");
    }
    let mut methods = vec![0u8; header[1] as usize];
    stream.read_exact(&mut methods).await?;
    let supports_none = methods.contains(&0x00);

    let response = if supports_none {
        vec![0x05, 0x00]
    } else {
        vec![0x05, 0xFF]
    };

    stream.write_all(&response).await?;

    if !supports_none {
        return Err(anyhow::anyhow!("客户端不支持无需认证的连接"));
    }

    Ok(())
}

/// 读取SOCKS5请求
async fn read_socks5_request(stream: &mut TcpStream) -> anyhow::Result<shared::TargetAddr> {
    use shared::Request;

    let mut header = [0u8; 4];
    stream.read_exact(&mut header).await?;

    let addr_type = header[3];

    debug!("SOCKS5请求地址类型: 0x{:02X}", addr_type);

    match addr_type {
        0x01 => {
            let mut addr_buffer = [0u8; 6];
            stream.read_exact(&mut addr_buffer).await?;

            let mut full_buffer = [0u8; 10];
            full_buffer[0..4].copy_from_slice(&header);
            full_buffer[4..10].copy_from_slice(&addr_buffer);

            let request = Request::decode(&mut full_buffer.as_ref())?;
            debug!("收到IPv4地址: {:?}", request.dest_addr);
            Ok(request.dest_addr)
        }
        0x03 => {
            let mut len_buffer = [0u8; 1];
            stream.read_exact(&mut len_buffer).await?;

            let domain_len = len_buffer[0] as usize;
            let mut domain_buffer = vec![0u8; domain_len + 2];
            stream.read_exact(&mut domain_buffer).await?;

            let mut full_buffer = Vec::with_capacity(5 + domain_len);
            full_buffer.extend_from_slice(&header);
            full_buffer.push(len_buffer[0]);
            full_buffer.extend_from_slice(&domain_buffer);

            let request = Request::decode(&mut full_buffer.as_slice())?;
            debug!("收到域名地址: {:?}", request.dest_addr);
            Ok(request.dest_addr)
        }
        0x04 => {
            let mut addr_buffer = [0u8; 18];
            stream.read_exact(&mut addr_buffer).await?;

            let mut full_buffer = [0u8; 22];
            full_buffer[0..4].copy_from_slice(&header);
            full_buffer[4..22].copy_from_slice(&addr_buffer);

            let request = Request::decode(&mut full_buffer.as_ref())?;
            Ok(request.dest_addr)
        }
        _ => Err(anyhow::anyhow!("不支持的地址类型: {}", addr_type)),
    }
}

/// 连接到远程服务端
async fn connect_to_remote_server(config: &ClientConfig) -> anyhow::Result<TcpStream> {
    let server = config
        .get_active_server()
        .ok_or_else(|| anyhow::anyhow!("没有可用的服务器配置"))?;

    let addr = if server.host.contains(':') {
        format!("[{}]:{}", server.host, server.port)
    } else {
        format!("{}:{}", server.host, server.port)
    };

    TcpStream::connect(&addr).await.map_err(Into::into)
}

async fn send_socks5_response(stream: &mut TcpStream, reply: u8) -> anyhow::Result<()> {
    let response = [0x05, reply, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    stream.write_all(&response).await?;
    Ok(())
}

struct SessionCodecs {
    upload: FrameCodec,
    download: FrameCodec,
}

async fn establish_session(
    stream: &mut TcpStream,
    target: &shared::TargetAddr,
    config: &ClientConfig,
) -> anyhow::Result<SessionCodecs> {
    let auth = config.auth.enabled.then(|| {
        AuthPacket::new(
            config.auth.username.clone(),
            config.auth.shared_secret.as_bytes(),
            next_auth_sequence(),
        )
    });
    let hello = ClientHello::new(auth);
    let upload = FrameCodec::new_session(
        config.auth.shared_secret.as_bytes(),
        &hello.salt,
        SessionDirection::ClientToServer,
        config.auth.max_time_diff_secs,
    )?;
    let download = FrameCodec::new_session(
        config.auth.shared_secret.as_bytes(),
        &hello.salt,
        SessionDirection::ServerToClient,
        config.auth.max_time_diff_secs,
    )?;
    stream
        .write_all(&shared::generate_protocol_prefix(current_auth_byte(config)))
        .await?;
    stream.write_all(&hello.salt).await?;
    write_payload(stream, &upload, &hello.encode(), current_auth_byte(config)).await?;
    write_payload(stream, &upload, &target.encode(), current_auth_byte(config)).await?;
    Ok(SessionCodecs { upload, download })
}

/// 数据转发（带加密）
async fn relay_with_encryption(
    mut local_stream: TcpStream,
    mut remote_stream: TcpStream,
    config: &ClientConfig,
    status: &ProxyStatus,
    codecs: SessionCodecs,
) -> anyhow::Result<()> {
    set_tcp_keepalive(&local_stream).ok();
    set_tcp_keepalive(&remote_stream).ok();
    let (mut local_reader, mut local_writer) = local_stream.split();
    let (mut remote_reader, mut remote_writer) = remote_stream.split();
    let auth_byte = current_auth_byte(config);
    let upload = async {
        let mut buffer = vec![0u8; 8192];
        loop {
            let n = local_reader.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            write_payload(&mut remote_writer, &codecs.upload, &buffer[..n], auth_byte).await?;
            status.add_upload(n as u64);
        }
        remote_writer.shutdown().await?;
        Ok::<(), anyhow::Error>(())
    };
    let download = async {
        loop {
            let buffer = match read_payload(&mut remote_reader, &codecs.download).await {
                Ok(v) => v,
                Err(err) if is_eof(&err) => break,
                Err(err) => return Err(err),
            };
            local_writer.write_all(&buffer).await?;
            status.add_download(buffer.len() as u64);
        }
        local_writer.shutdown().await?;
        Ok::<(), anyhow::Error>(())
    };
    tokio::try_join!(upload, download)?;
    Ok(())
}

fn current_auth_byte(config: &ClientConfig) -> u8 {
    let shared_secret_byte = config
        .auth
        .shared_secret
        .as_bytes()
        .first()
        .copied()
        .unwrap_or(0);
    generate_first_auth_byte(shared_secret_byte)
}

fn next_auth_sequence() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    (nanos & u128::from(u64::MAX)) as u64
}

async fn write_payload<W>(
    writer: &mut W,
    codec: &FrameCodec,
    payload: &[u8],
    auth_byte: u8,
) -> anyhow::Result<()>
where
    W: AsyncWrite + Unpin,
{
    write_encrypted_frame(writer, codec, payload, auth_byte, DEFAULT_MAX_PADDING).await?;
    Ok(())
}

async fn read_payload<R>(reader: &mut R, codec: &FrameCodec) -> anyhow::Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    Ok(codec.decode(&read_encrypted_frame(reader).await?)?.0)
}

fn is_eof(error: &anyhow::Error) -> bool {
    error.downcast_ref::<shared::error::ProxyError>().is_some_and(|e| matches!(e, shared::error::ProxyError::Io(io) if io.kind() == std::io::ErrorKind::UnexpectedEof))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn socks5_handshake_accepts_segmented_input() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            handle_socks5_handshake(&mut stream).await.unwrap();
        });
        let mut client = TcpStream::connect(address).await.unwrap();
        client.write_all(&[0x05]).await.unwrap();
        tokio::task::yield_now().await;
        client.write_all(&[0x02, 0x02]).await.unwrap();
        tokio::task::yield_now().await;
        client.write_all(&[0x00]).await.unwrap();
        let mut response = [0u8; 2];
        client.read_exact(&mut response).await.unwrap();
        assert_eq!(response, [0x05, 0x00]);
        server.await.unwrap();
    }
}
