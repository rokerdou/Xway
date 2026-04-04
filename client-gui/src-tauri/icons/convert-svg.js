const sharp = require('sharp');
const fs = require('fs');
const svg = fs.readFileSync('icon.svg', 'utf-8');

// 需要生成的尺寸
const sizes = [
  { size: 32, name: '32x32.png' },
  { size: 128, name: '128x128.png' },
  { size: 256, name: '256x256.png' },
  { size: 512, name: '512x512.png' },
  { size: 32, name: 'icon@2xTemplate.png', template: true }, // macOS 托盘图标
];

async function convert() {
  for (const { size, name, template } of sizes) {
    // 使用 sharp 转换 SVG 到 PNG
    const buffer = Buffer.from(svg);
    await sharp(buffer, { density: 300 })
      .resize(size, size)
      .png()
      .toFile(name);
    
    console.log(`✅ Generated ${name} (${size}x${size})`);
  }
  
  console.log('🎉 All icons generated!');
}

convert().catch(console.error);
