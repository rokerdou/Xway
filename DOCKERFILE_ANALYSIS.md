# Dockerfile 分析与更新建议

## 📋 当前项目结构

```
workspace members = [
    "server",              // 服务端
    "client",              // 命令行客户端
    "shared",              // 共享库
    "client-core",         // 客户端核心库 (新增)
    "client-gui/src-tauri" // GUI客户端 (新增)
]
```

## 🔍 依赖关系分析

### 各成员依赖

| 成员 | 依赖 |
|------|------|
| **server** | `shared` |
| **client** | `shared` |
| **client-core** | `shared` |
| **client-gui/src-tauri** | `client-core`, `shared` |

### 关键发现

✅ **server 不依赖 client-core**
✅ **server 不依赖 client-gui**
✅ **Docker 只需要构建 server**

## ⚠️ 当前 Dockerfile 的问题

### 问题1：缺少新增成员的 Cargo.toml

当前 Dockerfile（第19-21行）：
```dockerfile
COPY server/Cargo.toml server/
COPY shared/Cargo.toml shared/
COPY client/Cargo.toml client/
```

❌ **缺少**：
- `client-core/Cargo.toml`
- `client-gui/src-tauri/Cargo.toml`

**影响**：
- `cargo fetch` 可能无法正确解析 workspace
- 如果将来 server 依赖了 client-core，构建会失败

### 问题2：缺少新增成员的 dummy src

当前 Dockerfile（第24-27行）：
```dockerfile
RUN mkdir -p server/src shared/src client/src \
    && echo "fn main() {}" > server/src/main.rs \
    && echo "" > shared/src/lib.rs \
    && echo "fn main() {}" > client/src/main.rs
```

❌ **缺少**：
- `client-core/src/lib.rs`
- `client-gui/src-tauri/src/lib.rs` 或 `main.rs`

## ✅ 修复方案

### 方案1：最小改动（推荐）

**只添加 workspace 成员的 manifest，不需要编译它们**

```dockerfile
# ============================================
# 阶段1: 构建阶段
# ============================================
FROM rust:latest AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# ✅ 复制 workspace 配置
COPY Cargo.toml ./

# ✅ 复制所有成员的 manifest（包括新增的）
COPY server/Cargo.toml server/
COPY shared/Cargo.toml shared/
COPY client/Cargo.toml client/
COPY client-core/Cargo.toml client-core/        # 新增
COPY client-gui/src-tauri/Cargo.toml client-gui/src-tauri/  # 新增

# ✅ 创建 dummy src（只包含 server 依赖的）
RUN mkdir -p server/src shared/src client/src \
         client-core/src client-gui/src-tauri/src \
    && echo "fn main() {}" > server/src/main.rs \
    && echo "" > shared/src/lib.rs \
    && echo "fn main() {}" > client/src/main.rs \
    && echo "" > client-core/src/lib.rs \
    && echo "" > client-gui/src-tauri/src/lib.rs

# 缓存依赖
RUN cargo fetch

# 覆盖真实源码
COPY server/src server/src
COPY shared/src shared/src

# 编译 server（只编译需要的）
RUN cargo build --release -p server

# ============================================
# 阶段2: 运行阶段
# ============================================
FROM debian:bookworm-slim

# ... 保持不变 ...
```

### 方案2：只复制 server 直接依赖的（如果不需要支持 client）

```dockerfile
# 只复制 server 及其依赖
COPY Cargo.toml ./
COPY server/Cargo.toml server/
COPY shared/Cargo.toml shared/

# 只为需要的创建 dummy
RUN mkdir -p server/src shared/src \
    && echo "fn main() {}" > server/src/main.rs \
    && echo "" > shared/src/lib.rs

RUN cargo fetch
```

**优点**：更小的 Docker 上下文
**缺点**：如果将来 server 依赖了其他成员，需要更新

## 📝 建议的完整 Dockerfile

```dockerfile
# 多阶段构建 - SOCKS5 代理服务端
# 支持 Rust workspace 包含多个成员

# ============================================
# 阶段1: 构建阶段
# ============================================
FROM rust:latest AS builder

WORKDIR /build

# 安装依赖（Rust 的 pkg-config 用于某些 crate）
RUN apt-get update && apt-get install -y \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# ✅ Step 1: 复制 workspace 配置
COPY Cargo.toml ./
COPY Cargo.lock ./

# ✅ Step 2: 复制所有成员的 manifest
# 为 workspace 的所有成员提供 Cargo.toml
COPY server/Cargo.toml server/
COPY shared/Cargo.toml shared/
COPY client/Cargo.toml client/
COPY client-core/Cargo.toml client-core/
COPY client-gui/src-tauri/Cargo.toml client-gui/src-tauri/

# ✅ Step 3: 创建 dummy src 文件
# 为所有成员创建空源文件，使 cargo fetch 能够解析依赖
RUN mkdir -p server/src shared/src client/src \
         client-core/src client-gui/src-tauri/src \
    && echo "fn main() {}" > server/src/main.rs \
    && echo "mod lib {}" > shared/src/lib.rs \
    && echo "pub mod lib; pub use lib::..." > shared/src/lib.rs \
    && echo "fn main() {}" > client/src/main.rs \
    && echo "" > client-core/src/lib.rs \
    && echo "" > client-gui/src-tauri/src/lib.rs

# ✅ Step 4: 预缓存依赖
# 这会缓存所有 workspace 成员的依赖
RUN cargo fetch

# ✅ Step 5: 复制真实源码
# 只复制 server 需要的源码
COPY server/src server/src
COPY shared/src shared/src

# ✅ Step 6: 编译 server
# 只编译 server 二进制文件
RUN cargo build --release -p server

# ============================================
# 阶段2: 运行阶段
# ============================================
FROM debian:bookworm-slim

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    ca-certificates \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户
RUN id -u proxy >/dev/null 2>&1 || useradd -m -u 1000 -s /bin/bash proxy

# 创建应用目录
WORKDIR /app

# 从构建阶段复制二进制文件
COPY --from=builder /build/target/release/server /app/server

# 复制服务端配置文件
COPY server/config/server.toml /app/server.toml

# 更改所有权
RUN chown -R proxy:proxy /app

# 切换到非 root 用户
USER proxy

# 暴露端口
EXPOSE 1080

# 设置环境变量
ENV RUST_LOG=info
ENV SERVER_ADDRESS=0.0.0.0:1080

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD nc -z localhost 1080 || exit 1

# 启动服务端
CMD ["/app/server", "--config", "/app/server.toml"]
```

## 🎯 更新要点

### 必须添加

1. **新增成员的 Cargo.toml**
   - `client-core/Cargo.toml`
   - `client-gui/src-tauri/Cargo.toml`

2. **新增成员的 dummy src**
   - `client-core/src/lib.rs`
   - `client-gui/src-tauri/src/lib.rs`

### 可选添加

1. **.dockerignore 更新**
   - 忽略 `client-core/src/`
   - 忽略 `client-gui/src-tauri/src/`
   - 忽略 `client-gui/ui/`、`client-gui/ui/node_modules/`

## 📦 构建影响

### Docker 镜像大小

- ✅ **无影响**：最终镜像只包含 server 二进制文件
- ✅ **构建缓存**：依赖缓存仍有效

### 构建时间

- ⚠️ **略微增加**：需要解析更多成员的 manifest
- ✅ **仍可缓存**：依赖层仍可被 Docker 缓存

## 🚀 部署建议

### 当前部署（dokploy）

✅ **无需改动**：当前的 dokploy 部署流程正常工作

### 如果要更新

1. 更新 Dockerfile（使用上面的完整版本）
2. 测试本地构建：`docker build -t socks5-server .`
3. 推送到 GitHub，dokploy 会自动拉取并构建

## ❓ 常见问题

### Q: client-gui/src-tauri 需要在 Docker 中构建吗？

**A**: ❌ **不需要**
- `client-gui/src-tauri` 是桌面应用（Tauri）
- 包含前端代码和平台特定代码
- 在 Docker 中构建没有意义

### Q: client-core 需要在 Docker 中构建吗？

**A**: ❌ **当前不需要**
- `server` 不依赖 `client-core`
- 只需要在 `cargo fetch` 时识别它

### Q: 如果将来 server 依赖了 client-core？

**A**: ✅ **已经在 Dockerfile 中准备好了**
- 所有 workspace 成员都已添加
- 只需在编译时添加 `-p client-core`

## 📋 总结

| 项目 | 是否需要在 Dockerfile | 原因 |
|------|---------------------|------|
| **server** | ✅ 必须 | 部署目标 |
| **shared** | ✅ 必须 | server 的依赖 |
| **client** | ⚠️ 建议 | workspace 成员，用于 `cargo fetch` |
| **client-core** | ⚠️ 建议 | workspace 成员，用于 `cargo fetch` |
| **client-gui/src-tauri** | ⚠️ 建议 | workspace 成员，用于 `cargo fetch` |

**建议**：使用方案1（最小改动），确保所有 workspace 成员的 manifest 都被复制。
