//! King流加密算法（SIMD优化）
//!
//! 采用基于映射表的字节替换加密
//! 使用AVX2 SIMD指令加速（16/32字节块处理）

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

        // SIMD优化路径（x86_64 with AVX2）
        #[cfg(target_arch = "x86_64")]
        {
            if is_x86_feature_detected!("avx2") {
                unsafe { encode_avx2(data, len); }
            } else {
                encode_scalar(data, len);
            }
        }

        #[cfg(not(target_arch = "x86_64"))]
        {
            encode_scalar(data, len);
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

        // SIMD优化路径（x86_64 with AVX2）
        #[cfg(target_arch = "x86_64")]
        {
            if is_x86_feature_detected!("avx2") {
                unsafe { decode_avx2(data, len); }
            } else {
                decode_scalar(data, len);
            }
        }

        #[cfg(not(target_arch = "x86_64"))]
        {
            decode_scalar(data, len);
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

// ============================================================================
// 标量实现（回退路径）
// ============================================================================

#[inline(always)]
fn encode_scalar(data: &mut [u8], len: usize) {
    for i in 0..len {
        data[i] = ENMAP[data[i] as usize];
    }
}

#[inline(always)]
fn decode_scalar(data: &mut [u8], len: usize) {
    for i in 0..len {
        data[i] = DEMAP[data[i] as usize];
    }
}

// ============================================================================
// AVX2 SIMD实现（x86_64）
// ============================================================================

#[cfg(target_arch = "x86_64")]
use std::arch::x86_64::*;

#[cfg(target_arch = "x86_64")]
unsafe fn encode_avx2(data: &mut [u8], len: usize) {
    let enmap: &[u8; 256] = &ENMAP;
    let data_ptr = data.as_mut_ptr();

    // 处理32字节块
    let mut i = 0;
    while i + 32 <= len {
        // 加载32字节
        let chunk = _mm256_loadu_si256(data_ptr.add(i) as *const __m256i);

        // 分成两个16字节块处理
        let lo = _mm256_castsi256_si128(chunk);
        let hi = _mm256_extracti128_si256(chunk, 1);

        // 处理低16字节
        let result_lo = process_16_bytes_en(lo, enmap);

        // 处理高16字节
        let result_hi = process_16_bytes_en(hi, enmap);

        // 组合结果：将两个128位结果正确组合成256位
        let result = _mm256_setr_m128i(result_lo, result_hi);

        // 存储32字节
        _mm256_storeu_si256(data_ptr.add(i) as *mut __m256i, result);
        i += 32;
    }

    // 处理16字节块
    while i + 16 <= len {
        let chunk = _mm_loadu_si128(data_ptr.add(i) as *const __m128i);
        let result = process_16_bytes_en(chunk, enmap);
        _mm_storeu_si128(data_ptr.add(i) as *mut __m128i, result);
        i += 16;
    }

    // 处理剩余字节
    while i < len {
        *data_ptr.add(i) = enmap[*data_ptr.add(i) as usize];
        i += 1;
    }
}

#[cfg(target_arch = "x86_64")]
unsafe fn decode_avx2(data: &mut [u8], len: usize) {
    let demap: &[u8; 256] = &DEMAP;
    let data_ptr = data.as_mut_ptr();

    // 处理32字节块
    let mut i = 0;
    while i + 32 <= len {
        let chunk = _mm256_loadu_si256(data_ptr.add(i) as *const __m256i);
        let lo = _mm256_castsi256_si128(chunk);
        let hi = _mm256_extracti128_si256(chunk, 1);

        let result_lo = process_16_bytes_de(lo, demap);
        let result_hi = process_16_bytes_de(hi, demap);

        // 组合结果：将两个128位结果正确组合成256位
        let result = _mm256_setr_m128i(result_lo, result_hi);

        _mm256_storeu_si256(data_ptr.add(i) as *mut __m256i, result);
        i += 32;
    }

    // 处理16字节块
    while i + 16 <= len {
        let chunk = _mm_loadu_si128(data_ptr.add(i) as *const __m128i);
        let result = process_16_bytes_de(chunk, demap);
        _mm_storeu_si128(data_ptr.add(i) as *mut __m128i, result);
        i += 16;
    }

    // 处理剩余字节
    while i < len {
        *data_ptr.add(i) = demap[*data_ptr.add(i) as usize];
        i += 1;
    }
}

// SIMD辅助函数：并行查找16字节（加密）
#[cfg(target_arch = "x86_64")]
#[inline(always)]
unsafe fn process_16_bytes_en(input: __m128i, table: &[u8; 256]) -> __m128i {
    // 提取16个字节并查找
    let b0 = table[_mm_extract_epi8(input, 0) as usize] as i8;
    let b1 = table[_mm_extract_epi8(input, 1) as usize] as i8;
    let b2 = table[_mm_extract_epi8(input, 2) as usize] as i8;
    let b3 = table[_mm_extract_epi8(input, 3) as usize] as i8;
    let b4 = table[_mm_extract_epi8(input, 4) as usize] as i8;
    let b5 = table[_mm_extract_epi8(input, 5) as usize] as i8;
    let b6 = table[_mm_extract_epi8(input, 6) as usize] as i8;
    let b7 = table[_mm_extract_epi8(input, 7) as usize] as i8;
    let b8 = table[_mm_extract_epi8(input, 8) as usize] as i8;
    let b9 = table[_mm_extract_epi8(input, 9) as usize] as i8;
    let b10 = table[_mm_extract_epi8(input, 10) as usize] as i8;
    let b11 = table[_mm_extract_epi8(input, 11) as usize] as i8;
    let b12 = table[_mm_extract_epi8(input, 12) as usize] as i8;
    let b13 = table[_mm_extract_epi8(input, 13) as usize] as i8;
    let b14 = table[_mm_extract_epi8(input, 14) as usize] as i8;
    let b15 = table[_mm_extract_epi8(input, 15) as usize] as i8;

    _mm_setr_epi8(
        b0, b1, b2, b3, b4, b5, b6, b7,
        b8, b9, b10, b11, b12, b13, b14, b15,
    )
}

// SIMD辅助函数：并行查找16字节（解密）
#[cfg(target_arch = "x86_64")]
#[inline(always)]
unsafe fn process_16_bytes_de(input: __m128i, table: &[u8; 256]) -> __m128i {
    let b0 = table[_mm_extract_epi8(input, 0) as usize] as i8;
    let b1 = table[_mm_extract_epi8(input, 1) as usize] as i8;
    let b2 = table[_mm_extract_epi8(input, 2) as usize] as i8;
    let b3 = table[_mm_extract_epi8(input, 3) as usize] as i8;
    let b4 = table[_mm_extract_epi8(input, 4) as usize] as i8;
    let b5 = table[_mm_extract_epi8(input, 5) as usize] as i8;
    let b6 = table[_mm_extract_epi8(input, 6) as usize] as i8;
    let b7 = table[_mm_extract_epi8(input, 7) as usize] as i8;
    let b8 = table[_mm_extract_epi8(input, 8) as usize] as i8;
    let b9 = table[_mm_extract_epi8(input, 9) as usize] as i8;
    let b10 = table[_mm_extract_epi8(input, 10) as usize] as i8;
    let b11 = table[_mm_extract_epi8(input, 11) as usize] as i8;
    let b12 = table[_mm_extract_epi8(input, 12) as usize] as i8;
    let b13 = table[_mm_extract_epi8(input, 13) as usize] as i8;
    let b14 = table[_mm_extract_epi8(input, 14) as usize] as i8;
    let b15 = table[_mm_extract_epi8(input, 15) as usize] as i8;

    _mm_setr_epi8(
        b0, b1, b2, b3, b4, b5, b6, b7,
        b8, b9, b10, b11, b12, b13, b14, b15,
    )
}

// ============================================================================
// 单元测试
// ============================================================================

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

    #[test]
    fn test_large_data_simd() {
        println!("\n=== 测试: 大数据块SIMD处理 ===");

        let mut encryptor = KingObj::new();
        let mut decryptor = KingObj::new();
        decryptor.set_seed(encryptor.seed());

        // 测试32字节对齐的大数据
        let original: Vec<u8> = (0..8192).map(|i| i as u8).collect();
        let mut data = original.clone();

        println!("测试8KB数据（32字节对齐）...");

        encryptor.encode(&mut data, 8192).unwrap();
        assert_ne!(&data[..], &original[..], "加密应该改变所有字节");

        decryptor.decode(&mut data, 8192).unwrap();
        assert_eq!(&data[..], &original[..], "解密应该恢复所有字节");

        println!("✅ 大数据块测试通过");
    }

    #[test]
    fn test_non_aligned_data() {
        println!("\n=== 测试: 非对齐数据 ===");

        let mut encryptor = KingObj::new();
        let mut decryptor = KingObj::new();
        decryptor.set_seed(encryptor.seed());

        // 测试非16/32字节对齐的大小
        for size in [15, 17, 31, 33, 100, 1023].iter() {
            let original: Vec<u8> = (0..*size).map(|i| i as u8).collect();
            let mut data = original.clone();

            encryptor.encode(&mut data, *size).unwrap();
            decryptor.decode(&mut data, *size).unwrap();

            assert_eq!(&data[..], &original[..],
                "大小{}的数据应该正确往返", size);
        }

        println!("✅ 非对齐数据测试通过");
    }
}
