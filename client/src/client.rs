//! SOCKS5代理客户端核心实现
//!
//! 架构：
//! 1. 在本地监听SOCKS5请求
//! 2. 接收到连接后，连接到远程服务端
//! 3. 将本地SOCKS5数据加密后转发到远程服务端
//! 4. 接收远程服务端加密流量并解密
//! 5. 将解密后的数据返回给本地SOCKS5客户端

use crate::config::ClientConfig;
use shared::{AuthPacket, KingObj, Result};
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
    /// 连接信号量（限制最大连接数）
    semaphore: Arc<Semaphore>,
}

impl ProxyClient {
    /// 创建新的代理客户端
    pub fn new(config: ClientConfig) -> Result<Self> {
        let semaphore = Arc::new(Semaphore::new(100)); // 默认最多100个连接

        Ok(Self {
            config: Arc::new(config),
            semaphore,
        })
    }

    /// 启动客户端
    pub async fn run(&self) -> Result<()> {
        use std::net::{IpAddr, Ipv4Addr, SocketAddr};

        let bind_addr = SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            self.config.local.listen_port
        );
        let listener = TcpListener::bind(bind_addr).await?;

        info!("🎯 SOCKS5代理客户端监听: {}", bind_addr);
        info!("📡 远程服务端: {}:{}", self.config.server.remote_server, self.config.server.remote_port);

        loop {
            // 接受本地连接
            let (local_stream, local_addr) = listener.accept().await?;

            // 获取信号量许可
            let permit = self.semaphore.clone().acquire_owned().await.unwrap();

            info!("📥 新的本地连接来自: {}", local_addr);

            // 处理连接
            let config = self.config.clone(); // Arc克隆是零成本的
            tokio::spawn(async move {
                let _permit = permit; // 持有许可直到连接结束

                if let Err(e) = handle_local_connection(local_stream, local_addr, config).await {
                    error!("❌ 连接处理错误 [{}]: {}", local_addr, e);
                }
            });
        }
    }
}

/// 处理本地连接
async fn handle_local_connection(
    mut local_stream: TcpStream,
    local_addr: SocketAddr,
    config: Arc<ClientConfig>,
) -> anyhow::Result<()> {
    debug!("🔌 开始处理本地连接: {}", local_addr);

    // 步骤1: SOCKS5握手
    if let Err(e) = handle_socks5_handshake(&mut local_stream).await {
        error!("❌ SOCKS5握手失败 [{}]: {}", local_addr, e);
        return Err(e.into());
    }

    debug!("✅ SOCKS5握手成功 [{}]", local_addr);

    // 步骤2: 读取SOCKS5请求（获取目标地址）
    let target_addr = match read_socks5_request(&mut local_stream).await {
        Ok(addr) => addr,
        Err(e) => {
            error!("❌ 读取SOCKS5请求失败 [{}]: {}", local_addr, e);
            return Err(e.into());
        }
    };

    info!("🎯 收到SOCKS5请求: {:?}", target_addr);
    info!("🎯 最终连接到: {:?}", target_addr);

    // 步骤3: 连接到远程服务端
    let mut remote_stream = match connect_to_remote_server(&config).await {
        Ok(s) => s,
        Err(e) => {
            error!("❌ 无法连接到远程服务端: {}", e);
            return Err(e.into());
        }
    };

    info!("✅ 成功连接到远程服务端");

    // 步骤4: 发送认证包（如果启用）
    if config.auth.enabled {
        debug!("🔐 发送认证包到远程服务端");
        if let Err(e) = send_auth_packet(&mut remote_stream, &config).await {
            error!("❌ 发送认证包失败: {}", e);
            return Err(e.into());
        }
        info!("✅ 认证包发送成功");
    }

    // 步骤5: 将目标地址加密发送给服务端
    if let Err(e) = send_target_address(&mut remote_stream, &target_addr).await {
        error!("❌ 发送目标地址失败: {}", e);
        return Err(e.into());
    }

    // 步骤6: 发送成功响应给本地客户端
    if let Err(e) = send_socks5_success_response(&mut local_stream).await {
        error!("❌ 发送SOCKS5响应失败: {}", e);
        return Err(e.into());
    }

    // 步骤7: 开始数据转发（本地 <-> 远程，带加密）
    info!("🔄 开始数据转发 [{}]", local_addr);
    relay_with_encryption(local_stream, remote_stream).await?;

    Ok(())
}

/// 处理SOCKS5握手
async fn handle_socks5_handshake(stream: &mut TcpStream) -> anyhow::Result<()> {
    let mut buffer = [0u8; 257];
    let n = stream.read(&mut buffer).await?;

    if n < 3 {
        return Err(anyhow::anyhow!("无效的握手请求"));
    }

    // 验证SOCKS5版本
    if buffer[0] != 0x05 {
        return Err(anyhow::anyhow!("不支持的SOCKS版本: {}", buffer[0]));
    }

    // 检查是否支持无需认证
    let method_count = buffer[1] as usize;
    if n < 2 + method_count {
        return Err(anyhow::anyhow!("无效的方法数量"));
    }

    let methods = &buffer[2..2 + method_count];
    let supports_none = methods.contains(&0x00);

    // 发送握手响应（无需认证）
    let response = if supports_none {
        vec![0x05, 0x00] // 版本5，无需认证
    } else {
        vec![0x05, 0xFF] // 版本5，无支持的认证方法
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

    // 读取请求头（4字节）
    let mut header = [0u8; 4];
    stream.read_exact(&mut header).await?;

    // 根据地址类型读取剩余数据
    let addr_type = header[3];

    debug!("📋 SOCKS5请求地址类型: 0x{:02X} ({})",
        addr_type,
        match addr_type {
            0x01 => "IPv4",
            0x03 => "域名",
            0x04 => "IPv6",
            _ => "未知",
        }
    );

    match addr_type {
        0x01 => {
            // IPv4: 4字节IP + 2字节端口
            let mut addr_buffer = [0u8; 6];
            stream.read_exact(&mut addr_buffer).await?;

            let mut full_buffer = [0u8; 10];
            full_buffer[0..4].copy_from_slice(&header);
            full_buffer[4..10].copy_from_slice(&addr_buffer);

            let request = Request::decode(&mut full_buffer.as_ref())?;
            debug!("🔴 收到IPv4地址: {:?}", request.dest_addr);
            Ok(request.dest_addr)
        }
        0x03 => {
            // 域名: 1字节长度 + 域名 + 2字节端口
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
            debug!("🟢 收到域名地址: {:?}", request.dest_addr);
            Ok(request.dest_addr)
        }
        0x04 => {
            // IPv6: 16字节IP + 2字节端口
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
    // 构造地址字符串（只调用一次，影响较小）
    let addr_str = &config.server.remote_server;
    let port = config.server.remote_port;

    // 使用 &str 拼接避免格式化（编译器会优化）
    let addr = if addr_str.contains(':') {
        // IPv6地址需要用方括号
        format!("[{}]:{}", addr_str, port)
    } else {
        // IPv4或域名
        format!("{}:{}", addr_str, port)
    };

    let stream = TcpStream::connect(&addr).await?;
    Ok(stream)
}

/// 发送目标地址到远程服务端
async fn send_target_address(stream: &mut TcpStream, target_addr: &shared::TargetAddr) -> anyhow::Result<()> {
    debug!("📤 发送目标地址到远程服务端: {:?}", target_addr);

    // 将目标地址序列化
    let addr_bytes = target_addr.encode();

    // 创建加密器
    let mut king = KingObj::new();

    // 加密地址数据
    let mut encrypted = addr_bytes.clone();
    let encrypted_len = encrypted.len();
    king.encode(&mut encrypted, encrypted_len)?;

    debug!("🔒 目标地址加密后: {} 字节", encrypted_len);

    // 发送长度前缀（2字节，大端序）
    let len = encrypted.len() as u16;
    stream.write_all(&len.to_be_bytes()).await?;

    // 发送加密后的地址
    stream.write_all(&encrypted).await?;

    debug!("✅ 目标地址发送成功");

    Ok(())
}

/// 发送SOCKS5成功响应
async fn send_socks5_success_response(stream: &mut TcpStream) -> anyhow::Result<()> {
    // 发送成功响应（使用IPv4 0.0.0.0:0作为绑定地址）
    let response = [
        0x05, 0x00, 0x00, 0x01, // 版本、成功、保留、IPv4
        0x00, 0x00, 0x00, 0x00, // 绑定地址
        0x00, 0x00,              // 绑定端口
    ];

    stream.write_all(&response).await?;
    Ok(())
}

/// 数据转发（带加密）
///
/// 架构：
/// - 本地 -> 远程：读取本地数据，加密后发送到远程
/// - 远程 -> 本地：读取远程数据，解密后发送到本地
async fn relay_with_encryption(
    local_stream: TcpStream,
    remote_stream: TcpStream,
) -> anyhow::Result<()> {
    let mut local_encryptor = KingObj::new();
    let mut local_decryptor = KingObj::new();

    let (mut local_reader, mut local_writer) = local_stream.into_split();
    let (mut remote_reader, mut remote_writer) = remote_stream.into_split();

    // 本地 -> 远程（加密）
    let l2r = async move {
        let mut buffer = vec![0u8; 8192];
        // 优化：预分配加密缓冲区，避免每次循环都to_vec()
        let mut data = Vec::with_capacity(8192);

        loop {
            let n = local_reader.read(&mut buffer).await?;
            if n == 0 {
                break;
            }

            debug!("本地->远程: {} 字节", n);

            // 优化：重用加密缓冲区
            data.clear();
            data.resize(n, 0);
            data.copy_from_slice(&buffer[..n]);

            // 加密数据
            local_encryptor.encode(&mut data, n)?;

            // 发送到远程（需要添加长度前缀）
            let len = data.len() as u16;
            remote_writer.write_all(&len.to_be_bytes()).await?;
            remote_writer.write_all(&data).await?;
        }

        Ok::<(), anyhow::Error>(())
    };

    // 远程 -> 本地（解密）
    let r2l = async move {
        let mut len_buffer = [0u8; 2];
        // 优化：预分配缓冲区，重用内存减少分配次数
        let mut buffer = Vec::with_capacity(8192);

        loop {
            // 读取数据长度
            match remote_reader.read_exact(&mut len_buffer).await {
                Ok(_) => {}
                Err(_) => break,
            }
            let len = u16::from_be_bytes(len_buffer) as usize;

            // 优化：重用缓冲区，resize在capacity足够时不会重新分配
            buffer.clear();
            buffer.resize(len, 0);

            // 读取加密数据
            match remote_reader.read_exact(&mut buffer).await {
                Ok(_) => {}
                Err(_) => break,
            }

            debug!("远程->本地: {} 字节（加密）", len);

            // 解密数据
            local_decryptor.decode(&mut buffer, len)?;

            // 发送到本地
            match local_writer.write_all(&buffer).await {
                Ok(_) => {}
                Err(_) => break,
            }
        }

        Ok::<(), anyhow::Error>(())
    };

    // 并发执行双向转发
    tokio::select! {
        res = l2r => {
            if let Err(e) = res {
                debug!("本地->远程 转发结束: {}", e);
            }
        }
        res = r2l => {
            if let Err(e) = res {
                debug!("远程->本地 转发结束: {}", e);
            }
        }
    }

    Ok(())
}

/// 发送认证包到远程服务端
///
/// 创建、加密并发送认证包
async fn send_auth_packet(
    stream: &mut TcpStream,
    config: &ClientConfig,
) -> anyhow::Result<()> {
    // 创建认证包
    let auth_packet = AuthPacket::new(
        config.auth.username.clone(),
        config.auth.shared_secret.as_bytes(),
        config.auth.sequence,
    );

    // 从共享密钥中提取首字节用于鉴权
    let shared_secret_byte = config.auth.shared_secret.as_bytes()
        .first()
        .copied()
        .unwrap_or(0);

    // 生成鉴权字节（仅基于时间和密钥）
    use shared::generate_first_auth_byte;
    let auth_byte = generate_first_auth_byte(shared_secret_byte);

    // 加密认证包（带鉴权字节）
    let mut encryptor = KingObj::new();
    let encrypted = auth_packet.serialize_encrypted(&mut encryptor, Some(auth_byte))?;

    // 发送加密的认证包
    stream.write_all(&encrypted).await?;

    Ok(())
}
