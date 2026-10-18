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
    CREDIT_FLAG, DEFAULT_MAX_PADDING, MAX_SUBFLOWS, SESSION_SALT_LEN, STREAM_FLAG_FIN,
};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
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
/// 每条子流的发送队列深度（帧数）。
const WRITER_QUEUE: usize = 16;
/// 下行分摊的读分片大小。独立于单流路径的 max_buffer_size：分片越大，
/// 每字节调度/加密开销越小，但乱序粒度越粗。
const STREAM_CHUNK: usize = 32 * 1024;
/// 子流发送缓冲上限：禁止内核自动调优把在途字节吞进调度器视野之外。
/// credit 流控启用后全局窗口（6MB）先于管道容量生效，SNDBUF 不再是
/// reorder 溢出的防线，可以放宽换取单子流吞吐（≈ SNDBUF/RTT）；仅在
/// 老客户端盲发时它兜底总量（此时需 子流数×(SNDBUF+队列) < reorder
/// 窗口）。注意内核对请求值加倍记账（sk_sndbuf = 2×请求值），实际传值
/// 减半，使最终生效值等于本常量。
const SUBFLOW_SNDBUF: usize = 4096 * 1024;
/// 内核写队列中"未真正发出"数据的上限，配合 SNDBUF 限制提前排队。
const SUBFLOW_NOTSENT_LOWAT: usize = 512 * 1024;
/// credit 流控全局窗口：已入队未消费字节的上界。客户端经 join 子流
/// 上行周期上报累计消费量（WINDOW_UPDATE），发送循环在此窗口内才继续
/// 从 target 读取。须小于客户端 reorder 缓冲（8MB）。
const GLOBAL_WINDOW: u64 = 6 * 1024 * 1024;
/// WINDOW_UPDATE 载荷：type(1) + consumed(u64 BE)。走 join 子流上行。
const WINDOW_UPDATE_TYPE: u8 = 0x01;

type BoxWriter = Box<dyn AsyncWrite + Unpin + Send>;

/// 限制子流发送缓冲并回读验证。手动 setsockopt 会禁用内核自动调优，
/// 且内核通常对请求值加倍记账——回读值仅用于日志核对。
fn cap_subflow_send_buffer(stream: &TcpStream) {
    use socket2::SockRef;
    let sock = SockRef::from(stream);
    if let Err(err) = sock.set_send_buffer_size(SUBFLOW_SNDBUF / 2) {
        warn!("subflow set_send_buffer_size failed: {err}");
    }
    set_notsent_lowat(&sock, SUBFLOW_NOTSENT_LOWAT);
    match sock.send_buffer_size() {
        Ok(actual) => debug!(
            "subflow send buffer capped: requested {}KB, kernel {}KB",
            SUBFLOW_SNDBUF / 1024,
            actual / 1024
        ),
        Err(err) => warn!("subflow send_buffer_size readback failed: {err}"),
    }
}

/// TCP_NOTSENT_LOWAT：限制内核写队列中尚未发出的数据量。socket2 0.5
/// 未封装，直接走 libc；非 Linux 平台跳过（服务端仅部署 Linux）。
fn set_notsent_lowat(sock: &socket2::SockRef<'_>, lowat: usize) {
    #[cfg(target_os = "linux")]
    {
        const TCP_NOTSENT_LOWAT: i32 = 25;
        use std::os::fd::{AsFd, AsRawFd};
        let raw = sock.as_fd().as_raw_fd();
        let value = lowat as libc::c_uint;
        let rc = unsafe {
            libc::setsockopt(
                raw,
                libc::IPPROTO_TCP,
                TCP_NOTSENT_LOWAT,
                &value as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::c_uint>() as libc::socklen_t,
            )
        };
        if rc != 0 {
            warn!("subflow set_notsent_lowat failed: {}", std::io::Error::last_os_error());
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (sock, lowat);
    }
}

/// 已完成 join 握手、随时可写入的子流。
pub struct JoinedSubflow {
    pub index: u8,
    stream: TcpStream,
    outbound: FrameCodec,
    /// join 子流的 c2s 编解码器：握手后用于接收 WINDOW_UPDATE。
    inbound: FrameCodec,
}

enum Slot {
    /// 先于会话 0 到达的 join 在此暂存。
    Gathering {
        joins: HashMap<u8, (TcpStream, FrameCodec, FrameCodec)>,
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
            Some(Slot::Gathering { joins, .. }) => joins
                .insert(
                    subflow.index,
                    (subflow.stream, subflow.outbound, subflow.inbound),
                )
                .is_none(),
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
                let joins = HashMap::from([(
                    subflow.index,
                    (subflow.stream, subflow.outbound, subflow.inbound),
                )]);
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
            for (index, (stream, outbound, inbound)) in joins {
                joined.insert(index);
                collected.push(JoinedSubflow {
                    index,
                    stream,
                    outbound,
                    inbound,
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
    cap_subflow_send_buffer(&stream);
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
        inbound,
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

/// credit 流控共享状态：客户端上报的累计消费量。锚点是客户端上层
/// Read() 实际取走的字节（含 readBuf 积压），不是 reorder Expected()，
/// 因此消费慢直接转化为背压。收到首个 WINDOW_UPDATE 前 enabled=false，
/// 发送循环盲发（老客户端兼容，SNDBUF 安全阀兜底）。
struct CreditFlow {
    consumed: Arc<AtomicU64>,
    enabled: Arc<AtomicBool>,
    notify: watch::Receiver<u64>,
}

/// credit 流控等待统计：累计阻塞时长与发生次数。
#[derive(Default)]
struct CreditStats {
    wait: Duration,
    stalls: u64,
}

/// join 子流上行读循环：解析 WINDOW_UPDATE，推进 consumed（单调取最大）
/// 并唤醒等待的发送循环。任一 join 上报即生效；读到错误即退出（子流
/// 死亡由 writer 侧判定会话终结）。
async fn read_credit_updates<R: AsyncRead + Unpin>(
    mut reader: R,
    codec: FrameCodec,
    consumed: Arc<AtomicU64>,
    enabled: Arc<AtomicBool>,
    notify: watch::Sender<u64>,
) {
    loop {
        let frame = match read_encrypted_frame(&mut reader).await {
            Ok(frame) => frame,
            Err(_) => return,
        };
        let Ok((payload, _)) = codec.decode(&frame) else {
            return;
        };
        if payload.len() == 9 && payload[0] == WINDOW_UPDATE_TYPE {
            let reported = u64::from_be_bytes(payload[1..].try_into().expect("len checked"));
            let mut current = consumed.load(Ordering::Acquire);
            while reported > current {
                match consumed.compare_exchange_weak(
                    current,
                    reported,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                ) {
                    Ok(_) => break,
                    Err(actual) => current = actual,
                }
            }
            enabled.store(true, Ordering::Release);
            let _ = notify.send(reported);
        }
    }
}

fn spawn_subflow_writer(
    index: u8,
    mut writer: BoxWriter,
    codec: FrameCodec,
    secret_byte: u8,
    mut rx: mpsc::Receiver<Downlink>,
    queued: Arc<AtomicUsize>,
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
            queued.fetch_sub(1, Ordering::Relaxed);
            sent += bytes;
        }
        let _ = writer.shutdown().await;
        sent
    })
}

/// 下行分摊中继：把 target 数据按字节偏移打成流帧，发往队列最空的子流
/// （最短队列调度）。慢子流队列积压后自动绕开，客户端乱序窗口被限制
/// 在单子流队列容量内，链路抖动不再冲爆 reorder 缓冲。credit 启用后
/// 额外受全局窗口约束（已入队 − 已消费 < GLOBAL_WINDOW）。任一子流写
/// 失败即判定会话死亡（v1 无重传语义）。
async fn relay_download_striped<R: AsyncRead + Unpin>(
    target_reader: &mut R,
    writers: Vec<(u8, BoxWriter, FrameCodec)>,
    secret_byte: u8,
    max_payload: usize,
    mut credit: Option<CreditFlow>,
    session_id: [u8; 16],
    upload_closed: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let (dead_tx, mut dead_rx) = watch::channel(false);
    let mut handles = Vec::with_capacity(writers.len());
    let mut senders = Vec::with_capacity(writers.len());
    let mut queues = Vec::with_capacity(writers.len());
    let mut indexes = Vec::with_capacity(writers.len());
    for (index, writer, codec) in writers {
        let (tx, rx) = mpsc::channel(WRITER_QUEUE);
        let queued = Arc::new(AtomicUsize::new(0));
        senders.push((tx, queued.clone()));
        queues.push(queued.clone());
        indexes.push(index);
        handles.push(spawn_subflow_writer(
            index,
            writer,
            codec,
            secret_byte,
            rx,
            queued.clone(),
            dead_tx.clone(),
        ));
    }
    drop(dead_tx);

    let started = Instant::now();
    let mut credit_stats = CreditStats::default();
    let mut buffer = vec![0u8; max_payload];
    let mut offset: u64 = 0;
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
                // credit 预算：本帧入队后已入队总量 − 已消费 < GLOBAL_WINDOW。
                // 首个 WINDOW_UPDATE 到达前 enabled=false，盲发（兼容老
                // 客户端，SNDBUF 安全阀兜底）。watch 通道全关（join 全死）
                // 时放弃等待——会话随即被 writer 侧终结。
                if let Some(credit) = credit.as_mut() {
                    let wait_start = Instant::now();
                    let mut stalled = false;
                    while credit.enabled.load(Ordering::Acquire)
                        && offset + n as u64 - credit.consumed.load(Ordering::Acquire)
                            >= GLOBAL_WINDOW
                    {
                        stalled = true;
                        if credit.notify.changed().await.is_err() {
                            break;
                        }
                    }
                    if stalled {
                        credit_stats.wait += wait_start.elapsed();
                        credit_stats.stalls += 1;
                    }
                }
                let payload = encode_stream_payload(0, offset, &buffer[..n]);
                offset += n as u64;
                // 最短队列调度：打满一条后它不再最短，自然轮转；慢子流
                // 队列积压时被自动绕开，客户端乱序窗口收敛。
                let next = queues
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, q)| q.load(Ordering::Relaxed))
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                queues[next].fetch_add(1, Ordering::Relaxed);
                if senders[next].0.send(Downlink::Data(payload)).await.is_err() {
                    break Err(anyhow::anyhow!("multipath subflow {} writer closed", indexes[next]));
                }
            }
        }
    };
    if result.is_ok() {
        for (tx, _) in &senders {
            let _ = tx.send(Downlink::Fin(offset)).await;
        }
    }
    drop(senders);
    let mut per_subflow = Vec::with_capacity(handles.len());
    for handle in handles {
        per_subflow.push(handle.await.unwrap_or(0));
    }
    let sid = hex(&session_id);
    let client_closed = upload_closed.load(Ordering::Acquire);
    match &result {
        Ok(()) => info!(
            "multipath download finished [{sid}]: {offset} bytes in {:?} ({} KB/s), credit_wait {:?}/{}x, client_closed={client_closed}, per-subflow {:?}",
            started.elapsed(),
            offset / 1024 / started.elapsed().as_secs().max(1),
            credit_stats.wait,
            credit_stats.stalls,
            indexes.iter().zip(per_subflow.iter()).collect::<Vec<_>>()
        ),
        Err(err) => warn!(
            "multipath download failed [{sid}] at offset {offset} after {:?}: {err} (credit_wait {:?}/{}x, client_closed={client_closed}, per-subflow {:?})",
            started.elapsed(),
            credit_stats.wait,
            credit_stats.stalls,
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
/// join 子流读写两半分离：写半进分摊 writer 池，读半承载客户端的
/// WINDOW_UPDATE（credit 流控）。upload 先于 download 结束（客户端
/// 半关或主动断开）时 upload_closed 置位，结束日志据此刻区分谁先关。
pub async fn relay_split(
    client: TcpStream,
    target: TcpStream,
    codecs: SessionCodecs,
    secret_byte: u8,
    session_id: [u8; 16],
    joins: Vec<JoinedSubflow>,
) -> anyhow::Result<()> {
    cap_subflow_send_buffer(&client);
    let (mut client_reader, client_writer) = client.into_split();
    let (mut target_reader, mut target_writer) = target.into_split();

    let mut writers: Vec<(u8, BoxWriter, FrameCodec)> =
        vec![(0, Box::new(client_writer), codecs.outbound)];
    let credit = if joins.is_empty() {
        None
    } else {
        let (notify_tx, notify_rx) = watch::channel(0u64);
        let consumed = Arc::new(AtomicU64::new(0));
        let enabled = Arc::new(AtomicBool::new(false));
        for subflow in joins {
            let (read_half, write_half) = subflow.stream.into_split();
            writers.push((subflow.index, Box::new(write_half), subflow.outbound));
            tokio::spawn(read_credit_updates(
                read_half,
                subflow.inbound,
                consumed.clone(),
                enabled.clone(),
                notify_tx.clone(),
            ));
        }
        drop(notify_tx);
        Some(CreditFlow {
            consumed,
            enabled,
            notify: notify_rx,
        })
    };

    let upload_closed = Arc::new(AtomicBool::new(false));
    let upload_flag = upload_closed.clone();
    let upload = async move {
        let result = relay_upload(&mut client_reader, &mut target_writer, &codecs.inbound).await;
        upload_flag.store(true, Ordering::Release);
        result
    };
    let download = relay_download_striped(
        &mut target_reader,
        writers,
        secret_byte,
        STREAM_CHUNK,
        credit,
        session_id,
        upload_closed,
    );
    tokio::try_join!(upload, download)?;
    Ok(())
}

/// 生成分摊会话的 ConnectResponse 载荷。actual 字节 bit7 置位表示
/// 服务端支持 credit 流控（老客户端忽略该位）。
pub fn connect_response_payload(success: bool, subflows: u8) -> Vec<u8> {
    let response = if success {
        ConnectResponse::Success
    } else {
        ConnectResponse::Failure
    };
    if subflows > 1 {
        response.encode_multipath(subflows | CREDIT_FLAG).to_vec()
    } else {
        response.encode().to_vec()
    }
}

/// 解码 hex 用于日志（16 字节会话 ID）。
pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 合法 join 子流 index：1..=MAX_SUBFLOWS-1。
pub fn is_join_index(byte: u8) -> bool {
    (1..MAX_SUBFLOWS).contains(&byte)
}
