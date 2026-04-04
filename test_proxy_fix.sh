#!/bin/bash

echo "=== 测试代理端口检测修复 ==="
echo ""

# 停止所有现有进程
killall client-gui-tauri 2>/dev/null
sleep 2

echo "1. 检查初始状态（应该未监听）"
if lsof -i :1081 >/dev/null 2>&1; then
    echo "❌ 错误：端口1081被占用"
    lsof -i :1081
else
    echo "✓ 正确：端口1081未被监听"
fi

echo ""
echo "2. 启动GUI应用（但不点击启动）"
cargo run --bin client-gui-tauri >/tmp/tauri_test.log 2>&1 &
TAURI_PID=$!
echo "  GUI进程PID: $TAURI_PID"
sleep 5

echo ""
echo "3. 检查端口状态（应该仍未监听）"
if lsof -i :1081 >/dev/null 2>&1; then
    echo "❌ 错误：端口1081被占用（不应该）"
    lsof -i :1081
else
    echo "✓ 正确：端口1081未监听（符合预期）"
fi

echo ""
echo "4. 测试端口检测功能"
echo "  请在GUI中点击'启动'按钮，然后按回车继续..."
read -r

echo ""
echo "5. 检查端口状态（应该已监听）"
if lsof -i :1081 >/dev/null 2>&1; then
    echo "✓ 成功：端口1081正在监听"
    lsof -i :1081 | head -2
else
    echo "❌ 错误：端口1081未监听"
fi

echo ""
echo "6. 测试重复启动保护"
echo "  再次点击'启动'按钮，应该显示错误提示"
echo "  请在GUI中再次点击'启动'按钮，然后按回车继续..."
read -r

echo ""
echo "7. 清理"
kill $TAURI_PID 2>/dev/null
sleep 2
echo "测试完成"
