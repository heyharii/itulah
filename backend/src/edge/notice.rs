//! A message for the person at the machine, when there is one: a Windows
//! message box (the uninstaller's refusal, `cli.rs` can-uninstall --ui).
//! Elsewhere the caller has already printed it, so this does nothing.

/// Show `text` in a window titled `title` and wait for OK.
#[cfg(windows)]
#[allow(unsafe_code)]
pub fn alert(title: &str, text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONWARNING, MB_OK, MB_SERVICE_NOTIFICATION, MB_TOPMOST,
    };
    let wide = |value: &str| value.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (title, text) = (wide(title), wide(text));
    // SAFETY: both buffers are NUL-terminated UTF-16 that outlive the call;
    // no owner window. MB_SERVICE_NOTIFICATION puts the box on the desktop of
    // whoever is signed in, which is what the uninstaller needs: it asks as
    // SYSTEM, from the session-0 desktop nobody sees.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONWARNING | MB_SERVICE_NOTIFICATION | MB_TOPMOST,
        );
    }
}

#[cfg(not(windows))]
pub fn alert(_title: &str, _text: &str) {}
