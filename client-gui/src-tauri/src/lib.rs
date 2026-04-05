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

/// 设置 macOS 系统 SOCKS代理（需要管理员权限）
#[tauri::command]
async fn set_system_proxy(enabled: bool, port: u16) -> Result<String, String> {
    use std::process::Command;

    // 获取当前网络服务（通常是Wi-Fi或Ethernet）
    let get_service_script = "do shell script \"networksetup -listallnetworkservices | head -2 | tail -1\"";

    let service_output = Command::new("osascript")
        .arg("-e")
        .arg(get_service_script)
        .output()
        .map_err(|e| format!("获取网络服务失败: {}", e))?;

    let service_name = String::from_utf8_lossy(&service_output.stdout).trim().to_string();
    tracing::info!("检测到网络服务: {}", service_name);

    if service_name.is_empty() {
        return Err("无法获取网络服务名称".to_string());
    }

    // 构建networksetup命令
    let command = if enabled {
        // 启用SOCKS代理时，先禁用HTTP/HTTPS代理，再启用SOCKS代理
        format!(
            "networksetup -setwebproxystate {} off && \
             networksetup -setsecurewebproxystate {} off && \
             networksetup -setsocksfirewallproxy {} 127.0.0.1 {} && \
             networksetup -setsocksfirewallproxystate {} on",
            service_name, service_name, service_name, port, service_name
        )
    } else {
        // 禁用SOCKS代理时，也确保HTTP/HTTPS代理都被禁用
        format!(
            "networksetup -setwebproxystate {} off && \
             networksetup -setsecurewebproxystate {} off && \
             networksetup -setsocksfirewallproxystate {} off",
            service_name, service_name, service_name
        )
    };

    tracing::info!("尝试自动执行: {}", command);

    // 使用AppleScript with administrator privileges执行
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        command
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("执行osascript失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    tracing::info!("命令执行结果 - exit code: {:?}", output.status.code());
    tracing::info!("stdout: {}", stdout);
    tracing::info!("stderr: {}", stderr);

    if output.status.success() {
        // 添加延迟以等待系统更新
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // 验证SOCKS代理设置
        let verify_script = format!(
            "do shell script \"networksetup -getsocksfirewallproxy {}\"",
            service_name
        );

        let verify_output = Command::new("osascript")
            .arg("-e")
            .arg(&verify_script)
            .output()
            .map_err(|e| format!("验证失败: {}", e))?;

        let verify_result = String::from_utf8_lossy(&verify_output.stdout);
        tracing::info!("SOCKS代理验证结果: {}", verify_result);

        // 验证HTTP/HTTPS代理已禁用
        let http_verify_script = format!(
            "do shell script \"networksetup -getwebproxy {} && networksetup -getsecurewebproxy {}\"",
            service_name, service_name
        );

        let http_verify_output = Command::new("osascript")
            .arg("-e")
            .arg(&http_verify_script)
            .output()
            .map_err(|e| format!("验证HTTP代理失败: {}", e))?;

        let http_verify_result = String::from_utf8_lossy(&http_verify_output.stdout);
        tracing::info!("HTTP/HTTPS代理验证结果: {}", http_verify_result);

        let socks_success = if enabled {
            verify_result.contains("Enabled: Yes") && verify_result.contains("127.0.0.1")
        } else {
            verify_result.contains("Enabled: No")
        };

        // 检查HTTP/HTTPS代理是否已禁用
        let http_disabled = http_verify_result.contains("Enabled: No");

        if socks_success && http_disabled {
            let message = if enabled {
                format!("✅ 系统代理已启用: 127.0.0.1:{} (服务: {})\n💡 已自动禁用HTTP/HTTPS代理", port, service_name)
            } else {
                format!("✅ 系统代理已禁用 (服务: {})\n💡 HTTP/HTTPS代理也已禁用", service_name)
            };
            tracing::info!("{}", message);
            return Ok(message);
        } else {
            tracing::warn!("验证失败 - SOCKS成功: {}, HTTP已禁用: {}", socks_success, http_disabled);
            return Err(format!("命令已执行但验证失败，请手动检查设置"));
        }
    }

    Err(format!("命令执行失败 (exit code: {:?})", output.status.code()))
}

/// 获取代理环境变量配置
#[tauri::command]
async fn get_proxy_env_vars(port: u16) -> Result<String, String> {
    let vars = format!(
        "export all_proxy=\"socks5://127.0.0.1:{}\"\n\
         export http_proxy=\"socks5://127.0.0.1:{}\"\n\
         export https_proxy=\"socks5://127.0.0.1:{}\"\n\
         export no_proxy=\"localhost,127.0.0.1,::1\"",
        port, port, port
    );

    Ok(vars)
}

/// 检查系统代理状态
#[tauri::command]
async fn check_system_proxy_status() -> Result<bool, String> {
    use std::process::Command;

    // 获取当前网络服务
    let get_service_script = "do shell script \"networksetup -listallnetworkservices | head -2 | tail -1\"";

    let service_output = Command::new("osascript")
        .arg("-e")
        .arg(get_service_script)
        .output()
        .map_err(|e| format!("获取网络服务失败: {}", e))?;

    let service_name = String::from_utf8_lossy(&service_output.stdout).trim().to_string();

    if service_name.is_empty() {
        return Ok(false);
    }

    // 检查SOCKS代理状态
    let check_script = format!(
        "do shell script \"networksetup -getsocksfirewallproxy {}\"",
        service_name
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&check_script)
        .output()
        .map_err(|e| format!("检查代理状态失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // 检查SOCKS代理是否启用
    let socks_enabled = stdout.contains("Enabled: Yes");

    // 同时检查HTTP/HTTPS代理状态
    let http_check_script = format!(
        "do shell script \"networksetup -getwebproxy {}\"",
        service_name
    );

    let http_output = Command::new("osascript")
        .arg("-e")
        .arg(&http_check_script)
        .output()
        .map_err(|e| format!("检查HTTP代理状态失败: {}", e))?;

    let http_stdout = String::from_utf8_lossy(&http_output.stdout);
    let http_enabled = http_stdout.contains("Enabled: Yes");

    let https_check_script = format!(
        "do shell script \"networksetup -getsecurewebproxy {}\"",
        service_name
    );

    let https_output = Command::new("osascript")
        .arg("-e")
        .arg(&https_check_script)
        .output()
        .map_err(|e| format!("检查HTTPS代理状态失败: {}", e))?;

    let https_stdout = String::from_utf8_lossy(&https_output.stdout);
    let https_enabled = https_stdout.contains("Enabled: Yes");

    tracing::info!(
        "系统代理状态检查 - SOCKS: {}, HTTP: {}, HTTPS: {}, service: {}",
        socks_enabled, http_enabled, https_enabled, service_name
    );

    // 只有SOCKS代理启用时才返回true
    Ok(socks_enabled)
}

/// 关闭窗口
#[tauri::command]
async fn close_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.close()
            .map_err(|e| format!("关闭窗口失败: {}", e))?;
    }
    Ok(())
}

/// 最小化窗口
#[tauri::command]
async fn minimize_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize()
            .map_err(|e| format!("最小化窗口失败: {}", e))?;
    }
    Ok(())
}

/// 退出应用（先关闭系统代理）
#[tauri::command]
async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    // 先尝试关闭系统代理
    let config_path = ClientConfig::default_config_path();
    if let Ok(config) = ClientConfig::from_file(&config_path) {
        if let Some(_server) = config.get_active_server() {
            let port = config.local.listen_port;
            // 尝试关闭系统代理，忽略错误
            let _ = set_system_proxy(false, port).await;
            tracing::info!("✅ 系统代理已关闭");
        }
    }

    // 退出应用
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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

            // 设置 macOS 不显示在 Dock 中
            #[cfg(target_os = "macos")]
            {
                unsafe {
                    use objc::{msg_send, sel, sel_impl, class};
                    let ns_app = class!(NSApplication);
                    let shared_app: *mut objc::runtime::Object = msg_send![ns_app, sharedApplication];
                    let ns_application_activation_policy_accessory = 2u64; // NSApplicationActivationPolicyAccessory
                    let _: () = msg_send![shared_app, setActivationPolicy: ns_application_activation_policy_accessory];
                }
                tracing::info!("✅ 设置 macOS 应用不在 Dock 中显示");
            }

            // 创建系统托盘
            #[cfg(desktop)]
            {
                let app_handle = app.handle();
                if let Err(e) = create_tray(app_handle) {
                    tracing::error!("❌ 创建托盘失败: {}", e);
                }
                tracing::info!("✅ 应用启动：窗口可见，托盘图标已创建");
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
            set_system_proxy,
            get_proxy_env_vars,
            check_system_proxy_status,
            close_window,
            minimize_window,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 创建系统托盘（使用 Tauri v2 内置 API）
#[cfg(desktop)]
fn create_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };

    // 创建菜单项
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit_item])?;

    // 暂时使用默认窗口图标，确保托盘图标可见
    let tray_icon = app.default_window_icon().unwrap().clone();
    tracing::info!("🖼️  使用默认窗口图标作为托盘图标");

    // 创建托盘图标
    let _tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(false)  // 左键点击不显示菜单，改为触发事件
        .tooltip("SOCKS5 代理客户端")
        .on_menu_event(|app: &tauri::AppHandle, event: tauri::menu::MenuEvent| match event.id.as_ref() {
            "quit" => {
                tracing::info!("📋 点击退出菜单，准备退出...");
                // 调用退出命令，会先关闭系统代理
                tauri::async_runtime::block_on(async {
                    let _ = quit_app(app.clone()).await;
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray: &tauri::tray::TrayIcon<_>, event: tauri::tray::TrayIconEvent| {
            tracing::info!("🖱️ 托盘图标事件: {:?}", event);

            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
                match event {
                    tauri::tray::TrayIconEvent::Click { .. } => {
                        // 单击：显示/隐藏窗口
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    tauri::tray::TrayIconEvent::DoubleClick { .. } => {
                        // 双击：显示并聚焦窗口
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    _ => {}
                }
            }
        })
        .build(app)?;

    tracing::info!("✅ 系统托盘已创建（使用 Tauri v2 API）");
    Ok(())
}
