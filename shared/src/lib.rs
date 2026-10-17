//! SOCKS5代理共享库
//!
//! 包含协议定义、错误类型和加密模块

pub mod auth;
pub mod auth_config;
pub mod error;
pub mod frame;
pub mod protocol;
pub mod session;
pub mod wire_prefix;

pub use auth::AuthPacket;
pub use auth_config::AuthConfig;
pub use error::{ProtocolError, Result};
pub use frame::{
    decode_obfuscated_frame, decode_stream_payload, derive_session_id, encode_obfuscated_frame,
    encode_stream_payload, read_encrypted_frame, write_encrypted_frame, FrameCodec,
    SessionDirection, DEFAULT_MAX_PADDING, MAX_FRAME_BODY_LEN, STREAM_FLAG_FIN,
};
pub use protocol::*;
pub use session::{ClientHello, ConnectResponse, CREDIT_FLAG, MAX_SUBFLOWS, SESSION_SALT_LEN};
pub use wire_prefix::{
    extract_auth_byte_from_prefix, generate_first_auth_byte, generate_protocol_prefix,
    verify_first_auth_byte, PROTOCOL_PREFIX_TEMPLATE,
};
