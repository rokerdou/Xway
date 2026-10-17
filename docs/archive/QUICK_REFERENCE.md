# 🚀 GitHub Actions 快速参考

## ⚡ 5分钟快速配置

### 步骤 1: 创建发布仓库
```bash
# 在 GitHub 创建: socks5-proxy-releases
cd ..
git clone git@github.com:your-username/socks5-proxy-releases.git
cd socks5-proxy-releases
echo "# Releases" > README.md
git add . && git commit -m "Initial commit" && git push -u origin main
cd ../socks5-proxy-rust
```

### 步骤 2: 生成 Token
访问: https://github.com/settings/tokens
- 名称: `socks5-releases-deploy`
- 权限: ✅ `repo` + ✅ `workflow`
- 复制 token

### 步骤 3: 配置 Secret
在源码仓库: Settings → Secrets → Actions
- Name: `RELEASES_TOKEN`
- Value: 粘贴 token

### 步骤 4: 推送代码
```bash
git add .github/workflows/release.yml
git commit -m "feat: 添加 GitHub Actions"
git push
```

### 步骤 5: 验证
访问: https://github.com/your-username/socks5-proxy-rust/actions
- 查看工作流运行
- 确认状态为绿色 ✅

---

## 📋 配置 dokploy

```
Git: git@github.com:your-username/socks5-proxy-releases.git
分支: main
构建路径: /
Dockerfile: Dockerfile
端口: 1080
```

---

## ✨ 日常使用

```bash
# 修改代码
git add .
git commit -m "fix: xxx"
git push

# ✅ 自动编译 → 自动部署 → 完成！
```

---

## 🔧 其他构建方式

### Docker 构建（macOS）
```bash
./scripts/build-in-docker.sh
```

### 本地交叉编译
```bash
./scripts/build-release.sh
```

---

## 📖 详细文档

- 📘 [完整配置指南](./GITHUB_ACTIONS_SETUP.md)
- ✅ [配置检查清单](./GITHUB_ACTIONS_CHECKLIST.md)
- 📦 [二进制发布指南](./BINARY_RELEASE_GUIDE.md)

---

**提示**: 首次构建需要 5-10 分钟，后续只需 1-2 分钟（缓存加速）
