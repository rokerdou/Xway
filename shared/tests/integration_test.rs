//! 客户端-服务端集成测试
//!
//! 测试完整的加密解密流程

use shared::{AuthPacket, KingObj, TargetAddr, generate_protocol_prefix, extract_auth_byte_from_prefix, generate_first_auth_byte, verify_first_auth_byte, adjust_popcount, reverse_popcount_adjust};

#[test]
fn test_client_server_auth_flow() {
    println!("\n=== 测试客户端-服务端认证流程 ===");

    let shared_secret = b"test_secret_key_12345";
    let username = "testuser".to_string();
    let sequence = 12345;

    // === 客户端 ===
    println!("\n【客户端】");

    let auth_packet = AuthPacket::new(username.clone(), shared_secret, sequence);
    println!("✅ 认证包创建成功");

    // 客户端生成鉴权字节
    let shared_secret_byte = shared_secret[0];
    let auth_byte = generate_first_auth_byte(shared_secret_byte);
    println!("✅ 鉴权字节生成: {}", auth_byte);

    // 客户端加密（使用新的KingObj，模拟真实场景）
    let mut client_king = KingObj::new();
    let encrypted = auth_packet.serialize_encrypted(&mut client_king, Some(auth_byte))
        .expect("加密失败");

    println!("✅ 认证包加密成功，总长度: {}", encrypted.len());

    // === 服务端 ===
    println!("\n【服务端】");

    // 服务端解密（使用新的KingObj，模拟真实场景）
    let mut server_king = KingObj::new();
    let (decrypted_packet, returned_auth_byte) = AuthPacket::deserialize_encrypted(&encrypted, &mut server_king)
        .expect("解密失败");

    println!("✅ 认证包解密成功");

    // 验证数据
    assert_eq!(decrypted_packet.username, username, "用户名应该匹配");
    assert_eq!(decrypted_packet.sequence, sequence, "序列号应该匹配");
    assert_eq!(returned_auth_byte, Some(auth_byte), "鉴权字节应该匹配");

    // 验证HMAC
    decrypted_packet.verify(shared_secret, 300).expect("HMAC验证失败");

    println!("✅ 认证包验证通过");
    println!("✅ 客户端-服务端认证流程测试通过\n");
}

#[test]
fn test_client_server_target_address() {
    println!("\n=== 测试客户端-服务端目标地址传输 ===");

    // 目标地址
    let target_addr = TargetAddr::Domain("example.com".to_string(), 443);
    println!("目标地址: {:?}", target_addr);

    // === 客户端 ===
    println!("\n【客户端】");

    let addr_bytes = target_addr.encode();
    println!("1. 编码长度: {}", addr_bytes.len());

    // 客户端加密
    let mut client_king = KingObj::new();
    let mut encrypted = addr_bytes.clone();
    client_king.encode(&mut encrypted, addr_bytes.len()).expect("加密失败");

    // Popcount调整
    let seed = client_king.seed();
    let (adjusted_data, bits_added) = adjust_popcount(encrypted, seed, (2.5, 5.2))
        .expect("Popcount调整失败");

    println!("2. 加密并调整后长度: {}, 添加比特: {}", adjusted_data.len(), bits_added);

    // === 服务端 ===
    println!("\n【服务端】");

    // Popcount反向调整
    let mut reversed = reverse_popcount_adjust(adjusted_data, seed)
        .expect("Popcount反向调整失败");

    println!("3. 反向调整后长度: {}", reversed.len());

    // 服务端解密（使用新的KingObj）
    let mut server_king = KingObj::new();
    server_king.decode(&mut reversed, addr_bytes.len()).expect("解密失败");

    println!("4. 解密后长度: {}", reversed.len());

    // 解析目标地址
    use std::io::Cursor;
    let mut cursor = Cursor::new(&reversed[..addr_bytes.len()]);
    let decoded_addr = TargetAddr::decode(&mut cursor)
        .expect("解析目标地址失败");

    assert_eq!(&decoded_addr, &target_addr, "目标地址应该匹配");
    println!("✅ 目标地址: {:?}", decoded_addr);
    println!("✅ 客户端-服务端目标地址传输测试通过\n");
}

#[test]
fn test_auth_packet_encryption_roundtrip() {
    println!("\n=== 测试认证包加密解密往返 ===");

    let shared_secret = b"test_secret_key_12345";
    let username = "testuser".to_string();
    let sequence = 12345;

    // 创建认证包
    let auth_packet = AuthPacket::new(username.clone(), shared_secret, sequence);
    println!("✅ 认证包创建成功");

    // 序列化并加密（客户端）
    let mut client_king = KingObj::new();
    let auth_byte = 5;
    let encrypted = auth_packet.serialize_encrypted(&mut client_king, Some(auth_byte))
        .expect("加密失败");

    println!("✅ 认证包加密成功，总长度: {}", encrypted.len());

    // 验证协议前缀
    assert!(encrypted.starts_with(b"GET /"), "应该以GET /开头");
    println!("✅ 协议前缀验证通过");

    // 提取鉴权字节
    let prefix = &encrypted[..6];
    let extracted_auth = extract_auth_byte_from_prefix(prefix)
        .expect("前缀格式错误");
    assert_eq!(extracted_auth, auth_byte, "鉴权字节应该匹配");
    println!("✅ 鉴权字节提取验证通过: {}", auth_byte);

    // 解密并反序列化（服务端）
    let mut server_king = KingObj::new();
    let (decrypted_packet, returned_auth_byte) = AuthPacket::deserialize_encrypted(&encrypted, &mut server_king)
        .expect("解密失败");

    // 验证数据
    assert_eq!(decrypted_packet.username, username, "用户名应该匹配");
    assert_eq!(decrypted_packet.sequence, sequence, "序列号应该匹配");
    assert_eq!(returned_auth_byte, Some(auth_byte), "鉴权字节应该匹配");
    assert_eq!(decrypted_packet.hmac, auth_packet.hmac, "HMAC应该匹配");

    println!("✅ 认证包解密验证通过");
    println!("✅ 认证包加密解密往返测试通过\n");
}

#[test]
fn test_first_auth_byte_generation_and_verification() {
    println!("\n=== 测试首字节鉴权生成和验证 ===");

    let shared_secret = 42u8;

    // 生成鉴权字节
    let auth_byte = generate_first_auth_byte(shared_secret);
    println!("生成的鉴权字节: {}", auth_byte);

    // 验证鉴权字节（300秒容差）
    let valid = verify_first_auth_byte(auth_byte, shared_secret, 300);
    assert!(valid, "鉴权验证应该成功");

    println!("✅ 首字节鉴权生成和验证测试通过\n");
}

#[test]
fn test_protocol_prefix_generation() {
    println!("\n=== 测试协议前缀生成 ===");

    for auth_byte in 0..=8 {
        let prefix = generate_protocol_prefix(auth_byte);
        let prefix_str = String::from_utf8_lossy(&prefix);

        // 验证前缀格式
        assert_eq!(prefix.len(), 6, "前缀应该是6字节");
        assert!(prefix.starts_with(b"GET /"), "应该以GET /开头");

        // 验证最后一个字节是鉴权字节
        assert_eq!(prefix[5], b'0' + auth_byte, "最后一个字节应该是鉴权字节");

        // 验证所有字符都是可打印ASCII
        for &byte in &prefix {
            assert!(byte >= 0x20 && byte <= 0x7E, "前缀必须是可打印ASCII");
        }

        println!("鉴权字节 {}: {} ✓", auth_byte, prefix_str);
    }

    println!("✅ 协议前缀生成测试通过\n");
}
