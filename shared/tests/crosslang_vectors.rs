//! Cross-language test-vector generator for the Go port (transport/xway).
//! Run with: cargo test -p shared --test crosslang_vectors -- --nocapture
use hkdf::Hkdf;
use sha2::Sha256;
use shared::AuthPacket;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[test]
fn print_vectors() {
    let secret = b"vector-secret-0123456789abcdef";
    let salt = [7u8; 32];

    let hkdf = Hkdf::<Sha256>::new(Some(&salt), secret);
    let mut c2s = [0u8; 32];
    let mut s2c = [0u8; 32];
    hkdf.expand(b"xway-session-c2s-v2", &mut c2s).unwrap();
    hkdf.expand(b"xway-session-s2c-v2", &mut s2c).unwrap();
    println!("VECTOR_C2S_KEY={}", hex(&c2s));
    println!("VECTOR_S2C_KEY={}", hex(&s2c));

    let mut sf1 = [0u8; 32];
    let mut sf2 = [0u8; 32];
    let mut sf1_s2c = [0u8; 32];
    hkdf.expand(b"xway-session-c2s-v2-sf1", &mut sf1).unwrap();
    hkdf.expand(b"xway-session-c2s-v2-sf2", &mut sf2).unwrap();
    hkdf.expand(b"xway-session-s2c-v2-sf1", &mut sf1_s2c).unwrap();
    println!("VECTOR_C2S_SF1={}", hex(&sf1));
    println!("VECTOR_C2S_SF2={}", hex(&sf2));
    println!("VECTOR_S2C_SF1={}", hex(&sf1_s2c));

    let username = "vector-user".to_string();
    let sequence = 0x1122334455667788u64;
    let packet = AuthPacket::new(username.clone(), secret, sequence);
    println!("VECTOR_AUTH_TS={}", packet.timestamp);
    println!("VECTOR_AUTH_HMAC={}", hex(&packet.hmac));
    println!("VECTOR_AUTH_SERIALIZE={}", hex(&packet.serialize()));

    let session_id = shared::derive_session_id(secret, &salt).unwrap();
    println!("VECTOR_SESSION_ID={}", hex(&session_id));

    let mut hello = shared::ClientHello::new(Some(packet));
    hello.salt = salt;
    hello.subflows = 4;
    println!("VECTOR_HELLO_SF4={}", hex(&hello.encode()));
    let decoded = shared::ClientHello::decode(&hello.encode()).unwrap();
    assert_eq!(decoded.subflows, 4);
}
