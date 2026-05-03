//! SOCKS5代理共享库
//!
//! 包含协议定义、错误类型和加密模块

pub mod auth;
pub mod auth_config;
pub mod crypto;
pub mod error;
pub mod king_maps;
pub mod popcount;
pub mod protocol;

pub use auth::AuthPacket;
pub use auth_config::AuthConfig;
pub use crypto::KingObj;
pub use error::{ProtocolError, Result};
pub use popcount::{
    analyze_popcount,
    generate_protocol_prefix,
    extract_auth_byte_from_prefix,
    generate_first_auth_byte,
    verify_first_auth_byte,
    PROTOCOL_PREFIX_TEMPLATE,
};
pub use protocol::*;
