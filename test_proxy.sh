#!/bin/bash
# SOCKS5代理服务器简单测试脚本

set -e

PROJECT_ROOT="/Users/doujia/Work/自制FQ工具/socks5-proxy-rust"
cd "$PROJECT_ROOT"

echo "🔨 构建服务端..."
cargo build -p server

echo ""
echo "🚀 启动服务端..."
./target/debug/server &
SERVER_PID=$!

# 等待服务器启动
sleep 2

echo ""
echo "🧪 测试SOCKS5握手..."
# 测试握手
(echo -ne "\x05\x01\x00" | nc localhost 1080 | head -c 2 | xxd) &
sleep 1

echo ""
echo "🧪 测试HTTP代理..."
# 测试HTTP请求
curl -x socks5://localhost:1080 --connect-timeout 5 http://example.com/ > /dev/null 2>&1 && echo "✅ HTTP代理测试成功" || echo "❌ HTTP代理测试失败"

echo ""
echo "🛑 停止服务端..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo ""
echo "✨ 测试完成"
