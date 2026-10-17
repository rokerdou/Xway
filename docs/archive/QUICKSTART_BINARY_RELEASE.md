# 快速开始 - 本地构建部署

## 方案选择

✅ **当前已配置**：本地构建 + 独立发布仓库

## 首次部署（5分钟）

### 1️⃣ 本地构建

```bash
cd socks5-proxy-rust
./scripts/build-release.sh
```

### 2️⃣ 初始化发布仓库

```bash
cd ../socks5-proxy-releases

# 添加远端（替换为你的实际地址）
git remote add origin git@github.com:your-username/socks5-proxy-releases.git
git branch -M main

# 推送
git push -u origin main
```

### 3️⃣ 配置 dokploy

在 dokploy 面板：
- 应用名称：`socks5-proxy`
- Git 仓库：`git@github.com:your-username/socks5-proxy-releases.git`
- 分支：`main`
- Docker 构建路径：`/`
- Dockerfile：`Dockerfile`
- 端口：`1080`

点击部署！

## 日常更新（30秒）

修改代码后：

```bash
# 一键发布
./scripts/release.sh "修复了XXX问题"

# 或分步执行
./scripts/build-release.sh
cd ../socks5-proxy-releases
git add . && git commit -m "chore: 更新" && git push
```

dokploy 会自动拉取并部署新版本。

## 文件结构

```
socks5-proxy-rust/              # 源码（开发）
├── scripts/
│   ├── build-release.sh        # 构建脚本
│   └── release.sh              # 一键发布脚本
├── Dockerfile                  # 单阶段（用于发布仓库）
└── Dockerfile.multi-stage      # 多阶段（备份）

socks5-proxy-releases/          # 二进制（部署）
├── server                      # 预编译二进制
├── Dockerfile
├── server.toml
└── README.md
```

## 优势对比

| 操作 | 旧方案（容器内构建） | 新方案（本地构建） |
|------|---------------------|------------------|
| 部署时间 | 5-10 分钟 | 10-30 秒 |
| 服务器负载 | 高（编译） | 低（仅复制） |
| 网络传输 | 源码 | 二进制 |
| 回滚速度 | 慢 | 快 |

## 常见问题

### Q: 如何切换回旧方案？
```bash
# 在源码仓库
mv Dockerfile.multi-stage Dockerfile
# 在 dokploy 中切换回源码仓库
```

### Q: 交叉编译失败？
```bash
# macOS 需要安装交叉编译工具
brew install x86_64-linux-gnu-gcc

# 或者在 Linux 机器上构建
```

### Q: 如何回滚版本？
```bash
cd socks5-proxy-releases
git log --oneline        # 查看历史
git reset --hard HEAD~1  # 回滚
git push --force         # 强制推送
```

## 详细文档

查看完整指南：[BINARY_RELEASE_GUIDE.md](./BINARY_RELEASE_GUIDE.md)
