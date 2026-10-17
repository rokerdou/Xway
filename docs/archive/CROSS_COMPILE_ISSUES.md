# 交叉编译问题解决方案

## 问题：macOS 交叉编译失败

```
error: linking with `cc` failed: exit status: 1
ld: unknown option: --as-needed
```

**原因**：macOS 的 linker 不支持 Linux 的链接选项

---

## 解决方案（选择其一）

### ✅ 方案 1：使用 Docker 编译（推荐）

在 Docker 容器内编译，确保完全兼容 Linux：

```bash
# 创建 Docker 编译脚本
cat > scripts/build-in-docker.sh << 'EOF'
#!/bin/bash
docker run --rm -v "$(pwd)":/app -w /app \
  rust:latest \
  bash -c "cargo build --release -p server && cp target/release/server ../socks5-proxy-releases/"
EOF

chmod +x scripts/build-in-docker.sh
```

使用：
```bash
./scripts/build-in-docker.sh
```

---

### ✅ 方案 2：使用 Linux 机器

如果你有 Linux 服务器或 VPS：

```bash
# 在 Linux 机器上
git clone <your-repo>
cd socks5-proxy-rust
./scripts/build-release.sh
```

---

### ✅ 方案 3：使用 GitHub Actions（最佳）

让 GitHub 自动编译并发布到发布仓库：

创建 `.github/workflows/release.yml`：

```yaml
name: Build and Release

on:
  push:
    branches: [ main ]
    paths:
      - 'server/**'
      - 'shared/**'
      - 'Cargo.toml'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Install Rust
        uses: actions-rust-lang/setup-rust-toolchain@v1

      - name: Build server
        run: cargo build --release -p server

      - name: Copy to releases repo
        run: |
          git clone https://github.com/${{ github.repository_owner }}/socks5-proxy-releases.git
          cp target/release/server socks5-proxy-releases/
          cd socks5-proxy-releases
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add .
          git commit -m "chore: 自动构建 - $(date +%Y-%m-%d)" || echo "No changes"
          git push
```

---

### ✅ 方案 4：安装正确的交叉编译工具

```bash
# macOS 上安装 Linux 工具链
brew install x86_64-linux-gnu-gcc

# 配置 Rust 使用正确的 linker
mkdir -p ~/.cargo
cat >> ~/.cargo/config.toml << EOF

[target.x86_64-unknown-linux-gnu]
linker = "x86_64-linux-gnu-gcc"
ar = "x86_64-linux-gnu-gcc-ar"
EOF
```

---

## 快速修复（临时）

如果你只是想测试部署流程，可以暂时使用多阶段构建：

```bash
# 切换回容器内构建
mv Dockerfile.multi-stage Dockerfile
mv Dockerfile Dockerfile.binary

# 在 dokploy 中使用源码仓库
```

---

## 推荐配置

根据你的情况选择：

| 场景 | 推荐方案 |
|------|---------|
| **有 Docker** | 方案 1（Docker 编译） |
| **有 Linux 服务器** | 方案 2（Linux 编译） |
| **希望自动化** | 方案 3（GitHub Actions） |
| **偶尔部署** | 使用容器内构建（原方案） |

需要我帮你配置哪个方案？
