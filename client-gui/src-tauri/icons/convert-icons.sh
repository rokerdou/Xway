#!/bin/bash
# SVG 转 PNG 图标转换脚本
# 用于生成不同尺寸的透明背景图标

set -e  # 遇到错误立即退出

ICONS_DIR="/Users/doujia/Work/自制FQ工具/socks5-proxy-rust/client-gui/src-tauri/icons"
cd "$ICONS_DIR"

echo "🔄 开始转换 SVG 到 PNG..."
echo ""

# 检查 ImageMagick 是否安装
if ! command -v convert &> /dev/null; then
    echo "❌ 错误: ImageMagick 未安装"
    echo ""
    echo "请先安装 ImageMagick:"
    echo "  brew install imagemagick"
    echo ""
    exit 1
fi

# 检查 icon.svg 是否存在
if [ ! -f "icon.svg" ]; then
    echo "❌ 错误: 找不到 icon.svg 文件"
    exit 1
fi

# 转换各种尺寸的图标
echo "📦 生成图标..."

# 32x32 - 托盘图标
convert -background none -density 300 icon.svg -resize 32x32 32x32.png
echo "  ✅ 32x32.png (托盘图标)"

# 64x64 - macOS 托盘图标 (2x)
convert -background none -density 300 icon.svg -resize 64x64 icon@2xTemplate.png
echo "  ✅ icon@2xTemplate.png (macOS 托盘 2x)"

# 128x128 - 应用图标
convert -background none -density 300 icon.svg -resize 128x128 128x128.png
echo "  ✅ 128x128.png (应用图标)"

# 256x256 - 大图标
convert -background none -density 300 icon.svg -resize 256x256 256x256.png
echo "  ✅ 256x256.png (大图标)"

# 512x512 - 超大图标
convert -background none -density 300 icon.svg -resize 512x512 512x512.png
echo "  ✅ 512x512.png (超大图标)"

# 128x128@2x - macOS Retina 图标
convert -background none -density 300 icon.svg -resize 256x256 128x128@2x.png
echo "  ✅ 128x128@2x.png (macOS Retina)"

echo ""
echo "🎉 图标转换完成！"
echo ""
echo "📂 生成的文件:"
ls -lh *.png | awk '{print "  " $9 " (" $5 ")"}'
