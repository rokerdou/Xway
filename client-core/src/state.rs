//! 代理状态管理

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, AtomicU32, Ordering};
use std::sync::Arc;
use crate::TrafficStats;

/// 代理状态
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProxyState {
    /// 未启动
    Stopped,
    /// 启动中
    Starting,
    /// 运行中
    Running,
    /// 停止中
    Stopping,
    /// 错误状态
    Error(String),
}

impl ProxyState {
    pub fn is_running(&self) -> bool {
        matches!(self, Self::Running)
    }

    pub fn is_stopped(&self) -> bool {
        matches!(self, Self::Stopped)
    }
}

/// 代理状态管理器
#[derive(Clone)]
pub struct ProxyStatus {
    state: Arc<tokio::sync::RwLock<ProxyState>>,
    stats: Arc<ProxyStats>,
}

impl ProxyStatus {
    pub fn new() -> Self {
        Self {
            state: Arc::new(tokio::sync::RwLock::new(ProxyState::Stopped)),
            stats: Arc::new(ProxyStats::new()),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> ProxyState {
        self.state.read().await.clone()
    }

    /// 设置状态
    pub async fn set_state(&self, state: ProxyState) {
        *self.state.write().await = state;
    }

    /// 获取统计信息
    pub fn get_stats(&self) -> TrafficStats {
        self.stats.get()
    }

    /// 增加上传字节数
    pub fn add_upload(&self, bytes: u64) {
        self.stats.upload.fetch_add(bytes, Ordering::Relaxed);
    }

    /// 增加下载字节数
    pub fn add_download(&self, bytes: u64) {
        self.stats.download.fetch_add(bytes, Ordering::Relaxed);
    }

    /// 增加连接数
    pub fn increment_connections(&self) {
        self.stats.connections.fetch_add(1, Ordering::Relaxed);
    }

    /// 减少连接数
    pub fn decrement_connections(&self) {
        // 使用 saturating_sub 防止下溢
        self.stats.connections.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |x| Some(x.saturating_sub(1))
        ).ok();
    }

    /// 重置统计信息
    pub fn reset_stats(&self) {
        self.stats.upload.store(0, Ordering::Relaxed);
        self.stats.download.store(0, Ordering::Relaxed);
        self.stats.connections.store(0, Ordering::Relaxed);
    }
}

impl Default for ProxyStatus {
    fn default() -> Self {
        Self::new()
    }
}

/// 内部统计结构（使用原子操作）
struct ProxyStats {
    upload: AtomicU64,
    download: AtomicU64,
    connections: AtomicU32,
}

impl ProxyStats {
    fn new() -> Self {
        Self {
            upload: AtomicU64::new(0),
            download: AtomicU64::new(0),
            connections: AtomicU32::new(0),
        }
    }

    fn get(&self) -> TrafficStats {
        TrafficStats {
            upload_bytes: self.upload.load(Ordering::Relaxed),
            download_bytes: self.download.load(Ordering::Relaxed),
            connections: self.connections.load(Ordering::Relaxed),
        }
    }
}

/// 连接守卫，使用 RAII 模式确保连接结束时减少计数
pub struct ConnectionGuard<'a> {
    status: &'a ProxyStatus,
}

impl<'a> ConnectionGuard<'a> {
    /// 创建新的连接守卫（此时连接数已经增加）
    pub fn new(status: &'a ProxyStatus) -> Self {
        Self { status }
    }
}

impl<'a> Drop for ConnectionGuard<'a> {
    /// 当守卫被销毁时，自动减少连接计数
    fn drop(&mut self) {
        self.status.decrement_connections();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_state_transitions() {
        let status = ProxyStatus::new();

        assert_eq!(status.get_state().await, ProxyState::Stopped);

        status.set_state(ProxyState::Starting).await;
        assert_eq!(status.get_state().await, ProxyState::Starting);

        status.set_state(ProxyState::Running).await;
        assert!(status.get_state().await.is_running());

        status.set_state(ProxyState::Stopped).await;
        assert!(status.get_state().await.is_stopped());
    }

    #[test]
    fn test_stats_increment() {
        let status = ProxyStatus::new();

        status.add_upload(1024);
        status.add_download(2048);
        status.increment_connections();

        let stats = status.get_stats();
        assert_eq!(stats.upload_bytes, 1024);
        assert_eq!(stats.download_bytes, 2048);
        assert_eq!(stats.connections, 1);
    }

    #[test]
    fn test_stats_reset() {
        let status = ProxyStatus::new();

        status.add_upload(1024);
        status.add_download(2048);
        status.increment_connections();

        status.reset_stats();

        let stats = status.get_stats();
        assert_eq!(stats.upload_bytes, 0);
        assert_eq!(stats.download_bytes, 0);
        assert_eq!(stats.connections, 0);
    }

    #[test]
    fn test_connections_decrement() {
        let status = ProxyStatus::new();

        // 增加连接数
        status.increment_connections();
        assert_eq!(status.get_stats().connections, 1);

        // 减少连接数
        status.decrement_connections();
        assert_eq!(status.get_stats().connections, 0);

        // 多次增加和减少
        status.increment_connections();
        status.increment_connections();
        status.increment_connections();
        assert_eq!(status.get_stats().connections, 3);

        status.decrement_connections();
        status.decrement_connections();
        assert_eq!(status.get_stats().connections, 1);
    }

    #[test]
    fn test_connection_guard() {
        let status = ProxyStatus::new();

        // 创建守卫前
        assert_eq!(status.get_stats().connections, 0);

        // 增加连接
        status.increment_connections();
        assert_eq!(status.get_stats().connections, 1);

        // 创建守卫（模拟连接处理）
        {
            let _guard = ConnectionGuard::new(&status);
            // 在作用域内，连接数仍然是1
            assert_eq!(status.get_stats().connections, 1);
        } // guard 离开作用域，自动减少连接数

        // 守卫销毁后，连接数应该减少
        assert_eq!(status.get_stats().connections, 0);
    }

    #[test]
    fn test_connection_guard_safety() {
        let status = ProxyStatus::new();

        // 测试防止下溢
        status.decrement_connections(); // 从0减少
        assert_eq!(status.get_stats().connections, 0); // 应该保持0，不会变成负数
    }
}
