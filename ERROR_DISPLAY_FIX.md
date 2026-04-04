# 错误信息显示优化

## 问题描述

用户反馈：第二个GUI启动时提示了错误，但是没有显示具体的错误原因。

## 问题分析

### 原因

错误信息传递链路：
```
bind_port() 返回 anyhow::Error
  ↓
start() 返回 anyhow::Error
  ↓
start_proxy() 转换为 String: format!("启动代理失败: {}", e)
  ↓
前端显示: e.toString()
```

**问题**：`anyhow::Error` 在某些情况下转换为String时，可能只显示错误类型，不显示详细信息。

### 示例

修复前可能显示：
```
"启动代理失败: Os { code: 48, kind: AddrInUse, message: \"Address already in use\" }"
```

或者更简洁但不友好：
```
"启动代理失败: 端口127.0.0.1:1081失败: Os { code: 48 }"
```

## 修复方案

### 1. 改进 bind_port() 错误信息

```rust
let listener = TcpListener::bind(bind_addr).await
    .map_err(|e| {
        // 根据错误类型提供中文说明
        let error_msg = if e.kind() == std::io::ErrorKind::AddrInUse {
            format!("端口{}已被占用，请检查是否有其他程序正在使用", bind_addr)
        } else if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!("权限不足，无法绑定端口{}", bind_addr)
        } else {
            format!("绑定端口{}失败: {}", bind_addr, e)
        };
        anyhow::anyhow!("{}", error_msg)
    })?;
```

### 2. 简化 start_proxy() 错误转换

```rust
client.start().await
    .map_err(|e| {
        // 直接转换为String，保留完整错误信息
        e.to_string()
    })?;
```

## 修复后的错误信息

### 场景1：端口被占用（最常见的场景）

**显示**：
```
端口127.0.0.1:1081已被占用，请检查是否有其他程序正在使用
```

### 场景2：权限不足

**显示**：
```
权限不足，无法绑定端口127.0.0.1:1081
```

### 场景3：其他错误

**显示**：
```
绑定端口127.0.0.1:1081失败: <具体错误信息>
```

## 测试方法

### 测试1：双GUI进程冲突

```bash
# 终端1
cargo run --bin client-gui-tauri
# 点击"启动"按钮

# 终端2
cargo run --bin client-gui-tauri
# 点击"启动"按钮

# 预期结果：
# 第二个GUI应该显示错误提示：
# "端口127.0.0.1:1081已被占用，请检查是否有其他程序正在使用"
```

### 测试2：保留端口（使用netcat模拟）

```bash
# 终端1：占用1081端口
nc -l 1081

# 终端2：启动GUI
cargo run --bin client-gui-tauri
# 点击"启动"按钮

# 预期结果：
# GUI应该显示错误提示：
# "端口127.0.0.1:1081已被占用，请检查是否有其他程序正在使用"
```

## 前端错误显示

前端代码已经正确处理：

```javascript
try {
  await invoke('start_proxy');
  setTimeout(() => loadStatus(), 500);
} catch (startError) {
  setStatus('启动失败');
  setIsRunning(false);
  setError(startError.toString());  // ← 显示完整错误信息
  throw startError;
}
```

UI显示：
```
+---------------------------+
| ✓ SOCKS5 代理              |
+---------------------------+
| 状态指示器: 启动失败        |
| 错误信息框:                |
| 端口127.0.0.1:1081已被占用，|
| 请检查是否有其他程序正在使用|
+---------------------------+
```

## 代码修改清单

- ✅ `client-core/src/proxy.rs`
  - 改进 `bind_port()` 的错误信息
  - 根据错误类型提供中文提示

- ✅ `client-gui/src-tauri/src/lib.rs`
  - 简化错误转换逻辑
  - 直接使用 `e.to_string()` 保留完整信息

- ✅ 前端已正确实现（无需修改）

## 效果对比

### 修复前

用户看到的错误提示：
- ❌ "启动代理失败: Os { code: 48 }"
- ❌ "Error: 启动失败"
- ❌ 或者没有任何具体错误信息

### 修复后

用户看到的错误提示：
- ✅ "端口127.0.0.1:1081已被占用，请检查是否有其他程序正在使用"
- ✅ 清晰、准确、可操作

## 后续优化建议

1. **添加错误代码映射**：为不同错误提供解决建议
   ```
   端口被占用：
   1. 检查是否有其他实例正在运行
   2. 使用 lsof -i :1081 查看占用进程
   3. 杀死占用进程或更换端口
   ```

2. **UI增强**：
   - 添加"查看详情"按钮
   - 提供一键解决建议（如"终止占用进程"）

3. **错误统计**：
   - 记录错误发生频率
   - 分析常见错误原因
