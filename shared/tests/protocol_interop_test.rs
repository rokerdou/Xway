use shared::{
    decode_obfuscated_frame, encode_obfuscated_frame, generate_first_auth_byte, AuthPacket,
    TargetAddr, DEFAULT_MAX_PADDING,
};

#[test]
fn client_server_auth_target_and_data_frames_interoperate() {
    let secret = b"integration-secret";
    let auth_byte = generate_first_auth_byte(secret[0]);

    let auth = AuthPacket::new("client".to_string(), secret, 42);
    let auth_frame =
        encode_obfuscated_frame(&auth.serialize(), secret, auth_byte, DEFAULT_MAX_PADDING).unwrap();

    let (server_auth_payload, _) = decode_obfuscated_frame(&auth_frame, secret, 300).unwrap();
    let server_auth = AuthPacket::deserialize(&server_auth_payload).unwrap();
    server_auth.verify(secret, 300).unwrap();
    assert_eq!(server_auth.username, "client");

    let target = TargetAddr::Domain("example.com".to_string(), 443);
    let target_frame =
        encode_obfuscated_frame(&target.encode(), secret, auth_byte, DEFAULT_MAX_PADDING).unwrap();

    let (server_target_payload, _) = decode_obfuscated_frame(&target_frame, secret, 300).unwrap();
    let decoded_target = TargetAddr::decode(&mut server_target_payload.as_slice()).unwrap();
    assert_eq!(decoded_target, target);

    let response_payload = b"HTTP/1.1 200 OK\r\n\r\nhello";
    let response_frame =
        encode_obfuscated_frame(response_payload, secret, auth_byte, DEFAULT_MAX_PADDING).unwrap();

    let (client_payload, _) = decode_obfuscated_frame(&response_frame, secret, 300).unwrap();
    assert_eq!(client_payload, response_payload);
}

#[test]
fn encrypted_frames_have_variable_wire_bytes() {
    let secret = b"integration-secret";
    let auth_byte = generate_first_auth_byte(secret[0]);
    let payload = vec![0x42; 512];

    let first = encode_obfuscated_frame(&payload, secret, auth_byte, DEFAULT_MAX_PADDING).unwrap();
    let second = encode_obfuscated_frame(&payload, secret, auth_byte, DEFAULT_MAX_PADDING).unwrap();

    assert_ne!(first, second);
    assert_eq!(
        decode_obfuscated_frame(&first, secret, 300).unwrap().0,
        payload
    );
    assert_eq!(
        decode_obfuscated_frame(&second, secret, 300).unwrap().0,
        payload
    );
}
