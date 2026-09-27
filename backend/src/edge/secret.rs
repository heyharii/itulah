//! The sync key at rest.
//!
//! On Windows the key in `node.env` is sealed with DPAPI in machine scope:
//! readable by this machine and nobody else, so a copy of the data folder —
//! a backup, a stolen disk image — carries no usable key. The folder is also
//! restricted to the service account and administrators (`winservice.rs`);
//! this is the second lock. Elsewhere the file's owner-only mode is the lock,
//! and the value is stored as it is.
//!
//! Sealed values are written `dpapi:<hex>`; anything else is read as plain, so
//! a node enrolled before this, or edited by hand, keeps working.

const PREFIX: &str = "dpapi:";

/// What to write for `SYNC_UPLOAD_KEY`.
pub fn seal(plain: &str) -> String {
    #[cfg(windows)]
    {
        match protect(plain.as_bytes()) {
            Ok(sealed) => return format!("{PREFIX}{}", hex::encode(sealed)),
            Err(error) => tracing::warn!(%error, "DPAPI unavailable; the key is stored unsealed"),
        }
    }
    plain.to_owned()
}

/// What a stored `SYNC_UPLOAD_KEY` means.
pub fn unseal(stored: &str) -> Result<String, String> {
    let Some(sealed) = stored.strip_prefix(PREFIX) else {
        return Ok(stored.to_owned());
    };
    let bytes = hex::decode(sealed).map_err(|_| "sealed key is not hex".to_owned())?;
    #[cfg(windows)]
    {
        let plain = unprotect(&bytes)?;
        return String::from_utf8(plain).map_err(|_| "sealed key is not text".to_owned());
    }
    #[allow(unreachable_code)]
    {
        let _ = bytes;
        Err("this key was sealed on Windows and can only be read there".into())
    }
}

/// After `node.env` is loaded: replace a sealed key in the environment with
/// the key itself, so everything that reads `SYNC_UPLOAD_KEY` sees a key.
pub fn unseal_environment() -> Result<(), String> {
    if let Ok(stored) = std::env::var("SYNC_UPLOAD_KEY") {
        if stored.starts_with(PREFIX) {
            std::env::set_var("SYNC_UPLOAD_KEY", unseal(&stored)?);
        }
    }
    Ok(())
}

#[cfg(windows)]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_LOCAL_MACHINE, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    take(ok, output)
}

#[cfg(windows)]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    take(ok, output)
}

#[cfg(windows)]
fn take(
    ok: i32,
    output: windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB,
) -> Result<Vec<u8>, String> {
    if ok == 0 || output.pbData.is_null() {
        return Err(format!("DPAPI failed: {}", std::io::Error::last_os_error()));
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(output.pbData as _);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_key_reads_as_itself() {
        assert_eq!(unseal("abc123").as_deref(), Ok("abc123"));
    }

    #[cfg(not(windows))]
    #[test]
    fn off_windows_the_key_is_stored_as_it_is() {
        assert_eq!(seal("abc123"), "abc123");
        assert!(unseal("dpapi:00ff").is_err());
    }
}
