//! Encrypted TCP tunnel server.
use crate::config::ServerConfig;
use crate::defense::{DefenseConfig, DefenseManager};
use shared::{
    extract_auth_byte_from_prefix, generate_first_auth_byte, read_encrypted_frame,
    verify_first_auth_byte, write_encrypted_frame, AuthPacket, ClientHello, ConnectResponse,
    FrameCodec, Result, SessionDirection, TargetAddr, DEFAULT_MAX_PADDING, SESSION_SALT_LEN,
};
use std::{
    collections::HashMap,
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
        Ok(Self {
            config: Arc::new(config),
            semaphore,
            defense,
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
            tokio::spawn(async move {
                let _permit = permit;
                if let Err(err) = handle_client_connection(stream, address, config, defense).await {
                    debug!("connection {address} closed: {err}");
                }
            });
        }
    }
}

struct SessionCodecs {
    inbound: FrameCodec,
    outbound: FrameCodec,
}

async fn handle_client_connection(
    mut client: TcpStream,
    client_addr: std::net::SocketAddr,
    config: Arc<ServerConfig>,
    defense: Arc<DefenseManager>,
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
        perform_handshake(&mut client, &config),
    )
    .await;
    let (target, codecs) = match handshake {
        Ok(Ok(v)) => v,
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
        connect_to_target(&target),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        failure => {
            let _ = write_payload(
                &mut client,
                &codecs.outbound,
                &ConnectResponse::Failure.encode(),
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
        &codecs.outbound,
        &ConnectResponse::Success.encode(),
        auth_byte,
    )
    .await?;
    // Upload direction stalls the same way as the client leg (see above).
    let _ = target_stream.set_nodelay(true);
    relay_with_encryption(client, target_stream, &config, codecs).await?;
    Ok(())
}

async fn perform_handshake(
    stream: &mut TcpStream,
    config: &ServerConfig,
) -> anyhow::Result<(TargetAddr, SessionCodecs)> {
    let mut prefix = [0u8; 6];
    stream.read_exact(&mut prefix).await?;
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
    stream.read_exact(&mut salt).await?;
    let inbound = FrameCodec::new_session(
        config.auth.shared_secret.as_bytes(),
        &salt,
        SessionDirection::ClientToServer,
        config.auth.max_time_diff_secs,
    )?;
    let outbound = FrameCodec::new_session(
        config.auth.shared_secret.as_bytes(),
        &salt,
        SessionDirection::ServerToClient,
        config.auth.max_time_diff_secs,
    )?;
    let hello = ClientHello::decode(&read_payload(stream, &inbound).await?)?;
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
    Ok((target, SessionCodecs { inbound, outbound }))
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
        loop {
            match read_payload(&mut client_reader, &codecs.inbound).await {
                Ok(payload) => target_writer.write_all(&payload).await?,
                Err(err) if is_eof(&err) => break,
                Err(err) => return Err(err),
            }
        }
        target_writer.shutdown().await?;
        Ok::<(), anyhow::Error>(())
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

async fn read_payload<R: AsyncRead + Unpin>(
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
fn is_eof(error: &anyhow::Error) -> bool {
    error.downcast_ref::<shared::error::ProxyError>().is_some_and(|e| matches!(e, shared::error::ProxyError::Io(io) if io.kind() == std::io::ErrorKind::UnexpectedEof))
}
fn set_tcp_keepalive(stream: &TcpStream) -> std::io::Result<()> {
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
