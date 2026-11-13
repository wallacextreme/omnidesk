fn main() {
    println!("cargo:rerun-if-changed=src/win7_etw_shim.c");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_os == "windows" && target_arch == "x86_64" {
        let objs = cc::Build::new()
            .file("src/win7_etw_shim.c")
            .flag_if_supported("/GS-")
            .compile_intermediates();
        for obj in objs {
            println!("cargo:rustc-link-arg-bin=omnidesk={}", obj.display());
        }
    }

    tauri_build::build();
}
