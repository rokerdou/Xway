# 单阶段构建 - 使用预编译二进制
# 用于 dokploy 部署：直接从 git 拉取预编译的 Linux 二进制文件
# 优势：
#  1. 容器构建速度极快（无需编译）
#  2. 最终镜像更小（无构建工具）
#  3. 节省服务器资源

# ============================================
# 运行阶段（唯一阶段）
# ============================================
FROM debian:bookworm-slim

# 元数据
LABEL maintainer="your-email@example.com"
LABEL description="SOCKS5 代理服务端 - 预编译版本"
LABEL version="1.0"

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    ca-certificates \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户（如果不存在）
RUN id -u proxy >/dev/null 2>&1 || useradd -m -u 1000 -s /bin/bash proxy

# 创建应用目录
WORKDIR /app

# 从发布仓库复制预编译的二进制文件
# 这个二进制文件由 scripts/build-release.sh 生成并复制到发布仓库
COPY server /app/server

# 复制服务端配置文件
COPY server.toml /app/server.toml

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
