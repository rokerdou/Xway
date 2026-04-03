# SOCKS5 代理系统 (Rust 版本)

基于 Java 版本重新实现的 SOCKS5 代理系统，使用 Rust 和 Tokio 异步框架。

## 项目结构

```
socks5-proxy-rust/
├── Cargo.toml          # Workspace 配置
├── server/             # 服务端
├── client/             # 客户端 (Tauri)
├── shared/             # 共享库
└── tests/              # 集成测试
```

## 技术栈

- **异步运行时**: Tokio 1.35
- **网络库**: Tokio + tokio-util
- **GUI框架**: Tauri 2.x
- **加密**: 自定义 King 算法 + AES-GCM
- **日志**: Tracing
- **配置**: TOML

## 开发阶段

### 阶段 1: 基础架构 + SOCKS5 协议 (进行中)
- [x] 项目结构初始化
- [ ] SOCKS5 协议实现
- [ ] 服务端基础框架
- [ ] 数据转发功能

### 阶段 2: 自定义加密和协议
- [ ] King 加密算法移植
- [ ] 自定义协议编解码器
- [ ] 互操作性测试

### 阶段 3: 客户端和 GUI
- [ ] Tauri 项目搭建
- [ ] 客户端代理功能
- [ ] GUI 界面

### 阶段 4: 高级功能
- [ ] 认证功能
- [ ] 流量统计
- [ ] 性能优化

### 阶段 5: 测试和文档
- [ ] 单元测试
- [ ] 集成测试
- [ ] 文档完善

## 构建和运行

### 服务端

```bash
cd server
cargo run --release
```

### 客户端

```bash
cd client
cargo tauri dev
```

## 许可证

MIT
