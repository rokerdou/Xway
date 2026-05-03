//! 调试测试 - 查看详细的加密解密过程

use shared::{AuthPacket, KingObj};

#[test]
fn test_debug_encrypt_process() {
    println!("\n=== 调试加密过程 ===");

    let shared_secret = b"test_secret";
    let username = "testuser".to_string();
    let sequence = 123;

    let auth_packet = AuthPacket::new(username.clone(), shared_secret, sequence);

    // 步骤1: 序列化
    let serialized = auth_packet.serialize();
    println!("步骤1 - 序列化后长度: {}", serialized.len());

    // 步骤2: 加密
    let mut encryptor = KingObj::new();
    let mut data_clone = serialized.clone();
    encryptor.encode(&mut data_clone, serialized.len()).expect("编码失败");
    println!("步骤2 - 加密后长度: {}", data_clone.len());

    // 步骤3: Popcount调整
    let seed = encryptor.seed();
    let (adjusted_data, bits_added) = shared::adjust_popcount(data_clone, seed, (2.5, 5.2))
        .expect("Popcount调整失败");
    println!("步骤3 - Popcount调整后长度: {}, 添加比特: {}", adjusted_data.len(), bits_added);

    // 步骤4: 添加前缀和长度
    let prefix = shared::generate_protocol_prefix(5);
    let final_len = adjusted_data.len();
    println!("步骤4 - 前缀: {:?}, 长度字段: {}", prefix, final_len);

    // 总长度
    let total_len = prefix.len() + 2 + final_len;
    println!("步骤5 - 总长度: {} = {}(前缀) + 2(长度) + {}(数据)",
             total_len, prefix.len(), final_len);
}

#[test]
fn test_debug_decrypt_process() {
    println!("\n=== 调试解密过程 ===");

    let shared_secret = b"test_secret";
    let username = "testuser".to_string();
    let sequence = 123;

    let auth_packet = AuthPacket::new(username.clone(), shared_secret, sequence);

    // 完整加密
    let mut encryptor = KingObj::new();
    let encrypted = auth_packet.serialize_encrypted(&mut encryptor, Some(5))
        .expect("加密失败");

    println!("加密数据总长度: {}", encrypted.len());
    println!("加密数据前10字节: {:?}", &encrypted[..10]);

    // 手动解密
    const PREFIX_LEN: usize = 6;
    let prefix = &encrypted[..PREFIX_LEN];
    println!("前缀: {:?}", prefix);

    let data_without_prefix = &encrypted[PREFIX_LEN..];
    println!("前缀后剩余长度: {}", data_without_prefix.len());

    if data_without_prefix.len() >= 2 {
        let len = u16::from_be_bytes([data_without_prefix[0], data_without_prefix[1]]) as usize;
        println!("长度字段: {}", len);
        println!("剩余数据长度: {}", data_without_prefix.len() - 2);

        if data_without_prefix.len() >= 2 + len {
            let encrypted_data = &data_without_prefix[2..2+len];
            println!("加密数据长度: {}", encrypted_data.len());

            // 解密
            let mut decryptor = KingObj::new();
            let mut decrypted = encrypted_data.to_vec();
            decryptor.decode(&mut decrypted, len).expect("解密失败");
            println!("解密后长度: {}", decrypted.len());

            // Popcount反向调整
            let seed = decryptor.seed();
            println!("解密器seed: {}", seed);

            match shared::reverse_popcount_adjust(decrypted, seed) {
                Ok(reversed) => {
                    println!("Popcount反向调整后长度: {}", reversed.len());

                    // 尝试反序列化
                    match AuthPacket::deserialize(&reversed) {
                        Ok(packet) => {
                            println!("✅ 反序列化成功!");
                            println!("用户名: {}, 序列号: {}", packet.username, packet.sequence);
                        }
                        Err(e) => {
                            println!("❌ 反序列化失败: {:?}", e);
                            println!("数据长度: {}, 数据: {:?}", reversed.len(), reversed);
                        }
                    }
                }
                Err(e) => {
                    println!("❌ Popcount反向调整失败: {:?}", e);
                }
            }
        } else {
            println!("❌ 数据长度不足: 需要 {}, 实际 {}", 2 + len, data_without_prefix.len());
        }
    } else {
        println!("❌ 没有长度字段");
    }
}
