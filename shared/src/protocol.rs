//! SOCKS5协议定义
//!
//! 实现RFC 1928定义的SOCKS5协议

use std::io::Read;
use std::net::{Ipv4Addr, Ipv6Addr};
use crate::error::{ProtocolError, Result};

/// SOCKS5协议版本
pub const SOCKS5_VERSION: u8 = 0x05;

/// 认证方法
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMethod {
    /// 无需认证
    None = 0x00,
    /// GSSAPI
    GssApi = 0x01,
    /// 用户名/密码认证
    UserPass = 0x02,
    /// 无可接受的认证方法
    NoAcceptable = 0xFF,

    /// IANA分配的私有方法
    IanaStart = 0x03,
    IanaEnd = 0x7F,
    /// 私有方法
    PrivateStart = 0x80,
    PrivateEnd = 0xFE,
}

impl AuthMethod {
    /// 从u8创建AuthMethod
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0x00 => Some(AuthMethod::None),
            0x01 => Some(AuthMethod::GssApi),
            0x02 => Some(AuthMethod::UserPass),
            0xFF => Some(AuthMethod::NoAcceptable),
            _ => None,
        }
    }

    /// 转换为u8
    pub fn to_u8(self) -> u8 {
        self as u8
    }
}

/// SOCKS5命令类型
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    /// CONNECT命令
    Connect = 0x01,
    /// BIND命令
    Bind = 0x02,
    /// UDP ASSOCIATE命令
    UdpAssociate = 0x03,
}

impl Command {
    /// 从u8创建Command
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0x01 => Some(Command::Connect),
            0x02 => Some(Command::Bind),
            0x03 => Some(Command::UdpAssociate),
            _ => None,
        }
    }

    /// 转换为u8
    pub fn to_u8(self) -> u8 {
        self as u8
    }
}

/// 地址类型
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressType {
    /// IPv4地址
    Ipv4 = 0x01,
    /// 域名
    Domain = 0x03,
    /// IPv6地址
    Ipv6 = 0x04,
}

impl AddressType {
    /// 从u8创建AddressType
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0x01 => Some(AddressType::Ipv4),
            0x03 => Some(AddressType::Domain),
            0x04 => Some(AddressType::Ipv6),
            _ => None,
        }
    }

    /// 转换为u8
    pub fn to_u8(self) -> u8 {
        self as u8
    }
}

/// 目标地址
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetAddr {
    /// IPv4地址
    Ipv4(Ipv4Addr, u16),
    /// 域名
    Domain(String, u16),
    /// IPv6地址
    Ipv6(Ipv6Addr, u16),
}

impl TargetAddr {
    /// 获取端口号
    pub fn port(&self) -> u16 {
        match self {
            TargetAddr::Ipv4(_, port) => *port,
            TargetAddr::Domain(_, port) => *port,
            TargetAddr::Ipv6(_, port) => *port,
        }
    }

    /// 序列化目标地址
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();

        match self {
            TargetAddr::Ipv4(addr, port) => {
                buf.push(AddressType::Ipv4.to_u8());
                buf.extend_from_slice(&addr.octets());
                buf.extend_from_slice(&port.to_be_bytes());
            }
            TargetAddr::Domain(domain, port) => {
                buf.push(AddressType::Domain.to_u8());
                buf.push(domain.len() as u8);
                buf.extend_from_slice(domain.as_bytes());
                buf.extend_from_slice(&port.to_be_bytes());
            }
            TargetAddr::Ipv6(addr, port) => {
                buf.push(AddressType::Ipv6.to_u8());
                buf.extend_from_slice(&addr.octets());
                buf.extend_from_slice(&port.to_be_bytes());
            }
        }

        buf
    }

    /// 从字节流反序列化目标地址
    pub fn decode<R: Read>(reader: &mut R) -> Result<Self> {
        let mut addr_type = [0u8; 1];
        reader.read_exact(&mut addr_type)?;

        match AddressType::from_u8(addr_type[0]) {
            Some(AddressType::Ipv4) => {
                let mut addr_bytes = [0u8; 4];
                reader.read_exact(&mut addr_bytes)?;
                let addr = Ipv4Addr::from(addr_bytes);

                let mut port_bytes = [0u8; 2];
                reader.read_exact(&mut port_bytes)?;
                let port = u16::from_be_bytes(port_bytes);

                Ok(TargetAddr::Ipv4(addr, port))
            }
            Some(AddressType::Domain) => {
                let mut domain_len = [0u8; 1];
                reader.read_exact(&mut domain_len)?;

                let mut domain_bytes = vec![0u8; domain_len[0] as usize];
                reader.read_exact(&mut domain_bytes)?;
                let domain = String::from_utf8_lossy(&domain_bytes).to_string();

                let mut port_bytes = [0u8; 2];
                reader.read_exact(&mut port_bytes)?;
                let port = u16::from_be_bytes(port_bytes);

                Ok(TargetAddr::Domain(domain, port))
            }
            Some(AddressType::Ipv6) => {
                let mut addr_bytes = [0u8; 16];
                reader.read_exact(&mut addr_bytes)?;
                let addr = Ipv6Addr::from(addr_bytes);

                let mut port_bytes = [0u8; 2];
                reader.read_exact(&mut port_bytes)?;
                let port = u16::from_be_bytes(port_bytes);

                Ok(TargetAddr::Ipv6(addr, port))
            }
            None => Err(ProtocolError::UnsupportedAddressType(addr_type[0]).into()),
        }
    }
}

/// SOCKS5握手请求
#[derive(Debug, Clone)]
pub struct HandshakeRequest {
    /// 版本号
    pub version: u8,
    /// 认证方法列表
    pub methods: Vec<AuthMethod>,
}

impl HandshakeRequest {
    /// 创建新的握手请求
    pub fn new(methods: Vec<AuthMethod>) -> Self {
        Self {
            version: SOCKS5_VERSION,
            methods,
        }
    }

    /// 从字节流解码握手请求
    pub fn decode<R: Read>(reader: &mut R) -> Result<Self> {
        let mut version = [0u8; 1];
        reader.read_exact(&mut version)?;

        if version[0] != SOCKS5_VERSION {
            return Err(ProtocolError::UnsupportedVersion(version[0]).into());
        }

        let mut method_count = [0u8; 1];
        reader.read_exact(&mut method_count)?;

        let mut methods = Vec::with_capacity(method_count[0] as usize);
        for _ in 0..method_count[0] {
            let mut method = [0u8; 1];
            reader.read_exact(&mut method)?;

            match AuthMethod::from_u8(method[0]) {
                Some(auth_method) => methods.push(auth_method),
                None => {
                    // 未知的认证方法，暂时跳过
                    continue;
                }
            }
        }

        Ok(Self {
            version: version[0],
            methods,
        })
    }

    /// 编码握手请求
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(self.version);
        buf.push(self.methods.len() as u8);

        for method in &self.methods {
            buf.push(method.to_u8());
        }

        buf
    }
}

/// SOCKS5握手响应
#[derive(Debug, Clone)]
pub struct HandshakeResponse {
    /// 版本号
    pub version: u8,
    /// 选择的认证方法
    pub method: AuthMethod,
}

impl HandshakeResponse {
    /// 创建新的握手响应
    pub fn new(method: AuthMethod) -> Self {
        Self {
            version: SOCKS5_VERSION,
            method,
        }
    }

    /// 从字节流解码握手响应
    pub fn decode<R: Read>(reader: &mut R) -> Result<Self> {
        let mut version = [0u8; 1];
        reader.read_exact(&mut version)?;

        if version[0] != SOCKS5_VERSION {
            return Err(ProtocolError::UnsupportedVersion(version[0]).into());
        }

        let mut method = [0u8; 1];
        reader.read_exact(&mut method)?;

        match AuthMethod::from_u8(method[0]) {
            Some(auth_method) => Ok(Self {
                version: version[0],
                method: auth_method,
            }),
            None => Err(ProtocolError::UnsupportedAuthMethod(method[0]).into()),
        }
    }

    /// 编码握手响应
    pub fn encode(&self) -> Vec<u8> {
        vec![self.version, self.method.to_u8()]
    }
}

/// SOCKS5响应状态码
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reply {
    /// 成功
    Success = 0x00,
    /// 一般性SOCKS服务器失败
    GeneralFailure = 0x01,
    /// 连接不被规则允许
    ConnectionNotAllowed = 0x02,
    /// 网络不可达
    NetworkUnreachable = 0x03,
    /// 主机不可达
    HostUnreachable = 0x04,
    /// 连接被拒绝
    ConnectionRefused = 0x05,
    /// TTL过期
    TtlExpired = 0x06,
    /// 命令不支持
    CommandNotSupported = 0x07,
    /// 地址类型不支持
    AddressTypeNotSupported = 0x08,
}

impl Reply {
    /// 从u8创建Reply
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0x00 => Some(Reply::Success),
            0x01 => Some(Reply::GeneralFailure),
            0x02 => Some(Reply::ConnectionNotAllowed),
            0x03 => Some(Reply::NetworkUnreachable),
            0x04 => Some(Reply::HostUnreachable),
            0x05 => Some(Reply::ConnectionRefused),
            0x06 => Some(Reply::TtlExpired),
            0x07 => Some(Reply::CommandNotSupported),
            0x08 => Some(Reply::AddressTypeNotSupported),
            _ => None,
        }
    }

    /// 转换为u8
    pub fn to_u8(self) -> u8 {
        self as u8
    }
}

/// SOCKS5请求
#[derive(Debug, Clone)]
pub struct Request {
    /// 版本号
    pub version: u8,
    /// 命令
    pub command: Command,
    /// 目标地址
    pub dest_addr: TargetAddr,
}

impl Request {
    /// 从字节流解码请求
    pub fn decode<R: Read>(reader: &mut R) -> Result<Self> {
        let mut version = [0u8; 1];
        reader.read_exact(&mut version)?;

        if version[0] != SOCKS5_VERSION {
            return Err(ProtocolError::UnsupportedVersion(version[0]).into());
        }

        let mut command = [0u8; 1];
        reader.read_exact(&mut command)?;

        let cmd = Command::from_u8(command[0])
            .ok_or_else(|| ProtocolError::UnsupportedCommand(command[0]))?;

        // 跳过RSV字段
        let mut rsv = [0u8; 1];
        reader.read_exact(&mut rsv)?;

        let dest_addr = TargetAddr::decode(reader)?;

        Ok(Self {
            version: version[0],
            command: cmd,
            dest_addr,
        })
    }

    /// 编码请求
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(self.version);
        buf.push(self.command.to_u8());
        buf.push(0x00); // RSV
        buf.extend_from_slice(&self.dest_addr.encode());
        buf
    }
}

/// SOCKS5响应
#[derive(Debug, Clone)]
pub struct Response {
    /// 版本号
    pub version: u8,
    /// 响应状态
    pub reply: Reply,
    /// 绑定地址
    pub bind_addr: TargetAddr,
}

impl Response {
    /// 创建新的响应
    pub fn new(reply: Reply, bind_addr: TargetAddr) -> Self {
        Self {
            version: SOCKS5_VERSION,
            reply,
            bind_addr,
        }
    }

    /// 从字节流解码响应
    pub fn decode<R: Read>(reader: &mut R) -> Result<Self> {
        let mut version = [0u8; 1];
        reader.read_exact(&mut version)?;

        if version[0] != SOCKS5_VERSION {
            return Err(ProtocolError::UnsupportedVersion(version[0]).into());
        }

        let mut reply = [0u8; 1];
        reader.read_exact(&mut reply)?;

        let rep = Reply::from_u8(reply[0])
            .ok_or_else(|| ProtocolError::GeneralFailure(format!("Invalid reply code: {}", reply[0])))?;

        // 跳过RSV字段
        let mut rsv = [0u8; 1];
        reader.read_exact(&mut rsv)?;

        let bind_addr = TargetAddr::decode(reader)?;

        Ok(Self {
            version: version[0],
            reply: rep,
            bind_addr,
        })
    }

    /// 编码响应
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(self.version);
        buf.push(self.reply.to_u8());
        buf.push(0x00); // RSV
        buf.extend_from_slice(&self.bind_addr.encode());
        buf
    }

    /// 创建成功响应
    pub fn success(bind_addr: TargetAddr) -> Self {
        Self::new(Reply::Success, bind_addr)
    }

    /// 创建失败响应
    pub fn failure(reply: Reply) -> Self {
        // 失败时使用无效的绑定地址
        Self::new(reply, TargetAddr::Ipv4(Ipv4Addr::new(0, 0, 0, 0), 0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handshake_request_encode() {
        let request = HandshakeRequest::new(vec![AuthMethod::None, AuthMethod::UserPass]);
        let encoded = request.encode();

        assert_eq!(encoded.len(), 4);
        assert_eq!(encoded[0], SOCKS5_VERSION);
        assert_eq!(encoded[1], 2);
        assert_eq!(encoded[2], AuthMethod::None.to_u8());
        assert_eq!(encoded[3], AuthMethod::UserPass.to_u8());
    }

    #[test]
    fn test_target_addr_ipv4_encode() {
        let addr = TargetAddr::Ipv4(Ipv4Addr::new(127, 0, 0, 1), 8080);
        let encoded = addr.encode();

        assert_eq!(encoded.len(), 7);
        assert_eq!(encoded[0], AddressType::Ipv4.to_u8());
        assert_eq!(&encoded[1..5], &[127, 0, 0, 1]);
        assert_eq!(&encoded[5..7], &[31, 144]); // 8080 in big endian
    }

    #[test]
    fn test_target_addr_domain_encode() {
        let addr = TargetAddr::Domain("example.com".to_string(), 443);
        let encoded = addr.encode();

        assert_eq!(encoded.len(), 15); // 1(type) + 1(len) + 11(domain) + 2(port)
        assert_eq!(encoded[0], AddressType::Domain.to_u8());
        assert_eq!(encoded[1], 11); // "example.com" length
        assert_eq!(&encoded[2..13], b"example.com");
        assert_eq!(&encoded[13..15], &[1, 187]); // 443 in big endian
    }
}
