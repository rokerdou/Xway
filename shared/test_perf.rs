use std::time::Instant;
use std::fs;

fn main() {
    // 创建测试数据（8KB）
    let mut data: Vec<u8> = (0..8192).map(|i| i as u8).collect();
    let original = data.clone();
    
    // 测试加密性能
    let iterations = 1000;
    
    let start = Instant::now();
    for _ in 0..iterations {
        let mut test_data = data.clone();
        let mut king = shared::KingObj::new();
        king.encode(&mut test_data, 8192).unwrap();
    }
    let encode_time = start.elapsed();
    
    // 测试解密性能
    let start = Instant::now();
    for _ in 0..iterations {
        let mut test_data = data.clone();
        let mut king = shared::KingObj::new();
        king.decode(&mut test_data, 8192).unwrap();
    }
    let decode_time = start.elapsed();
    
    println!("性能测试结果（8KB数据 x {}次迭代）:", iterations);
    println!("加密时间: {:.2} ms ({:.2} MB/s)", 
        encode_time.as_millis(),
        (8192.0 * iterations as f64) / (encode_time.as_secs_f64() * 1024.0 * 1024.0)
    );
    println!("解密时间: {:.2} ms ({:.2} MB/s)", 
        decode_time.as_millis(),
        (8192.0 * iterations as f64) / (decode_time.as_secs_f64() * 1024.0 * 1024.0)
    );
    println!("总时间: {:.2} ms", encode_time.as_millis() + decode_time.as_millis());
    
    // 验证结果正确性
    let mut king = shared::KingObj::new();
    king.encode(&mut data, 8192).unwrap();
    king.decode(&mut data, 8192).unwrap();
    assert_eq!(data, original, "加密解密结果不匹配");
    println!("✅ 结果验证通过");
}
