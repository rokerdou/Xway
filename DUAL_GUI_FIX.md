# 双GUI进程端口冲突修复

## 问题描述

用户发现启动两个GUI进程时，两者都能成功启动代理，但第二个进程应该因为端口占用而失败。

## 修复前的问题

### 原因分析

```rust
// 修复前的代码
pub async fn start(&mut self) -> Result<()> {
    // ...

    // 创建异步任务（还没执行）
    let handle = tokio::spawn(async move {
        // 在这里才真正绑定端口
        if let Err(e) = run_proxy(...).await {
            error!("代理运行错误: {}", e);  // ❌ 错误只记录日志
        }
    });

    // 立即设置状态为Running
    self.status.set_state(Running).await;
    Ok(())  // ❌ 立即返回成功
}
```

**时序问题**：
1. `start()` 调用 `tokio::spawn`
2. 立即设置状态为 `Running`
3. 立即返回 `Ok(())`
4. **稍后**异步任务执行，尝试绑定端口
5. 如果端口被占用，错误只记录在日志中
6. **UI看到的是"启动成功"，但实际失败了**

### 实际测试结果

```
第一个GUI日志：
  INFO SOCKS5代理客户端已启动
  INFO SOCKS5代理客户端监听: 127.0.0.1:1081

第二个GUI日志：
  INFO SOCKS5代理客户端已启动  ← ❌ 错误地显示成功
  ERROR 代理运行错误: Address already in use (os error 48)  ← 实际失败
```

## 修复方案

### 核心思想：同步端口绑定

**在 `start()` 方法中立即绑定端口，如果端口被占用则立即返回错误。**

### 代码修改

#### 1. 添加 listener 字段

```rust
pub struct ProxyClient {
    config: Arc<ClientConfig>,
    semaphore: Arc<Semaphore>,
    status: ProxyStatus,
    handle: Option<tokio::task::JoinHandle<()>>,
    shutdown_tx: Option<tokio::sync::broadcast::Sender<()>>,
    listener: Option<std::sync::Arc<tokio::sync::Mutex<TcpListener>>>,  // 新增
}
```

#### 2. 添加 bind_port() 方法

```rust
/// 绑定监听端口（同步操作，确保端口可用）
async fn bind_port(&self) -> Result<TcpListener> {
    let bind_addr = SocketAddr::new(
        IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
        self.config.local.listen_port
    );

    info!("尝试绑定端口: {}", bind_addr);

    let listener = TcpListener::bind(bind_addr).await
        .map_err(|e| anyhow::anyhow!("绑定端口{}失败: {}", bind_addr, e))?;

    info!("端口绑定成功: {}", bind_addr);
    Ok(listener)
}
```

#### 3. 修改 start() 方法

```rust
pub async fn start(&mut self) -> Result<()> {
    if self.status.get_state().await.is_running() {
        return Ok(());
    }

    self.status.set_state(Starting).await;

    // 【关键修复】先同步绑定端口，确保端口可用
    let listener = match self.bind_port().await {
        Ok(l) => l,
        Err(e) => {
            self.status.set_state(Stopped).await;
            return Err(e);  // ← 立即返回错误给UI
        }
    };

    info!("端口绑定成功，准备启动代理任务");

    // ... 创建异步任务，传入已绑定的listener ...

    self.status.set_state(Running).await;
    info!("SOCKS5代理客户端已启动");
    Ok(())
}
```

#### 4. 修改 run_proxy 函数

```rust
// 原有函数（保持向后兼容）
async fn run_proxy(...) -> Result<()> {
    // 绑定端口
    let listener = TcpListener::bind(bind_addr).await?;
    // 调用新函数
    run_proxy_with_listener(listener, ...).await
}

// 新函数：接受已绑定的listener
async fn run_proxy_with_listener(
    listener: TcpListener,  // ← 已绑定的listener
    config: Arc<ClientConfig>,
    semaphore: Arc<Semaphore>,
    status: ProxyStatus,
    shutdown_rx: tokio::sync::broadcast::Receiver<()>,
) -> Result<()> {
    info!("SOCKS5代理客户端监听: {}", listener.local_addr()?);

    // 直接使用listener，不需要再次绑定
    loop {
        tokio::select! {
            result = listener.accept() => {
                // 处理连接
            }
            _ = shutdown_rx.recv() => {
                break;
            }
        }
    }
}
```

## 修复后的行为

### 正常情况（端口未被占用）

```
用户点击"启动"
  ↓
start() 调用 bind_port()
  ↓
TcpListener::bind(127.0.0.1:1081) ← 同步操作，阻塞到成功
  ↓
端口绑定成功
  ↓
创建异步任务
  ↓
返回 Ok(())
  ↓
UI显示"启动成功" ✓
```

### 异常情况（端口已被占用）

```
用户点击"启动"
  ↓
start() 调用 bind_port()
  ↓
TcpListener::bind(127.0.0.1:1081) ← 同步操作
  ↓
❌ 返回错误 "Address already in use"
  ↓
立即返回 Err() 给UI
  ↓
UI显示错误提示 ✓
```

### 时序对比

#### 修复前
```
时间轴：
0ms    start()被调用
1ms    tokio::spawn创建任务
2ms    设置状态Running
3ms    返回Ok() ← UI看到"启动成功"
...
100ms  异步任务执行
101ms  尝试bind端口
102ms  ❌ 发现端口被占用
103ms  记录错误日志
       ← 但UI已经显示成功了！
```

#### 修复后
```
时间轴：
0ms    start()被调用
1ms    调用bind_port()
2ms    TcpListener::bind()
...
10ms   ❌ 发现端口被占用
11ms   返回Err() ← UI立即看到错误
```

## 测试方法

### 自动化测试

```bash
./test_dual_gui.sh
```

### 手动测试

1. **启动第一个GUI**
   ```bash
   cargo run --bin client-gui-tauri
   ```
   点击"启动"按钮

2. **验证第一个GUI**
   ```bash
   lsof -i :1081
   ```
   应该看到端口被监听

3. **启动第二个GUI**
   ```bash
   cargo run --bin client-gui-tauri
   ```

4. **在第二个GUI中点击"启动"**
   - **预期结果**：显示错误提示 "绑定端口127.0.0.1:1081失败: Address already in use"
   - **不应该**：显示"启动成功"

5. **验证第二个GUI日志**
   ```bash
   tail -f /tmp/tauri2.log
   ```
   应该看到错误信息

## 文件修改清单

- ✅ `client-core/src/proxy.rs`
  - 添加 `listener` 字段
  - 添加 `bind_port()` 方法
  - 修改 `start()` 方法，同步绑定端口
  - 添加 `run_proxy_with_listener()` 函数

- ✅ `client-gui/src-tauri/src/lib.rs`
  - 移除500ms延迟（不再需要）
  - 简化错误处理逻辑

- 📄 `test_dual_gui.sh` - 测试脚本
- 📄 `DUAL_GUI_FIX.md` - 本文档

## 相关问题修复

本次修复同时解决了之前的问题：
1. ✅ 端口状态检测不真实
2. ✅ 异步错误丢失
3. ✅ 重复启动无保护
4. ✅ **新增：双GUI进程端口冲突检测**

## 性能影响

- **正面影响**：错误检测更快，用户体验更好
- **性能开销**：可忽略不计（bind操作本身必须执行）
- **启动时间**：略微增加（需要等待bind完成），但这是必要的
