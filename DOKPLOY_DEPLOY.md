# 🚀 dokploy 部署指南

## 📋 部署架构

```
GitHub → dokploy → Dockerfile → 构建镜像 → 运行容器
```

dokploy 会自动：
1. 从 git 仓库拉取代码
2. 使用根目录的 `Dockerfile` 构建镜像
3. 运行容器

---

## ⚡ 快速部署步骤

### 1. 推送代码到 GitHub

```bash
cd /Users/doujia/Work/自制FQ工具/socks5-proxy-rust

# 提交所有更改
git add .
git commit -m "feat: 添加 Docker 部署配置"

# 推送到 GitHub
git push origin main
```

### 2. 在 dokploy 中配置应用

#### 创建新应用

1. 登录 dokploy 管理界面
2. 点击 **"Create Application"** 或 **"新建应用"**
3. 选择 **"Docker"** 类型

#### 配置 Git 仓库

```
Git 仓库地址: https://github.com/rokerdou/Xway.git
分支: main
```

#### 配置构建选项

```
Dockerfile 路径: Dockerfile (默认)
Docker 上下文: / (根目录)
```

#### 配置端口

```
容器端口: 1080
服务端口: 1080 (或自定义)
```

#### 环境变量（可选）

```
RUST_LOG = info
SERVER_ADDRESS = 0.0.0.0:1080
```

### 3. 部署

点击 **"Deploy"** 或 **"部署"** 按钮。

dokploy 会：
- ✅ 拉取最新代码
- ✅ 构建 Docker 镜像（约 3-5 分钟）
- ✅ 启动容器
- ✅ 健康检查（30秒后开始）

### 4. 验证部署

在 dokploy 中查看：
- 日志输出
- 容器状态
- 健康检查状态

或在终端测试：
```bash
# 测试端口连通性
telnet 你的服务器IP 1080

# 或使用 nc
nc -zv 你的服务器IP 1080
```

---

## 🔧 客户端配置

### 修改配置文件

编辑 `client/config/client.toml`:

```toml
[client]
listen_address = "127.0.0.1:1081"
server_address = "你的dokploy服务器IP:1080"  # 修改为实际服务器地址
```

### 启动客户端

```bash
cd /Users/doujia/Work/自制FQ工具/socks5-proxy-rust

# 开发模式运行
cargo run --release -p client

# 或使用编译好的二进制
./target/release/client
```

### 测试代理

```bash
# 测试 HTTP 请求
curl -x socks5://127.0.0.1:1081 http://www.baidu.com

# 测试 HTTPS 请求
curl -x socks5://127.0.0.1:1081 https://www.baidu.com

# 查看出口 IP
curl -x socks5://127.0.0.1:1081 http://ifconfig.me
```

---

## 📊 监控和日志

### 在 dokploy 中

- **实时日志**: 点击应用的 "Logs" 按钮
- **容器状态**: 查看应用列表中的状态指示
- **资源使用**: 查看 CPU/内存占用

### 关键日志标识

```
✅ 服务端启动成功:
"SOCKS5 server listening on 0.0.0.0:1080"

✅ 客户端连接:
"客户端已连接: {ip}"

✅ 成功解密并连接:
"连接目标成功: {target}"
```

---

## 🔄 更新部署

当代码更新后：

### 方式 1: 自动部署（推荐）

在 dokploy 中配置 **Webhook**：
1. 在 GitHub 仓库设置中添加 webhook
2. URL: `https://your-dokploy-server/api/webhook/{application-id}`
3. 触发事件: `Push` events

### 方式 2: 手动部署

在 dokploy 中点击 **"Redeploy"** 或 **"重新部署"** 按钮。

---

## 🐛 故障排查

### 问题 1: 构建失败

**可能原因**:
- Rust 版本不匹配
- 依赖下载失败
- 内存不足

**解决方案**:
1. 检查 dokploy 构建日志
2. 确认 Dockerfile 中的 Rust 版本（当前 1.75）
3. 增加 dokploy 构建容器的内存限制

### 问题 2: 容器启动失败

**可能原因**:
- 端口冲突
- 权限问题
- 配置错误

**解决方案**:
```bash
# 查看容器日志
docker logs <container-id>

# 检查端口占用
lsof -i :1080
```

### 问题 3: 客户端无法连接

**检查清单**:
- [ ] 服务端容器正在运行
- [ ] 端口 1080 已开放
- [ ] 防火墙允许访问
- [ ] 客户端配置的服务器地址正确

**测试步骤**:
```bash
# 1. 测试服务器端口
telnet 服务器IP 1080

# 2. 查看服务端日志
docker logs -f socks5-server

# 3. 测试客户端
cargo run --release -p client
```

---

## 🔒 安全配置

### 防火墙设置

```bash
# 在 dokploy 服务器上
sudo ufw allow from 你的客户端IP to any port 1080

# 或使用 iptables
sudo iptables -A INPUT -p tcp --dport 1080 -s 你的客户端IP -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 1080 -j DROP
```

### 限制访问

考虑使用以下方式之一：
1. VPN/内网访问
2. IP 白名单
3. 添加认证功能（TODO）

---

## 📝 文件说明

| 文件 | 说明 |
|------|------|
| `Dockerfile` | dokploy 构建镜像的主文件 |
| `.dockerignore` | 排除不需要的文件 |
| `Cargo.toml` | Rust 项目配置 |
| `server/` | 服务端源码 |
| `shared/` | 共享库（加密、协议） |

**不需要的文件**（已排除）:
- `client/` - 客户端代码
- `docker-compose.yml` - 本地开发用
- `*.md` - 文档文件
- `tests/` - 测试代码

---

## 🎯 部署检查清单

- [ ] 代码已推送到 GitHub
- [ ] dokploy 中已创建应用
- [ ] Git 仓库地址配置正确
- [ ] 端口 1080 已映射
- [ ] 环境变量已设置（可选）
- [ ] 构建成功
- [ ] 容器正在运行
- [ ] 健康检查通过
- [ ] 客户端已配置并连接成功
- [ ] 测试请求正常工作

---

## 📞 获取帮助

- **dokploy 文档**: https://dokploy.com/docs
- **项目 README**: [README.md](./README.md)
- **测试指南**: [TESTING_GUIDE.md](./TESTING_GUIDE.md)

---

祝部署顺利！🎉
