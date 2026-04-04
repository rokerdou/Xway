# GUI 客户端使用指南

## ✅ 已完成

### 1. 核心库（client-core）
- ✅ 平台无关的代理核心逻辑
- ✅ 配置管理（自动保存到系统配置目录）
- ✅ 状态管理和流量统计
- ✅ 平台抽象（为移动端预留接口）

### 2. Tauri GUI 应用
- ✅ 编译成功（无错误）
- ✅ 系统托盘支持（基础版本）
- ✅ 简洁 UI 框架
- ✅ 所有必需的图标文件

### 3. 图标文件
```
client-gui/src-tauri/icons/
├── 32x32.png         ✅
├── 128x128.png       ✅
├── 128x128@2x.png    ✅
├── 256x256.png       ✅
├── icon.icns         ✅ (macOS)
├── icon.ico          ✅ (Windows)
└── icon.svg          ✅ (源文件)
```

## 🚀 如何运行

### 方式 1：开发模式（推荐用于测试 UI）

**步骤 1：安装前端依赖**
```bash
cd client-gui/ui
npm install  # 或 pnpm install
```

**步骤 2：启动前端开发服务器**
```bash
cd ui
npm run dev
```
前端将在 http://localhost:1420 运行

**步骤 3：启动 Tauri 应用（新终端）**
```bash
cd client-gui/src-tauri
cargo run
```

### 方式 2：构建前端后运行

**步骤 1：构建前端**
```bash
cd client-gui/ui
npm install
npm run build
```

**步骤 2：运行应用**
```bash
cd client-gui/src-tauri
cargo run
```

## 📋 当前功能状态

### ✅ 已实现
- [x] 启动/停止代理
- [x] 实时状态显示
- [x] 配置保存和加载
- [x] 流量统计
- [x] 系统托盘图标
- [x] 跨平台编译（macOS）

### ⏳ 待完善
- [ ] 托盘菜单（需要进一步研究 Tauri 2.0 API）
- [ ] 托盘图标事件处理
- [ ] 前端完整构建
- [ ] 开机自启动
- [ ] Windows 和 Linux 测试

## 🎨 UI 预览

主界面包含：
1. **状态指示器**：绿色圆点 = 运行中，红色圆点 = 已停止
2. **启动/停止按钮**：一键控制代理
3. **配置面板**：服务器地址和端口
4. **流量统计**：上传、下载、连接数

界面尺寸：400x300 像素（固定）
主题：深色（Gray-900）

## ⚙️ 配置文件位置

- **macOS**: `~/Library/Application Support/socks5-proxy/client.toml`
- **Windows**: `%APPDATA%\socks5-proxy\client.toml`
- **Linux**: `~/.config/socks5-proxy/client.toml`

## 🔧 开发注意事项

### Tauri 2.0 API 变化
当前使用的是 Tauri 2.0，与 1.x 有较大差异：
- 菜单 API 已改变
- 窗口 API 已改变
- 托盘 API 需要进一步研究

### 编译选项
```bash
# 只编译 Rust 后端（快速测试）
cargo build -p client-gui-tauri

# 完整编译（包含前端）
cd client-gui && npm run build && cargo build

# 发布版本
cargo build --release
```

## 🐛 已知问题

1. **托盘菜单**：Tauri 2.0 的菜单 API 与文档不完全一致，暂时移除菜单功能
2. **前端构建**：前端需要进一步配置才能完整运行
3. **事件处理**：托盘图标点击事件未完全实现

## 📝 下一步工作

### 立即（必要）
1. 完善前端构建配置
2. 测试完整应用流程
3. 添加更多错误处理

### 短期（增强）
1. 实现托盘菜单
2. 添加系统通知
3. 完善状态持久化

### 长期（扩展）
1. iOS 支持（等待 Tauri Mobile）
2. Android 支持（等待 Tauri Mobile）
3. VPN 模式（移动端）

## 🎯 代码架构亮点

```
用户界面（React + Tailwind）
    ↓ Tauri Commands
业务逻辑（client-core）
    ↓ 平台抽象
底层实现（Shared）
```

**优势**：
- 代码分层清晰
- 核心逻辑可复用（CLI + GUI）
- 平台差异隔离
- 易于扩展到移动端

---

**创建时间**：2026-04-04
**编译状态**：✅ 成功
**测试状态**：⏳ 待测试
