# 本地构建 + 独立发布仓库部署指南

## 架构说明

```
socks5-proxy-rust/          # 源码仓库（你的开发目录）
  └── scripts/build-release.sh

socks5-proxy-releases/      # 二进制发布仓库（自动创建）
  ├── server                # 预编译的 Linux 二进制
  ├── Dockerfile            # 单阶段部署配置
  ├── server.toml           # 服务端配置文件
  └── README.md             # 说明文档
```

## 优势

| 特性 | 说明 |
|------|------|
| **快速部署** | 容器构建只需几秒（无需编译） |
| **仓库分离** | 源码和二进制分开管理 |
| **版本追踪** | 每次发布都有 Git 记录 |
| **跨平台** | macOS 上交叉编译为 Linux 二进制 |

## 首次使用

### 1. 构建并发布

```bash
# 在源码仓库执行
cd socks5-proxy-rust
./scripts/build-release.sh
```

脚本会自动：
1. 交叉编译为 Linux 二进制（如果在 macOS 上）
2. 创建 `../socks5-proxy-releases/` 发布仓库
3. 复制二进制、Dockerfile、配置文件到发布仓库

### 2. 初始化发布仓库

```bash
cd ../socks5-proxy-releases

# 如果是新仓库，需要先提交
git add .
git commit -m "chore: 初始化二进制发布仓库"

# 添加远端仓库（替换为你的实际地址）
git remote add origin git@github.com:your-username/socks5-proxy-releases.git

# 推送到远端
git push -u origin main
```

### 3. 配置 dokploy

在 dokploy 中：
1. 创建新应用
2. Git 仓库填写：`git@github.com:your-username/socks5-proxy-releases.git`
3. 分支：`main`
4. Docker 构建路径：`/`（根目录）
5. Dockerfile 名称：`Dockerfile`

## 日常使用流程

### 修改代码后重新部署

```bash
# 1. 修改代码
# ... 编辑代码 ...

# 2. 本地测试（可选）
cargo test
cargo run --bin server

# 3. 构建并发布
cd socks5-proxy-rust
./scripts/build-release.sh

# 4. 提交到发布仓库
cd ../socks5-proxy-releases
git add .
git commit -m "chore: 更新服务端二进制 - <填写变更说明>"
git push

# 5. dokploy 自动拉取并部署
```

## 构建脚本功能

`scripts/build-release.sh` 支持以下功能：

### 自动检测平台

- **macOS**：自动启用交叉编译，生成 Linux 二进制
- **Linux**：使用原生编译

### 输出信息

```bash
$ ./scripts/build-release.sh

========================================
  SOCKS5 代理服务端 - Linux 构建
========================================
当前操作系统: Darwin
检测到 macOS，启用交叉编译模式
目标平台: x86_64-unknown-linux-gnu
检查交叉编译目标...
✓ 交叉编译目标已安装
清理之前的构建产物...
开始编译 server...
✓ 编译成功！
二进制文件: target/x86_64-unknown-linux-gnu/release/server
文件大小: 4.2M

========================================
准备发布到独立仓库
✓ 发布仓库已存在
复制二进制文件到发布仓库...
✓ 文件已复制到发布仓库
发布仓库路径: ../socks5-proxy-releases

========================================
发布仓库 Git 状态:
M server

========================================
构建和发布准备完成！
二进制大小: 4.2M
下一步操作:
  1. 查看变更: cd ../socks5-proxy-releases && git diff
  2. 提交变更: cd ../socks5-proxy-releases && git add . && git commit -m 'chore: 更新服务端二进制'
  3. 推送到远端: cd ../socks5-proxy-releases && git push
========================================
```

## 文件说明

### 源码仓库（socks5-proxy-rust）

```
socks5-proxy-rust/
├── scripts/
│   └── build-release.sh    # 构建脚本
├── Dockerfile              # 单阶段 Dockerfile（用于发布仓库）
├── Dockerfile.multi-stage  # 多阶段 Dockerfile（备份，可用于 CI/CD）
└── ...
```

### 发布仓库（socks5-proxy-releases）

```
socks5-proxy-releases/
├── server                  # Linux 预编译二进制
├── Dockerfile              # 单阶段部署配置
├── server.toml             # 服务端配置文件
├── README.md               # 说明文档
└── .gitignore              # 不忽略任何文件
```

## Dockerfile 对比

### 当前使用（单阶段）

```dockerfile
FROM debian:bookworm-slim
COPY server /app/server
COPY server.toml /app/server.toml
# ... 运行配置
```

**优点**：
- 构建速度极快（几秒）
- 镜像小（~100MB）

### 备份方案（多阶段）

```dockerfile
FROM rust:latest AS builder
# ... 编译 ...

FROM debian:bookworm-slim
COPY --from=builder /build/target/release/server /app/server
# ... 运行配置
```

**用途**：CI/CD 环境或需要自动编译的场景

## 故障排查

### 问题 1：交叉编译失败

```bash
error: linker 'aarch64-linux-gnu-gcc' not found
```

**解决方案**：

```bash
# macOS: 安装交叉编译工具链
brew install x86_64-linux-gnu-gcc

# 或者在 Linux 环境中编译（使用 GitHub Actions、Docker 等）
```

### 问题 2：二进制文件无法执行

```bash
standard_init_linux.go:228: exec user process caused: exec format error
```

**原因**：平台不匹配（例如在 M1 Mac 上编译了 ARM 版本）

**解决方案**：确保使用 `x86_64-unknown-linux-gnu` 目标

### 问题 3：发布仓库推送失败

```bash
error: failed to push some refs
```

**解决方案**：

```bash
cd ../socks5-proxy-releases
git pull --rebase
git push
```

## 高级用法

### 添加多平台支持

修改 `scripts/build-release.sh`：

```bash
# 构建 AMD64
cargo build --release -p server --target x86_64-unknown-linux-gnu

# 构建 ARM64
cargo build --release -p server --target aarch64-unknown-linux-gnu
```

### 自动化脚本

创建 `scripts/release.sh`：

```bash
#!/bin/bash
# 完整的发布流程

set -e

echo "1. 构建二进制..."
./scripts/build-release.sh

echo "2. 提交到发布仓库..."
cd ../socks5-proxy-releases
git add .
git commit -m "chore: 更新服务端二进制 - $(date +%Y-%m-%d)"
git push

echo "✓ 发布完成！"
```

## 回滚方案

如果新版本有问题，可以快速回滚：

```bash
cd ../socks5-proxy-releases

# 查看历史版本
git log --oneline

# 回滚到上一个版本
git reset --hard HEAD~1
git push --force
```

dokploy 会自动拉取旧版本并重新部署。

## 总结

✅ **推荐使用此方案**，如果你：
- 频繁部署（每天多次）
- 想要快速迭代
- 单人开发者或小团队

❌ **不推荐此方案**，如果你：
- 多人协作开发（推荐使用容器内构建）
- 需要 CI/CD 自动化（推荐使用 GitHub Actions + 多阶段构建）
