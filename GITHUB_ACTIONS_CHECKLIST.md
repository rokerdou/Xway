# GitHub Actions 配置检查清单

## ✅ 配置前准备

### 1️⃣ 仓库名称确认

- [ ] 源码仓库：`your-username/socks5-proxy-rust`
- [ ] 发布仓库：`your-username/socks5-proxy-releases`

### 2️⃣ 检查文件

```bash
# 确认工作流文件存在
ls -la .github/workflows/release.yml

# 确认 Dockerfile 存在
ls -la Dockerfile
```

---

## 📝 配置步骤（按顺序完成）

### 步骤 1: 创建发布仓库

**访问 GitHub**：https://github.com/new

- [ ] 仓库名称：`socks5-proxy-releases`
- [ ] 可见性：Public 或 Private（与源码仓库一致）
- [ ] **不要**勾选 "Add a README file"
- [ ] **不要**勾选 "Add .gitignore"
- [ ] 点击 **"Create repository"**

**初始化本地仓库**：

```bash
cd ..
git clone git@github.com:your-username/socks5-proxy-releases.git
cd socks5-proxy-releases
echo "# SOCKS5 代理服务端 - 二进制发布仓库" > README.md
git add .
git commit -m "Initial commit"
git push -u origin main
cd ../socks5-proxy-rust
```

---

### 步骤 2: 生成 Personal Access Token

**访问**：https://github.com/settings/tokens

- [ ] 点击 **"Generate new token"** → **"Generate new token (classic)"**

**Token 设置**：

- [ ] Name: `socks5-releases-deploy`
- [ ] Expiration: `No expiration` 或至少 90 天
- [ ] 勾选权限：
  - [ ] `repo` (Full control of private repositories)
  - [ ] `workflow` (Update GitHub Action workflows)
- [ ] 点击 **"Generate token"**
- [ ] **复制 token**（格式：`ghp_xxx...`）

⚠️ **重要**：Token 只显示一次，请立即保存！

---

### 步骤 3: 配置 GitHub Secret

**在源码仓库**（`socks5-proxy-rust`）中：

1. 访问：https://github.com/your-username/socks5-proxy-rust/settings/secrets/actions
2. 点击 **"New repository secret"**
3. 填写：
   - [ ] Name: `RELEASES_TOKEN`（必须大写，完全匹配）
   - [ ] Value: 粘贴刚才的 Token
   - [ ] 点击 **"Add secret"**

**验证**：

- [ ] 在 Secrets 列表中看到 `RELEASES_TOKEN`

---

### 步骤 4: 推送代码触发构建

```bash
# 确保在源码仓库
cd socks5-proxy-rust

# 如果工作流文件还未提交
git add .github/workflows/release.yml
git commit -m "feat: 添加 GitHub Actions 自动构建"
git push
```

---

### 步骤 5: 验证工作流

**访问 Actions 页面**：

https://github.com/your-username/socks5-proxy-rust/actions

- [ ] 看到 **"Build and Release Server Binary"** 工作流
- [ ] 状态显示为 **蓝色（运行中）** 或 **绿色（成功）**
- [ ] 点击进入查看执行步骤

**查看执行日志**（点开最近的运行）：

- [ ] ✅ Checkout source code
- [ ] ✅ Install Rust toolchain
- [ ] ✅ Cache cargo registry/index/build
- [ ] ✅ Build server binary
- [ ] ✅ Run tests
- [ ] ✅ Clone releases repository
- [ ] ✅ Copy binary and configs
- [ ] ✅ Commit and push

---

### 步骤 6: 验证发布仓库

**访问发布仓库**：

https://github.com/your-username/socks5-proxy-releases

- [ ] 看到新的提交：`chore: 自动构建 - YYYY-MM-DD`
- [ ] 文件列表包含：
  - [ ] `server`（二进制文件，约 4-5 MB）
  - [ ] `Dockerfile`
  - [ ] `server.toml`
  - [ ] `README.md`

---

### 步骤 7: 配置 dokploy

**在 dokploy 面板**：

1. 创建新应用：`socks5-proxy`
2. Git 仓库：
   - [ ] `git@github.com:your-username/socks5-proxy-releases.git`
3. 分支：
   - [ ] `main`
4. Docker 构建路径：
   - [ ] `/`（根目录）
5. Dockerfile：
   - [ ] `Dockerfile`
6. 端口：
   - [ ] `1080`
7. 点击 **"部署"**

- [ ] 部署成功
- [ ] 容器运行正常
- [ ] 健康检查通过

---

## 🎉 完成验证

### 功能测试

**本地测试连接**：

```bash
# 测试 SOCKS5 代理（替换为你的服务器地址）
curl --socks5 your-server-ip:1080 https://httpbin.org/ip
```

**预期输出**：

```json
{
  "origin": "your-server-ip"
}
```

---

## 🐛 常见问题速查

| 问题 | 检查项 | 解决方案 |
|------|--------|---------|
| ❌ 工作流失败 - 权限不足 | Secret 配置 | 重新检查 `RELEASES_TOKEN` |
| ❌ 仓库不存在 | 发布仓库名称 | 确保仓库名称完全匹配 |
| ❌ 编译失败 | 代码错误 | 本地运行 `cargo build` 验证 |
| ❌ 推送失败 | Token 权限 | 确保 Token 有 `repo` 权限 |
| ⚠️ 工作流未触发 | 文件路径 | 确认修改了 `server/` 或 `shared/` 目录 |

---

## 📊 成功标志

✅ **所有项目都打勾后**，你的自动化部署流程就完成了！

从此以后：
1. 修改代码并推送到源码仓库
2. 等待 1-2 分钟
3. GitHub Actions 自动编译并推送二进制
4. dokploy 自动拉取并部署
5. 完成！🎉

---

## 🔧 维护建议

### 定期检查

- [ ] 每月检查 Token 是否即将过期
- [ ] 每月查看 Actions 运行历史
- [ ] 定期更新 Rust 版本（修改工作流中的 `dtolnay/rust-toolchain@stable`）

### 监控指标

- ⏱️ 构建时间：正常 1-2 分钟
- 📦 二进制大小：约 4-5 MB
- 🚀 部署时间：约 30-60 秒

---

## 📞 需要帮助？

- 📖 完整指南：`GITHUB_ACTIONS_SETUP.md`
- 🔧 问题排查：同一文档的"故障排查"章节
- 💬 GitHub Community：https://github.community/

---

**祝你配置顺利！** 🚀
