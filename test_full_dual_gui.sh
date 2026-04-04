#!/bin/bash

echo "=== 完整测试：双GUI端口冲突检测 ==="
echo ""

# 清理
killall client-gui-tauri 2>/dev/null
sleep 2

echo "第一步：启动第一个GUI"
echo "-------------------------------------------"
cargo run --bin client-gui-tauri >/tmp/tauri1.log 2>&1 &
PID1=$!
echo "PID1: $PID1"
sleep 10

echo ""
echo "检查第一个GUI日志:"
echo "-------------------------------------------"
cat /tmp/tauri1.log | grep -E "(启动|绑定|监听|INFO|ERROR)" | tail -20

echo ""
echo "检查端口1081:"
echo "-------------------------------------------"
if lsof -i :1081 2>/dev/null | grep -q LISTEN; then
    echo "✓ 端口1081被监听"
    lsof -i :1081 | grep LISTEN
else
    echo "✗ 端口1081未监听"
fi

echo ""
echo ""
echo "第二步：启动第二个GUI"
echo "-------------------------------------------"
cargo run --bin client-gui-tauri >/tmp/tauri2.log 2>&1 &
PID2=$!
echo "PID2: $PID2"
sleep 10

echo ""
echo "第二个GUI日志:"
echo "-------------------------------------------"
cat /tmp/tauri2.log | grep -E "(启动|绑定|监听|INFO|ERROR|error)" | tail -20

echo ""
echo ""
echo "完整日志对比:"
echo "-------------------------------------------"
echo "第一个GUI日志（最后30行）:"
echo "==========================================="
tail -30 /tmp/tauri1.log

echo ""
echo "第二个GUI日志（最后30行）:"
echo "==========================================="
tail -30 /tmp/tauri2.log

echo ""
echo ""
echo "清理进程"
echo "-------------------------------------------"
kill $PID1 $PID2 2>/dev/null
sleep 2

echo "测试完成！"
echo ""
echo "预期结果："
echo "- 第一个GUI应该显示 '✓ 端口绑定成功' 和 'SOCKS5代理客户端已启动'"
echo "- 第二个GUI应该显示 '绑定端口...失败' 或 'Address already in use'"
echo ""
echo "如果第二个GUI没有显示错误，请检查："
echo "1. 第一个GUI是否真的启动了代理（端口1081被监听）"
echo "2. 日志是否完整（cat /tmp/tauri*.log）"
