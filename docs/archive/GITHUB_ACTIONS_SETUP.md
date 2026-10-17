# GitHub Actions 自动构建配置指南

## 🎯 功能说明

当你在源码仓库修改代码并推送后，GitHub Actions 会自动：
1. ✅ 在 Linux 环境编译 server 二进制
2. ✅ 运行测试
3. ✅ 推送二进制到发布仓库
4. ✅ dokploy 自动拉取并部署

**整个流程完全自动化！**

---

## 📋 配置步骤（5 分钟）

### 步骤 1: 创建发布仓库

在 GitHub 上创建新的仓库 `socks5-proxy-releases`：

```bash
# 在 GitHub 上创建空仓库后，初始化本地
cd ..
git clone git@github.com:your-username/socks5-proxy-releases.git
cd socks5-proxy-releases

# 创建初始 README
echo "# SOCKS5 代理服务端 - 二进制发布仓库" > README.md
git add .
git commit -m "Initial commit"
git push -u origin main
```

---

### 步骤 2: 创建 Personal Access Token

#### 2.1 访问 GitHub Token 设置

访问：https://github.com/settings/tokens

#### 2.2 生成新 Token

1. 点击 **"Generate new token"** → **"Generate new token (classic)"**
2. 设置名称：`socks5-releases-deploy`
3. 设置过期时间：建议选择 `No expiration` 或较长的时间
4. 勾选权限：
   - ✅ `repo` (Full control of private repositories)
   - ✅ `workflow` (Update GitHub Action workflows)

5. 点击 **"Generate token"**
6. **重要**：复制生成的 token（只显示一次！）

```
ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### 步骤 3: 在源码仓库配置 Secret

#### 3.1 访问仓库设置

在你的源码仓库（`socks5-proxy-rust`）中：

1. 进入 **Settings** → **Secrets and variables** → **Actions**
2. 点击 **"New repository secret"**

#### 3.2 添加 Secret

- **Name**: `RELEASES_TOKEN`
- **Value**: 粘贴刚才复制的 Personal Access Token
- 点击 **"Add secret"**

✅ 现在你应该看到 `RELEASES_TOKEN` 在 secrets 列表中

---

### 步骤 4: 验证工作流

#### 4.1 手动触发工作流

1. 访问源码仓库的 **Actions** 页面
2. 选择 **"Build and Release Server Binary"** 工作流
3. 点击 **"Run workflow"**
4. 选择分支（通常是 `main`）
5. 点击 **"Run workflow"** 按钮

#### 4.2 查看执行日志

等待几分钟，工作流会执行以下步骤：
- 📥 Checkout 源码
- 🦀 安装 Rust
- 🔨 编译 server
- 🧪 运行测试
- 📦 克隆发布仓库
- 🚀 推送二进制

---

### 步骤 5: 配置 dokploy

在 dokploy 中：

1. 创建新应用：`socks5-proxy`
2. Git 仓库：`git@github.com:your-username/socks5-proxy-releases.git`
3. 分支：`main`
4. Docker 构建路径：`/`
5. Dockerfile：`Dockerfile`
6. 端口：`1080`

点击部署！🎉

---

## 🚀 日常使用

### 修改代码后的流程

```bash
# 1. 修改代码
# ... 编辑代码 ...

# 2. 本地测试（可选）
cargo test

# 3. 推送到源码仓库
git add .
git commit -m "fix: 修复了XXX问题"
git push

# ✅ GitHub Actions 自动：
#    - 编译二进制
#    - 推送到发布仓库
#    - dokploy 自动部署
```

### 查看部署状态

1. **GitHub Actions**: 查看构建状态
2. **发布仓库**: 查看是否有新提交
3. **dokploy 面板**: 查看部署进度

---

## 🔄 工作流触发条件

### 自动触发

当以下文件有变更时自动触发：
- `server/**` - 服务端代码
- `shared/**` - 共享代码
- `Cargo.toml` - 依赖配置
- `Cargo.lock` - 依赖锁定
- `.github/workflows/release.yml` - 工作流本身

### 手动触发

在 Actions 页面点击 **"Run workflow"** 按钮

---

## 🛡️ 安全说明

### Token 权限

创建的 Token 需要：
- `repo` - 读写发布仓库
- `workflow` - 更新 Actions

### 安全建议

1. ✅ Token 设置为 **Repository only**（不要用 Fine-grained）
2. ✅ 定期轮换 Token
3. ✅ 如果 Token 泄露，立即撤销并重新生成

---

## 📊 构建缓存

工作流会缓存以下内容以加速构建：

| 缓存项 | 路径 | 说明 |
|--------|------|------|
| Cargo Registry | `~/.cargo/registry` | crates.io 依赖 |
| Cargo Index | `~/.cargo/git` | Git 依赖索引 |
| Build Cache | `target/` | 编译产物 |

首次构建约 5 分钟，后续约 1-2 分钟。

---

## 🐛 故障排查

### 问题 1: 工作流失败 - 权限不足

```
Error: fatal: could not read Username for 'https://github.com'
```

**解决方案**：
1. 检查 Secret `RELEASES_TOKEN` 是否正确
2. 检查 Token 是否有 `repo` 权限
3. 检查发布仓库是否已创建

---

### 问题 2: 发布仓库不存在

```
Error: Repository not found
```

**解决方案**：
1. 在 GitHub 上创建 `socks5-proxy-releases` 仓库
2. 确保仓库名称完全匹配（包括用户名）

---

### 问题 3: 编译失败

```
Error: build failed
```

**解决方案**：
1. 在本地运行 `cargo build --release -p server` 确认能编译通过
2. 检查是否有语法错误
3. 查看 Actions 日志中的详细错误信息

---

### 问题 4: 测试失败

```
Error: test failed
```

**解决方案**：
1. 在本地运行 `cargo test` 确认测试通过
2. 或者临时禁用测试步骤（编辑 `.github/workflows/release.yml`）

---

## 📈 监控和通知

### 构建徽章

在 README.md 中添加：

```markdown
![Build Status](https://github.com/your-username/socks5-proxy-rust/actions/workflows/release.yml/badge.svg)
```

### 邮件通知

GitHub 会在以下情况发送邮件：
- ✅ 工作流成功
- ❌ 工作流失败
- ⚠️ 工作流被取消

---

## 🎉 验证成功

当一切配置正确后，你应该看到：

1. ✅ 工作流执行成功（绿色勾）
2. ✅ 发布仓库有新的提交
3. ✅ 提交信息包含：`chore: 自动构建 - YYYY-MM-DD`
4. ✅ dokploy 显示部署成功

---

## 📚 相关文档

- [GitHub Actions 官方文档](https://docs.github.com/en/actions)
- [Personal Access Tokens 指南](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [Dokploy 部署指南](./DEPLOYMENT.md)

---

## 💡 提示

1. **首次构建**可能需要 5-10 分钟（下载依赖）
2. **后续构建**通常只需 1-2 分钟（使用缓存）
3. **手动触发**可在任何时间强制重新构建
4. **回滚版本**只需在发布仓库 `git reset --hard HEAD~1`

---

需要帮助？查看完整的配置示例：
- 源码仓库：`.github/workflows/release.yml`
- 构建指南：`BINARY_RELEASE_GUIDE.md`
