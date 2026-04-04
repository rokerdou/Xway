//! Tauri GUI 应用

use client_core::{ClientConfig, ProxyClient, TrafficStats};
use std::sync::Arc;
use tauri::{State, Manager};
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub id: u64,
    pub host: String,
    pub port: u16,
    pub enabled: bool,
}

/// 应用状态
pub struct AppState {
    proxy: Arc<Mutex<Option<ProxyClient>>>,
    config: Arc<Mutex<ClientConfig>>,
}

/// 启动代理
#[tauri::command]
async fn start_proxy(state: State<'_, AppState>) -> Result<(), String> {
    let mut proxy_guard = state.proxy.lock().await;

    if proxy_guard.is_some() {
        // 检查端口是否真的在监听
        let config = state.config.lock().await;
        let port = config.local.listen_port;
        drop(config);

        if check_port_listening(port).await {
            return Err("代理已在运行，请先停止".to_string());
        } else {
            // 端口未监听，清理旧实例
            *proxy_guard = None;
        }
    }

    let config = state.config.lock().await.clone();

    let mut client = ProxyClient::new(config)
        .map_err(|e| format!("创建代理客户端失败: {}", e))?;

    // 【关键】现在start()会同步绑定端口，如果端口被占用会立即返回详细错误
    client.start().await
        .map_err(|e| {
            // anyhow::Error转换为String，保留完整错误信息
            e.to_string()
        })?;

    *proxy_guard = Some(client);
    Ok(())
}

/// 停止代理
#[tauri::command]
async fn stop_proxy(state: State<'_, AppState>) -> Result<(), String> {
    let mut proxy_guard = state.proxy.lock().await;

    if let Some(mut client) = proxy_guard.take() {
        client.stop().await
            .map_err(|e| format!("停止代理失败: {}", e))?;
    }

    Ok(())
}

/// 获取代理状态
#[tauri::command]
async fn get_proxy_status(state: State<'_, AppState>) -> Result<String, String> {
    let proxy_guard = state.proxy.lock().await;

    if let Some(client) = proxy_guard.as_ref() {
        let proxy_state = client.status().get_state().await;

        // 额外检查：验证端口是否真的在监听
        if proxy_state.is_running() {
            // 释放proxy_guard再获取config
            drop(proxy_guard);
            let config = state.config.lock().await;
            let port = config.local.listen_port;
            drop(config);

            // 检查端口是否真的在监听
            if check_port_listening(port).await {
                Ok(format!("{:?}", proxy_state))
            } else {
                // 端口没有监听，说明有错误
                tracing::error!("状态显示运行但端口{}未监听", port);
                Ok("Error".to_string())
            }
        } else {
            Ok(format!("{:?}", proxy_state))
        }
    } else {
        Ok("Stopped".to_string())
    }
}

/// 检查端口是否在监听
async fn check_port_listening(port: u16) -> bool {
    use tokio::net::TcpListener;
    use std::net::SocketAddr;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    // 尝试绑定端口，如果失败说明端口已被占用（正在监听）
    TcpListener::bind(&addr).await.is_err()
}

/// 获取流量统计
#[tauri::command]
async fn get_traffic_stats(state: State<'_, AppState>) -> Result<TrafficStats, String> {
    let proxy_guard = state.proxy.lock().await;

    if let Some(client) = proxy_guard.as_ref() {
        Ok(client.status().get_stats())
    } else {
        Ok(TrafficStats::new())
    }
}

/// 更新配置（保留用于向后兼容）
#[tauri::command]
async fn update_config(
    state: State<'_, AppState>,
    server: String,
    port: u16,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    // 更新第一个启用的服务器
    if let Some(s) = config.servers.iter_mut().find(|s| s.enabled) {
        s.host = server;
        s.port = port;
    } else if !config.servers.is_empty() {
        config.servers[0].host = server;
        config.servers[0].port = port;
    }

    // 保存配置
    let config_path = ClientConfig::default_config_path();
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    config.save_to_file(&config_path)
        .map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(())
}

/// 获取配置（保留用于向后兼容）
#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<(String, u16), String> {
    let config = state.config.lock().await;
    if let Some(server) = config.get_active_server() {
        Ok((server.host.clone(), server.port))
    } else {
        Ok(("127.0.0.1".to_string(), 1080))
    }
}

/// 获取服务器列表配置
#[tauri::command]
async fn get_servers_config(state: State<'_, AppState>) -> Result<Vec<ServerConfig>, String> {
    let config = state.config.lock().await;
    let servers: Vec<ServerConfig> = config.servers.iter().map(|s| ServerConfig {
        id: s.id,
        host: s.host.clone(),
        port: s.port,
        enabled: s.enabled,
    }).collect();
    Ok(servers)
}

/// 更新服务器列表配置
#[tauri::command]
async fn update_servers_config(
    state: State<'_, AppState>,
    servers: Vec<ServerConfig>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;

    // 转换为客户端配置格式
    config.servers = servers.iter().map(|s| client_core::ServerConfig {
        id: s.id,
        host: s.host.clone(),
        port: s.port,
        enabled: s.enabled,
    }).collect();

    // 保存配置
    let config_path = ClientConfig::default_config_path();
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    config.save_to_file(&config_path)
        .map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(())
}

/// 测试服务器时延
/// 通过TCP连接测量服务器响应时间（毫秒）
#[tauri::command]
async fn test_server_latency(
    server: String,
    port: u16,
) -> Result<u64, String> {
    use std::time::Instant;

    let addr = format!("{}:{}", server, port);
    let start = Instant::now();

    // 尝试建立TCP连接
    tokio::net::TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("连接服务器失败: {}", e))?;

    let latency = start.elapsed().as_millis() as u64;
    Ok(latency)
}

/// 检查本地端口是否在监听
#[tauri::command]
async fn check_local_port(port: u16) -> Result<bool, String> {
    Ok(check_port_listening(port).await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 初始化日志
            tracing_subscriber::fmt()
                .with_max_level(tracing::Level::INFO)
                .init();

            // 加载配置
            let config = ClientConfig::load_or_create()
                .unwrap_or_else(|e| {
                    eprintln!("加载配置失败，使用默认配置: {}", e);
                    ClientConfig::default_config()
                });

            // 初始化状态
            let state = AppState {
                proxy: Arc::new(Mutex::new(None)),
                config: Arc::new(Mutex::new(config)),
            };

            app.manage(state);

            // 创建系统托盘
            #[cfg(desktop)]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    create_tray(app_handle).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            stop_proxy,
            get_proxy_status,
            get_traffic_stats,
            update_config,
            get_config,
            test_server_latency,
            get_servers_config,
            update_servers_config,
            check_local_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 创建系统托盘
#[cfg(desktop)]
async fn create_tray(app: tauri::AppHandle) {
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    // 创建托盘图标
    let _tray = TrayIconBuilder::new()
        .tooltip("SOCKS5 代理客户端")
        .icon_as_template(true)  // macOS需要
        .on_tray_icon_event(move |tray, event| {
            match event {
                TrayIconEvent::Click {
                    id: _,
                    position: _,
                    rect: _,
                    button_state: _,
                    button: _,
                } => {
                    // 单击托盘图标：显示/隐藏窗口
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        if window.is_visible().unwrap() {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                TrayIconEvent::DoubleClick {
                    id: _,
                    position: _,
                    rect: _,
                    button: _,
                } => {
                    // 双击托盘图标：显示窗口并聚焦
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        })
        .build(&app);

    tracing::info!("✅ 系统托盘已创建");
}
