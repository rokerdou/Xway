//! 认证模块
//!
//! 使用HMAC-SHA256实现客户端-服务端认证
//! 认证包格式：长度(2) + username_len(1) + username + timestamp(8) + sequence(8) + hmac(32)

use crate::{KingObj, ProtocolError, Result, adjust_popcount, reverse_popcount_adjust};
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
    /// 客户端IP（用于首字节鉴权）
    pub client_ip: String,
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
            client_ip: "0.0.0.0".to_string(),  // 默认值
        }
    }

    /// 创建新的认证包（包含客户端IP）
    ///
    /// # 参数
    /// - `username`: 用户名
    /// - `shared_secret`: 共享密钥（用于HMAC）
    /// - `sequence`: 序列号
    /// - `client_ip`: 客户端IP地址
    pub fn new_with_ip(
        username: String,
        shared_secret: &[u8],
        sequence: u64,
        client_ip: String,
    ) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let hmac = Self::compute_hmac_with_ip(
            &username,
            timestamp,
            sequence,
            shared_secret,
            &client_ip,
        );

        Self {
            username,
            timestamp,
            sequence,
            hmac,
            client_ip,
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

    /// 计算HMAC（包含客户端IP）
    ///
    /// HMAC-SHA256(shared_secret, username + timestamp(8) + sequence(8) + client_ip)
    #[inline(always)]
    fn compute_hmac_with_ip(
        username: &str,
        timestamp: u64,
        sequence: u64,
        shared_secret: &[u8],
        client_ip: &str,
    ) -> [u8; 32] {
        let mut mac = HmacSha256::new_from_slice(shared_secret).unwrap();

        // 写入用户名
        mac.update(username.as_bytes());

        // 写入时间戳（大端序）
        mac.update(&timestamp.to_be_bytes());

        // 写入序列号（大端序）
        mac.update(&sequence.to_be_bytes());

        // 写入客户端IP
        mac.update(client_ip.as_bytes());

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
        // 验证HMAC（向后兼容：如果client_ip是默认值，使用不带IP的HMAC）
        let expected_hmac = if self.client_ip == "0.0.0.0" {
            // 向后兼容：使用旧的HMAC计算方法
            Self::compute_hmac(
                &self.username,
                self.timestamp,
                self.sequence,
                shared_secret,
            )
        } else {
            // 新版本：包含客户端IP的HMAC
            Self::compute_hmac_with_ip(
                &self.username,
                self.timestamp,
                self.sequence,
                shared_secret,
                &self.client_ip,
            )
        };

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
    /// 格式：username_len(1) + username + timestamp(8) + sequence(8) + hmac(32) + client_ip_len(2) + client_ip
    #[inline(always)]
    pub fn serialize(&self) -> Vec<u8> {
        let username_bytes = self.username.as_bytes();
        let username_len = username_bytes.len();

        let client_ip_bytes = self.client_ip.as_bytes();
        let client_ip_len = client_ip_bytes.len();

        // 总长度：username_len(1) + username + timestamp(8) + sequence(8) + hmac(32) + client_ip_len(2) + client_ip
        let total_len = 1 + username_len + 8 + 8 + 32 + 2 + client_ip_len;
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

        // 客户端IP长度（2字节，大端序）
        buffer.extend_from_slice(&(client_ip_len as u16).to_be_bytes());

        // 客户端IP
        buffer.extend_from_slice(client_ip_bytes);

        buffer
    }

    /// 反序列化认证包（不加密）
    ///
    /// # 参数
    /// - `data`: 数据（不包含长度前缀）
    #[inline(always)]
    pub fn deserialize(data: &[u8]) -> Result<Self> {
        // 最小长度：username_len(1) + username(最小0) + timestamp(8) + sequence(8) + hmac(32) + client_ip_len(2) + client_ip(0)
        if data.len() < 1 + 8 + 8 + 32 + 2 {
            return Err(ProtocolError::InvalidLength.into());
        }

        let mut pos = 0;

        // 读取用户名长度
        let username_len = data[pos] as usize;
        pos += 1;

        // 检查数据长度是否足够
        if data.len() < 1 + username_len + 8 + 8 + 32 + 2 {
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
        pos += 32;

        // 读取客户端IP长度
        let client_ip_len = u16::from_be_bytes(data[pos..pos + 2].try_into().unwrap());
        pos += 2;

        // 检查数据长度是否足够
        if data.len() < 1 + username_len + 8 + 8 + 32 + 2 + client_ip_len as usize {
            return Err(ProtocolError::InvalidLength.into());
        }

        // 读取客户端IP
        let client_ip = String::from_utf8(data[pos..pos + client_ip_len as usize].to_vec())
            .map_err(|_| ProtocolError::InvalidFormat)?;
        pos += client_ip_len as usize;

        Ok(Self {
            username,
            timestamp,
            sequence,
            hmac,
            client_ip,
        })
    }

    /// 序列化并加密认证包 - 启用popcount调整
    ///
    /// 返回格式：[协议前缀] [长度(2)] [popcount调整后的加密数据]
    ///
    /// 协议前缀满足GFW Ex2规则（前6个可打印ASCII字符）
    /// Popcount调整满足GFW Ex1豁免（popcount <3.4 或 >4.6）
    ///
    /// 性能优化：
    /// - SIMD优化的popcount计算
    /// - 早期退出：如果已经在安全范围，跳过调整
    /// - 预分配内存，减少分配次数
    ///
    /// # 参数
    /// - `encryptor`: 加密器
    /// - `auth_byte`: 可选的鉴权字节 (0-8)，如果提供则生成带鉴权的协议前缀 "GET /X"
    #[inline(always)]
    pub fn serialize_encrypted(&self, encryptor: &mut KingObj, auth_byte: Option<u8>) -> Result<Vec<u8>> {
        // 先序列化
        let mut data = self.serialize();

        // 加密
        let len = data.len();
        encryptor.encode(&mut data, len)?;

        // ✅ 启用popcount调整（方案3）
        // 使用encryptor的seed作为popcount调整的seed
        let seed = encryptor.seed();
        // 目标范围：<3.4（添加0比特）或>4.6（添加1比特）
        let target_range = (2.5, 5.2);
        let (adjusted_data, _bits_added) = adjust_popcount(data, seed, target_range)?;

        // 生成协议前缀（带鉴权字节或默认）
        let prefix = if let Some(byte) = auth_byte {
            crate::generate_protocol_prefix(byte)
        } else {
            // 默认前缀 "GET /0" (鉴权字节为0)
            crate::generate_protocol_prefix(0)
        };

        // 构建最终数据：前缀(6) + 长度(2) + popcount调整后的数据
        let final_len = adjusted_data.len();
        let mut result = Vec::with_capacity(prefix.len() + 2 + final_len);

        // 添加协议前缀（满足Ex2: 前6个可打印ASCII）
        result.extend_from_slice(&prefix);

        // 添加长度前缀（2字节，大端序）
        result.extend_from_slice(&(final_len as u16).to_be_bytes());

        // 添加popcount调整后的数据
        result.extend_from_slice(&adjusted_data);

        Ok(result)
    }

    /// 解密并反序列化认证包 - 启用popcount反向调整
    ///
    /// # 参数
    /// - `data`: [协议前缀(6)] [长度(2)] [popcount调整后的加密数据]
    /// - `decryptor`: 解密器
    ///
    /// # 返回
    /// - `(Self, Option<u8>)`: 认证包和可选的鉴权字节
    #[inline(always)]
    pub fn deserialize_encrypted(data: &[u8], decryptor: &mut KingObj) -> Result<(Self, Option<u8>)> {
        const PREFIX_LEN: usize = 6;

        // 验证数据长度
        if data.len() < PREFIX_LEN {
            return Err(ProtocolError::InvalidLength.into());
        }

        // 提取协议前缀
        let prefix = &data[..PREFIX_LEN];

        // 验证前缀格式并提取鉴权字节
        let auth_byte = crate::extract_auth_byte_from_prefix(prefix);

        // 如果前缀无效,返回错误
        if auth_byte.is_none() {
            return Err(ProtocolError::GeneralFailure(format!(
                "无效的协议前缀: {:?}", prefix
            )).into());
        }

        let data_without_prefix = &data[PREFIX_LEN..];

        // 读取长度
        if data_without_prefix.len() < 2 {
            return Err(ProtocolError::InvalidLength.into());
        }

        let len = u16::from_be_bytes([data_without_prefix[0], data_without_prefix[1]]) as usize;

        if data_without_prefix.len() < 2 + len {
            return Err(ProtocolError::InvalidLength.into());
        }

        // 读取加密数据（包含4字节popcount标签）
        let encrypted = &data_without_prefix[2..2 + len];

        // 分离popcount标签和加密数据
        if encrypted.len() < 4 {
            return Err(ProtocolError::InvalidLength.into());
        }

        let popcount_tag = &encrypted[..4];  // 前4字节是popcount标签
        let encrypted_data = &encrypted[4..]; // 剩余的是加密数据

        // 只解密数据部分（不包括popcount标签）
        let mut decrypted = encrypted_data.to_vec();
        decryptor.decode(&mut decrypted, encrypted_data.len())?;

        // 重新组合：popcount标签 + 解密后的数据
        let mut full_decrypted = Vec::with_capacity(4 + decrypted.len());
        full_decrypted.extend_from_slice(popcount_tag);
        full_decrypted.extend_from_slice(&decrypted);

        // ✅ 启用popcount反向调整
        // 使用decryptor的seed作为popcount反向调整的seed
        let seed = decryptor.seed();
        let original_data = reverse_popcount_adjust(full_decrypted, seed)?;

        // 反序列化
        let packet = Self::deserialize(&original_data)?;

        Ok((packet, auth_byte))
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

        // 序列化并加密（不使用鉴权字节）
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor, None).unwrap();

        // 解密并反序列化
        let mut decryptor = KingObj::new();
        let (decrypted, auth_byte) = AuthPacket::deserialize_encrypted(&encrypted, &mut decryptor).unwrap();

        // 验证数据
        assert_eq!(decrypted.username, username);
        assert_eq!(decrypted.sequence, sequence);
        assert_eq!(decrypted.hmac, packet.hmac);
        // 验证鉴权字节（应该是0，因为未指定）
        assert_eq!(auth_byte, Some(0));
    }

    #[test]
    fn test_auth_packet_size() {
        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username, shared_secret, sequence);

        // 序列化后的长度应该是：
        // 1 (username_len) + 8 (testuser) + 8 (timestamp) + 8 (sequence) + 32 (hmac) + 2 (client_ip_len) + 7 ("0.0.0.0") = 66
        let serialized = packet.serialize();
        assert_eq!(serialized.len(), 66);

        // 加密后的长度应该是：6 (前缀) + 2 (length prefix) + 66 (data) = 74
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor, None).unwrap();
        assert_eq!(encrypted.len(), 74);
    }

    #[test]
    fn test_auth_packet_long_username() {
        let shared_secret = b"test_secret_key_12345";
        let username = "very_long_username_with_many_characters_12345".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username.clone(), shared_secret, sequence);

        // 序列化并加密（使用鉴权字节5）
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor, Some(5)).unwrap();

        // 解密并反序列化
        let mut decryptor = KingObj::new();
        let (decrypted, auth_byte) = AuthPacket::deserialize_encrypted(&encrypted, &mut decryptor).unwrap();

        // 验证
        assert_eq!(decrypted.username, username);
        assert_eq!(decrypted.sequence, sequence);
        assert_eq!(auth_byte, Some(5));
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

    #[test]
    fn test_protocol_prefix_integration() {
        // 测试协议前缀与加密集成
        use crate::generate_protocol_prefix;

        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;
        let auth_byte = 7;

        let packet = AuthPacket::new(username.clone(), shared_secret, sequence);

        // 序列化并加密（使用鉴权字节7）
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor, Some(auth_byte)).unwrap();

        // 验证包含正确的协议前缀
        let expected_prefix = generate_protocol_prefix(auth_byte);
        assert!(encrypted.starts_with(&expected_prefix),
                "加密数据应该以协议前缀开头");

        // 解密并反序列化
        let mut decryptor = KingObj::new();
        decryptor.set_seed(encryptor.seed());
        let (decrypted, extracted_auth_byte) = AuthPacket::deserialize_encrypted(&encrypted, &mut decryptor).unwrap();

        // 验证数据正确
        assert_eq!(decrypted.username, username);
        assert_eq!(decrypted.sequence, sequence);
        assert_eq!(extracted_auth_byte, Some(auth_byte));
    }

    #[test]
    fn test_protocol_prefix_length() {
        // 验证协议前缀满足Ex2规则（>=6个可打印ASCII）
        use crate::generate_protocol_prefix;

        let prefix = generate_protocol_prefix(0);

        assert!(prefix.len() >= 6,
                "协议前缀至少需要6个字符，当前: {}", prefix.len());

        // 验证所有字符都是可打印ASCII
        for (i, &byte) in prefix.iter().enumerate() {
            assert!(byte >= 0x20 && byte <= 0x7E,
                    "前缀第{}个字节不是可打印ASCII: 0x{:02X}", i, byte);
        }
    }

    #[test]
    fn test_popcount_adjust_roundtrip_with_encryption() {
        // 测试popcount调整的完整往返测试
        use crate::popcount::{calculate_avg_popcount, is_in_gfw_range};

        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username.clone(), shared_secret, sequence);

        // 序列化并加密（启用popcount调整）
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor, Some(3)).unwrap();

        // 解密并反序列化（启用popcount反向调整）
        let mut decryptor = KingObj::new();
        decryptor.set_seed(encryptor.seed());
        let (decrypted, auth_byte) = AuthPacket::deserialize_encrypted(&encrypted, &mut decryptor).unwrap();

        // 验证数据完整性
        assert_eq!(decrypted.username, username);
        assert_eq!(decrypted.sequence, sequence);
        assert_eq!(auth_byte, Some(3));

        // ✅ 新增：验证加密数据确实被调整到了安全范围外
        let prefix_len = 6;
        let encrypted_data = &encrypted[prefix_len + 2..];
        if encrypted_data.len() >= 8 {
            let data_popcount = calculate_avg_popcount(encrypted_data);
            assert!(!is_in_gfw_range(data_popcount),
                    "调整后的数据应该在GFW检测范围外: {}", data_popcount);
        }
    }

    #[test]
    fn test_encrypted_packet_with_prefix_analysis() {
        // 测试加密后的数据包特征
        use crate::generate_protocol_prefix;
        use crate::popcount::{calculate_avg_popcount, is_in_gfw_range};

        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username, shared_secret, sequence);

        // 序列化并加密（使用鉴权字节3，启用popcount调整）
        let mut encryptor = KingObj::new();
        let encrypted = packet.serialize_encrypted(&mut encryptor, Some(3)).unwrap();

        // 前缀部分应该有低popcount（可打印ASCII）
        let prefix = generate_protocol_prefix(3);
        let prefix_data = &encrypted[..prefix.len()];
        let prefix_popcount = calculate_avg_popcount(prefix_data);
        assert!(!is_in_gfw_range(prefix_popcount),
                "前缀的popcount应该在GFW检测范围外: {}", prefix_popcount);

        // ✅ 新增：验证popcount调整后的数据在安全范围外
        // 跳过前缀和长度字段，检查加密数据部分
        let encrypted_data = &encrypted[prefix.len() + 2..];
        if encrypted_data.len() >= 8 {
            let data_popcount = calculate_avg_popcount(encrypted_data);
            // popcount调整后应该在安全范围外
            assert!(!is_in_gfw_range(data_popcount) || data_popcount.is_nan(),
                    "调整后的数据popcount应该在GFW检测范围外: {}", data_popcount);
        }

        // 验证整体数据长度
        assert!(encrypted.len() > prefix.len() + 2,
                "加密数据应该包含：前缀 + 长度(2) + 数据");
    }

    #[test]
    fn test_popcount_adjust_performance() {
        // 性能测试：验证popcount调整不会显著影响性能
        use crate::popcount::calculate_avg_popcount;
        use std::time::Instant;

        let shared_secret = b"test_secret_key_12345";
        let username = "testuser".to_string();
        let sequence = 12345;

        let packet = AuthPacket::new(username, shared_secret, sequence);

        // 测试序列化性能（100次）
        let iterations = 100;
        let start = Instant::now();

        for _ in 0..iterations {
            let mut encryptor = KingObj::new();
            let _encrypted = packet.serialize_encrypted(&mut encryptor, Some(3)).unwrap();
        }

        let duration = start.elapsed();

        println!("序列化{}次耗时: {:?}", iterations, duration);
        let avg_time = duration.as_micros() as f32 / iterations as f32;
        println!("平均每次序列化: {:.2}μs", avg_time);

        // 性能要求：平均每次应该 < 1000μs (1ms)
        assert!(avg_time < 1000.0, "popcount调整后性能仍然良好");
    }
}
