#!/bin/bash
# Docker 编译脚本 - 在 Linux 容器内编译
# 解决 macOS 交叉编译问题

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  SOCKS5 代理 - Docker 编译${NC}"
echo -e "${BLUE}========================================${NC}"

# 检查 Docker 是否运行
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}错误: Docker 未运行${NC}"
    echo -e "${YELLOW}请先启动 Docker Desktop${NC}"
    exit 1
fi

echo -e "${YELLOW}检查 Docker 镜像...${NC}"

# 拉取 Rust 镜像（如果不存在）
if ! docker image inspect rust:latest >/dev/null 2>&1; then
    echo -e "${YELLOW}拉取 Rust Docker 镜像...${NC}"
    docker pull rust:latest
fi

echo -e "${GREEN}✓ Docker 环境就绪${NC}"

# 获取项目路径
PROJECT_DIR="$(pwd)"
echo -e "${YELLOW}项目目录: ${PROJECT_DIR}${NC}"

# 创建发布仓库目录（如果不存在）
RELEASES_REPO="../socks5-proxy-releases"
if [[ ! -d "$RELEASES_REPO" ]]; then
    echo -e "${YELLOW}创建发布仓库: ${RELEASES_REPO}${NC}"
    mkdir -p "$RELEASES_REPO"
fi

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}开始在 Docker 中编译...${NC}"
echo -e "${YELLOW}========================================${NC}"

# 在 Docker 容器中编译
docker run --rm \
  -v "$PROJECT_DIR":/app \
  -w /app \
  rust:latest \
  bash -c "
    echo '📦 安装依赖...'
    apt-get update && apt-get install -y pkg-config

    echo '🔨 开始编译 server...'
    cargo build --release -p server

    echo '✓ 编译完成！'

    echo '📊 二进制信息:'
    ls -lh target/release/server
    file target/release/server
  "

# 检查编译结果
if [[ ! -f "target/release/server" ]]; then
    echo -e "${RED}错误: 编译失败，找不到二进制文件${NC}"
    exit 1
fi

# 复制到发布仓库
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}复制到发布仓库...${NC}"

# 确保我们在正确的目录
cd "$(dirname "$0")/.."

# 复制二进制
cp target/release/server "$RELEASES_REPO/server"

# 复制其他文件（如果不存在）
if [[ ! -f "$RELEASES_REPO/Dockerfile" ]]; then
    cp Dockerfile "$RELEASES_REPO/Dockerfile"
fi

if [[ ! -f "$RELEASES_REPO/server.toml" ]]; then
    cp server/config/server.toml "$RELEASES_REPO/server.toml"
fi

# 创建 README（如果不存在）
if [[ ! -f "$RELEASES_REPO/README.md" ]]; then
    cat > "$RELEASES_REPO/README.md" << 'EOFREADME'
# SOCKS5 代理服务端 - 二进制发布仓库

此仓库包含预编译的服务端二进制文件，用于 dokploy 部署。

## 文件说明
- `server`: Linux 预编译二进制文件
- `Dockerfile`: 单阶段部署配置
- `server.toml`: 服务端配置文件

## 更新方式
在源码仓库运行：
```bash
./scripts/build-in-docker.sh
```

然后在此仓库提交并推送。
EOFREADME
fi

echo -e "${GREEN}✓ 文件已复制${NC}"

# 显示文件信息
FILE_SIZE=$(ls -lh "$RELEASES_REPO/server" | awk '{print $5}')
echo -e "${GREEN}二进制大小: ${FILE_SIZE}${NC}"

# Git 状态
cd "$RELEASES_REPO"
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}发布仓库 Git 状态:${NC}"
git status --short

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Docker 编译完成！${NC}"
echo -e "${YELLOW}下一步操作:${NC}"
echo -e "  1. 查看变更: cd ${RELEASES_REPO} && git diff"
echo -e "  2. 提交变更: cd ${RELEASES_REPO} && git add . && git commit -m 'chore: 更新服务端二进制'"
echo -e "  3. 推送到远端: cd ${RELEASES_REPO} && git push"
echo -e "${GREEN}========================================${NC}"
