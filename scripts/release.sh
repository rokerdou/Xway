#!/bin/bash
# 一键发布脚本 - 完整的发布流程
# 用于构建并推送二进制到发布仓库

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  SOCKS5 代理 - 一键发布流程${NC}"
echo -e "${BLUE}========================================${NC}"

# 获取变更说明
if [[ -z "$1" ]]; then
    echo -e "${YELLOW}请输入本次变更说明:${NC}"
    read -r CHANGELOG
else
    CHANGELOG="$1"
fi

if [[ -z "$CHANGELOG" ]]; then
    echo -e "${RED}错误: 变更说明不能为空${NC}"
    exit 1
fi

# 步骤 1: 构建二进制
echo -e "${YELLOW}\n[步骤 1/3] 构建二进制...${NC}"
./scripts/build-release.sh

if [[ $? -ne 0 ]]; then
    echo -e "${RED}错误: 构建失败${NC}"
    exit 1
fi

# 步骤 2: 提交到发布仓库
echo -e "${YELLOW}\n[步骤 2/3] 提交到发布仓库...${NC}"

RELEASES_REPO="../socks5-proxy-releases"

if [[ ! -d "$RELEASES_REPO" ]]; then
    echo -e "${RED}错误: 发布仓库不存在${NC}"
    exit 1
fi

cd "$RELEASES_REPO"

# 检查是否有变更
if [[ -z $(git status --porcelain) ]]; then
    echo -e "${YELLOW}警告: 没有检测到变更${NC}"
    echo -e "${YELLOW}二进制文件可能已经是最新版本${NC}"
    exit 0
fi

# 显示变更
echo -e "${YELLOW}检测到以下变更:${NC}"
git status --short

# 提交变更
echo -e "${YELLOW}提交变更...${NC}"
git add .
git commit -m "chore: 更新服务端二进制 - ${CHANGELOG}"

if [[ $? -ne 0 ]]; then
    echo -e "${RED}错误: Git 提交失败${NC}"
    exit 1
fi

# 步骤 3: 推送到远端
echo -e "${YELLOW}\n[步骤 3/3] 推送到远端...${NC}"
git push

if [[ $? -ne 0 ]]; then
    echo -e "${RED}错误: Git 推送失败${NC}"
    echo -e "${YELLOW}提示: 可能需要先拉取远端变更${NC}"
    echo -e "${YELLOW}执行: cd ${RELEASES_REPO} && git pull --rebase && git push${NC}"
    exit 1
fi

# 完成
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ 发布完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${YELLOW}变更说明: ${CHANGELOG}${NC}"
echo -e "${YELLOW}提交信息:${NC}"
cd - >/dev/null
cd "$RELEASES_REPO"
git log -1 --oneline
cd - >/dev/null

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}下一步:${NC}"
echo -e "  • dokploy 将自动拉取新版本"
echo -e "  • 容器会自动重新构建和部署"
echo -e "  • 检查部署状态: 在 dokploy 面板查看"
echo -e "${BLUE}========================================${NC}"
