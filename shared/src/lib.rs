//! SOCKS5代理共享库
//!
//! 包含协议定义、错误类型和加密模块

pub mod auth;
pub mod auth_config;
pub mod crypto;
pub mod error;
pub mod king_maps;
pub mod protocol;

pub use auth::AuthPacket;
pub use auth_config::AuthConfig;
pub use crypto::KingObj;
pub use error::{ProtocolError, Result};
pub use protocol::*;
