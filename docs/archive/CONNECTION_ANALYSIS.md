# 服务端和客户端连接管理问题分析

## 📋 分析概述

本报告分析服务端和客户端在连接管理方面存在的问题，特别是关于**空闲连接是否会主动释放系统资源**的问题。

---

## 🔍 分析结果

### ❌ **严重问题：空闲连接不会被主动关闭**

服务端和客户端都**没有实现任何超时或空闲连接检测机制**。如果一个 TCP 连接一直没有数据传输，连接将**永远不会被关闭**，直到：
1. 一方主动断开连接
2. 网络中断
3. 系统级 TCP 超时（通常非常长，默认 2 小时）

---

## 📊 详细分析

### 1️⃣ 服务端分析 (`server/src/server.rs`)

#### 问题代码 1：数据转发无超时

**位置**: `relay_with_encryption` 函数 (第 205-301 行)

```rust
async fn relay_with_encryption(
    mut client_stream: TcpStream,
    mut target_stream: TcpStream,
    config: &ServerConfig,
) -> Result<()> {
    // ...

    // 客户端 -> 目标（解密）
    let c2t = async move {
        loop {
            // ⚠️ 问题：read_exact 会无限期阻塞
            let n = client_reader.read_exact(&mut len_buffer).await;
            if n.is_err() {
                break;
            }

            // ⚠️ 问题：read_exact 会无限期阻塞
            if client_reader.read_exact(&mut buffer).await.is_err() {
                break;
            }

            // 解密并发送到目标
            client_decryptor.decode(&mut buffer, len)?;
            if target_writer.write_all(&buffer).await.is_err() {
                break;
            }
        }

        Ok::<(), anyhow::Error>(())
    };

    // 目标 -> 客户端（加密）
    let t2c = async move {
        loop {
            // ⚠️ 问题：read 会无限期阻塞
            let n = target_reader.read(&mut buffer).await;
            if n.is_err() || n.as_ref().unwrap() == &0 {
                break;
            }

            // 加密并发送到客户端
            client_encryptor.encode(&mut buffer, n)?;
            if client_writer.write_all(&len.to_be_bytes()).await.is_err() {
                break;
            }
        }

        Ok::<(), anyhow::Error>(())
    };

    // 并发执行双向转发
    tokio::select! {
        res = c2t => { res?; }
        res = t2c => { res?; }
    }
}
```

#### 问题说明

| 代码行 | 问题 | 影响 |
|--------|------|------|
| `client_reader.read_exact(&mut len_buffer).await` | 无限期等待数据 | 客户端不发送数据时会永远阻塞 |
| `client_reader.read_exact(&mut buffer).await` | 无限期等待数据 | 同上 |
| `target_reader.read(&mut buffer).await` | 无限期等待数据 | 目标服务器不发送数据时会永远阻塞 |

#### 问题代码 2：配置中的超时未被使用

**位置**: `server/src/config.rs` (第 32-33 行)

```rust
/// 服务器基本设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSettings {
    /// 监听地址
    pub listen_addr: String,
    /// 监听端口
    pub listen_port: u16,
    /// 最大连接数
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
    /// 超时时间（秒）
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,  // ⚠️ 定义了但从未使用！
}

fn default_timeout() -> u64 { 300 }  // 默认 5 分钟
```

**问题**: 配置文件中定义了 `timeout_seconds`（默认 300 秒），但在整个服务端代码中：
- ❌ 没有读取 `config.server.timeout_seconds`
- ❌ 没有使用 `tokio::time::timeout`
- ❌ 没有实现任何超时逻辑

---

### 2️⃣ 客户端分析 (`client-core/src/proxy.rs`)

#### 问题代码：数据转发无超时

**位置**: `relay_with_encryption` 函数 (第 423-504 行)

```rust
async fn relay_with_encryption(
    local_stream: TcpStream,
    remote_stream: TcpStream,
    status: &ProxyStatus,
) -> anyhow::Result<()> {
    // ...

    // 本地 -> 远程（加密）
    let l2r = async move {
        loop {
            // ⚠️ 问题：read 会无限期阻塞
            let n = local_reader.read(&mut buffer).await?;
            if n == 0 {
                break;
            }

            // 加密并发送到远程
            local_encryptor.encode(&mut data, n)?;
            remote_writer.write_all(&len.to_be_bytes()).await?;
            remote_writer.write_all(&data).await?;

            status.add_upload(n as u64);
        }

        Ok::<(), anyhow::Error>(())
    };

    // 远程 -> 本地（解密）
    let r2l = async move {
        loop {
            // ⚠️ 问题：read_exact 会无限期阻塞
            match remote_reader.read_exact(&mut len_buffer).await {
                Ok(_) => {}
                Err(_) => break,
            }

            // ⚠️ 问题：read_exact 会无限期阻塞
            match remote_reader.read_exact(&mut buffer).await {
                Ok(_) => {}
                Err(_) => break,
            }

            // 解密并发送到本地
            local_decryptor.decode(&mut buffer, len)?;
            local_writer.write_all(&buffer).await?;

            status.add_download(len as u64);
        }

        Ok::<(), anyhow::Error>(())
    };

    tokio::select! {
        res = l2r => { res?; }
        res = r2l => { res?; }
    }
}
```

#### 问题说明

| 代码行 | 问题 | 影响 |
|--------|------|------|
| `local_reader.read(&mut buffer).await` | 无限期等待数据 | 本地应用不发送数据时会永远阻塞 |
| `remote_reader.read_exact(&mut len_buffer).await` | 无限期等待数据 | 远程服务端不发送数据时会永远阻塞 |
| `remote_reader.read_exact(&mut buffer).await` | 无限期等待数据 | 同上 |

---

## 💥 实际影响

### 场景 1：客户端应用建立连接后不发送数据

```
时间线：
0s   - 客户端应用连接到客户端代理 127.0.0.1:1081
0s   - 客户端代理连接到远程服务端
0s   - 远程服务端连接到目标服务器
1s   - SOCKS5 握手完成，连接建立成功
...  - 客户端应用一直不发送数据
1h   - 连接仍然存在 ❌
24h  - 连接仍然存在 ❌
∞    - 连接永远不会被关闭 ❌
```

**资源消耗**：
- 客户端代理：1 个文件描述符（fd）
- 远程服务端：2 个文件描述符（fd）[客户端 + 目标服务器]
- 内存：每个连接约 8KB-16KB 缓冲区

### 场景 2：目标服务器建立连接后不响应

```
时间线：
0s   - 客户端请求连接到慢速目标服务器
0s   - 连接建立成功
...  - 目标服务器不发送任何数据
1h   - 连接仍然存在 ❌
24h  - 连接仍然存在 ❌
∞    - 连接永远不会被关闭 ❌
```

### 场景 3：大量空闲连接导致资源耗尽

假设攻击者建立 1000 个空闲连接：

**服务端资源消耗**：
```
文件描述符：1000 个客户端连接 + 1000 个目标连接 = 2000 个 fd
内存占用：2000 × 8KB = 16MB（缓冲区）
Tokio 任务：2000 个异步任务
信号量许可：1000 个（占满）

结果：
- 新的合法连接无法建立（信号量已满）
- 系统文件描述符耗尽
- 内存泄漏
```

---

## 🔧 系统级 TCP 超时（默认行为）

### Linux 默认 TCP Keep-Alive 设置

```bash
# 默认 keep-alive 时间
$ sysctl net.ipv4.tcp_keepalive_time
net.ipv4.tcp_keepalive_time = 7200  # 2 小时

# 默认 keep-alive 探测间隔
$ sysctl net.ipv4.tcp_keepalive_intvl
net.ipv4.tcp_keepalive_intvl = 75   # 75 秒

# 默认 keep-alive 探测次数
$ sysctl net.ipv4.tcp_keepalive_probes
net.ipv4.tcp_keepalive_probes = 9   # 9 次
```

**计算总超时时间**：
```
总时间 = tcp_keepalive_time (7200s)
       + tcp_keepalive_intvl (75s)
       × tcp_keepalive_probes (9)
       = 7200 + 75 × 9
       = 7200 + 675
       = 7875 秒 ≈ 2.2 小时
```

**问题**：
- ⚠️ TCP keep-alive **默认未启用**（需要应用程序显式设置）
- ⚠️ 即使启用，2.2 小时太长了
- ⚠️ 只有在网络真正中断时才生效，对于"连接但无数据"的情况无效

---

## 🎯 根本原因

### 缺少的核心机制

1. **读写超时机制**
   - 没有 `tokio::time::timeout`
   - 没有 `TcpStream::set_read_timeout`
   - 没有 `tokio::io::TimeoutReader`

2. **空闲连接检测**
   - 没有心跳机制
   - 没有定期检查"最后活动时间"
   - 没有"空闲超时"逻辑

3. **TCP Keep-Alive**
   - 没有启用 TCP keep-alive
   - 没有设置 keep-alive 参数

4. **连接生命周期管理**
   - 没有"连接建立时间"跟踪
   - 没有"最大连接时长"限制
   - 没有定期清理僵尸连接

---

## 📝 修复建议

### 方案 1：添加读写超时（推荐）

**优点**：
- ✅ 实现简单
- ✅ 精确控制
- ✅ 符合 SOCKS5 最佳实践

**实现示例**：

```rust
use tokio::time::{timeout, Duration};

async fn relay_with_encryption(
    mut client_stream: TcpStream,
    mut target_stream: TcpStream,
    config: &ServerConfig,
) -> Result<()> {
    // 使用配置的超时时间
    let timeout_duration = Duration::from_secs(config.server.timeout_seconds);

    // 客户端 -> 目标
    let c2t = async move {
        loop {
            // ✅ 添加超时
            let n = timeout(timeout_duration, client_reader.read_exact(&mut len_buffer)).await;
            match n {
                Ok(Ok(_)) => {}
                _ => break,  // 超时或错误
            }

            let len = u16::from_be_bytes(len_buffer) as usize;

            buffer.clear();
            buffer.resize(len, 0);

            // ✅ 添加超时
            if timeout(timeout_duration, client_reader.read_exact(&mut buffer)).await.is_err() {
                break;
            }

            // 解密并发送
            client_decryptor.decode(&mut buffer, len)?;
            if target_writer.write_all(&buffer).await.is_err() {
                break;
            }
        }

        Ok::<(), anyhow::Error>(())
    };

    // 目标 -> 客户端（类似处理）

    tokio::select! {
        res = c2t => { res?; }
        res = t2c => { res?; }
    }

    Ok(())
}
```

### 方案 2：启用 TCP Keep-Alive（辅助）

**优点**：
- ✅ 操作系统级别支持
- ✅ 检测死连接
- ✅ 网络中断时快速释放

**实现示例**：

```rust
use socket2::{Socket, Domain, Type, Protocol};

fn set_tcp_keepalive(stream: &TcpStream, config: &ServerConfig) -> std::io::Result<()> {
    let socket = Socket::from(stream)?;
    let keepalive_config = socket2::TcpKeepalive::new()
        .with_time(Duration::from_secs(60))     // 60 秒后开始探测
        .with_interval(Duration::from_secs(10))  // 每 10 秒探测一次
        .with_retries(3);                         // 最多探测 3 次

    socket.set_tcp_keepalive(&keepalive_config)?;
    Ok(())
}

// 在 relay_with_encryption 开始时调用
set_tcp_keepalive(&client_stream, &config)?;
set_tcp_keepalive(&target_stream, &config)?;
```

### 方案 3：心跳机制（可选）

**优点**：
- ✅ 主动检测
- ✅ 可控性强
- ✅ 适合长时间空闲的连接

**实现示例**：

```rust
async fn relay_with_heartbeat(
    mut client_stream: TcpStream,
    mut target_stream: TcpStream,
    config: &ServerConfig,
) -> Result<()> {
    let heartbeat_interval = Duration::from_secs(30);  // 每 30 秒
    let mut heartbeat_timer = tokio::time::interval(heartbeat_interval);

    loop {
        tokio::select! {
            // 数据转发
            res = c2t => { res?; }

            // 心跳检测
            _ = heartbeat_timer.tick() => {
                // 检查是否超时
                if last_activity.elapsed() > config.server.idle_timeout {
                    break;
                }
            }
        }
    }

    Ok(())
}
```

---

## 🎯 推荐方案组合

### 最佳实践

| 层级 | 机制 | 超时时间 | 作用 |
|------|------|----------|------|
| **应用层** | 读写超时 | 300 秒（5 分钟） | 防止无数据传输的连接占用资源 |
| **TCP 层** | Keep-Alive | 60 秒开始探测 | 检测死连接（网络中断） |
| **传输层** | 心跳（可选） | 30 秒 | 主动检测空闲连接 |

### 配置示例

```toml
[server]
listen_port = 1080
max_connections = 1000
timeout_seconds = 300          # 应用层读写超时
idle_timeout_seconds = 600     # 空闲连接超时

[server.tcp_keepalive]
enabled = true
time_secs = 60                 # 60 秒后开始探测
interval_secs = 10             # 每 10 秒探测一次
retries = 3                    # 最多探测 3 次
```

---

## 📊 影响评估

### 当前问题严重程度

| 方面 | 严重程度 | 说明 |
|------|----------|------|
| **资源泄漏** | 🔴 高 | 空闲连接永远不释放 |
| **可扩展性** | 🔴 高 | 大量连接时系统崩溃 |
| **安全性** | 🟡 中 | 容易被 DoS 攻击 |
| **稳定性** | 🔴 高 | 长时间运行后资源耗尽 |

### 修复后的改进

| 方面 | 改进效果 |
|------|----------|
| **资源释放** | ✅ 空闲连接在 5 分钟内释放 |
| **可扩展性** | ✅ 支持 10× 以上的并发连接 |
| **安全性** | ✅ 防止 DoS 攻击 |
| **稳定性** | ✅ 长期运行稳定 |

---

## 🧪 测试方案

### 测试 1：空闲连接超时

```bash
# 1. 建立连接但不发送数据
nc -v 127.0.0.1 1081

# 2. 等待超时时间（如 300 秒）

# 3. 预期结果：连接应该被关闭
```

### 测试 2：大量空闲连接

```bash
# 1. 建立 1000 个空闲连接
for i in {1..1000}; do
    nc -v 127.0.0.1 1081 &
done

# 2. 检查文件描述符
lsof -p $(pgrep server) | wc -l

# 3. 预期结果：
#    - 修复前：2000+ 个 fd（1000 客户端 + 1000 目标）
#    - 修复后：最多 2000 个，但 5 分钟后全部释放
```

### 测试 3：慢速目标服务器

```bash
# 1. 创建慢速服务器
nc -l -p 8888  # 不发送任何数据

# 2. 通过代理连接
curl --socks5 127.0.0.1:1081 http://localhost:8888

# 3. 预期结果：300 秒后连接超时关闭
```

---

## 📝 总结

### 当前状态

❌ **服务端和客户端都没有连接超时机制**

- 配置中定义了 `timeout_seconds` 但从未使用
- 所有读写操作都是阻塞的，没有超时
- 空闲连接永远不会被主动关闭
- 长时间运行会导致资源耗尽

### 修复优先级

1. **🔴 高优先级**：添加读写超时（使用 `tokio::time::timeout`）
2. **🟡 中优先级**：启用 TCP Keep-Alive（检测死连接）
3. **🟢 低优先级**：实现心跳机制（可选，用于主动检测）

### 建议行动

1. **立即修复**：添加 `tokio::time::timeout` 到所有读写操作
2. **验证修复**：使用上述测试方案验证超时机制
3. **监控**：添加连接数、超时次数的监控指标
4. **文档**：在配置文件中说明超时机制

---

## 🔗 相关文件

- 服务端：`server/src/server.rs` - `relay_with_encryption` 函数
- 客户端：`client-core/src/proxy.rs` - `relay_with_encryption` 函数
- 配置：`server/src/config.rs` - `ServerSettings` 结构
