//! 错误类型定义

use std::io;

/// 代理错误类型
#[derive(Debug, thiserror::Error)]
pub enum ProxyError {
    #[error("IO错误: {0}")]
    Io(#[from] io::Error),

    #[error("协议错误: {0}")]
    Protocol(#[from] ProtocolError),

    #[error("加密错误: {0}")]
    Crypto(String),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("连接超时")]
    Timeout,

    #[error("连接被拒绝")]
    ConnectionRefused,

    #[error("无效的地址: {0}")]
    InvalidAddress(String),
}

/// 协议错误类型
#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("不支持的SOCKS版本: {0}")]
    UnsupportedVersion(u8),

    #[error("不支持的认证方法: {0}")]
    UnsupportedAuthMethod(u8),

    #[error("不支持的命令: {0}")]
    UnsupportedCommand(u8),

    #[error("不支持的地址类型: {0}")]
    UnsupportedAddressType(u8),

    #[error("无效的数据长度")]
    InvalidLength,

    #[error("无效的协议格式")]
    InvalidFormat,

    #[error("认证失败")]
    AuthenticationFailed,

    #[error("一般失败: {0}")]
    GeneralFailure(String),
}

/// Result类型别名
pub type Result<T> = std::result::Result<T, ProxyError>;
