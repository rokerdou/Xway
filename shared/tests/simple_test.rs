//! 简单的认证包测试

use shared::AuthPacket;

#[test]
fn test_auth_packet_serialize_deserialize() {
    println!("\n=== 测试认证包序列化反序列化 ===");

    let shared_secret = b"test_secret";
    let username = "testuser".to_string();
    let sequence = 123;

    let auth_packet = AuthPacket::new(username.clone(), shared_secret, sequence);
    println!("✅ 认证包创建成功");

    // 测试基本的序列化和反序列化
    let serialized = auth_packet.serialize();
    println!("序列化长度: {}", serialized.len());

    let deserialized = AuthPacket::deserialize(&serialized)
        .expect("反序列化失败");

    assert_eq!(deserialized.username, username);
    assert_eq!(deserialized.sequence, sequence);
    println!("✅ 序列化反序列化测试通过\n");
}

#[test]
fn test_auth_packet_encrypt_decrypt() {
    println!("\n=== 测试认证包加密解密 ===");

    let shared_secret = b"test_secret";
    let username = "testuser".to_string();
    let sequence = 123;

    let auth_packet = AuthPacket::new(username.clone(), shared_secret, sequence);
    println!("✅ 认证包创建成功");

    // 加密（不带鉴权字节）
    let mut king = shared::KingObj::new();
    let encrypted = auth_packet.serialize_encrypted(&mut king, None)
        .expect("加密失败");
    println!("加密后总长度: {}", encrypted.len());

    // 解密 - 使用同一个king实例
    let (decrypted, _) = AuthPacket::deserialize_encrypted(&encrypted, &mut king)
        .expect("解密失败");
    println!("✅ 解密成功");

    assert_eq!(decrypted.username, username);
    assert_eq!(decrypted.sequence, sequence);
    println!("✅ 加密解密测试通过\n");
}

#[test]
fn test_auth_packet_with_auth_byte() {
    println!("\n=== 测试带鉴权字节的认证包 ===");

    let shared_secret = b"test_secret";
    let username = "testuser".to_string();
    let sequence = 456;

    let auth_packet = AuthPacket::new(username.clone(), shared_secret, sequence);

    // 使用鉴权字节 5
    let auth_byte = 5u8;

    let mut king = shared::KingObj::new();
    let encrypted = auth_packet.serialize_encrypted(&mut king, Some(auth_byte))
        .expect("加密失败");
    println!("加密后总长度: {}", encrypted.len());

    // 验证前缀
    assert!(encrypted.starts_with(b"GET /5"));
    println!("✅ 前缀验证通过: GET /5");

    // 解密 - 使用同一个king实例
    let (decrypted, returned_auth) = AuthPacket::deserialize_encrypted(&encrypted, &mut king)
        .expect("解密失败");

    assert_eq!(returned_auth, Some(auth_byte));
    assert_eq!(decrypted.username, username);
    assert_eq!(decrypted.sequence, sequence);
    println!("✅ 带鉴权字节的测试通过\n");
}
