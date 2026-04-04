# Dockerfile 脚本和 "early eof" 深度分析

## 🔍 问题现象

**错误日志**：
```
❌ 客户端认证失败 [127.0.0.1:60906]: early  eof
```

**客户端日志**：
```
活动服务器: 124.156.132.195:1080 ✅
成功连接到远程服务端 ✅
认证包发送成功 ✅
```

**表面矛盾**：
- 客户端说：连接到了远程服务器，认证包发送成功
- 服务端说：读取时遇到 EOF，连接提前关闭

---

## 🐛 Dockerfile 分析

### Dockerfile 配置文件复制

**第 68 行**：
```dockerfile
COPY server/config/server.toml /app/server.toml
```

**验证配置文件存在**：
```bash
$ ls -lh server/config/server.toml
-rw-r--r--  1 doujia  staff   325B Apr   4 09:26
```

**配置内容**：
```toml
[server]
listen_addr = "0.0.0.0"
listen_port = 1080
max_connections = 1000
timeout_seconds = 300

[auth]
enabled = true
shared_secret = "my_secret_key_12345"  # ✅ 正确
max_time_diff_secs = 300
```

### 启动命令

**第 88 行**：
```dockerfile
CMD ["/app/server", "--config", "/app/server.toml"]
```

**分析**：
- ✅ 配置文件会被复制到容器内的 `/app/server.toml`
- ✅ 服务端启动时会加载 `/app/server.toml`
- ✅ 认证密钥是正确的

---

## 🔬 关键发现：代码默认值问题

### 我们修改的代码

**文件**: `shared/src/auth_config.rs`

**修改**：
```rust
// 修改前
fn default_shared_secret() -> String {
    "change_me_please".to_string()  // ❌ 旧值
}

// 修改后
fn default_shared_secret() -> String {
    "my_secret_key_12345".to_string()  // ✅ 新值
}
```

### 关键问题

**Docker 镜像中的代码版本**：

| 组件 | 本地代码 | 远程镜像（可能） |
|------|---------|---------------|
| `shared/src/auth_config.rs` | `"my_secret_key_12345"` ✅ | `"change_me_please"` ❌（旧镜像）|
| `server/config/server.toml` | `"my_secret_key_12345"` ✅ | `"my_secret_key_12345"` ✅ |

### 配置加载逻辑

**服务端启动流程**：
```rust
// server/src/main.rs:36-45
let config = match config::ServerConfig::from_file(&config_path) {
    Ok(cfg) => {
        info!("⚙️  配置加载成功: {}", config_path);
        cfg  // ✅ 使用配置文件中的值
    }
    Err(e) => {
        info!("⚠️  无法加载配置文件, 使用默认配置: {}", config_path, e);
        config::ServerConfig::default_config()  // ⚠️ 使用代码默认值
    }
};
```

### 问题场景分析

#### 场景 A：配置文件加载成功

**结果**：
- ✅ 使用配置文件：`shared_secret = "my_secret_key_12345"`
- ✅ 客户端和服务端密钥一致
- ✅ 认证应该成功

**结论**：如果配置文件正确加载，不会出现 "early eof"

---

#### 场景 B：配置文件加载失败（最可能）

**失败原因**：
1. 配置文件路径错误
2. 配置文件格式错误
3. 文件权限问题
4. Docker 构建时文件没有正确复制

**结果**：
- ❌ 使用代码默认值：`shared_secret = "change_me_please"`（旧代码）
- ✅ 客户端使用配置文件：`shared_secret = "my_secret_key_12345"`
- ❌ **密钥不匹配！**

**会发生什么**？

##### 详细流程分析

1. **客户端发送认证包**（使用 `my_secret_key_12345`）：
   ```
   [长度2字节] + [加密的认证包N字节]
   ```

2. **服务端接收并读取长度**：
   ```rust
   stream.read_exact(&mut len_buffer).await?;  // 读取2字节长度
   let len = u16::from_be_bytes(len_buffer) as usize;
   ```

3. **服务端读取加密数据**：
   ```rust
   let mut encrypted = vec![0u8; len];
   stream.read_exact(&mut encrypted).await?;  // ← 可能在这里 "early eof"
   ```

4. **服务端解密**（使用错误的密钥 `change_me_please`）：
   ```rust
   decryptor.decode(&mut encrypted, len)?;  // ⚠️ 解密失败
   ```

5. **反序列化**：
   ```rust
   let auth_packet = AuthPacket::deserialize(&encrypted)?;  // ⚠️ 数据格式错误
   ```

6. **结果**：
   - 解密后的数据不是有效的认证包格式
   - 或者解密过程中出错
   - 服务端返回错误，但可能在某个地方连接提前关闭
   - **导致 "early eof"**

---

## 🎯 为什么会 "early eof"？

### 关键发现

**"early eof" 不是超时，是连接关闭！**

可能的情况：

#### 情况 1：解密失败导致连接中断

```rust
// 解密代码（shared/src/king_obj.rs）
decryptor.decode(&mut encrypted, len)?;  // 解密失败
```

**KingObj 解密失败时可能的行为**：
- 返回错误
- 或者修改数据导致后续反序列化失败
- 或者崩溃/panic（如果错误处理不当）

#### 情况 2：反序列化失败

```rust
let auth_packet = AuthPacket::deserialize(&encrypted)?;
```

**反序列化代码**：
```rust
// 读取用户名长度
let username_len = data[pos] as usize;
pos += 1;

// 检查数据长度
if data.len() < 1 + username_len + 8 + 8 + 32 {
    return Err(ProtocolError::InvalidLength.into());  // ← 可能返回这个错误
}
```

**如果数据长度不足**：
- 返回 `ProtocolError::InvalidLength`
- 这个错误可能被转换为某种 I/O 错误
- 或者在错误处理过程中，连接被提前关闭

---

## 🔗 问题根源

### Docker 镜像构建时间线

| 时间点 | 事件 |
|-------|------|
| 1. 修改前 | 构建旧镜像（代码默认值：`change_me_please`） |
| 2. 修改代码 | 修改代码默认值为：`my_secret_key_12345` |
| 3. 修改配置 | 配置文件值：`my_secret_key_12345` |
| 4. **未重新构建镜像** | 远程服务器运行的是旧镜像 ❌ |
| 5. 客户端更新 | 客户端代码和配置都是新的 |
| 6. 密钥不匹配 | 旧镜像用旧密钥，客户端用新密钥 |

### 为什么会 "early eof"？

**最可能的原因**：

1. 远程 Docker 镜像使用**旧代码**
   - 代码默认值：`shared_secret = "change_me_please"`

2. 客户端使用**新密钥**加密：
   - `shared_secret = "my_secret_key_12345"`

3. 服务端用**旧密钥**解密失败：
   ```rust
   decryptor.decode(&mut encrypted, len)?;  // 使用错误的密钥
   ```

4. **解密后的数据格式错误**：
   ```rust
   let auth_packet = AuthPacket::deserialize(&encrypted)?;
   // 数据格式不符合预期，返回错误
   ```

5. **错误处理导致连接关闭**：
   - 服务端检测到认证失败
   - 关闭连接
   - 但在关闭前，或者在某些错误处理路径中
   - 连接被提前关闭
   - 导致读取线程遇到 `early eof`

---

## ✅ 解决方案

### 方案 1：重新构建并部署 Docker 镜像（推荐）

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 重新构建镜像
docker build -t socks5-server:latest .

# 3. 推送到镜像仓库
docker push <your-registry>/socks5-server:latest

# 4. 在 dokploy 中重新部署
```

### 方案 2：验证远程容器配置

```bash
# 进入远程容器
docker exec -it <container_id> sh

# 查看配置文件
cat /app/server.toml

# 查看启动日志
docker logs <container_id> | grep "配置\|shared_secret\|auth"
```

**期望看到**：
```
⚙️ 配置加载成功: /app/server.toml
```

**如果看到**：
```
⚠️ 无法加载配置文件, 使用默认配置
```

说明配置加载失败，使用了代码默认值（旧代码 = 错误密钥）。

### 方案 3：进入容器检查实际密钥

```bash
# 在远程服务器上
docker exec -it <container_id> sh

# 检查服务端进程的环境变量或配置
env | grep -E "SECRET|AUTH"
```

---

## 📊 总结

### "early eof" 的真正原因

1. ✅ **与我们的超时修改无关** - 超时不会导致 "early eof"
2. ❌ **Docker 镜像使用旧代码** - 代码默认值是 `"change_me_please"`
3. ❌ **密钥不匹配** - 服务端用旧密钥解密失败
4. ❌ **解密失败导致连接关闭** - 在读取或处理认证包时连接关闭

### 验证方法

**检查远程容器**：
```bash
docker logs <container_id> | grep -E "配置加载|shared_secret"
```

**期望输出**：
```
⚙️ 配置加载成功: /app/server.toml
```

**如果输出**：
```
�️ 无法加载配置文件, 使用默认配置
```

说明需要重新构建镜像。

### 下一步

1. **重新构建 Docker 镜像**（包含最新代码）
2. **重新部署到远程服务器**
3. **重启客户端测试**
