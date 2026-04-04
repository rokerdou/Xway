import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import './index.css';

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('已停止');
  const [statusError, setStatusError] = useState(null); // 状态栏专用错误
  const [error, setError] = useState(null);
  const [servers, setServers] = useState([
    { id: 1, host: '124.156.132.195', port: 1080, enabled: true }
  ]);
  const [stats, setStats] = useState({ upload_bytes: 0, download_bytes: 0, connections: 0 });
  const [latency, setLatency] = useState(null);
  const [testing, setTesting] = useState(false);
  const [systemProxyEnabled, setSystemProxyEnabled] = useState(false);
  const [proxyEnvVars, setProxyEnvVars] = useState('');
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServer, setNewServer] = useState({ host: '', port: 1080 });

  const appWindow = getCurrentWindow();

  const handleCloseWindow = async () => {
    console.log('🖱️ handleCloseWindow 被调用');
    try {
      console.log('⏳ 准备关闭窗口...');
      await invoke('close_window');
      console.log('✅ 窗口关闭成功');
    } catch (e) {
      console.error('❌ 关闭窗口失败:', e);
    }
  };

  const handleMinimizeWindow = async () => {
    console.log('🖱️ handleMinimizeWindow 被调用');
    try {
      console.log('⏳ 准备最小化窗口...');
      await invoke('minimize_window');
      console.log('✅ 窗口最小化成功');
    } catch (e) {
      console.error('❌ 最小化窗口失败:', e);
    }
  };

  const handleToggleSystemProxy = async () => {
    try {
      // 使用本地SOCKS5代理监听端口1081，而不是远程服务器端口
      const localProxyPort = 1081;

      const result = await invoke('set_system_proxy', { enabled: !systemProxyEnabled, port: localProxyPort });

      if (result.startsWith('✅')) {
        // 成功
        setSystemProxyEnabled(!systemProxyEnabled);
        alert(result);
      } else {
        // 失败，显示命令让用户手动执行
        setSystemProxyEnabled(!systemProxyEnabled); // 假设用户会手动执行

        // 创建可复制的文本
        const textToCopy = result.replace("自动执行失败，请手动执行以下命令：\n\n", "")
                            .replace("无法自动执行，请手动执行以下命令：\n\n", "");

        // 复制到剪贴板（使用 Tauri API）
        await writeText(textToCopy);

        alert(`⚠️ 自动执行失败\n\n已复制命令到剪贴板！\n\n请在终端中粘贴并执行：\n${textToCopy}\n\n提示：执行后请点击按钮刷新状态`);
      }
    } catch (e) {
      console.error('设置系统代理失败:', e);
      alert(`设置系统代理失败: ${e}`);
    }
  };

  const handleCopyEnvVars = async () => {
    try {
      console.log('🎯 开始复制环境变量...');

      // 使用本地SOCKS5代理监听端口1081
      const localProxyPort = 1081;

      console.log('📡 调用 get_proxy_env_vars, port:', localProxyPort);
      const envVars = await invoke('get_proxy_env_vars', { port: localProxyPort });
      console.log('✅ 获取到环境变量:', envVars);
      setProxyEnvVars(envVars);

      // 复制到剪贴板（使用 Tauri API）
      console.log('📋 准备写入剪贴板...');
      console.log('📦 writeText 函数:', writeText);
      console.log('🔧 writeText 类型:', typeof writeText);

      await writeText(envVars);
      console.log('✅ 写入剪贴板成功');
      alert('✅ 环境变量已复制到剪贴板！\n\n在终端中粘贴即可使用');
    } catch (e) {
      console.error('❌ 复制环境变量失败:', e);
      console.error('❌ 错误类型:', e.constructor.name);
      console.error('❌ 错误信息:', e.message);
      console.error('❌ 错误堆栈:', e.stack);
      alert('复制失败: ' + e);
    }
  };

  // 加载配置和状态
  useEffect(() => {
    loadConfig();
    loadStatus();

    // 定期刷新状态和统计
    const interval = setInterval(() => {
      loadStatus();
      loadStats();
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const loadConfig = async () => {
    try {
      const config = await invoke('get_servers_config');
      if (config && config.length > 0) {
        setServers(config);
      }
    } catch (e) {
      console.error('加载配置失败:', e);
    }
  };

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
    } catch (e) {
      console.error('获取状态失败:', e);
      setStatus('错误');
      setIsRunning(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await invoke('get_traffic_stats');
      setStats(data);
    } catch (e) {
      console.error('获取统计失败:', e);
    }
  };

  const handleToggle = async () => {
    try {
      setStatusError(null); // 清除之前的错误
      if (isRunning) {
        await invoke('stop_proxy');
        setStatus('已停止');
        setIsRunning(false);
      } else {
        setStatus('正在启动...');
        try {
          await invoke('start_proxy');
          // 等待状态更新
          setTimeout(() => loadStatus(), 500);
        } catch (startError) {
          setStatus('启动失败');
          setIsRunning(false);
          setStatusError(startError.toString()); // 使用statusError显示错误
          throw startError;
        }
      }
    } catch (e) {
      console.error('操作失败:', e);
      if (!isRunning) {
        setStatus('启动失败');
        setStatusError(e.toString());
      }
      setIsRunning(false);
    }
  };

  const handleSave = async () => {
    try {
      setError(null);
      await invoke('update_servers_config', { servers });
      alert('✅ 配置已保存');
    } catch (e) {
      console.error('保存配置失败:', e);
      setError(e.toString());
      alert('❌ 保存失败: ' + e);
    }
  };

  const handleAddServer = () => {
    if (!newServer.host || newServer.port <= 0) {
      alert('请输入有效的服务器地址和端口');
      return;
    }
    const server = {
      id: Date.now(),
      host: newServer.host,
      port: newServer.port,
      enabled: true
    };
    setServers([...servers, server]);
    setNewServer({ host: '', port: 1080 });
    setShowAddServer(false);
  };

  const handleRemoveServer = (id) => {
    if (servers.length === 1) {
      alert('至少需要保留一个服务器配置');
      return;
    }
    setServers(servers.filter(s => s.id !== id));
  };

  const handleToggleServer = (id) => {
    setServers(servers.map(s =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    ));
  };

  const getActiveServer = () => {
    return servers.find(s => s.enabled) || servers[0];
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getLatencyColor = (ms) => {
    if (ms < 50) return 'text-green-500';
    if (ms < 100) return 'text-yellow-500';
    if (ms < 200) return 'text-orange-500';
    return 'text-red-500';
  };

  const getLatencyLevel = (ms) => {
    if (ms < 50) return '优秀';
    if (ms < 100) return '良好';
    if (ms < 200) return '一般';
    return '较差';
  };

  const handleTestLatency = async () => {
    try {
      setTesting(true);
      setError(null);
      const activeServer = getActiveServer();
      if (!activeServer) {
        setError('没有可用的服务器');
        return;
      }
      const ms = await invoke('test_server_latency', {
        server: activeServer.host,
        port: activeServer.port
      });
      setLatency(ms);
    } catch (e) {
      console.error('测速失败:', e);
      setError('测速失败: ' + e);
      setLatency(null);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="h-full w-full bg-gray-900 text-white">
      {/* 顶部标题栏 - 可拖拽窗口 */}
      <div className="bg-gray-800 border-b border-gray-700 flex items-center" style={{ height: '41px' }}>
        {/* 左侧标题区域 - 可拖拽 */}
        <div className="flex-1 flex items-center px-3" data-tauri-drag-region>
          <span className="text-sm font-semibold select-none">SOCKS5 代理</span>
        </div>

        {/* 右侧窗口控制按钮 */}
        <div className="flex items-center">
          {/* 最小化按钮 */}
          <button
            onClick={handleMinimizeWindow}
            className="text-gray-400 hover:text-white hover:bg-gray-700 rounded px-2 py-1 transition-colors"
            title="最小化"
            style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>

          {/* 关闭按钮 */}
          <button
            onClick={handleCloseWindow}
            className="text-gray-400 hover:text-red-500 hover:bg-gray-700 rounded px-2 py-1 transition-colors"
            title="关闭窗口"
            style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="p-3 overflow-y-auto" style={{ height: 'calc(100% - 41px)' }}>
        <div className="bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-auto p-2.5 space-y-1.5">
          {/* 标题 */}
          <div className="text-center pb-0.5">
            <h1 className="text-lg font-bold">SOCKS5 代理</h1>
            <p className="text-gray-400 text-[10px]">简洁安全的网络代理工具</p>
          </div>

        {/* 状态指示器 */}
        <div className="bg-gray-700/50 rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[11px]">{status}</span>
            </div>
            <button
              onClick={handleToggle}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                isRunning
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isRunning ? '停止' : '启动'}
            </button>
          </div>

          {/* 错误信息显示 */}
          {statusError && (
            <div className="mt-1 text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">
              <div className="flex items-start gap-1">
                <span>⚠️</span>
                <span className="break-all">{statusError}</span>
              </div>
            </div>
          )}
        </div>

        {/* 旧的错误弹框 - 移除 */}
        {/* {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3">
            ...
          </div>
        )} */}

        {/* 服务器配置 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-300">服务器配置</h2>
            <button
              onClick={() => setShowAddServer(!showAddServer)}
              className="text-[10px] bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded"
            >
              + 添加
            </button>
          </div>

          {/* 添加服务器表单 */}
          {showAddServer && (
            <div className="bg-gray-700/50 rounded-lg p-2 space-y-1.5">
              <input
                type="text"
                placeholder="服务器地址"
                value={newServer.host}
                onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                className="w-full bg-gray-600 border border-gray-500 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
              />
              <input
                type="number"
                placeholder="端口"
                value={newServer.port}
                onChange={(e) => setNewServer({ ...newServer, port: Number(e.target.value) })}
                className="w-full bg-gray-600 border border-gray-500 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={handleAddServer}
                  className="flex-1 bg-green-600 hover:bg-green-700 py-1 rounded-md text-xs font-medium transition-colors"
                >
                  确定
                </button>
                <button
                  onClick={() => setShowAddServer(false)}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 py-1 rounded-md text-xs font-medium transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* 服务器列表 */}
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {servers.map((server) => (
              <div
                key={server.id}
                className={`bg-gray-700/50 rounded-lg p-2 ${
                  server.enabled ? 'border-l-2 border-green-500' : 'border-l-2 border-gray-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleToggleServer(server.id)}
                      className={`w-2.5 h-2.5 rounded-full transition-colors ${
                        server.enabled ? 'bg-green-500' : 'bg-gray-500'
                      }`}
                    />
                    <span className="text-xs font-medium">
                      {server.host}:{server.port}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveServer(server.id)}
                    className="text-[10px] text-red-400 hover:text-red-300"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-blue-600 hover:bg-blue-700 py-1 rounded-md text-xs font-medium transition-colors"
          >
            保存配置
          </button>
          <button
            onClick={handleTestLatency}
            disabled={testing}
            className={`w-full py-1 rounded-md text-xs font-medium transition-colors ${
              testing
                ? 'bg-gray-600 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {testing ? '测速中...' : '测速当前服务器'}
          </button>
        </div>

        {/* 测速结果 */}
        {latency !== null && (
          <div className={`bg-gray-700/50 rounded-lg p-2 ${getLatencyColor(latency)}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] text-gray-400 mb-0.5">服务器延迟</p>
                <p className="text-sm font-bold">{latency} ms</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-gray-400 mb-0.5">连接质量</p>
                <p className="text-xs font-semibold">{getLatencyLevel(latency)}</p>
              </div>
            </div>
          </div>
        )}

        {/* 流量统计 */}
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold text-gray-300">流量统计</h2>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-gray-700/50 rounded-lg p-2">
              <p className="text-[9px] text-gray-400 mb-0.5">上传</p>
              <p className="text-xs font-semibold">{formatBytes(stats.upload_bytes)}</p>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-2">
              <p className="text-[9px] text-gray-400 mb-0.5">下载</p>
              <p className="text-xs font-semibold">{formatBytes(stats.download_bytes)}</p>
            </div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-2">
            <p className="text-[9px] text-gray-400 mb-0.5">连接数</p>
            <p className="text-xs font-semibold">{stats.connections}</p>
          </div>
        </div>

        {/* 系统代理设置 */}
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold text-gray-300">系统代理设置 (SOCKS)</h2>
          <button
            onClick={handleToggleSystemProxy}
            className={`w-full py-1.5 rounded-md text-xs font-medium transition-colors ${
              systemProxyEnabled
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {systemProxyEnabled ? '🔴 关闭系统代理' : '🟢 启用系统代理'}
          </button>
          <p className="text-[9px] text-yellow-400">
            ⚠️ 需要管理员权限
          </p>
        </div>

        {/* 环境变量 */}
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold text-gray-300">终端代理设置</h2>
          <button
            onClick={handleCopyEnvVars}
            className="w-full bg-purple-600 hover:bg-purple-700 py-1.5 rounded-md text-xs font-medium transition-colors"
          >
            📋 复制环境变量
          </button>
          {proxyEnvVars && (
            <div className="bg-gray-900/50 rounded-lg p-2">
              <p className="text-[9px] text-gray-400 mb-1">在终端中粘贴：</p>
              <pre className="text-[9px] text-green-400 whitespace-pre-wrap break-all">
                {proxyEnvVars}
              </pre>
              <p className="text-[9px] text-gray-500 mt-1">适用于 bash/zsh</p>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

export default App;
