//! Embed the Open 2D Studio / Viewer icon as a Windows resource.
//!
//! `winres` runs `rc.exe` at compile time to compile a small .rc file
//! that links the .ico into the .exe as IDI_ICON1 (the lowest-numbered
//! icon resource). Windows Explorer + the taskbar use that automatically.
//!
//! We can't easily distinguish "this build is for open_2d_viewer" vs
//! "this build is for open_2d_studio" at build.rs time — both binaries
//! come from the same crate. So we embed BOTH icons into the lib's
//! resource section and switch which one the winit window uses at
//! runtime (see `studio_app::run_app`). Explorer / taskbar pick the
//! first IDI_ICON in the executable's resource section — by ordering
//! the two .RC entries with the Viewer second only on the viewer .exe
//! we'd need separate build scripts; for now both .exes ship with the
//! Studio icon as the "primary" Explorer face and the runtime winit
//! API selects the per-window icon. Acceptable for Phase 1.

fn main() {
    println!("cargo:rerun-if-changed=assets/open-2d-studio.ico");
    println!("cargo:rerun-if-changed=assets/open-2d-viewer.ico");
    println!("cargo:rerun-if-changed=build.rs");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    // Pick the right .ico based on which binary cargo is currently
    // building. Cargo sets CARGO_BIN_NAME for `[[bin]]` targets.
    let bin_name = std::env::var("CARGO_BIN_NAME").unwrap_or_default();
    let icon_rel = match bin_name.as_str() {
        "open_2d_viewer" => "assets/open-2d-viewer.ico",
        // open_2d_studio + everything else gets the Studio icon. Other
        // bins (dwg_mockup, headless-render, lz77-*) inherit it too —
        // they're internal dev tools, having any icon is fine.
        _ => "assets/open-2d-studio.ico",
    };

    let icon_abs = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(icon_rel);
    if !icon_abs.exists() {
        // Don't fail the build if the asset is missing — it's an
        // optional resource. Print a warning and continue.
        println!(
            "cargo:warning=icon not found at {} — exe will use default Windows icon",
            icon_abs.display()
        );
        return;
    }

    let mut res = winres::WindowsResource::new();
    res.set_icon(icon_abs.to_str().expect("icon path is utf-8"));
    if let Err(e) = res.compile() {
        println!("cargo:warning=winres compile failed: {}", e);
    }
}
