#!/bin/bash
# 加密隧道端到端测试脚本

set -e

PROJECT_ROOT="/Users/doujia/Work/自制FQ工具/socks5-proxy-rust"
cd "$PROJECT_ROOT"

echo "========================================="
echo "  SOCKS5加密隧道端到端测试"
echo "========================================="
echo ""

# 1. 构建项目
echo "🔨 构建项目..."
cargo build

echo ""
echo "========================================="
echo "  启动服务端（远程）"
echo "========================================="
# 启动服务端（监听1080端口）
./target/debug/server &
SERVER_PID=$!
echo "服务端PID: $SERVER_PID"
sleep 2

echo ""
echo "========================================="
echo "  启动客户端（本地SOCKS5）"
echo "========================================="
# 启动客户端（监听1081端口，转发到1080端口的服务端）
./target/debug/client &
CLIENT_PID=$!
echo "客户端PID: $CLIENT_PID"
sleep 2

echo ""
echo "========================================="
echo "  测试SOCKS5握手"
echo "========================================="
# 测试SOCKS5握手
echo -ne "\x05\x01\x00" | nc localhost 1081 | head -c 2 | xxd
echo ""

echo ""
echo "========================================="
echo "  测试HTTP代理（通过加密隧道）"
echo "========================================="
# 测试HTTP请求
echo "尝试通过代理访问 example.com..."
if curl -x socks5://localhost:1081 --connect-timeout 10 http://example.com/ > /tmp/test_result.html 2>&1; then
    echo "✅ HTTP代理测试成功！"
    echo "响应大小: $(wc -c < /tmp/test_result.html) 字节"
else
    echo "❌ HTTP代理测试失败"
fi

echo ""
echo "========================================="
echo "  清理进程"
echo "========================================="
# 停止客户端和服务端
kill $CLIENT_PID 2>/dev/null || true
kill $SERVER_PID 2>/dev/null || true
wait $CLIENT_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo ""
echo "========================================="
echo "  测试完成"
echo "========================================="
echo ""
echo "日志文件位置："
echo "  - 服务端日志（当前终端输出）"
echo "  - 客户端日志（当前终端输出）"
echo ""
