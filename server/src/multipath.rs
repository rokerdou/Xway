//! 协议内多路捆绑（multipath bonding）。
//!
//! 一个会话由 1 条主子流（会话 0，走完整握手）和最多 7 条 join 子流组成。
//! join 子流与会话 0 并行到达，通过 session_id 在注册表中会合。v1 仅对
//! 下行（s2c）做 round-robin 分摊，上行仍走会话 0 的原有协议。

use crate::config::ServerConfig;
use crate::server::SessionCodecs;
use shared::{
    derive_session_id, encode_stream_payload, generate_first_auth_byte,
    read_encrypted_frame, write_encrypted_frame, FrameCodec, SessionDirection, ConnectResponse,
    DEFAULT_MAX_PADDING, MAX_SUBFLOWS, SESSION_SALT_LEN, STREAM_FLAG_FIN,
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    sync::{mpsc, Mutex, watch},
    time::timeout,
};
use tracing::{debug, info, warn};

/// join 子流等待会话 0 到达、以及会话 0 等待迟到 join 的窗口。
const JOIN_WINDOW: Duration = Duration::from_secs(2);
/// 注册表槽位存活上限（防攻击流量占内存）。
const SLOT_TTL: Duration = Duration::from_secs(15);
/// 每条子流的发送队列深度。
const WRITER_QUEUE: usize = 64;

type BoxWriter = Box<dyn AsyncWrite + Unpin + Send>;

/// 已完成 join 握手、随时可写入的子流。
pub struct JoinedSubflow {
    pub index: u8,
    stream: TcpStream,
    outbound: FrameCodec,
}

enum Slot {
    /// 先于会话 0 到达的 join 在此暂存。
    Gathering {
        joins: HashMap<u8, (TcpStream, FrameCodec)>,
        created_at: Instant,
    },
    /// 会话 0 已接管；窗口内迟到的 join 经通道转交。
    Ready {
        tx: mpsc::Sender<JoinedSubflow>,
        joined: HashSet<u8>,
        created_at: Instant,
    },
}

/// 多路会话注册表：以 `HMAC(secret, salt)[..16]` 为键的会合点。
#[derive(Default)]
pub struct SessionRegistry {
    inner: Mutex<HashMap<[u8; 16], Slot>>,
}

impl SessionRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// 注册一条已完成 GCM 握手的 join 子流。重复 index 或会话已关闭时
    /// 返回 false（调用方应关闭该连接）。
    pub async fn register_join(&self, session_id: [u8; 16], subflow: JoinedSubflow) -> bool {
        let mut map = self.inner.lock().await;
        match map.get_mut(&session_id) {
            Some(Slot::Gathering { joins, .. }) => {
                joins.insert(subflow.index, (subflow.stream, subflow.outbound)).is_none()
            }
            Some(Slot::Ready { tx, joined, .. }) => {
                if joined.contains(&subflow.index) {
                    return false;
                }
                let index = subflow.index;
                if tx.try_send(subflow).is_err() {
                    return false;
                }
                joined.insert(index);
                true
            }
            None => {
                let joins = HashMap::from([(subflow.index, (subflow.stream, subflow.outbound))]);
                map.insert(
                    session_id,
                    Slot::Gathering {
                        joins,
                        created_at: Instant::now(),
                    },
                );
                true
            }
        }
    }

    /// 会话 0 接管注册表槽位：取走已聚集的 join，并建立迟到 join 通道。
    pub async fn open_session(
        &self,
        session_id: [u8; 16],
    ) -> (Vec<JoinedSubflow>, mpsc::Receiver<JoinedSubflow>) {
        let (tx, rx) = mpsc::channel(8);
        let mut map = self.inner.lock().await;
        let mut collected = Vec::new();
        let mut joined = HashSet::new();
        if let Some(Slot::Gathering { joins, .. }) = map.remove(&session_id) {
            for (index, (stream, outbound)) in joins {
                joined.insert(index);
                collected.push(JoinedSubflow {
                    index,
                    stream,
                    outbound,
                });
            }
        }
        map.insert(
            session_id,
            Slot::Ready {
                tx,
                joined,
                created_at: Instant::now(),
            },
        );
        (collected, rx)
    }

    pub async fn close_session(&self, session_id: [u8; 16]) {
        self.inner.lock().await.remove(&session_id);
    }

    /// 清理超时槽位；移除即关闭其持有的连接。
    pub async fn sweep(&self) {
        self.inner
            .lock()
            .await
            .retain(|_, slot| slot.created_at() + SLOT_TTL > Instant::now());
    }
}

impl Slot {
    fn created_at(&self) -> Instant {
        match self {
            Self::Gathering { created_at, .. } | Self::Ready { created_at, .. } => *created_at,
        }
    }
}

/// 处理一条 join 子流连接。
///
/// 调用前连接已消费 `prefix(6) + salt(32) + index(1)`。随后完成一次
/// 加密往返（空载荷 join 帧 / 空载荷 ack 帧，GCM tag 即认证），成功后
/// 将连接与 s2c 编解码器一并注册到会话。
pub async fn handle_join(
    mut stream: TcpStream,
    config: &ServerConfig,
    registry: &SessionRegistry,
    salt: [u8; SESSION_SALT_LEN],
    index: u8,
) -> anyhow::Result<()> {
    let _ = stream.set_nodelay(true);
    crate::server::set_tcp_keepalive(&stream).ok();
    let secret = config.auth.shared_secret.as_bytes();
    let inbound = FrameCodec::new_subflow(
        secret,
        &salt,
        SessionDirection::ClientToServer,
        index,
        config.auth.max_time_diff_secs,
    )?;
    let frame = read_encrypted_frame(&mut stream).await?;
    let (payload, _) = inbound.decode(&frame)?;
    if !payload.is_empty() {
        anyhow::bail!("join frame must carry an empty payload");
    }
    let outbound = FrameCodec::new_subflow(
        secret,
        &salt,
        SessionDirection::ServerToClient,
        index,
        config.auth.max_time_diff_secs,
    )?;
    let auth_byte = generate_first_auth_byte(secret[0]);
    write_encrypted_frame(&mut stream, &outbound, &[], auth_byte, DEFAULT_MAX_PADDING).await?;

    let session_id = derive_session_id(secret, &salt)?;
    let subflow = JoinedSubflow {
        index,
        stream,
        outbound,
    };
    if !registry.register_join(session_id, subflow).await {
        anyhow::bail!("duplicate or closed subflow index {index}");
    }
    debug!(
        "multipath subflow {index} joined session {}",
        hex(&session_id)
    );
    Ok(())
}

/// 会话 0 侧收集 join 子流：先取已聚集的，再在窗口内等待迟到者。
/// 只保留 index < expected 的子流，多余的连接被丢弃（即关闭）。
pub async fn collect_subflows(
    registry: &SessionRegistry,
    session_id: [u8; 16],
    expected: u8,
) -> Vec<JoinedSubflow> {
    let (mut collected, mut rx) = registry.open_session(session_id).await;
    collected.retain(|sf| sf.index < expected);
    let deadline = Instant::now() + JOIN_WINDOW;
    while (collected.len() as u8) < expected - 1 {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match timeout(remaining, rx.recv()).await {
            Ok(Some(sf)) if sf.index < expected => collected.push(sf),
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => break,
        }
    }
    registry.close_session(session_id).await;
    collected.sort_by_key(|sf| sf.index);
    collected
}

enum Downlink {
    Data(Vec<u8>),
    Fin(u64),
}

fn spawn_subflow_writer(
    index: u8,
    mut writer: BoxWriter,
    codec: FrameCodec,
    secret_byte: u8,
    mut rx: mpsc::Receiver<Downlink>,
    dead: watch::Sender<bool>,
) -> tokio::task::JoinHandle<u64> {
    tokio::spawn(async move {
        let mut sent = 0u64;
        while let Some(item) = rx.recv().await {
            let (payload, bytes) = match item {
                Downlink::Data(payload) => {
                    let n = payload.len() as u64;
                    (payload, n)
                }
                Downlink::Fin(total) => (encode_stream_payload(STREAM_FLAG_FIN, total, &[]), 0),
            };
            let auth_byte = generate_first_auth_byte(secret_byte);
            if write_encrypted_frame(&mut writer, &codec, &payload, auth_byte, DEFAULT_MAX_PADDING)
                .await
                .is_err()
            {
                warn!("multipath subflow {index} write failed after {sent} bytes");
                dead.send_replace(true);
                break;
            }
            sent += bytes;
        }
        let _ = writer.shutdown().await;
        sent
    })
}

/// 下行分摊中继：把 target 数据按字节偏移打成流帧，round-robin 发往各
/// 子流。任一子流写失败即判定会话死亡（v1 无重传语义）。
async fn relay_download_striped<R: AsyncRead + Unpin>(
    target_reader: &mut R,
    writers: Vec<(u8, BoxWriter, FrameCodec)>,
    secret_byte: u8,
    max_payload: usize,
) -> anyhow::Result<()> {
    let (dead_tx, mut dead_rx) = watch::channel(false);
    let mut handles = Vec::with_capacity(writers.len());
    let mut senders = Vec::with_capacity(writers.len());
    let mut indexes = Vec::with_capacity(writers.len());
    for (index, writer, codec) in writers {
        let (tx, rx) = mpsc::channel(WRITER_QUEUE);
        senders.push(tx);
        indexes.push(index);
        handles.push(spawn_subflow_writer(index, writer, codec, secret_byte, rx, dead_tx.clone()));
    }
    drop(dead_tx);

    let started = Instant::now();
    let mut buffer = vec![0u8; max_payload];
    let mut offset: u64 = 0;
    let mut next = 0usize;
    let count = senders.len();
    let result = loop {
        tokio::select! {
            changed = dead_rx.changed() => {
                if changed.is_err() || *dead_rx.borrow() {
                    break Err(anyhow::anyhow!("multipath subflow died"));
                }
            }
            read = target_reader.read(&mut buffer) => {
                let n = read?;
                if n == 0 {
                    break Ok(());
                }
                let payload = encode_stream_payload(0, offset, &buffer[..n]);
                offset += n as u64;
                if senders[next].send(Downlink::Data(payload)).await.is_err() {
                    break Err(anyhow::anyhow!("multipath subflow {} writer closed", indexes[next]));
                }
                next = (next + 1) % count;
            }
        }
    };
    if result.is_ok() {
        for tx in &senders {
            let _ = tx.send(Downlink::Fin(offset)).await;
        }
    }
    drop(senders);
    let mut per_subflow = Vec::with_capacity(handles.len());
    for handle in handles {
        per_subflow.push(handle.await.unwrap_or(0));
    }
    match &result {
        Ok(()) => info!(
            "multipath download finished: {offset} bytes in {:?} ({} KB/s), per-subflow {:?}",
            started.elapsed(),
            offset / 1024 / started.elapsed().as_secs().max(1),
            indexes.iter().zip(per_subflow.iter()).collect::<Vec<_>>()
        ),
        Err(err) => warn!(
            "multipath download failed at offset {offset} after {:?}: {err} (per-subflow {:?})",
            started.elapsed(),
            indexes.iter().zip(per_subflow.iter()).collect::<Vec<_>>()
        ),
    }
    result
}

/// 上行中继：客户端（会话 0）→ target，沿用原有单流协议。
/// 与 `relay_with_encryption` 共用。
pub async fn relay_upload<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(
    reader: &mut R,
    writer: &mut W,
    codec: &FrameCodec,
) -> anyhow::Result<()> {
    loop {
        match crate::server::read_payload(reader, codec).await {
            Ok(payload) => writer.write_all(&payload).await?,
            Err(err) if crate::server::is_eof(&err) => break,
            Err(err) => return Err(err),
        }
    }
    writer.shutdown().await?;
    Ok(())
}

/// 多路会话中继入口：上行走会话 0 原协议，下行在全部子流间分摊。
pub async fn relay_split(
    client: TcpStream,
    target: TcpStream,
    config: &ServerConfig,
    codecs: SessionCodecs,
    secret_byte: u8,
    joins: Vec<JoinedSubflow>,
) -> anyhow::Result<()> {
    let (mut client_reader, client_writer) = client.into_split();
    let (mut target_reader, mut target_writer) = target.into_split();
    let max_payload = config.relay.max_buffer_size.clamp(1024, 16 * 1024);

    let mut writers: Vec<(u8, BoxWriter, FrameCodec)> =
        vec![(0, Box::new(client_writer), codecs.outbound)];
    for subflow in joins {
        writers.push((subflow.index, Box::new(subflow.stream), subflow.outbound));
    }

    let upload = relay_upload(&mut client_reader, &mut target_writer, &codecs.inbound);
    let download = relay_download_striped(
        &mut target_reader,
        writers,
        secret_byte,
        max_payload,
    );
    tokio::try_join!(upload, download)?;
    Ok(())
}

/// 生成分摊会话的 ConnectResponse 载荷。
pub fn connect_response_payload(success: bool, subflows: u8) -> Vec<u8> {
    let response = if success {
        ConnectResponse::Success
    } else {
        ConnectResponse::Failure
    };
    if subflows > 1 {
        response.encode_multipath(subflows).to_vec()
    } else {
        response.encode().to_vec()
    }
}

/// 解码 hex 用于日志（16 字节会话 ID）。
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 合法 join 子流 index：1..=MAX_SUBFLOWS-1。
pub fn is_join_index(byte: u8) -> bool {
    (1..MAX_SUBFLOWS).contains(&byte)
}
