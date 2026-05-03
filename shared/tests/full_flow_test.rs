//! 测试完整的加密解密流程

use shared::AuthPacket;

#[test]
fn test_full_encryption_decryption_flow() {
    println!("\n=== 测试完整的加密解密流程 ===");

    let shared_secret = b"test_secret";
    let username = "alice";
    let sequence = 42;

    // 创建认证包
    let auth_packet = AuthPacket::new(username.to_string(), shared_secret, sequence);
    println!("1. 认证包创建成功");

    // 查看原始序列化数据
    let serialized = auth_packet.serialize();
    println!("2. 序列化长度: {}, 前10字节: {:?}", serialized.len(), &serialized[..10]);

    // 使用同一个king实例进行加密和解密
    let mut king = shared::KingObj::new();
    println!("3. king seed (加密前): {}", king.seed());

    // 加密
    let encrypted = auth_packet.serialize_encrypted(&mut king, Some(7))
        .expect("加密失败");
    println!("4. 加密成功，总长度: {}", encrypted.len());
    println!("5. 加密数据前12字节: {:?}", &encrypted[..12]);

    // 解密（使用同一个king实例）
    let (decrypted, auth_byte) = AuthPacket::deserialize_encrypted(&encrypted, &mut king)
        .expect("解密失败");

    println!("6. 解密成功");
    println!("7. 用户名: {}, 序列号: {}, 鉴权字节: {:?}",
             decrypted.username, decrypted.sequence, auth_byte);

    // 验证
    assert_eq!(decrypted.username, username);
    assert_eq!(decrypted.sequence, sequence);
    assert_eq!(auth_byte, Some(7));

    println!("✅ 完整的加密解密流程测试通过！");
}
