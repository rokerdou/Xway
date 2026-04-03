//! King流加密算法（简化实现）
//!
//! 采用基于映射表的字节替换加密

use std::sync::atomic::{AtomicUsize, Ordering};
use crate::error::Result;
use super::king_maps::{ENMAP, DEMAP};

/// 全局offset计数器
static GLOBAL_OFFSET: AtomicUsize = AtomicUsize::new(0);

/// King加密对象
pub struct KingObj {
    encode_index: usize,
    decode_index: usize,
    seed: u8,
}

impl KingObj {
    pub fn new() -> Self {
        let offset = Self::update_offset();
        let seed = (offset % 256) as u8;

        Self {
            encode_index: 0,
            decode_index: 0,
            seed,
        }
    }

    fn update_offset() -> usize {
        GLOBAL_OFFSET.fetch_add(1, Ordering::SeqCst)
    }

    pub fn reload_seed(&mut self) {
        let offset = Self::update_offset();
        self.seed = (offset % 256) as u8;
        self.encode_index = 0;
        self.decode_index = 0;
    }

    pub fn encode(&mut self, data: &mut [u8], len: usize) -> Result<()> {
        if len > data.len() {
            return Err(crate::error::ProxyError::Crypto(
                "长度超出数据边界".to_string()
            ));
        }

        for i in 0..len {
            let encrypted = ENMAP[data[i] as usize];
            data[i] = encrypted;
        }

        self.encode_index = (self.encode_index + len) % 256;
        Ok(())
    }

    pub fn decode(&mut self, data: &mut [u8], len: usize) -> Result<()> {
        if len > data.len() {
            return Err(crate::error::ProxyError::Crypto(
                "长度超出数据边界".to_string()
            ));
        }

        for i in 0..len {
            let decrypted = DEMAP[data[i] as usize];
            data[i] = decrypted;
        }

        self.decode_index = (self.decode_index + len) % 256;
        Ok(())
    }

    pub fn seed(&self) -> u8 {
        self.seed
    }

    pub fn encode_index(&self) -> usize {
        self.encode_index
    }

    pub fn decode_index(&self) -> usize {
        self.decode_index
    }

    #[cfg(test)]
    pub fn set_seed(&mut self, seed: u8) {
        self.seed = seed;
    }

    #[cfg(test)]
    pub fn reset_index(&mut self) {
        self.encode_index = 0;
        self.decode_index = 0;
    }
}

impl Default for KingObj {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_king_creation() {
        let king = KingObj::new();
        assert_eq!(king.encode_index(), 0);
        assert_eq!(king.decode_index(), 0);
    }

    #[test]
    fn test_encode_decode_roundtrip() {
        let mut encryptor = KingObj::new();
        let original = b"Hello, World!";
        let mut data = original.to_vec();
        let data_len = data.len();

        encryptor.encode(&mut data, data_len).unwrap();
        assert_ne!(&data[..], &original[..]);

        let mut decryptor = KingObj::new();
        decryptor.set_seed(encryptor.seed());
        decryptor.decode(&mut data, data_len).unwrap();

        assert_eq!(&data[..], &original[..]);
    }

    #[test]
    fn test_encode_preserves_length() {
        let mut king = KingObj::new();
        let mut data = vec![0u8; 100];

        let original_len = data.len();
        king.encode(&mut data, original_len).unwrap();

        assert_eq!(data.len(), original_len);
    }

    #[test]
    fn test_decode_preserves_length() {
        let mut king = KingObj::new();
        let mut data = vec![0u8; 100];

        let original_len = data.len();
        king.decode(&mut data, original_len).unwrap();

        assert_eq!(data.len(), original_len);
    }

    #[test]
    fn test_encode_empty_data() {
        let mut king = KingObj::new();
        let mut data = vec![];

        king.encode(&mut data, 0).unwrap();
        assert_eq!(data.len(), 0);
    }

    #[test]
    fn test_encode_too_long() {
        let mut king = KingObj::new();
        let mut data = vec![0u8; 10];

        let result = king.encode(&mut data, 20);
        assert!(result.is_err());
    }

    #[test]
    fn test_single_byte_encrypt_decrypt() {
        println!("\n=== 测试: 单字节加密解密 ===");

        let mut encryptor = KingObj::new();
        let mut decryptor = KingObj::new();
        decryptor.set_seed(encryptor.seed());

        let original: u8 = 0x41; // 'A'
        let mut data = vec![original];

        println!("原始值: 0x{:02X} ('{}')", original, original as char);

        encryptor.encode(&mut data, 1).unwrap();
        let encrypted = data[0];
        println!("加密后: 0x{:02X}", encrypted);

        assert_ne!(encrypted, original, "加密应该改变字节值");

        decryptor.decode(&mut data, 1).unwrap();
        let decrypted = data[0];
        println!("解密后: 0x{:02X} ('{}')", decrypted, decrypted as char);

        assert_eq!(decrypted, original, "解密应该恢复原值");
        println!("✅ 单字节测试通过");
    }

    #[test]
    fn test_all_byte_values() {
        println!("\n=== 测试: 所有可能的字节值 ===");

        let mut encryptor = KingObj::new();
        let mut decryptor = KingObj::new();
        decryptor.set_seed(encryptor.seed());

        let original: Vec<u8> = (0..=255).collect();
        let mut data = original.clone();

        println!("测试所有256个字节值...");

        encryptor.encode(&mut data, 256).unwrap();
        println!("加密完成，验证数据已改变...");
        assert_ne!(&data[..], &original[..], "加密应该改变所有字节");

        decryptor.decode(&mut data, 256).unwrap();
        println!("解密完成，验证数据恢复...");

        for i in 0..256 {
            assert_eq!(data[i], original[i],
                "字节{}应该正确恢复: 期望0x{:02X}, 实际0x{:02X}",
                i, original[i], data[i]);
        }

        println!("✅ 所有字节值测试通过");
    }

    #[test]
    fn test_chinese_characters() {
        println!("\n=== 测试: 中文字符加密解密 ===");

        let mut encryptor = KingObj::new();
        let mut decryptor = KingObj::new();
        decryptor.set_seed(encryptor.seed());

        let original = "你好世界";
        let mut data = original.as_bytes().to_vec();

        println!("原始值: {}", original);

        let len = data.len();
        encryptor.encode(&mut data, len).unwrap();

        decryptor.decode(&mut data, len).unwrap();
        let decrypted = std::str::from_utf8(&data).unwrap();

        println!("解密后: {}", decrypted);

        assert_eq!(decrypted, original, "中文字符应该正确加密解密");
        println!("✅ 中文字符测试通过");
    }
}
