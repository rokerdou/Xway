//! 测试认证包的popcount处理修复

use shared::{AuthPacket, KingObj, generate_protocol_prefix, reverse_popcount_adjust};

#[test]
fn test_auth_packet_with_popcount() {
    println!("\n=== 测试认证包的popcount处理 ===");

    let shared_secret = b"test_secret";
    let username = "testuser";
    let sequence = 123;

    // 创建认证包
    let auth_packet = AuthPacket::new(username.to_string(), shared_secret, sequence);

    // 序列化
    let serialized = auth_packet.serialize();
    println!("1. 序列化长度: {}", serialized.len());

    // 加密
    let mut king = KingObj::new();
    let mut encrypted = serialized.clone();
    king.encode(&mut encrypted, serialized.len()).expect("加密失败");
    println!("2. 加密后长度: {}", encrypted.len());

    // Popcount调整（客户端发送时做的）
    let seed = king.seed();
    let (adjusted, bits_added) = shared::adjust_popcount(encrypted, seed, (2.5, 5.2))
        .expect("Popcount调整失败");
    println!("3. Popcount调整后长度: {}, 添加比特: {}", adjusted.len(), bits_added);

    // 添加前缀和长度字段（模拟网络传输）
    let prefix = shared::generate_protocol_prefix(5);
    let len = adjusted.len() as u16;

    let mut full_packet = Vec::new();
    full_packet.extend_from_slice(&prefix);
    full_packet.extend_from_slice(&len.to_be_bytes());
    full_packet.extend_from_slice(&adjusted);

    println!("4. 完整包长度: {}", full_packet.len());

    // ===== 服务端处理 =====
    println!("\n【服务端】");

    // 移除前缀和长度字段
    let data_without_prefix = &full_packet[6..];
    let data_len = u16::from_be_bytes([data_without_prefix[0], data_without_prefix[1]]) as usize;
    let encrypted_data = &data_without_prefix[2..2+data_len];

    println!("5. 读取加密数据长度: {}", encrypted_data.len());

    // 分离popcount标签和加密数据
    let popcount_tag = &encrypted_data[..4];
    let encrypted_only = &encrypted_data[4..];

    println!("6. Popcount标签: {:?}", popcount_tag);
    println!("7. 加密数据长度: {}", encrypted_only.len());

    // 解密（使用新的KingObj实例，模拟真实场景）
    let mut server_king = KingObj::new();
    let mut decrypted = encrypted_only.to_vec();
    server_king.decode(&mut decrypted, encrypted_only.len()).expect("解密失败");

    println!("8. 解密后长度: {}", decrypted.len());

    // 重新组合popcount标签 + 解密数据
    let mut full_decrypted = Vec::with_capacity(4 + decrypted.len());
    full_decrypted.extend_from_slice(popcount_tag);
    full_decrypted.extend_from_slice(&decrypted);

    println!("9. 组合后长度: {}", full_decrypted.len());

    // Popcount反向调整（关键修复！）
    let reversed = reverse_popcount_adjust(full_decrypted, server_king.seed())
        .expect("Popcount反向调整失败");

    println!("10. 反向调整后长度: {}", reversed.len());

    // 反序列化
    let decoded_packet = AuthPacket::deserialize(&reversed)
        .expect("反序列化失败");

    println!("11. 用户名: {}, 序列号: {}", decoded_packet.username, decoded_packet.sequence);

    // 验证
    assert_eq!(decoded_packet.username, username);
    assert_eq!(decoded_packet.sequence, sequence);

    println!("✅ 测试通过！认证包的popcount处理正确！\n");
}
