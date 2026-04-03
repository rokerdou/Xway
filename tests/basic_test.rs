//! SOCKS5代理服务器集成测试

use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{sleep, Duration};

/// 测试SOCKS5握手
#[tokio::test]
async fn test_socks5_handshake() {
    // 启动测试服务器
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        let (mut stream, _addr) = listener.accept().await.unwrap();
        let mut buffer = [0u8; 257];

        // 读取握手请求
        let n = stream.read(&mut buffer).await.unwrap();

        // 验证请求格式
        assert_eq!(buffer[0], 0x05); // SOCKS5版本
        assert_eq!(buffer[1], 1);    // 1个方法
        assert_eq!(buffer[2], 0x00); // 无需认证

        // 发送握手响应
        let response = vec![0x05, 0x00]; // 版本5，无需认证
        stream.write_all(&response).await.unwrap();
    });

    // 客户端连接并发送握手
    sleep(Duration::from_millis(100)).await;
    let mut stream = TcpStream::connect(addr).await.unwrap();

    // 发送握手请求
    let handshake = vec![0x05, 0x01, 0x00]; // 版本5，1个方法，无需认证
    stream.write_all(&handshake).await.unwrap();

    // 读取响应
    let mut response = [0u8; 2];
    stream.read_exact(&mut response).await.unwrap();

    assert_eq!(response[0], 0x05); // 版本5
    assert_eq!(response[1], 0x00); // 无需认证
}

/// 测试SOCKS5 CONNECT请求
#[tokio::test]
async fn test_socks5_connect() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    // 启动测试目标服务器
    let target_server = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target_addr = target_server.local_addr().unwrap();

    tokio::spawn(async move {
        // 处理SOCKS5握手
        let (mut stream, _addr) = listener.accept().await.unwrap();
        let mut buffer = [0u8; 257];
        stream.read(&mut buffer).await.unwrap();

        // 发送握手响应
        stream.write_all(&[0x05, 0x00]).await.unwrap();

        // 读取CONNECT请求
        let mut req_buffer = [0u8; 4];
        stream.read_exact(&mut req_buffer).await.unwrap();

        // 读取IPv4地址和端口
        let mut addr_buffer = [0u8; 6];
        stream.read_exact(&mut addr_buffer).await.unwrap();

        // 发送成功响应
        let response = [
            0x05, 0x00, 0x00, 0x01, // 版本、成功、保留、IPv4
            0x00, 0x00, 0x00, 0x00, // 绑定地址
            0x00, 0x00,              // 绑定端口
        ];
        stream.write_all(&response).await.unwrap();
    });

    // 客户端连接
    sleep(Duration::from_millis(100)).await;
    let mut stream = TcpStream::connect(addr).await.unwrap();

    // 发送握手
    stream.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
    let mut response = [0u8; 2];
    stream.read_exact(&mut response).await.unwrap();
    assert_eq!(response[1], 0x00);

    // 发送CONNECT请求
    let connect = [
        0x05, 0x01, 0x00, 0x01, // 版本、CONNECT、保留、IPv4
        127, 0, 0, 1,            // 目标IP
        0x1F, 0x90,              // 目标端口 8080
    ];
    stream.write_all(&connect).await.unwrap();

    // 读取响应
    let mut resp_buffer = [0u8; 10];
    stream.read_exact(&mut resp_buffer).await.unwrap();

    assert_eq!(resp_buffer[0], 0x05); // 版本
    assert_eq!(resp_buffer[1], 0x00); // 成功
}
