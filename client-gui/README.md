# SOCKS5 代理客户端（GUI 版本）

## 功能特点

- ✅ 跨平台：支持 Windows、macOS、Linux
- ✅ 简洁界面：最小化设计，易于使用
- ✅ 系统托盘：最小化到系统托盘，不占用任务栏
- ✅ 流量统计：实时显示上传/下载流量
- ✅ 配置管理：可视化配置远程服务器

## 开发

### 前置要求

- Rust 1.70+
- Node.js 18+
- pnpm（推荐）

### 安装依赖

```bash
cd ui
pnpm install
```

### 开发模式

```bash
cd ui
pnpm run dev
```

然后在新终端运行：

```bash
cd src-tauri
cargo run
```

### 构建发布版本

```bash
cd ui
pnpm run build
cd ..
cargo build --release
```

## 架构说明

```
client-gui/
├── ui/                    # 前端界面（React + Tailwind CSS）
│   ├── src/
│   │   ├── App.jsx        # 主应用组件
│   │   └── main.jsx       # 入口文件
│   ├── package.json
│   └── vite.config.js
│
└── src-tauri/             # Tauri 后端
    ├── src/
    │   └── lib.rs         # Tauri 命令和状态管理
    ├── Cargo.toml
    └── tauri.conf.json
```

## Tauri 命令

- `start_proxy` - 启动代理
- `stop_proxy` - 停止代理
- `get_proxy_status` - 获取代理状态
- `get_traffic_stats` - 获取流量统计
- `update_config` - 更新配置
- `get_config` - 获取配置

## 未来规划

- [ ] iOS 支持（Tauri Mobile）
- [ ] Android 支持（Tauri Mobile）
- [ ] VPN 模式（移动端）
- [ ] 流量图表
- [ ] 连接日志
