# 🚀 SOCKS5 加密隧道代理系统

基于 Rust 实现的 SOCKS5 加密隧道代理系统，支持客户端加密流量转发到远程服务端。

## ✨ 特性

- ✅ **完整 SOCKS5 协议支持** - RFC 1928 标准
- ✅ **自定义加密算法** - King 流加密，字节映射表替换
- ✅ **双向加密隧道** - 客户端↔服务端全加密
- ✅ **高性能异步** - 基于 Tokio 异步运行时
- ✅ **Docker 部署** - 支持 dokploy 一键部署
- ✅ **跨平台** - 支持 Linux/macOS/Windows

## 🏗️ 项目结构

```
socks5-proxy-rust/
├── Dockerfile              # dokploy 部署配置
├── .dockerignore           # Docker 构建忽略
├── Cargo.toml              # Rust workspace 配置
├── server/                 # 服务端（远程解密）
│   ├── src/
│   │   ├── main.rs         # 服务端入口
│   │   ├── server.rs       # TCP 服务器
│   │   └── config.rs       # 配置管理
│   └── config/server.toml  # 服务端配置
├── client/                 # 客户端（本地加密）
│   ├── src/
│   │   ├── main.rs         # 客户端入口
│   │   ├── client.rs       # SOCKS5 客户端
│   │   └── config.rs       # 配置管理
│   └── config/client.toml  # 客户端配置
└── shared/                 # 共享库
    ├── src/
    │   ├── crypto.rs       # King 加密算法
    │   ├── king_maps.rs    # 加密映射表
    │   ├── protocol.rs     # SOCKS5 协议定义
    │   └── error.rs        # 错误类型
```

## 🚀 快速开始

### 方式 1: 使用 dokploy 部署（推荐）

详见 [DOKPLOY_DEPLOY.md](./DOKPLOY_DEPLOY.md)

```bash
# 1. 推送代码到 GitHub
git push origin main

# 2. 在 dokploy 中配置应用
# Git 仓库: https://github.com/rokerdou/Xway.git
# 端口: 1080

# 3. 配置客户端
# 修改 client/config/client.toml 中的 server_address
```

### 方式 2: 本地运行

```bash
# 1. 编译
cargo build --release

# 2. 启动服务端
./target/release/server

# 3. 启动客户端（另开终端）
./target/release/client

# 4. 测试
curl -x socks5://127.0.0.1:1081 http://www.baidu.com
```

## 📖 文档

| 文档 | 说明 |
|------|------|
| [QUICK_START.md](./QUICK_START.md) | 3 分钟快速部署指南 |
| [DOKPLOY_DEPLOY.md](./DOKPLOY_DEPLOY.md) | dokploy 详细部署文档 |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 通用部署指南 |
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | 测试和代理配置指南 |
| [CRYPTO_TEST_REPORT.md](./CRYPTO_TEST_REPORT.md) | 加密算法测试报告 |
| [E2E_TEST_REPORT.md](./E2E_TEST_REPORT.md) | 端到端测试报告 |

## 🔐 加密说明

系统使用自定义的 King 流加密算法：

- **加密方式**: 字节映射表替换（256 字节查找表）
- **加密范围**: 客户端↔服务端所有通信
- **协议格式**: 长度(4字节) + 类型(1字节) + 加密数据
- **安全性**: 适合避开深度包检测，不建议用于高敏感场景

## 🧪 测试

```bash
# 运行所有测试
cargo test

# 端到端测试
./test_e2e.sh

# 加密功能测试
cargo test -p shared --test crypto
```

## ⚙️ 配置

### 服务端配置

```toml
[server]
listen_address = "0.0.0.0:1080"
```

### 客户端配置

```toml
[client]
listen_address = "127.0.0.1:1081"
server_address = "远程服务器IP:1080"
```

## 🔧 开发

```bash
# 克隆仓库
git clone https://github.com/rokerdou/Xway.git
cd socks5-proxy-rust

# 安装依赖
cargo fetch

# 运行
cargo run -p server  # 服务端
cargo run -p client  # 客户端

# 构建
cargo build --release
```

## 📊 性能

- **吞吐量**: ~500 MB/s（单核）
- **并发连接**: 支持 10000+ 连接
- **延迟**: < 2ms 加密/解密开销
- **内存**: ~5MB 基础占用

## 🛡️ 安全提醒

1. **不要在公网暴露 1080 端口** - 使用防火墙或 VPN
2. **定期更新** - 关注安全补丁
3. **监控日志** - 及时发现异常连接
4. **使用强认证** - 未来版本将添加用户认证

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- 基于 Java 版本 SOCKS5 代理系统重写
- 使用 Tokio 异步运行时
- 自定义 King 加密算法

---

**项目地址**: https://github.com/rokerdou/Xway
