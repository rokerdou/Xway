#!/bin/bash
# 交叉编译脚本 - 为 Linux 构建 server 二进制文件
# 用于 macOS 开发环境编译 Linux 可执行文件

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SOCKS5 代理服务端 - Linux 构建${NC}"
echo -e "${GREEN}========================================${NC}"

# 检测当前操作系统
OS=$(uname -s)
echo -e "${YELLOW}当前操作系统: ${OS}${NC}"

if [[ "$OS" == "Darwin" ]]; then
    TARGET="x86_64-unknown-linux-gnu"
    echo -e "${YELLOW}检测到 macOS，启用交叉编译模式${NC}"
    echo -e "${YELLOW}目标平台: ${TARGET}${NC}"
elif [[ "$OS" == "Linux" ]]; then
    TARGET=""
    echo -e "${YELLOW}检测到 Linux，使用原生编译${NC}"
else
    echo -e "${RED}错误: 不支持的操作系统 ${OS}${NC}"
    exit 1
fi

# 安装交叉编译目标（仅 macOS）
if [[ -n "$TARGET" ]]; then
    echo -e "${YELLOW}检查交叉编译目标...${NC}"
    if ! rustup target list --installed | grep -q "$TARGET"; then
        echo -e "${YELLOW}安装交叉编译目标: ${TARGET}${NC}"
        rustup target add "$TARGET"
    else
        echo -e "${GREEN}交叉编译目标已安装${NC}"
    fi
fi

# 清理之前的构建
echo -e "${YELLOW}清理之前的构建产物...${NC}"
if [[ -n "$TARGET" ]]; then
    cargo clean --target "$TARGET"
else
    cargo clean
fi

# 编译 server
echo -e "${YELLOW}开始编译 server...${NC}"
if [[ -n "$TARGET" ]]; then
    cargo build --release -p server --target "$TARGET"
else
    cargo build --release -p server
fi

# 确定二进制文件路径
if [[ -n "$TARGET" ]]; then
    BINARY_PATH="target/$TARGET/release/server"
else
    BINARY_PATH="target/release/server"
fi

# 检查编译结果
if [[ ! -f "$BINARY_PATH" ]]; then
    echo -e "${RED}错误: 编译失败，找不到二进制文件${NC}"
    exit 1
fi

# 显示文件信息
echo -e "${GREEN}✓ 编译成功！${NC}"
FILE_SIZE=$(ls -lh "$BINARY_PATH" | awk '{print $5}')
echo -e "${GREEN}二进制文件: ${BINARY_PATH}${NC}"
echo -e "${GREEN}文件大小: ${FILE_SIZE}${NC}"

# 验证二进制文件（Linux）
if [[ "$OS" == "Linux" ]]; then
    echo -e "${YELLOW}验证二进制文件...${NC}"
    file "$BINARY_PATH"
    echo -e "${YELLOW}测试运行（显示版本信息）...${NC}"
    "$BINARY_PATH" --version || true
fi

# ============================================
# 发布到独立仓库
# ============================================
RELEASES_REPO="../socks5-proxy-releases"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}准备发布到独立仓库${NC}"

# 检查发布仓库是否存在
if [[ ! -d "$RELEASES_REPO" ]]; then
    echo -e "${YELLOW}创建发布仓库: ${RELEASES_REPO}${NC}"
    mkdir -p "$RELEASES_REPO"
    cd "$RELEASES_REPO"
    git init
    echo "# SOCKS5 代理服务端 - 二进制发布仓库

此仓库包含预编译的服务端二进制文件，用于 dokploy 部署。

## 文件说明
- \`server\`: Linux x86_64 预编译二进制文件
- \`Dockerfile\`: 单阶段部署配置
- \`server.toml\`: 服务端配置文件

## 部署流程
1. 从源码仓库构建: \`cd ../socks5-proxy-rust && ./scripts/build-release.sh\`
2. 此脚本会自动复制二进制到当前仓库
3. 提交并推送: \`git add . && git commit -m 'chore: 更新服务端二进制' && git push\`
" > README.md
    cd - >/dev/null
else
    echo -e "${GREEN}✓ 发布仓库已存在${NC}"
fi

# 复制二进制文件
echo -e "${YELLOW}复制二进制文件到发布仓库...${NC}"
cp "$BINARY_PATH" "$RELEASES_REPO/server"

# 复制 Dockerfile（如果发布仓库没有）
if [[ ! -f "$RELEASES_REPO/Dockerfile" ]]; then
    echo -e "${YELLOW}复制 Dockerfile 到发布仓库...${NC}"
    cp "Dockerfile" "$RELEASES_REPO/Dockerfile"
fi

# 复制配置文件（如果发布仓库没有）
if [[ ! -f "$RELEASES_REPO/server.toml" ]]; then
    echo -e "${YELLOW}复制配置文件到发布仓库...${NC}"
    cp "server/config/server.toml" "$RELEASES_REPO/server.toml"
fi

# 创建 .gitignore（排除不必要的文件）
cat > "$RELEASES_REPO/.gitignore" << 'EOF'
# 保留所有文件，不忽略任何内容
# 我们需要提交所有文件到发布仓库
EOF

echo -e "${GREEN}✓ 文件已复制到发布仓库${NC}"
echo -e "${YELLOW}发布仓库路径: ${RELEASES_REPO}${NC}"

# 显示发布仓库状态
cd "$RELEASES_REPO"
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}发布仓库 Git 状态:${NC}"
git status --short

FILE_SIZE=$(ls -lh server | awk '{print $5}')
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}构建和发布准备完成！${NC}"
echo -e "${GREEN}二进制大小: ${FILE_SIZE}${NC}"
echo -e "${YELLOW}下一步操作:${NC}"
echo -e "  1. 查看变更: cd ${RELEASES_REPO} && git diff"
echo -e "  2. 提交变更: cd ${RELEASES_REPO} && git add . && git commit -m 'chore: 更新服务端二进制'"
echo -e "  3. 推送到远端: cd ${RELEASES_REPO} && git push"
echo -e "${GREEN}========================================${NC}"
cd - >/dev/null
