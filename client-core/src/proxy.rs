//! SOCKS5代理客户端核心逻辑

use crate::{ClientConfig, ProxyStatus, Result};
use shared::{AuthPacket, KingObj};
use tokio::net::{TcpListener, TcpStream};
use tracing::{info, error, debug};
use std::sync::Arc;
use tokio::sync::Semaphore;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
        self.status.set_state(crate::state::ProxyState::Starting).await;

        // 【关键修复】先同步绑定端口，确保端口可用
        info!("步骤1: 绑定端口...");
        let listener = match self.bind_port().await {
            Ok(l) => {
                info!("步骤1完成: 端口绑定成功");
                l
            },
            Err(e) => {
                error!("步骤1失败: {}", e);
                self.status.set_state(crate::state::ProxyState::Stopped).await;
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
            if let Err(e) = run_proxy_with_listener(listener, config, semaphore, status, shutdown_rx).await {
                error!("代理运行错误: {}", e);
            }
        });

        self.handle = Some(handle);
        self.status.set_state(crate::state::ProxyState::Running).await;

        info!("步骤2完成: 异步任务已创建");
        info!("✓ SOCKS5代理客户端已启动");
        Ok(())
    }

    /// 停止代理客户端
    pub async fn stop(&mut self) -> Result<()> {
        if !self.status.get_state().await.is_running() {
            return Ok(());
        }

        self.status.set_state(crate::state::ProxyState::Stopping).await;

        // 发送停止信号
        if let Some(tx) = &self.shutdown_tx {
            let _ = tx.send(());
        }

        // 等待任务结束
        if let Some(handle) = self.handle.take() {
            let _ = handle.await;
        }

        self.listener = None;
        self.status.set_state(crate::state::ProxyState::Stopped).await;
        info!("SOCKS5代理客户端已停止");
        Ok(())
    }

    /// 绑定监听端口（同步操作，确保端口可用）
    async fn bind_port(&self) -> Result<TcpListener> {
        use std::net::{IpAddr, Ipv4Addr};

        let bind_addr = SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            self.config.local.listen_port
        );

        info!("尝试绑定端口: {}", bind_addr);

        let listener = TcpListener::bind(&bind_addr).await
            .map_err(|e| {
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
        info!("配置服务器: {}:{} [{}]", server.host, server.port,
              if server.enabled { "启用" } else { "禁用" });
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

    status.increment_connections();

    // SOCKS5握手
    if let Err(e) = handle_socks5_handshake(&mut local_stream).await {
        error!("SOCKS5握手失败 [{}]: {}", local_addr, e);
        return Err(e.into());
    }

    debug!("SOCKS5握手成功 [{}]", local_addr);

    // 读取SOCKS5请求
    let target_addr = match read_socks5_request(&mut local_stream).await {
        Ok(addr) => addr,
        Err(e) => {
            error!("读取SOCKS5请求失败 [{}]: {}", local_addr, e);
            return Err(e.into());
        }
    };

    info!("收到SOCKS5请求: {:?}", target_addr);

    // 连接到远程服务端
    let mut remote_stream = match connect_to_remote_server(&config).await {
        Ok(s) => s,
        Err(e) => {
            error!("无法连接到远程服务端: {}", e);
            return Err(e.into());
        }
    };

    info!("成功连接到远程服务端");

    // 发送认证包（如果启用）
    if config.auth.enabled {
        debug!("发送认证包到远程服务端");
        if let Err(e) = send_auth_packet(&mut remote_stream, &config).await {
            error!("发送认证包失败: {}", e);
            return Err(e.into());
        }
        info!("认证包发送成功");
    }

    // 发送目标地址
    if let Err(e) = send_target_address(&mut remote_stream, &target_addr).await {
        error!("发送目标地址失败: {}", e);
        return Err(e.into());
    }

    // 发送成功响应
    if let Err(e) = send_socks5_success_response(&mut local_stream).await {
        error!("发送SOCKS5响应失败: {}", e);
        return Err(e.into());
    }

    // 数据转发
    info!("开始数据转发 [{}]", local_addr);
    relay_with_encryption(local_stream, remote_stream, &status).await?;

    Ok(())
}

/// 处理SOCKS5握手
async fn handle_socks5_handshake(stream: &mut TcpStream) -> anyhow::Result<()> {
    let mut buffer = [0u8; 257];
    let n = stream.read(&mut buffer).await?;

    if n < 3 {
        return Err(anyhow::anyhow!("无效的握手请求"));
    }

    if buffer[0] != 0x05 {
        return Err(anyhow::anyhow!("不支持的SOCKS版本: {}", buffer[0]));
    }

    let method_count = buffer[1] as usize;
    if n < 2 + method_count {
        return Err(anyhow::anyhow!("无效的方法数量"));
    }

    let methods = &buffer[2..2 + method_count];
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
    let server = config.get_active_server()
        .ok_or_else(|| anyhow::anyhow!("没有可用的服务器配置"))?;

    let addr = if server.host.contains(':') {
        format!("[{}]:{}", server.host, server.port)
    } else {
        format!("{}:{}", server.host, server.port)
    };

    TcpStream::connect(&addr).await.map_err(Into::into)
}

/// 发送目标地址到远程服务端
async fn send_target_address(stream: &mut TcpStream, target_addr: &shared::TargetAddr) -> anyhow::Result<()> {
    let addr_bytes = target_addr.encode();
    let mut king = KingObj::new();
    let mut encrypted = addr_bytes.clone();
    let encrypted_len = encrypted.len();
    king.encode(&mut encrypted, encrypted_len)?;

    let len = encrypted.len() as u16;
    stream.write_all(&len.to_be_bytes()).await?;
    stream.write_all(&encrypted).await?;

    Ok(())
}

/// 发送SOCKS5成功响应
async fn send_socks5_success_response(stream: &mut TcpStream) -> anyhow::Result<()> {
    let response = [
        0x05, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
    ];
    stream.write_all(&response).await?;
    Ok(())
}

/// 数据转发（带加密）
async fn relay_with_encryption(
    local_stream: TcpStream,
    remote_stream: TcpStream,
    status: &ProxyStatus,
) -> anyhow::Result<()> {
    let mut local_encryptor = KingObj::new();
    let mut local_decryptor = KingObj::new();

    let (mut local_reader, mut local_writer) = local_stream.into_split();
    let (mut remote_reader, mut remote_writer) = remote_stream.into_split();

    // 本地 -> 远程（加密）
    let l2r = async move {
        let mut buffer = vec![0u8; 8192];
        let mut data = Vec::with_capacity(8192);

        loop {
            let n = local_reader.read(&mut buffer).await?;
            if n == 0 {
                break;
            }

            debug!("本地->远程: {} 字节", n);

            data.clear();
            data.resize(n, 0);
            data.copy_from_slice(&buffer[..n]);

            local_encryptor.encode(&mut data, n)?;

            let len = data.len() as u16;
            remote_writer.write_all(&len.to_be_bytes()).await?;
            remote_writer.write_all(&data).await?;

            status.add_upload(n as u64);
        }

        Ok::<(), anyhow::Error>(())
    };

    // 远程 -> 本地（解密）
    let r2l = async move {
        let mut len_buffer = [0u8; 2];
        let mut buffer = Vec::with_capacity(8192);

        loop {
            match remote_reader.read_exact(&mut len_buffer).await {
                Ok(_) => {}
                Err(_) => break,
            }
            let len = u16::from_be_bytes(len_buffer) as usize;

            buffer.clear();
            buffer.resize(len, 0);

            match remote_reader.read_exact(&mut buffer).await {
                Ok(_) => {}
                Err(_) => break,
            }

            debug!("远程->本地: {} 字节（加密）", len);

            local_decryptor.decode(&mut buffer, len)?;

            match local_writer.write_all(&buffer).await {
                Ok(_) => {}
                Err(_) => break,
            }

            status.add_download(len as u64);
        }

        Ok::<(), anyhow::Error>(())
    };

    tokio::select! {
        res = l2r => { res?; }
        res = r2l => { res?; }
    }

    Ok(())
}

/// 发送认证包到远程服务端
async fn send_auth_packet(
    stream: &mut TcpStream,
    config: &ClientConfig,
) -> anyhow::Result<()> {
    let auth_packet = AuthPacket::new(
        config.auth.username.clone(),
        config.auth.shared_secret.as_bytes(),
        config.auth.sequence,
    );

    let mut encryptor = KingObj::new();
    let encrypted = auth_packet.serialize_encrypted(&mut encryptor)?;

    stream.write_all(&encrypted).await?;
    Ok(())
}
