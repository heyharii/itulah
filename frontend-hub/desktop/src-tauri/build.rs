// The hub page is remote, so its commands are listed here: with an app
// manifest, a command is reachable only where a capability grants it
// (`src/main.rs` grants these to the hub's origin and nothing else).
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "notify",
            "print",
            "print_html",
            "install_update_now",
        ]),
    ))
    .expect("failed to run tauri-build");
}
