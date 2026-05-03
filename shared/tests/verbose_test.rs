//! 详细的调试测试

use shared::{AuthPacket, KingObj};

#[test]
fn test_verbose_encryption_decryption() {
    println!("\n=== 详细的加密解密测试 ===");

    let shared_secret = b"test_secret";
    let username = "testuser".to_string();
    let sequence = 123;

    let auth_packet = AuthPacket::new(username.clone(), shared_secret, sequence);
    println!("1. 认证包创建成功");

    // 序列化
    let serialized = auth_packet.serialize();
    println!("2. 序列化长度: {}", serialized.len());
    println!("2a. 序列化数据前10字节: {:?}", &serialized[..10]);

    // 加密 - 使用同一个king实例
    let mut king = KingObj::new();
    let mut data_clone = serialized.clone();
    king.encode(&mut data_clone, serialized.len()).expect("编码失败");
    println!("3. 加密后长度: {} (seed: {})", data_clone.len(), king.seed());

    // Popcount调整
    let seed = king.seed();
    let (adjusted_data, bits_added) = shared::adjust_popcount(data_clone, seed, (2.5, 5.2))
        .expect("Popcount调整失败");
    println!("4. Popcount调整后长度: {}, 添加比特: {}", adjusted_data.len(), bits_added);

    // 查看前10字节
    println!("5. 调整后数据前10字节: {:?}", &adjusted_data[..10]);

    // 添加前缀
    let prefix = shared::generate_protocol_prefix(5);
    let final_len = adjusted_data.len();
    println!("6. 前缀: {:?}, 长度字段: {}", std::str::from_utf8(&prefix).unwrap(), final_len);

    // 构建最终数据
    let mut final_data = Vec::new();
    final_data.extend_from_slice(&prefix);
    final_data.extend_from_slice(&(final_len as u16).to_be_bytes());
    final_data.extend_from_slice(&adjusted_data);

    println!("7. 最终数据总长度: {}", final_data.len());
    println!("8. 最终数据前12字节: {:?}", &final_data[..12]);

    // ===== 开始解密 =====
    println!("\n=== 开始解密 ===");

    // 移除前缀
    const PREFIX_LEN: usize = 6;
    let data_without_prefix = &final_data[PREFIX_LEN..];
    println!("9. 移除前缀后长度: {}", data_without_prefix.len());

    // 读取长度
    let len = u16::from_be_bytes([data_without_prefix[0], data_without_prefix[1]]) as usize;
    println!("10. 读取长度字段: {}", len);

    // 读取加密数据
    let encrypted = &data_without_prefix[2..2 + len];
    println!("11. 加密数据长度: {}", encrypted.len());
    println!("12. 加密数据前10字节: {:?}", &encrypted[..10]);

    // 分离popcount标签和加密数据
    if encrypted.len() < 4 {
        println!("❌ 数据太短，无法分离popcount标签");
        return;
    }

    let popcount_tag = &encrypted[..4];
    let encrypted_data = &encrypted[4..];
    println!("13. Popcount标签: {:?}", popcount_tag);
    println!("14. 加密数据长度: {}", encrypted_data.len());

    // 解密数据部分 - 使用同一个king实例
    println!("15a. 加密器seed (用于后续解码): {}", king.seed());

    let mut decrypted = encrypted_data.to_vec();
    king.decode(&mut decrypted, encrypted_data.len()).expect("解密失败");
    println!("15b. 解密器seed (解码后): {}", king.seed());
    println!("15. 解密后长度: {}", decrypted.len());
    println!("16. 解密后前10字节: {:?}", &decrypted[..10]);

    // 重新组合
    let mut full_decrypted = Vec::with_capacity(4 + decrypted.len());
    full_decrypted.extend_from_slice(popcount_tag);
    full_decrypted.extend_from_slice(&decrypted);
    println!("17. 组合后长度: {}", full_decrypted.len());

    // Popcount反向调整
    let seed2 = king.seed();
    println!("18. king seed (用于反向调整): {}", seed2);

    match shared::reverse_popcount_adjust(full_decrypted, seed2) {
        Ok(reversed) => {
            println!("19. 反向调整后长度: {}", reversed.len());
            println!("20. 反向调整后前10字节: {:?}", &reversed[..10]);

            // 尝试反序列化
            match AuthPacket::deserialize(&reversed) {
                Ok(packet) => {
                    println!("✅ 反序列化成功！");
                    println!("用户名: {}", packet.username);
                    println!("序列号: {}", packet.sequence);
                }
                Err(e) => {
                    println!("❌ 反序列化失败: {:?}", e);
                }
            }
        }
        Err(e) => {
            println!("❌ 反向调整失败: {:?}", e);
        }
    }
}
