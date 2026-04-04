# 状态栏错误信息显示修复

## 问题描述

用户反馈：错误弹框只显示一会儿就消失了。

## 问题原因

### 原因分析

1. **错误弹框组件使用 `error` state**
   ```jsx
   {error && (
     <div className="bg-red-900/30 ...">
       错误提示: {error}
     </div>
   )}
   ```

2. **`loadStatus()` 每秒被调用（定期刷新）**
   ```jsx
   const interval = setInterval(() => {
     loadStatus();  // ← 每秒调用
     loadStats();
   }, 1000);
   ```

3. **`loadStatus()` 会清除 `error` state**
   ```jsx
   const loadStatus = async () => {
     try {
       const state = await invoke('get_proxy_status');
       if (state === 'Error') {
         // ...
       } else {
         setStatus(state);
         setError(null);  // ← 清除错误！
       }
     }
   }
   ```

4. **结果**：错误显示1秒后就被清除

## 用户建议

> "你不需要弹框，你直接在启动状态哪里显示错误就好"

## 修复方案

### 1. 添加专用的 `statusError` state

```jsx
const [status, setStatus] = useState('已停止');
const [statusError, setStatusError] = useState(null); // 状态栏专用错误
```

### 2. 修改 `loadStatus()` - 不清除 `statusError`

```jsx
const loadStatus = async () => {
  try {
    const state = await invoke('get_proxy_status');

    if (state === 'Error') {
      setStatus('错误');
      setIsRunning(false);
      // 不清除statusError，保持显示
    } else {
      setStatus(state);
      setIsRunning(state === 'Running');
      // 只有在成功运行时才清除错误
      if (state === 'Running') {
        setStatusError(null);
      }
    }
  }
}
```

**关键改动**：
- 不在每次状态查询时清除错误
- 只有在状态变为 `Running` 时才清除错误

### 3. 修改 `handleToggle()` - 使用 `statusError`

```jsx
const handleToggle = async () => {
  try {
    setStatusError(null); // 手动清除之前的错误

    if (!isRunning) {
      try {
        await invoke('start_proxy');
      } catch (startError) {
        setStatus('启动失败');
        setIsRunning(false);
        setStatusError(startError.toString()); // ← 使用statusError
      }
    }
  }
}
```

### 4. UI修改 - 在状态栏内显示错误

```jsx
{/* 状态指示器 */}
<div className="bg-gray-700/50 rounded-lg p-3">
  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
      <span className="text-xs">{status}</span>
    </div>
    <button onClick={handleToggle}>...</button>
  </div>

  {/* 错误信息显示 - 在状态栏内 */}
  {statusError && (
    <div className="mt-2 text-xs text-red-400 bg-red-900/20 rounded px-2 py-1">
      <div className="flex items-start gap-1">
        <span>⚠️</span>
        <span className="break-all">{statusError}</span>
      </div>
    </div>
  )}
</div>
```

**UI布局**：
```
┌─────────────────────────────────┐
│ ● 运行中              [停止]    │
│ ⚠️ 端口127.0.0.1:1081已被占用  │
└─────────────────────────────────┘
```

### 5. 移除旧的错误弹框

- 删除了独立的错误弹框组件
- 保留了 `error` state用于其他用途（测速、保存配置等）

## 修复效果

### 修复前
```
错误发生 → 显示弹框 → 1秒后弹框消失
```

### 修复后
```
错误发生 → 在状态栏显示错误 → 持续显示直到：
  - 手动关闭（点击启动/停止）
  - 代理成功启动
```

## UI示例

### 正常状态
```
┌─────────────────────────────────┐
│ ● 已停止              [启动]    │
└─────────────────────────────────┘
```

### 启动中
```
┌─────────────────────────────────┐
│ ● 正在启动...         [启动]    │
└─────────────────────────────────┘
```

### 运行中
```
┌─────────────────────────────────┐
│ ● 运行中              [停止]    │
└─────────────────────────────────┘
```

### 端口被占用错误
```
┌─────────────────────────────────┐
│ ● 启动失败             [启动]    │
│ ⚠️ 端口127.0.0.1:1081已被占用，│
│    请检查是否有其他程序正在使用 │
└─────────────────────────────────┘
```

### 其他错误
```
┌─────────────────────────────────┐
│ ● 启动失败             [启动]    │
│ ⚠️ 连接服务器失败: Connection   │
│    refused                      │
└─────────────────────────────────┘
```

## 关键改进

1. **错误持续显示**：不会被定期刷新清除
2. **位置合理**：在状态栏内，与启动/停止按钮在同一区域
3. **手动清除**：点击启动/停止按钮时清除旧错误
4. **自动清除**：代理成功启动后自动清除错误
5. **简洁设计**：不需要单独的弹框，节省空间

## 文件修改清单

- ✅ `client-gui/ui/src/App.jsx`
  - 添加 `statusError` state
  - 修改 `loadStatus()` 逻辑
  - 修改 `handleToggle()` 使用 `statusError`
  - 修改UI布局，在状态栏内显示错误
  - 移除独立的错误弹框组件

## 测试验证

### 测试1：端口被占用

```bash
# 终端1
cargo run --bin client-gui-tauri
# 点击"启动"按钮

# 终端2
cargo run --bin client-gui-tauri
# 点击"启动"按钮
```

**预期**：
- 第二个GUI的状态栏显示红色错误信息
- 错误信息持续显示，不会消失
- 点击"启动"按钮重新尝试时，旧错误被清除

### 测试2：错误清除

1. 端口被占用时显示错误
2. 关闭第一个GUI
3. 在第二个GUI中再次点击"启动"
4. **预期**：成功启动，错误信息消失

## 代码对比

### 修复前：错误弹框（会消失）
```jsx
{error && (
  <div className="bg-red-900/30 border ...">
    错误提示: {error}
  </div>
)}
// loadStatus中会调用 setError(null)
```

### 修复后：状态栏错误（持续显示）
```jsx
<div className="状态栏">
  <div className="状态和按钮">...</div>

  {statusError && (
    <div className="错误信息">
      ⚠️ {statusError}
    </div>
  )}
</div>
// loadStatus不会清除statusError
```
