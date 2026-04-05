#!/bin/bash

APP_PATH="/Users/doujia/Work/自制FQ工具/socks5-proxy-rust/target/release/bundle/macos/SOCKS5 Proxy.app"

# 停止应用
pkill -f "client-gui-tauri"

# 修改 Info.plist
/usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$APP_PATH/Contents/Info.plist"

# 删除应用缓存
rm -rf ~/Library/Caches/com.socks5proxy.client
rm -rf ~/Library/Application\ Support/com.socks5proxy.client

# 复制到 Applications
rm -rf /Applications/SOCKS5\ Proxy.app
cp -R "$APP_PATH" /Applications/

# 重启 Dock
killall Dock

# 启动应用
sleep 2
open /Applications/SOCKS5\ Proxy.app
