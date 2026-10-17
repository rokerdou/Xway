use shared::{
    generate_first_auth_byte, AuthPacket, ClientHello, ConnectResponse, FrameCodec,
    SessionDirection, TargetAddr, DEFAULT_MAX_PADDING,
};

#[test]
fn client_server_session_protocol_interoperates() {
    let secret = b"integration-secret";
    let auth_byte = generate_first_auth_byte(secret[0]);
    let hello = ClientHello::new(Some(AuthPacket::new("client".to_string(), secret, 42)));
    let client_up =
        FrameCodec::new_session(secret, &hello.salt, SessionDirection::ClientToServer, 300)
            .unwrap();
    let server_up =
        FrameCodec::new_session(secret, &hello.salt, SessionDirection::ClientToServer, 300)
            .unwrap();
    let client_down =
        FrameCodec::new_session(secret, &hello.salt, SessionDirection::ServerToClient, 300)
            .unwrap();
    let server_down =
        FrameCodec::new_session(secret, &hello.salt, SessionDirection::ServerToClient, 300)
            .unwrap();
    let frame = client_up
        .encode(&hello.encode(), auth_byte, DEFAULT_MAX_PADDING)
        .unwrap();
    let decoded = ClientHello::decode(&server_up.decode(&frame).unwrap().0).unwrap();
    assert_eq!(decoded.salt, hello.salt);
    decoded.auth.as_ref().unwrap().verify(secret, 300).unwrap();

    let target = TargetAddr::Domain("example.com".to_string(), 443);
    let frame = client_up.encode(&target.encode(), auth_byte, 17).unwrap();
    let payload = server_up.decode(&frame).unwrap().0;
    assert_eq!(TargetAddr::decode(&mut payload.as_slice()).unwrap(), target);

    let ack = server_down
        .encode(&ConnectResponse::Success.encode(), auth_byte, 5)
        .unwrap();
    assert_eq!(
        ConnectResponse::decode(&client_down.decode(&ack).unwrap().0)
            .unwrap()
            .0,
        ConnectResponse::Success
    );
    let response = b"HTTP/1.1 200 OK\r\n\r\nhello";
    let frame = server_down.encode(response, auth_byte, 31).unwrap();
    assert_eq!(client_down.decode(&frame).unwrap().0, response);
}

#[test]
fn direction_keys_are_not_interchangeable() {
    let secret = b"integration-secret";
    let salt = [7u8; 32];
    let auth_byte = generate_first_auth_byte(secret[0]);
    let upload =
        FrameCodec::new_session(secret, &salt, SessionDirection::ClientToServer, 300).unwrap();
    let download =
        FrameCodec::new_session(secret, &salt, SessionDirection::ServerToClient, 300).unwrap();
    let frame = upload.encode(b"payload", auth_byte, 0).unwrap();
    assert!(download.decode(&frame).is_err());
}
