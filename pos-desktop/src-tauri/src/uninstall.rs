//! Only head office uninstalls a POS (the client's review, 23 Oct 2026).
//!
//! The till holds itself while it is a till of its store: a value under
//! `HKCU\Software\Central POS` (`Held`), written when the window learns the
//! till is joined and not removed. The installer reads it
//! (`wix/uninstall-guard.wxs`) and refuses to uninstall while it is there —
//! "Kasir ini masih aktif" — so a till cannot be taken off the counter from
//! Windows' own Apps list. When head office removes the till from the hub
//! (`REVOKED`), the window lets go ([`till_hold`] with `false`) and offers
//! "Uninstall POS", which opens that same Apps list ([`open_uninstall`]).
//!
//! What it does not stop: an administrator who deletes the folder, or one
//! who uninstalls from another Windows account (the value is the signed-in
//! user's). It stops the counter's own user, which is who the client meant.
//!
//! Not Windows: nothing is held, and there is nothing to open.

/// Hold the till (`true`) or let it go (`false`). Idempotent.
#[tauri::command]
pub async fn till_hold(held: bool) -> Result<(), String> {
    crate::edge::off_the_window(move || hold(held)).await
}

/// Open Windows' Apps list, where "Central POS" is uninstalled.
#[tauri::command]
pub async fn open_uninstall() -> Result<(), String> {
    crate::edge::off_the_window(open_apps).await
}

#[cfg(target_os = "windows")]
const KEY: &str = r"HKCU\Software\Central POS";

#[cfg(target_os = "windows")]
fn quiet(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = std::process::Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(target_os = "windows")]
fn hold(held: bool) -> Result<(), String> {
    if held {
        let status = quiet("reg.exe")
            .args(["add", KEY, "/v", "Held", "/t", "REG_SZ", "/d", "1", "/f"])
            .status()
            .map_err(|error| format!("could not hold the till: {error}"))?;
        if !status.success() {
            return Err(format!(
                "could not hold the till: reg.exe ended with {status}"
            ));
        }
    } else {
        // Absent already is let go already: reg.exe's complaint is not one.
        let _ = quiet("reg.exe")
            .args(["delete", KEY, "/v", "Held", "/f"])
            .status()
            .map_err(|error| format!("could not let the till go: {error}"))?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn hold(held: bool) -> Result<(), String> {
    let _ = held;
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_apps() -> Result<(), String> {
    // explorer.exe answers 1 even when it opened the page, so only a failure
    // to start it at all is a failure.
    quiet("explorer.exe")
        .arg("ms-settings:appsfeatures")
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not open Windows' Apps list: {error}"))
}

#[cfg(not(target_os = "windows"))]
fn open_apps() -> Result<(), String> {
    Err("uninstalling from here works only on the Windows till".into())
}
