use std::fs;
use std::path::Path;

fn main() {
    // 先调用标准的 Tauri 构建
    tauri_build::build();

    // 在构建后修改生成的 Info.plist 文件
    // 注意：这个文件在 target/release/bundle/... 目录下
    // 我们需要在构建脚本中添加 LSUIElement

    // 实际上，Tauri 会在编译时生成 Info.plist
    // 我们可以通过环境变量或者配置来影响它

    // 暂时打印信息来调试
    println!("cargo:warning=LSUIElement will be set to 1 to hide from Dock");
}
