//! Encrypted TCP tunnel server.
use crate::config::ServerConfig;
use crate::defense::{DefenseConfig, DefenseManager};
use crate::multipath::{self, SessionRegistry};
use shared::{
    derive_session_id, extract_auth_byte_from_prefix, generate_first_auth_byte,
    read_encrypted_frame, verify_first_auth_byte, write_encrypted_frame, AuthPacket, ClientHello,
    FrameCodec, Result, SessionDirection, TargetAddr, DEFAULT_MAX_PADDING, SESSION_SALT_LEN,
};
use std::{
    collections::HashMap,
    iter::once,
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Mutex, Semaphore},
    time::{sleep, timeout},
};
use tracing::{debug, info, warn};

pub struct ProxyServer {
    config: Arc<ServerConfig>,
    semaphore: Arc<Semaphore>,
    defense: Arc<DefenseManager>,
    multipath: Arc<SessionRegistry>,
}
static AUTH_REPLAY_CACHE: OnceLock<Mutex<HashMap<[u8; 32], u64>>> = OnceLock::new();

impl ProxyServer {
    pub fn new(config: ServerConfig) -> Result<Self> {
        config.auth.validate()?;
        let semaphore = Arc::new(Semaphore::new(config.server.max_connections));
        let defense = Arc::new(DefenseManager::new(DefenseConfig::default()));
        let cleanup = defense.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(300));
            loop {
                tick.tick().await;
                cleanup.cleanup().await;
            }
        });
        let multipath = SessionRegistry::new();
        let sweeper = multipath.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(5));
            loop {
                tick.tick().await;
                sweeper.sweep().await;
            }
        });
        Ok(Self {
            config: Arc::new(config),
            semaphore,
            defense,
            multipath,
        })
    }

    pub async fn run(&self) -> Result<()> {
        let listener = TcpListener::bind(format!(
            "{}:{}",
            self.config.server.listen_addr, self.config.server.listen_port
        ))
        .await?;
        info!("tunnel server listening on {}", listener.local_addr()?);
        loop {
            let permit = match self.semaphore.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => return Ok(()),
            };
            let (stream, address) = match listener.accept().await {
                Ok(c) => c,
                Err(err) => {
                    drop(permit);
                    warn!("accept failed: {err}; retrying");
                    sleep(Duration::from_millis(100)).await;
                    continue;
                }
            };
            let config = self.config.clone();
            let defense = self.defense.clone();
            let multipath = self.multipath.clone();
            tokio::spawn(async move {
                let _permit = permit;
                if let Err(err) =
                    handle_client_connection(stream, address, config, defense, multipath).await
                {
                    debug!("connection {address} closed: {err}");
                }
            });
        }
    }
}

pub(crate) struct SessionCodecs {
    pub(crate) inbound: FrameCodec,
    pub(crate) outbound: FrameCodec,
}

/// 多路会话协商结果。
struct SessionPlan {
    target: TargetAddr,
    codecs: SessionCodecs,
    /// 服务端确认的子流总数（1 = 单流，走原有路径）。
    subflows: u8,
    joins: Vec<multipath::JoinedSubflow>,
}

async fn handle_client_connection(
    mut client: TcpStream,
    client_addr: std::net::SocketAddr,
    config: Arc<ServerConfig>,
    defense: Arc<DefenseManager>,
    multipath_registry: Arc<SessionRegistry>,
) -> anyhow::Result<()> {
    let client_ip = client_addr.ip();
    // Nagle holds the tail segment of every frame until the previous frame is
    // ACKed, capping throughput at frame_size/RTT (~17KB/s on a 240ms path).
    let _ = client.set_nodelay(true);
    if config.server.enable_ip_ban && defense.is_banned(client_ip).await {
        anyhow::bail!("IP is temporarily banned");
    }
    let handshake = timeout(
        Duration::from_secs(config.server.handshake_timeout_seconds),
        async {
            let mut prefix = [0u8; 6];
            client.read_exact(&mut prefix).await?;
            let received = extract_auth_byte_from_prefix(&prefix)
                .ok_or_else(|| anyhow::anyhow!("invalid session prelude"))?;
            if !verify_first_auth_byte(
                received,
                config.auth.shared_secret.as_bytes()[0],
                config.auth.max_time_diff_secs,
            ) {
                anyhow::bail!("invalid session prelude authentication");
            }
            let mut salt = [0u8; SESSION_SALT_LEN];
            client.read_exact(&mut salt).await?;
            let mut marker = [0u8; 1];
            client.read_exact(&mut marker).await?;
            if multipath::is_join_index(marker[0]) {
                multipath::handle_join(client, &config, &multipath_registry, salt, marker[0])
                    .await?;
                Ok(HandshakeOutcome::JoinHandled)
            } else {
                let plan =
                    session_handshake(&mut client, &config, &multipath_registry, salt, marker[0])
                        .await?;
                Ok(HandshakeOutcome::Session((client, plan)))
            }
        },
    )
    .await;
    let (mut client, plan) = match handshake {
        Ok(Ok(HandshakeOutcome::Session(pair))) => pair,
        Ok(Ok(HandshakeOutcome::JoinHandled)) => return Ok(()),
        Ok(Err(err)) => {
            if config.server.enable_ip_ban {
                defense.record_auth_failure(client_ip).await;
            }
            return Err(err);
        }
        Err(_) => {
            if config.server.enable_ip_ban {
                defense.record_auth_failure(client_ip).await;
            }
            anyhow::bail!("handshake timed out");
        }
    };
    let auth_byte = current_auth_byte(&config);
    let target_stream = match timeout(
        Duration::from_secs(config.server.timeout_seconds),
        connect_to_target(&plan.target),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        failure => {
            let _ = write_payload(
                &mut client,
                &plan.codecs.outbound,
                &multipath::connect_response_payload(false, plan.subflows),
                auth_byte,
            )
            .await;
            match failure {
                Ok(Err(err)) => return Err(err),
                Err(_) => anyhow::bail!("target connection timed out"),
                Ok(Ok(_)) => unreachable!(),
            }
        }
    };
    write_payload(
        &mut client,
        &plan.codecs.outbound,
        &multipath::connect_response_payload(true, plan.subflows),
        auth_byte,
    )
    .await?;
    // Upload direction stalls the same way as the client leg (see above).
    let _ = target_stream.set_nodelay(true);
    if plan.subflows > 1 {
        let secret_byte = config.auth.shared_secret.as_bytes()[0];
        let indexes: Vec<u8> = once(&0u8)
            .chain(plan.joins.iter().map(|sf| &sf.index))
            .copied()
            .collect();
        tracing::info!(
            "multipath session -> {:?}: striping {} subflows {:?}",
            plan.target,
            plan.subflows,
            indexes
        );
        multipath::relay_split(
            client,
            target_stream,
            plan.codecs,
            secret_byte,
            plan.joins,
        )
        .await?;
    } else {
        relay_with_encryption(client, target_stream, &config, plan.codecs).await?;
    }
    Ok(())
}

/// 读取连接前导（prefix+salt+1 字节标记）后的分发结果。
enum HandshakeOutcome {
    /// 会话 0 完成握手；连接归还给外层继续中继。
    Session((TcpStream, SessionPlan)),
    /// join 子流已交接给注册表，连接不再属于当前任务。
    JoinHandled,
}

/// 会话 0 的完整握手：hello 帧、目标地址帧、多路协商与子流收集。
/// `marker` 是 hello 帧前缀的第一个字节（'G'）。
async fn session_handshake(
    stream: &mut TcpStream,
    config: &ServerConfig,
    registry: &SessionRegistry,
    salt: [u8; SESSION_SALT_LEN],
    marker: u8,
) -> anyhow::Result<SessionPlan> {
    if marker != b'G' {
        anyhow::bail!("invalid frame prelude");
    }
    let inbound = FrameCodec::new_subflow(
        config.auth.shared_secret.as_bytes(),
        &salt,
        SessionDirection::ClientToServer,
        0,
        config.auth.max_time_diff_secs,
    )?;
    let outbound = FrameCodec::new_subflow(
        config.auth.shared_secret.as_bytes(),
        &salt,
        SessionDirection::ServerToClient,
        0,
        config.auth.max_time_diff_secs,
    )?;
    let hello = ClientHello::decode(&read_payload_with_first_byte(stream, marker, &inbound).await?)?;
    if hello.salt != salt {
        anyhow::bail!("session salt binding mismatch");
    }
    if config.auth.enabled {
        let auth = hello
            .auth
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("missing authentication"))?;
        auth.verify(
            config.auth.shared_secret.as_bytes(),
            config.auth.max_time_diff_secs,
        )?;
        reject_replayed_auth(auth, config.auth.max_time_diff_secs).await?;
    }
    let payload = read_payload(stream, &inbound).await?;
    let target = TargetAddr::decode(&mut payload.as_slice())?;
    let actual = hello
        .subflows
        .clamp(1, config.server.max_subflows.max(1));
    let joins = if actual > 1 {
        let session_id = derive_session_id(config.auth.shared_secret.as_bytes(), &salt)?;
        multipath::collect_subflows(registry, session_id, actual).await
    } else {
        Vec::new()
    };
    Ok(SessionPlan {
        target,
        codecs: SessionCodecs { inbound, outbound },
        subflows: actual,
        joins,
    })
}

/// 帧的第一个字节已被消费为 `first`，读余下部分并组帧。
async fn read_payload_with_first_byte<R: AsyncRead + Unpin>(
    reader: &mut R,
    first: u8,
    codec: &FrameCodec,
) -> anyhow::Result<Vec<u8>> {
    let mut rest_prefix = [0u8; 5];
    reader.read_exact(&mut rest_prefix).await?;
    let mut frame = Vec::with_capacity(64);
    frame.push(first);
    frame.extend_from_slice(&rest_prefix);
    let mut len_bytes = [0u8; 2];
    reader.read_exact(&mut len_bytes).await?;
    let body_len = u16::from_be_bytes(len_bytes) as usize;
    frame.extend_from_slice(&len_bytes);
    let start = frame.len();
    frame.resize(start + body_len, 0);
    reader.read_exact(&mut frame[start..]).await?;
    Ok(codec.decode(&frame)?.0)
}

async fn connect_to_target(target: &TargetAddr) -> anyhow::Result<TcpStream> {
    let address = match target {
        TargetAddr::Ipv4(ip, port) => format!("{ip}:{port}"),
        TargetAddr::Domain(host, port) => format!("{host}:{port}"),
        TargetAddr::Ipv6(ip, port) => format!("[{ip}]:{port}"),
    };
    Ok(TcpStream::connect(address).await?)
}

async fn relay_with_encryption(
    mut client: TcpStream,
    mut target: TcpStream,
    config: &ServerConfig,
    codecs: SessionCodecs,
) -> anyhow::Result<()> {
    set_tcp_keepalive(&client).ok();
    set_tcp_keepalive(&target).ok();
    let (mut client_reader, mut client_writer) = client.split();
    let (mut target_reader, mut target_writer) = target.split();
    let max_payload = config.relay.max_buffer_size.clamp(1024, 16 * 1024);
    let auth_byte = current_auth_byte(config);
    let upload = async {
        crate::multipath::relay_upload(&mut client_reader, &mut target_writer, &codecs.inbound)
            .await
    };
    let download = async {
        let mut buffer = vec![0u8; max_payload];
        loop {
            let count = target_reader.read(&mut buffer).await?;
            if count == 0 {
                break;
            }
            write_payload(
                &mut client_writer,
                &codecs.outbound,
                &buffer[..count],
                auth_byte,
            )
            .await?;
        }
        client_writer.shutdown().await?;
        Ok::<(), anyhow::Error>(())
    };
    tokio::try_join!(upload, download)?;
    Ok(())
}

pub(crate) async fn read_payload<R: AsyncRead + Unpin>(
    reader: &mut R,
    codec: &FrameCodec,
) -> anyhow::Result<Vec<u8>> {
    Ok(codec.decode(&read_encrypted_frame(reader).await?)?.0)
}
async fn write_payload<W: AsyncWrite + Unpin>(
    writer: &mut W,
    codec: &FrameCodec,
    payload: &[u8],
    auth_byte: u8,
) -> anyhow::Result<()> {
    write_encrypted_frame(writer, codec, payload, auth_byte, DEFAULT_MAX_PADDING).await?;
    Ok(())
}
pub(crate) fn is_eof(error: &anyhow::Error) -> bool {
    error.downcast_ref::<shared::error::ProxyError>().is_some_and(|e| matches!(e, shared::error::ProxyError::Io(io) if io.kind() == std::io::ErrorKind::UnexpectedEof))
}
pub(crate) fn set_tcp_keepalive(stream: &TcpStream) -> std::io::Result<()> {
    use socket2::{SockRef, TcpKeepalive};
    SockRef::from(stream).set_tcp_keepalive(
        &TcpKeepalive::new()
            .with_time(Duration::from_secs(60))
            .with_interval(Duration::from_secs(10)),
    )
}
async fn reject_replayed_auth(auth: &AuthPacket, max_age: u64) -> anyhow::Result<()> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let cache = AUTH_REPLAY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().await;
    cache.retain(|_, timestamp| *timestamp >= now.saturating_sub(max_age));
    if cache.insert(auth.hmac, auth.timestamp).is_some() {
        anyhow::bail!("replayed authentication packet");
    }
    Ok(())
}
fn current_auth_byte(config: &ServerConfig) -> u8 {
    generate_first_auth_byte(config.auth.shared_secret.as_bytes()[0])
}
