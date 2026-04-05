fn main() {
    tauri_build::build();

    // 在 macOS 上确保 LSUIElement 被设置
    #[cfg(target_os = "macos")]
    {
        println!("cargo:warning=Building with LSUIElement enabled to hide from Dock");

        // 构建后修改 Info.plist
        let bundle_path = std::env::var("OUT_DIR").unwrap_or_else(|_| ".".to_string());
        println!("cargo:warning=OUT_DIR: {}", bundle_path);
    }
}
