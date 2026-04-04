# 多阶段构建 - SOCKS5 代理服务端
# 用于 dokploy 部署：从 git 拉取代码后直接构建
# 支持 Rust workspace 包含多个成员

# ============================================
# 阶段1: 构建阶段
# ============================================
FROM rust:latest AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# 复制 workspace 配置
COPY Cargo.toml ./

# 复制所有 workspace 成员的 manifest
# 包括新增的 client-core 和 client-gui/src-tauri
COPY server/Cargo.toml server/
COPY shared/Cargo.toml shared/
COPY client/Cargo.toml client/
COPY client-core/Cargo.toml client-core/
COPY client-gui/src-tauri/Cargo.toml client-gui/src-tauri/

# 创建 dummy src（所有 workspace 成员）
# 为所有成员创建空源文件，使 cargo fetch 能够解析依赖
RUN mkdir -p server/src shared/src client/src \
         client-core/src client-gui/src-tauri/src \
    && echo "fn main() {}" > server/src/main.rs \
    && echo "pub mod lib; pub use lib::KingObj;" > shared/src/lib.rs \
    && echo "fn main() {}" > client/src/main.rs \
    && echo "" > client-core/src/lib.rs \
    && echo "" > client-gui/src-tauri/src/lib.rs

# 缓存依赖
RUN cargo fetch

# 覆盖真实源码（只复制 server 需要的）
COPY server/src server/src
COPY shared/src shared/src

# 编译 server（只编译需要的，不编译 client 和 client-gui）
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

# 创建非 root 用户（如果不存在）
RUN id -u proxy >/dev/null 2>&1 || useradd -m -u 1000 -s /bin/bash proxy

# 创建应用目录
WORKDIR /app

# 从构建阶段复制二进制文件
COPY --from=builder /build/target/release/server /app/server

# 复制服务端配置文件（直接从本地复制）
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

# 启动服务端（使用配置文件）
CMD ["/app/server", "--config", "/app/server.toml"]
