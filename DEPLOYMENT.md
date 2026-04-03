# 🚀 SOCKS5 代理服务端部署指南

本指南介绍如何将服务端部署到 **dokploy** 或其他 Docker 环境。

---

## 📦 部署方式

### 方式 1: 使用 Docker 镜像（推荐用于 dokploy）

#### 步骤 1: 构建 Docker 镜像

在本地构建镜像：

```bash
# 给脚本添加执行权限
chmod +x docker-build.sh

# 构建镜像（本地）
./docker-build.sh

# 构建并推送到 Docker Hub（需要先登录）
docker login
PUSH=true ./docker-build.sh

# 使用自定义标签
IMAGE_TAG=v1.0.0 PUSH=true ./docker-build.sh
```

#### 步骤 2: 在 dokploy 中部署

1. **登录 dokploy 管理界面**

2. **创建新应用**
   - 选择 "Docker" 类型
   - 应用名称: `socks5-server`

3. **配置镜像**
   ```
   镜像地址: docker.io/你的用户名/socks5-proxy-server:latest
   或使用本地构建的镜像: socks5-proxy-server:latest
   ```

4. **配置端口**
   ```
   容器端口: 1080
   主机端口: 1080 (或自定义)
   ```

5. **环境变量**（可选）
   ```
   RUST_LOG=info
   SERVER_ADDRESS=0.0.0.0:1080
   ```

6. **部署**

7. **验证**
   ```bash
   # 在 dokploy 服务器上测试
   telnet localhost 1080
   # 或
   nc -zv localhost 1080
   ```

---

### 方式 2: 直接部署二进制文件

#### 步骤 1: 编译二进制文件

```bash
# 进入项目目录
cd /Users/doujia/Work/自制FQ工具/socks5-proxy-rust

# 编译 release 版本
cargo build --release -p server

# 二进制文件位置
ls -lh target/release/server
```

#### 步骤 2: 上传到服务器

```bash
# 使用 scp 上传
scp target/release/server user@your-server:/opt/socks5-server/

# 或使用 rsync
rsync -avz target/release/server user@your-server:/opt/socks5-server/
```

#### 步骤 3: 在服务器上配置

```bash
# SSH 登录服务器
ssh user@your-server

# 创建专用用户
sudo useradd -r -s /bin/false socks5

# 移动文件到合适位置
sudo mv /opt/socks5-server/server /usr/local/bin/socks5-server
sudo chmod +x /usr/local/bin/socks5-server
sudo chown socks5:socks5 /usr/local/bin/socks5-server

# 创建 systemd 服务文件
sudo tee /etc/systemd/system/socks5-server.service > /dev/null <<EOF
[Unit]
Description=SOCKS5 Proxy Server
After=network.target

[Service]
Type=simple
User=socks5
Group=socks5
ExecStart=/usr/local/bin/socks5-server
Restart=always
RestartSec=5
Environment=RUST_LOG=info

# 安全设置
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/socks5

[Install]
WantedBy=multi-user.target
EOF

# 创建日志目录
sudo mkdir -p /var/log/socks5
sudo chown socks5:socks5 /var/log/socks5

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable socks5-server
sudo systemctl start socks5-server

# 查看状态
sudo systemctl status socks5-server

# 查看日志
sudo journalctl -u socks5-server -f
```

#### 步骤 4: 配置防火墙

```bash
# 如果使用 ufw
sudo ufw allow 1080/tcp

# 如果使用 firewalld
sudo firewall-cmd --permanent --add-port=1080/tcp
sudo firewall-cmd --reload

# 如果使用 iptables
sudo iptables -A INPUT -p tcp --dport 1080 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

---

### 方式 3: 使用 Docker Compose（本地测试）

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down

# 重新构建
docker-compose up -d --build
```

---

## 🔧 客户端配置

部署服务端后，需要修改客户端配置连接到远程服务器。

### 修改客户端配置

编辑 `client/config/client.toml`:

```toml
[client]
listen_address = "127.0.0.1:1081"
server_address = "你的服务器IP:1080"  # 修改为远程服务器地址

[logging]
level = "info"
```

### 启动客户端

```bash
# 方式 1: 直接运行
cargo run --release -p client

# 方式 2: 后台运行
nohup cargo run --release -p client > /tmp/client.log 2>&1 &

# 方式 3: 使用编译好的二进制
./target/release/client
```

### 测试连接

```bash
# 测试 SOCKS5 代理
curl -x socks5://127.0.0.1:1081 http://www.baidu.com

# 查看 IP 地址（应该显示服务器出口 IP）
curl -x socks5://127.0.0.1:1081 http://ifconfig.me
```

---

## 🔒 安全建议

1. **使用防火墙限制访问**
   ```bash
   # 只允许特定 IP 访问
   sudo iptables -A INPUT -p tcp --dport 1080 -s 允许的IP地址 -j ACCEPT
   sudo iptables -A INPUT -p tcp --dport 1080 -j DROP
   ```

2. **启用认证**（未来版本将支持用户名/密码认证）

3. **使用 TLS/SSL**（未来版本将支持）

4. **定期更新**
   ```bash
   # 更新镜像
   docker pull your-registry/socks5-proxy-server:latest
   # 重新部署
   ```

5. **监控日志**
   ```bash
   # Docker 部署
   docker logs -f socks5-server

   # 二进制部署
   sudo journalctl -u socks5-server -f
   ```

---

## 📊 性能优化

### 调整系统参数

```bash
# 增加文件描述符限制
sudo tee -a /etc/sysctl.conf > /dev/null <<EOF
fs.file-max = 100000
net.ipv4.tcp_max_syn_backlog = 8192
net.core.somaxconn = 1024
EOF

sudo sysctl -p

# 在 systemd 服务中添加限制
sudo tee /etc/systemd/system/socks5-server.service > /dev/null <<EOF
[Service]
...
LimitNOFILE=65536
EOF
```

---

## 🐛 故障排查

### 服务无法启动

```bash
# 检查端口占用
sudo lsof -i :1080
sudo netstat -tulpn | grep 1080

# 检查日志
sudo journalctl -u socks5-server -n 50
docker logs socks5-server
```

### 连接被拒绝

1. 检查防火墙设置
2. 确认服务端正在运行
3. 验证服务器地址和端口正确

### 性能问题

1. 检查系统资源: `htop`
2. 查看连接数: `ss -s`
3. 查看日志中的错误信息

---

## 📝 维护命令

```bash
# 重启服务
sudo systemctl restart socks5-server
docker-compose restart

# 查看版本
/usr/local/bin/socks5-server --version

# 备份配置
cp /etc/socks5-server/config.toml ~/socks5-backup-$(date +%Y%m%d).toml

# 更新服务
# 停止服务 -> 替换二进制 -> 启动服务
sudo systemctl stop socks5-server
sudo cp new-server /usr/local/bin/socks5-server
sudo systemctl start socks5-server
```

---

## 🎯 下一步

1. ✅ 部署服务端到 dokploy
2. ✅ 配置客户端连接到远程服务端
3. ✅ 测试完整链路
4. ✅ 配置监控和日志
5. 🔄 添加认证功能（TODO）
6. 🔄 添加流量统计面板（TODO）

---

如有问题，请查看日志文件或提交 Issue。
