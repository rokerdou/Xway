//! 认证模块
//!
//! 使用HMAC-SHA256实现客户端-服务端认证
//! 认证包格式：长度(2) + username_len(1) + username + timestamp(8) + sequence(8) + hmac(32)

use crate::{KingObj, ProtocolError, Result};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

/// 认证包
#[derive(Debug, Clone)]
pub struct AuthPacket {
    /// 用户名
    pub username: String,
    /// 时间戳（秒）
    pub timestamp: u64,
    /// 序列号
    pub sequence: u64,
    /// HMAC签名
    pub hmac: [u8; 32],
}

impl AuthPacket {
    /// 创建新的认证包
    ///
    /// # 参数
    /// - `username`: 用户名
    /// - `shared_secret`: 共享密钥（用于HMAC）
    /// - `sequence`: 序列号
    pub fn new(username: String, shared_secret: &[u8], sequence: u64) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let hmac = Self::compute_hmac(&username, timestamp, sequence, shared_secret);

        Self {
            username,
            timestamp,
            sequence,
            hmac,
        }
    }

    /// 计算HMAC
    ///
    /// HMAC-SHA256(shared_secret, username + timestamp(8) + sequence(8))
    #[inline(always)]
    fn compute_hmac(username: &str, timestamp: u64, sequence: u64, shared_secret: &[u8]) -> [u8; 32] {
        let mut mac = HmacSha256::new_from_slice(shared_secret).unwrap();

        // 写入用户名
        mac.update(username.as_bytes());

        // 写入时间戳（大端序）
        mac.update(&timestamp.to_be_bytes());

        // 写入序列号（大端序）
        mac.update(&sequence.to_be_bytes());

        // 计算HMAC
        let result = mac.finalize();
        let mut hmac_bytes = [0u8; 32];
        hmac_bytes.copy_from_slice(result.into_bytes().as_slice());

        hmac_bytes
    }

    /// 验证认证包
    ///
    /// # 返回
    /// - `Ok(())`: 认证成功
    /// - `Err(_)`: 认证失败（HMAC不匹配或时间戳过期）
    pub fn verify(&self, shared_secret: &[u8], max_time_diff_secs: u64) -> Result<()> {
        // 验证HMAC
        let expected_hmac = Self::compute_hmac(&self.username, self.timestamp, self.sequence, shared_secret);
        if self.hmac != expected_hmac {
            return Err(ProtocolError::AuthenticationFailed.into());
        }

        // 验证时间戳（防止重放攻击）
        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // 检查时间戳是否在允许范围内
        if self.timestamp > current_time {
            return Err(ProtocolError::GeneralFailure("时间戳在未来".to_string()).into());
        }

        let time_diff = current_time.saturating_sub(self.timestamp);
        if time_diff > max_time_diff_secs {
            return Err(ProtocolError::GeneralFailure(format!("时间戳过期（超过{}秒）", max_time_diff_secs)).into());
        }

        Ok(())
    }

    /// 序列化认证包（不加密）
    ///
    /// 格式：username_len(1) + username + timestamp(8) + sequence(8) + hmac(32)
    #[inline(always)]
    pub fn serialize(&self) -> Vec<u8> {
        let username_bytes = self.username.as_bytes();
        let username_len = username_bytes.len();

        // 总长度：username_len(1) + username + timestamp(8) + sequence(8) + hmac(32)
        let total_len = 1 + username_len + 8 + 8 + 32;
        let mut buffer = Vec::with_capacity(total_len);

        // 用户名长度（1字节）
        buffer.push(username_len as u8);

        // 用户名
        buffer.extend_from_slice(username_bytes);

        // 时间戳（8字节，大端序）
        buffer.extend_from_slice(&self.timestamp.to_be_bytes());

        // 序列号（8字节，大端序）
        buffer.extend_from_slice(&self.sequence.to_be_bytes());

        // HMAC（32字节）
        buffer.extend_from_slice(&self.hmac);

        buffer
    }

    /// 反序列化认证包（不加密）
    ///
    /// # 参数
    /// - `data`: 数据（不包含长度前缀）
    #[inline(always)]
    pub fn deserialize(data: &[u8]) -> Result<Self> {
        if data.len() < 1 + 8 + 8 + 32 {
            return Err(ProtocolError::InvalidLength.into());
        }

        let mut pos = 0;

        // 读取用户名长度
        let username_len = data[pos] as usize;
        pos += 1;

        // 检查数据长度是否足够
        if data.len() < 1 + username_len + 8 + 8 + 32 {
            return Err(ProtocolError::InvalidLength.into());
        }

        // 读取用户名
        let username = String::from_utf8(data[pos..pos + username_len].to_vec())
            .map_err(|_| ProtocolError::InvalidFormat)?;
        pos += username_len;

        // 读取时间戳
        let timestamp = u64::from_be_bytes(data[pos..pos + 8].try_into().unwrap());
        pos += 8;

        // 读取序列号
        let sequence = u64::from_be_bytes(data[pos..pos + 8].try_into().unwrap());
        pos += 8;

        // 读取HMAC
        let mut hmac = [0u8; 32];
        hmac.copy_from_slice(&data[pos..pos + 32]);

        Ok(Self {
            username,
            timestamp,
            sequence,
            hmac,
        })
    }

    /// 序列化并加密认证包
    ///
    /// 返回格式：长度(2) + 加密数据
    #[inline(always)]
    pub fn serialize_encrypted(&self, encryptor: &mut KingObj) -> Result<Vec<u8>> {
        // 先序列化
        let mut data = self.serialize();

        // 加密
        let len = data.len();
        encryptor.encode(&mut data, len)?;

        // 添加长度前缀（2字节，大端序）
        let mut result = Vec::with_capacity(2 + len);
        result.extend_from_slice(&(len as u16).to_be_bytes());
        result.extend_from_slice(&data);

        Ok(result)
    }

    /// 解密并反序列化认证包
    ///
    /// # 参数
    /// - `data`: 包含长度前缀的数据（长度(2) + 加密数据）
    #[inline(always)]
    pub fn deserialize_encrypted(data: &[u8], decryptor: &mut KingObj) -> Result<Self> {
        if data.len() < 2 {
            return Err(ProtocolError::InvalidLength.into());
        }

        // 读取长度
        let len = u16::from_be_bytes([data[0], data[1]]) as usize;

        if data.len() < 2 + len {
            return Err(ProtocolError::InvalidLength.into());
        }

        // 解密数据
        let mut decrypted = data[2..2 + len].to_vec();
        decryptor.decode(&mut decrypted, len)?;

        // 反序列化
        Self::deserialize(&decrypted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_packet_new_and_verify() {
        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        // 创建认证包
        let packet = AuthPacket::new(username.clone(), shared_secret, sequence);

        // 验证认证包
        let result = packet.verify(shared_secret, 300);
        assert!(result.is_ok(), "验证应该成功");
    }

    #[test]
    fn test_auth_packet_hmac_verification() {
        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username.clone(), shared_secret, sequence);

        // 使用错误的密钥验证
        let wrong_secret = b"wrong_secret_key_54321";
        let result = packet.verify(wrong_secret, 300);
        assert!(result.is_err(), "使用错误密钥验证应该失败");
    }

    #[test]
    fn test_auth_packet_serialize_deserialize() {
        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username.clone(), shared_secret, sequence);

        // 序列化
        let serialized = packet.serialize();

        // 反序列化
        let deserialized = AuthPacket::deserialize(&serialized).unwrap();

        // 验证
        assert_eq!(deserialized.username, username);
        assert_eq!(deserialized.sequence, sequence);
        assert_eq!(deserialized.hmac, packet.hmac);
    }

    #[test]
    fn test_auth_packet_serialize_deserialize_encrypted() {
        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username.clone(), shared_secret, sequence);

        // 序列化并加密
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor).unwrap();

        // 解密并反序列化
        let mut decryptor = KingObj::new();
        let decrypted = AuthPacket::deserialize_encrypted(&encrypted, &mut decryptor).unwrap();

        // 验证
        assert_eq!(decrypted.username, username);
        assert_eq!(decrypted.sequence, sequence);
        assert_eq!(decrypted.hmac, packet.hmac);
    }

    #[test]
    fn test_auth_packet_size() {
        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username, shared_secret, sequence);

        // 序列化后的长度应该是：1 (username_len) + 8 (testuser) + 8 (timestamp) + 8 (sequence) + 32 (hmac) = 57
        let serialized = packet.serialize();
        assert_eq!(serialized.len(), 57);

        // 加密后的长度应该是：2 (length prefix) + 57 (data) = 59
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor).unwrap();
        assert_eq!(encrypted.len(), 59);
    }

    #[test]
    fn test_auth_packet_long_username() {
        let shared_secret = b"test_secret_key_12345";
        let username = "very_long_username_with_many_characters_12345".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username.clone(), shared_secret, sequence);

        // 序列化并加密
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor).unwrap();

        // 解密并反序列化
        let mut decryptor = KingObj::new();
        let decrypted = AuthPacket::deserialize_encrypted(&encrypted, &mut decryptor).unwrap();

        // 验证
        assert_eq!(decrypted.username, username);
        assert_eq!(decrypted.sequence, sequence);
    }

    #[test]
    fn test_auth_packet_sequence_increment() {
        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();

        // 创建不同序列号的认证包
        let packet1 = AuthPacket::new(username.clone(), shared_secret, 1);
        let packet2 = AuthPacket::new(username.clone(), shared_secret, 2);
        let packet3 = AuthPacket::new(username.clone(), shared_secret, 3);

        // 验证所有认证包
        assert!(packet1.verify(shared_secret, 300).is_ok());
        assert!(packet2.verify(shared_secret, 300).is_ok());
        assert!(packet3.verify(shared_secret, 300).is_ok());

        // 验证HMAC不同
        assert_ne!(packet1.hmac, packet2.hmac);
        assert_ne!(packet2.hmac, packet3.hmac);
    }

    #[test]
    fn test_auth_packet_max_time_diff() {
        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let mut packet = AuthPacket::new(username, shared_secret, sequence);

        // 测试正常时间范围
        let result = packet.verify(shared_secret, 300);
        assert!(result.is_ok());

        // 测试过期时间戳
        packet.timestamp = packet.timestamp.saturating_sub(301);
        let result = packet.verify(shared_secret, 300);
        assert!(result.is_err());
    }
}
