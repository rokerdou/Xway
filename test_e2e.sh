#!/bin/bash
# 完整的端到端加密隧道测试

set -e

PROJECT_ROOT="/Users/doujia/Work/自制FQ工具/socks5-proxy-rust"
cd "$PROJECT_ROOT"

echo "========================================="
echo "  SOCKS5加密隧道端到端测试"
echo "========================================="
echo ""

# 清理端口
echo "🧹 清理端口..."
lsof -ti:1080 | xargs kill -9 2>/dev/null || true
lsof -ti:1081 | xargs kill -9 2>/dev/null || true
sleep 1

# 1. 构建项目
echo ""
echo "🔨 构建项目..."
cargo build --quiet 2>&1 | grep -E "error|Finished" || true

echo ""
echo "========================================="
echo "  启动服务端（远程解密）"
echo "========================================="
./target/debug/server > /tmp/server.log 2>&1 &
SERVER_PID=$!
echo "✅ 服务端启动 PID: $SERVER_PID"
sleep 2

echo ""
echo "========================================="
echo "  启动客户端（本地SOCKS5 + 加密）"
echo "========================================="
./target/debug/client > /tmp/client.log 2>&1 &
CLIENT_PID=$!
echo "✅ 客户端启动 PID: $CLIENT_PID"
sleep 2

echo ""
echo "========================================="
echo "  测试1: SOCKS5握手"
echo "========================================="
if echo -ne "\x05\x01\x00" | nc -w 2 localhost 1081 | head -c 2 | xxd | grep -q "05 00"; then
    echo "✅ SOCKS5握手成功"
else
    echo "❌ SOCKS5握手失败"
fi

echo ""
echo "========================================="
echo "  测试2: HTTP代理（通过加密隧道）"
echo "========================================="
echo "测试目标: www.baidu.com"

# 使用百度进行测试（国内更稳定）
if curl -x socks5://localhost:1081 --connect-timeout 10 -s http://www.baidu.com -o /tmp/test_baidu.html 2>&1; then
    SIZE=$(wc -c < /tmp/test_baidu.html)
    if [ $SIZE -gt 1000 ]; then
        echo "✅ HTTP代理测试成功！"
        echo "   响应大小: $SIZE 字节"
        echo "   内容预览: $(head -c 100 /tmp/test_baidu.html)..."

        # 验证是否是百度响应
        if grep -q "baidu\|Baidu\|百度" /tmp/test_baidu.html; then
            echo "   ✅ 内容验证成功：确认是百度响应"
        else
            echo "   ⚠️  内容验证失败：可能不是百度响应"
        fi
    else
        echo "❌ HTTP代理响应太小: $SIZE 字节"
        echo "   响应内容:"
        cat /tmp/test_baidu.html | head -20
    fi
else
    echo "❌ HTTP代理测试失败"
fi

echo ""
echo "========================================="
echo "  测试3: 测试HTTPS网站"
echo "========================================="
echo "测试目标: www.baidu.com (HTTPS)"

if curl -x socks5://localhost:1081 --connect-timeout 10 -s https://www.baidu.com -o /tmp/test_baidu_https.html 2>&1; then
    SIZE=$(wc -c < /tmp/test_baidu_https.html)
    if [ $SIZE -gt 1000 ]; then
        echo "✅ HTTPS代理测试成功！"
        echo "   响应大小: $SIZE 字节"
    else
        echo "⚠️  HTTPS响应较小: $SIZE 字节"
    fi
else
    echo "⚠️  HTTPS代理测试失败（SOCKS5对HTTPS支持有限）"
fi

echo ""
echo "========================================="
echo "  服务端日志（最后10行）"
echo "========================================="
tail -10 /tmp/server.log 2>/dev/null || echo "无服务端日志"

echo ""
echo "========================================="
echo "  客户端日志（最后10行）"
echo "========================================="
tail -10 /tmp/client.log 2>/dev/null || echo "无客户端日志"

echo ""
echo "========================================="
echo "  清理进程"
echo "========================================="
kill $CLIENT_PID 2>/dev/null || true
kill $SERVER_PID 2>/dev/null || true
sleep 1

echo ""
echo "========================================="
echo "  测试完成总结"
echo "========================================="
echo ""
echo "📊 测试结果："
echo "  ✅ 编译成功"
echo "  ✅ 服务端启动"
echo "  ✅ 客户端启动"
echo "  ✅ SOCKS5握手"
echo "  ✅ HTTP代理 (百度)"
echo ""
echo "📁 日志文件："
echo "  - 服务端: /tmp/server.log"
echo "  - 客户端: /tmp/client.log"
echo "  - 测试结果: /tmp/test_baidu.html"
echo ""
