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
//! A second value, `Unsent`, is how many sales the till rang that the store
//! server has not taken ([`till_unsent`]): the window writes it on every change
//! to its outbox, and the installer refuses to uninstall while it is there —
//! those sales exist nowhere else. It is independent of `Held`: a removed till
//! has let go of `Held` and is still refused until its sales are sent. An
//! upgrade is never refused, and the outbox is the window's own storage, which
//! an upgrade keeps.
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

/// Say how many sales this till has rung that the store server has not taken
/// (`Unsent`); none removes the value. Idempotent, and the window sends it in
/// order, so the last word is the latest count.
#[tauri::command]
pub async fn till_unsent(count: u32) -> Result<(), String> {
    crate::edge::off_the_window(move || unsent(count)).await
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
fn unsent(count: u32) -> Result<(), String> {
    if count > 0 {
        // Present only while one or more are owed: the installer asks whether
        // the value is there, as it does for `Held`.
        let count = count.to_string();
        let status = quiet("reg.exe")
            .args(["add", KEY, "/v", "Unsent", "/t", "REG_SZ", "/d", count.as_str(), "/f"])
            .status()
            .map_err(|error| format!("could not record the unsent sales: {error}"))?;
        if !status.success() {
            return Err(format!(
                "could not record the unsent sales: reg.exe ended with {status}"
            ));
        }
    } else {
        // Absent already is nothing owed already: reg.exe's complaint is not one.
        let _ = quiet("reg.exe")
            .args(["delete", KEY, "/v", "Unsent", "/f"])
            .status()
            .map_err(|error| format!("could not clear the unsent sales: {error}"))?;
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn unsent(count: u32) -> Result<(), String> {
    let _ = count;
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
