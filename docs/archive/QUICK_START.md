# 🚀 快速开始 - dokploy 部署

## 📦 部署流程概览

```
1. 推送代码到 GitHub
2. 在 dokploy 配置应用
3. 自动构建并部署
4. 配置客户端连接
```

---

## ⚡ 3 分钟快速部署

### 步骤 1: 推送代码

```bash
cd /Users/doujia/Work/自制FQ工具/socks5-proxy-rust

git add .
git commit -m "feat: 添加 dokploy 部署配置"
git push origin main
```

### 步骤 2: 在 dokploy 配置

1. **新建应用** → 选择 Docker 类型
2. **Git 配置**: `https://github.com/rokerdou/Xway.git`
3. **端口**: `1080`
4. **点击部署**

### 步骤 3: 配置客户端

编辑 `client/config/client.toml`:

```toml
server_address = "你的dokploy服务器IP:1080"
```

启动并测试:

```bash
cargo run --release -p client
curl -x socks5://127.0.0.1:1081 http://www.baidu.com
```

---

## 📚 详细文档

- 📖 [dokploy 完整部署指南](./DOKPLOY_DEPLOY.md) - 详细步骤和故障排查
- 📖 [通用部署文档](./DEPLOYMENT.md) - 其他部署方式
- 📖 [测试指南](./TESTING_GUIDE.md) - 代理配置和测试方法

---

## 📁 项目结构

```
socks5-proxy-rust/
├── Dockerfile              # dokploy 构建用
├── .dockerignore           # Docker 构建忽略
├── Cargo.toml              # Rust 配置
├── server/                 # 服务端源码
│   ├── src/
│   └── config/
├── client/                 # 客户端源码
│   ├── src/
│   └── config/
└── shared/                 # 共享库
    ├── src/
    │   ├── crypto.rs       # King 加密
    │   └── protocol.rs     # SOCKS5 协议
    └── src/
        └── king_maps.rs    # 加密映射表
```

---

## ✅ 验证部署成功

```bash
# 服务端（dokploy）应该看到:
✅ 容器状态: Running
✅ 健康检查: Healthy
✅ 日志: "SOCKS5 server listening on 0.0.0.0:1080"

# 客户端应该看到:
✅ 连接成功: "已连接到远程服务器"
✅ 加密正常: 日志显示加密流量

# 测试应该成功:
✅ curl -x socks5://127.0.0.1:1081 http://www.baidu.com
```
