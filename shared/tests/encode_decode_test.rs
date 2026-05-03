//! 测试encode/decode是否匹配

use shared::KingObj;

#[test]
fn test_encode_decode_simple() {
    println!("\n=== 测试简单的encode/decode ===");

    let original = vec![1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    println!("原始数据: {:?}", original);

    let mut king = KingObj::new();
    println!("king seed: {}", king.seed());

    // 编码
    let mut data = original.clone();
    king.encode(&mut data, original.len()).expect("编码失败");
    println!("编码后: {:?}", data);

    // 解码（使用同一个king实例）
    let mut decoded = data.clone();
    king.decode(&mut decoded, original.len()).expect("解码失败");
    println!("解码后: {:?}", decoded);

    // 验证
    assert_eq!(decoded, original);
    println!("✅ 编码/解码匹配！");
}

#[test]
fn test_encode_decode_with_popcount() {
    println!("\n=== 测试encode/decode + popcount调整 ===");

    let original = vec![1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    println!("原始数据: {:?}", original);

    let mut king = KingObj::new();
    println!("king seed: {}", king.seed());

    // 编码
    let mut data = original.clone();
    king.encode(&mut data, original.len()).expect("编码失败");
    println!("编码后: {:?}", data);

    // Popcount调整
    let seed = king.seed();
    let (adjusted, bits_added) = shared::adjust_popcount(data, seed, (2.5, 5.2))
        .expect("Popcount调整失败");
    println!("Popcount调整后: {:?}, 添加比特: {}", adjusted, bits_added);

    // Popcount反向调整
    let reversed = shared::reverse_popcount_adjust(adjusted, seed)
        .expect("Popcount反向调整失败");
    println!("Popcount反向调整后: {:?}", reversed);

    // 解码（使用同一个king实例）
    let mut decoded = reversed.clone();
    king.decode(&mut decoded, original.len()).expect("解码失败");
    println!("解码后: {:?}", decoded);

    // 验证
    assert_eq!(decoded, original);
    println!("✅ 完整流程匹配！");
}
