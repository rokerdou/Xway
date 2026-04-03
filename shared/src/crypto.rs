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
// AVX2 SIMD实现（x86_64）- 真正的并行查表
// ============================================================================

#[cfg(target_arch = "x86_64")]
use std::arch::x86_64::*;

// ============================================================================
// 预计算查找表（编译时生成）
// ============================================================================

#[cfg(target_arch = "x86_64")]
fn build_shuffle_table(table: &[u8; 256]) -> [__m256i; 16] {
    unsafe {
        let mut shuffle_tables = [zeroed_mm256(); 16];

        // 为每个高4位值（0-15）构建一个16字节的shuffle表
        for hi_nibble in 0..16 {
            let mut subtable = [0i8; 32];

            // 填充这个高4位对应的所有16个低4位值
            for lo_nibble in 0..16 {
                let full_byte = (hi_nibble << 4) | lo_nibble;
                subtable[lo_nibble] = table[full_byte] as i8;
                subtable[lo_nibble + 16] = table[full_byte] as i8; // 填充高128位
            }

            shuffle_tables[hi_nibble as usize] = _mm256_loadu_si256(subtable.as_ptr() as *const __m256i);
        }

        shuffle_tables
    }
}

#[cfg(target_arch = "x86_64")]
unsafe fn zeroed_mm256() -> __m256i {
    _mm256_setzero_si256()
}

// 加密查找表（lazy初始化，使用Once保证线程安全）
#[cfg(target_arch = "x86_64")]
static ENMAP_SHUFFLE: std::sync::OnceLock<[__m256i; 16]> = std::sync::OnceLock::new();

#[cfg(target_arch = "x86_64")]
fn get_enmap_shuffle() -> &'static [__m256i; 16] {
    ENMAP_SHUFFLE.get_or_init(|| build_shuffle_table(&ENMAP))
}

// 解密查找表（lazy初始化）
#[cfg(target_arch = "x86_64")]
static DEMAP_SHUFFLE: std::sync::OnceLock<[__m256i; 16]> = std::sync::OnceLock::new();

#[cfg(target_arch = "x86_64")]
fn get_demap_shuffle() -> &'static [__m256i; 16] {
    DEMAP_SHUFFLE.get_or_init(|| build_shuffle_table(&DEMAP))
}

#[cfg(target_arch = "x86_64")]
unsafe fn encode_avx2(data: &mut [u8], len: usize) {
    let shuffle_tables = get_enmap_shuffle();
    let data_ptr = data.as_mut_ptr();

    // 处理32字节块
    let mut i = 0;
    while i + 32 <= len {
        // 加载32字节输入
        let input = _mm256_loadu_si256(data_ptr.add(i) as *const __m256i);

        // 并行查表：高4位选子表，低4位做shuffle索引
        let result = lookup_256_avx2(input, shuffle_tables);

        // 存储32字节结果
        _mm256_storeu_si256(data_ptr.add(i) as *mut __m256i, result);
        i += 32;
    }

    // 处理16字节块
    while i + 16 <= len {
        let input = _mm256_castsi128_si256(_mm_loadu_si128(data_ptr.add(i) as *const __m128i));
        let result_256 = lookup_256_avx2(input, shuffle_tables);
        let result = _mm256_castsi256_si128(result_256);
        _mm_storeu_si128(data_ptr.add(i) as *mut __m128i, result);
        i += 16;
    }

    // 处理剩余字节（标量回退）
    let enmap: &[u8; 256] = &ENMAP;
    while i < len {
        *data_ptr.add(i) = enmap[*data_ptr.add(i) as usize];
        i += 1;
    }
}

#[cfg(target_arch = "x86_64")]
unsafe fn decode_avx2(data: &mut [u8], len: usize) {
    let shuffle_tables = get_demap_shuffle();
    let data_ptr = data.as_mut_ptr();

    // 处理32字节块
    let mut i = 0;
    while i + 32 <= len {
        let input = _mm256_loadu_si256(data_ptr.add(i) as *const __m256i);
        let result = lookup_256_avx2(input, shuffle_tables);
        _mm256_storeu_si256(data_ptr.add(i) as *mut __m256i, result);
        i += 32;
    }

    // 处理16字节块
    while i + 16 <= len {
        let input = _mm256_castsi128_si256(_mm_loadu_si128(data_ptr.add(i) as *const __m128i));
        let result_256 = lookup_256_avx2(input, shuffle_tables);
        let result = _mm256_castsi256_si128(result_256);
        _mm_storeu_si128(data_ptr.add(i) as *mut __m128i, result);
        i += 16;
    }

    // 处理剩余字节（标量回退）
    let demap: &[u8; 256] = &DEMAP;
    while i < len {
        *data_ptr.add(i) = demap[*data_ptr.add(i) as usize];
        i += 1;
    }
}

/// 真正的SIMD并行查表：使用_mm256_shuffle_epi8
///
/// 算法：
/// 1. 将256字节表分成16个16字节子表（按输入字节的高4位索引）
/// 2. 对每个输入字节，高4位决定使用哪个子表
/// 3. 低4位作为shuffle索引在子表中查找
///
/// 性能优化：
/// - 使用_epi16移位适合8位字节数据
/// - 纯逻辑运算（OR+AND）替代条件选择（blendv）
/// - 从0开始OR累加，避免特殊处理
#[cfg(target_arch = "x86_64")]
#[inline(always)]
unsafe fn lookup_256_avx2(input: __m256i, table: &[__m256i; 16]) -> __m256i {
    // 提取低4位作为shuffle索引（每个字节的低4位）
    let lo = _mm256_and_si256(input, _mm256_set1_epi8(0x0F));

    // 提取高4位（决定选择哪个子表）
    // 使用16位右移，更适合8位字节数据处理
    let hi = _mm256_and_si256(
        _mm256_srli_epi16(input, 4),
        _mm256_set1_epi8(0x0F),
    );

    // 从0开始，通过OR累加16个masked结果
    let mut result = _mm256_setzero_si256();

    // 16路并行"选择"（关键优化点）
    // 对每个可能的hi值（0-15）：
    // 1. 生成mask：标记哪些字节的高4位等于当前hi值
    // 2. shuffle：用对应的子表查表
    // 3. AND+OR：将masked的查表结果OR到最终结果
    for i in 0..16 {
        // 创建mask：选择高4位等于i的字节
        let mask = _mm256_cmpeq_epi8(hi, _mm256_set1_epi8(i as i8));

        // 用对应的表shuffle（并行查表）
        let shuffled = _mm256_shuffle_epi8(table[i], lo);

        // 纯逻辑运算：result | (shuffled & mask)
        // 只保留高4位匹配的字节的查表结果
        result = _mm256_or_si256(
            result,
            _mm256_and_si256(shuffled, mask),
        );
    }

    result
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
