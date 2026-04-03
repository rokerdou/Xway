# 多阶段构建 - SOCKS5 代理服务端
# 用于 dokploy 部署：从 git 拉取代码后直接构建

# ============================================
# 阶段1: 构建阶段
# ============================================
FROM rust:1.75-slim as builder

WORKDIR /build

# 安装构建依赖
RUN apt-get update && apt-get install -y \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# 复制 Cargo 配置
COPY Cargo.toml Cargo.lock ./

# 复制 shared 库源码
COPY shared/ shared/

# 复制 server 源码
COPY server/ server/

# 使用静态链接编译
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
RUN useradd -m -u 1000 -s /bin/bash proxy

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
