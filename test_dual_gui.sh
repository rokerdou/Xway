#!/bin/bash

echo "=== 测试两个GUI进程的端口冲突检测 ==="
echo ""

# 清理
killall client-gui-tauri 2>/dev/null
sleep 2

echo "1. 启动第一个GUI..."
cargo run --bin client-gui-tauri >/tmp/tauri1.log 2>&1 &
PID1=$!
echo "   PID1: $PID1"
sleep 10

echo ""
echo "2. 请在第一个GUI中点击'启动'按钮"
echo "   然后按回车继续..."
read

echo ""
echo "3. 验证第一个GUI的代理已启动:"
if lsof -i :1081 2>/dev/null | grep -q LISTEN; then
    echo "   ✓ 端口1081被监听"
    lsof -i :1081 | grep LISTEN
else
    echo "   ✗ 端口1081未监听"
fi

echo ""
echo "4. 启动第二个GUI..."
cargo run --bin client-gui-tauri >/tmp/tauri2.log 2>&1 &
PID2=$!
echo "   PID2: $PID2"
sleep 10

echo ""
echo "5. 请在第二个GUI中点击'启动'按钮"
echo "   预期结果：应该显示'启动失败'错误"
echo "   然后按回车继续..."
read

echo ""
echo "6. 检查第二个GUI的日志:"
echo "=== 日志内容 ==="
tail -30 /tmp/tauri2.log

echo ""
echo "7. 验证端口状态:"
lsof -i :1081 2>/dev/null | grep LISTEN || echo "端口未监听"

echo ""
echo "8. 清理"
kill $PID1 $PID2 2>/dev/null
sleep 2

echo "测试完成！"
