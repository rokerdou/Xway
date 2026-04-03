# 多阶段构建 - SOCKS5 代理服务端
# 用于 dokploy 部署：从 git 拉取代码后直接构建

# ============================================
# 阶段1: 构建阶段
# ============================================
FROM rust:1.75-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# ✅ 使用原始 workspace（最关键）
COPY Cargo.toml ./

# 所有 crate 的 manifest
COPY server/Cargo.toml server/
COPY shared/Cargo.toml shared/
COPY client/Cargo.toml client/

# dummy src（全部）
RUN mkdir -p server/src shared/src client/src \
 && echo "fn main() {}" > server/src/main.rs \
 && echo "" > shared/src/lib.rs \
 && echo "fn main() {}" > client/src/main.rs

# 缓存依赖
RUN cargo fetch

# 覆盖真实源码（只复制需要的）
COPY server/src server/src
COPY shared/src shared/src

# 编译 server（不编译 client）
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
CMD ["/app/server"]
