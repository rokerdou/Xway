//! DPI探测防御模块
//!
//! 对失败认证和无效探测进行限速封禁。

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// IP封禁记录
#[derive(Debug, Clone)]
struct BanRecord {
    /// 封禁开始时间
    banned_at: Instant,
    /// 封禁持续时间
    duration: Duration,
}

impl BanRecord {
    /// 创建新的封禁记录
    fn new(duration: Duration) -> Self {
        Self {
            banned_at: Instant::now(),
            duration,
        }
    }

    /// 检查封禁是否已过期
    fn is_expired(&self) -> bool {
        self.banned_at.elapsed() >= self.duration
    }
}

/// IP连接统计
#[derive(Debug)]
struct ConnectionStats {
    /// 失败的鉴权尝试次数
    auth_failures: u32,
    /// 窗口开始时间
    window_start: Instant,
}

impl Default for ConnectionStats {
    fn default() -> Self {
        Self {
            auth_failures: 0,
            window_start: Instant::now(),
        }
    }
}

impl ConnectionStats {
    /// 创建新的统计记录
    fn new() -> Self {
        Self::default()
    }

    /// 检查窗口是否已过期
    fn is_window_expired(&self, window_duration: Duration) -> bool {
        self.window_start.elapsed() >= window_duration
    }

    /// 重置统计窗口
    fn reset_window(&mut self) {
        self.auth_failures = 0;
        self.window_start = Instant::now();
    }
}

/// DPI防御配置
#[derive(Debug, Clone)]
pub struct DefenseConfig {
    /// 速率限制窗口大小（默认60秒）
    pub rate_limit_window: Duration,
    /// 最大鉴权失败次数（默认3）
    pub max_auth_failures: u32,
    /// 首次封禁持续时间（默认5分钟）
    pub initial_ban_duration: Duration,
    /// 封禁持续时间倍增因子（默认2）
    pub ban_multiplier: u32,
    /// 最大封禁持续时间（默认24小时）
    pub max_ban_duration: Duration,
}

impl Default for DefenseConfig {
    fn default() -> Self {
        Self {
            rate_limit_window: Duration::from_secs(60),
            max_auth_failures: 3,
            initial_ban_duration: Duration::from_secs(300),
            ban_multiplier: 2,
            max_ban_duration: Duration::from_secs(86400),
        }
    }
}

/// DPI防御管理器
pub struct DefenseManager {
    /// 配置
    config: DefenseConfig,
    /// IP连接统计
    stats: RwLock<HashMap<IpAddr, ConnectionStats>>,
    /// IP封禁记录
    bans: RwLock<HashMap<IpAddr, BanRecord>>,
}

impl DefenseManager {
    /// 创建新的防御管理器
    pub fn new(config: DefenseConfig) -> Self {
        Self {
            config,
            stats: RwLock::new(HashMap::new()),
            bans: RwLock::new(HashMap::new()),
        }
    }

    /// 使用默认配置创建防御管理器
    #[cfg(test)]
    pub fn with_default_config() -> Self {
        Self::new(DefenseConfig::default())
    }

    /// 检查IP是否被封禁
    pub async fn is_banned(&self, ip: IpAddr) -> bool {
        let mut bans = self.bans.write().await;

        if let Some(record) = bans.get(&ip) {
            if record.is_expired() {
                // 封禁已过期，移除记录
                bans.remove(&ip);
                tracing::debug!("IP {} 的封禁已过期", ip);
                false
            } else {
                true
            }
        } else {
            false
        }
    }

    /// 记录失败的鉴权
    pub async fn record_auth_failure(&self, ip: IpAddr) {
        let ban_level = {
            let mut stats = self.stats.write().await;
            let entry = stats.entry(ip).or_insert_with(ConnectionStats::new);

            // 检查窗口是否过期
            if entry.is_window_expired(self.config.rate_limit_window) {
                entry.reset_window();
            }

            entry.auth_failures += 1;

            if entry.auth_failures >= self.config.max_auth_failures {
                // 计算封禁等级
                Some((entry.auth_failures - self.config.max_auth_failures + 1) as u32)
            } else {
                None
            }
        };

        // 在释放锁后执行封禁操作
        if let Some(level) = ban_level {
            self.ban_ip(ip, level).await;
            tracing::warn!("IP {} 鉴权失败次数过多，已封禁", ip);
        }
    }

    /// 封禁IP
    async fn ban_ip(&self, ip: IpAddr, level: u32) {
        let mut bans = self.bans.write().await;

        // 计算封禁持续时间（指数增长）
        let duration = self
            .config
            .initial_ban_duration
            .saturating_mul(self.config.ban_multiplier.pow(level - 1))
            .min(self.config.max_ban_duration);

        bans.insert(ip, BanRecord::new(duration));

        tracing::info!("IP {} 已被封禁，持续时间: {:?}", ip, duration);
    }

    /// 清理过期的统计数据和封禁记录
    pub async fn cleanup(&self) {
        let mut stats = self.stats.write().await;
        let mut bans = self.bans.write().await;

        // 清理过期的统计记录
        stats.retain(|_, stat| {
            !stat.is_window_expired(self.config.rate_limit_window * 2) // 保留2个窗口周期的数据
        });

        // 清理过期的封禁记录
        bans.retain(|_, ban| !ban.is_expired());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[tokio::test]
    async fn test_auth_failure_ban() {
        let manager = DefenseManager::with_default_config();
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 2));

        // 记录鉴权失败
        for _ in 0..3 {
            manager.record_auth_failure(ip).await;
        }

        // 应该被封禁
        assert!(manager.is_banned(ip).await);
    }

    #[tokio::test]
    async fn test_ban_expiration() {
        let config = DefenseConfig {
            initial_ban_duration: Duration::from_millis(100), // 短暂封禁用于测试
            ..Default::default()
        };
        let manager = DefenseManager::new(config);
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 3));

        // 封禁IP
        manager.ban_ip(ip, 1).await;
        assert!(manager.is_banned(ip).await);

        // 等待封禁过期
        tokio::time::sleep(Duration::from_millis(150)).await;

        // 封禁应该已过期
        assert!(!manager.is_banned(ip).await);
    }

    #[tokio::test]
    async fn test_ipv6_support() {
        let manager = DefenseManager::with_default_config();
        let ip = IpAddr::V6(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 1));

        assert!(!manager.is_banned(ip).await);
    }
}
