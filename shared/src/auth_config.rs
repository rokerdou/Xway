//! 认证配置

use serde::{Deserialize, Serialize};

/// 认证配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    /// 是否启用认证
    #[serde(default = "default_enabled")]
    pub enabled: bool,

    /// 共享密钥（用于HMAC-SHA256）
    #[serde(default = "default_shared_secret")]
    pub shared_secret: String,

    /// 用户名（客户端使用）
    #[serde(default = "default_username")]
    pub username: String,

    /// 序列号（客户端使用，每次启动递增）
    #[serde(default = "default_sequence")]
    pub sequence: u64,

    /// 最大时间差（秒），用于防止重放攻击
    #[serde(default = "default_max_time_diff")]
    pub max_time_diff_secs: u64,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            shared_secret: default_shared_secret(),
            username: default_username(),
            sequence: default_sequence(),
            max_time_diff_secs: default_max_time_diff(),
        }
    }
}

fn default_enabled() -> bool {
    true
}

fn default_shared_secret() -> String {
    "change_me_please".to_string()
}

fn default_username() -> String {
    "client".to_string()
}

fn default_sequence() -> u64 {
    1
}

fn default_max_time_diff() -> u64 {
    300 // 5分钟
}
