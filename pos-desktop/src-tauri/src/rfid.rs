//! Chainway R3 USB access for the Windows till.
//!
//! The vendor SDK is loaded from the packaged `rfid-native` resource folder.
//! The reader is opened once and kept open: opening it disables the buzzer,
//! verifies the buzzer is off, and confirms the firmware identifies as R3.
//! Each read then costs one buzzer check and one single-tag inventory, instead
//! of a USB open/close and a DLL load per scan. A failed buzzer check means the
//! reader went away (unplugged, asleep), so the session is closed and reopened
//! once before the read gives up. Inventory is one-shot; the till never leaves
//! the reader in a continuous polling loop.

use tauri::AppHandle;

pub fn reader_state(app: &AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return windows::with_silent_r3(app, |_| Ok(())).map(|(version, ())| version);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Chainway R3 USB hanya tersedia di aplikasi POS Windows.".into())
    }
}

pub fn read_single(app: &AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return windows::with_silent_r3(app, |reader| {
            let mut length = 0_u8;
            let mut data = [0_u8; 256];
            let code = unsafe { (reader.inventory_single)(&mut length, data.as_mut_ptr()) };
            if code != 0 {
                return Err(format!("Pembacaan satu tag gagal (kode SDK {code})."));
            }
            epc_hex(&data[..usize::from(length)])
        })
        .map(|(_, epc)| epc);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Pembacaan Chainway R3 tersedia di aplikasi POS Windows.".into())
    }
}

/// The R3 SDK returns UII as either a bare EPC or a PC word followed by EPC.
/// For the latter, the PC word's length field gives the exact EPC byte count.
fn epc_hex(data: &[u8]) -> Result<String, String> {
    if data.is_empty() {
        return Err(
            "Belum ada tag terbaca. Letakkan satu tag di atas Chainway R3 lalu coba lagi.".into(),
        );
    }

    let epc = if data.len() == 12 {
        data
    } else if data.len() >= 2 {
        let pc = u16::from_be_bytes([data[0], data[1]]);
        let epc_len = usize::from((pc >> 11) & 0x1f) * 2;
        if epc_len > 0 && data.len() == 2 + epc_len {
            &data[2..]
        } else {
            return Err(format!(
                "Format UII dari Chainway R3 tidak dikenal ({} byte).",
                data.len()
            ));
        }
    } else {
        return Err(format!(
            "EPC Chainway R3 terlalu pendek ({} byte).",
            data.len()
        ));
    };

    let mut rendered = String::with_capacity(epc.len() * 2);
    for byte in epc {
        use std::fmt::Write as _;
        write!(&mut rendered, "{byte:02X}").expect("writing to a String cannot fail");
    }
    Ok(rendered)
}

#[cfg(target_os = "windows")]
mod windows {
    use std::os::raw::c_int;
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard};

    use libloading::Library;
    use tauri::{AppHandle, Manager};

    type InventorySingle = unsafe extern "C" fn(*mut u8, *mut u8) -> c_int;
    type UsbOpen = unsafe extern "C" fn() -> c_int;
    type UsbClose = unsafe extern "C" fn();
    type SetBeep = unsafe extern "C" fn(u8) -> c_int;
    type GetBeep = unsafe extern "C" fn(*mut u8) -> c_int;
    type GetReaderVersion = unsafe extern "C" fn(*mut u8) -> c_int;

    /// The open reader. The function pointers come out of `api`, which this
    /// struct owns, so they stay valid exactly as long as the session does.
    pub(super) struct Session {
        pub(super) inventory_single: InventorySingle,
        close: UsbClose,
        set_beep: SetBeep,
        get_beep: GetBeep,
        version: String,
        // Field order is drop order: UHFAPI.dll unloads before libusb, and
        // both only after `Drop` below has closed the USB handle.
        _api: Library,
        _libusb: Library,
    }

    impl Drop for Session {
        fn drop(&mut self) {
            unsafe { (self.close)() };
        }
    }

    /// One reader per till, shared by every command.
    static SESSION: Mutex<Option<Session>> = Mutex::new(None);

    fn session_slot() -> MutexGuard<'static, Option<Session>> {
        // A panic mid-read leaves nothing half-written worth refusing over:
        // the next buzzer check decides whether the session is still good.
        SESSION.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn sdk_directory(app: &AppHandle) -> Result<PathBuf, String> {
        let resource = app
            .path()
            .resource_dir()
            .map_err(|error| format!("Folder resource POS tidak bisa dibuka: {error}"))?
            .join("rfid-native");
        if resource.join("UHFAPI.dll").is_file() && resource.join("libusb-1.0.dll").is_file() {
            return Ok(resource);
        }

        #[cfg(debug_assertions)]
        {
            let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("rfid-native");
            if development.join("UHFAPI.dll").is_file()
                && development.join("libusb-1.0.dll").is_file()
            {
                return Ok(development);
            }
        }

        Err("SDK Chainway R3 belum ada di paket POS Windows.".into())
    }

    fn open(app: &AppHandle) -> Result<Session, String> {
        let directory = sdk_directory(app)?;
        // Load libusb from this exact directory before UHFAPI.dll so Windows
        // cannot resolve a same-named library from an unrelated search path.
        let libusb = unsafe { Library::new(directory.join("libusb-1.0.dll")) }
            .map_err(|error| format!("Library USB Chainway R3 gagal dimuat: {error}"))?;
        let api = unsafe { Library::new(directory.join("UHFAPI.dll")) }
            .map_err(|error| format!("SDK Chainway R3 gagal dimuat: {error}"))?;

        let usb_open: UsbOpen = unsafe { *api.get(b"UsbOpen\0") }
            .map_err(|error| format!("Fungsi koneksi USB R3 tidak tersedia: {error}"))?;
        let close: UsbClose = unsafe { *api.get(b"UsbClose\0") }
            .map_err(|error| format!("Fungsi penutup USB R3 tidak tersedia: {error}"))?;
        let set_beep: SetBeep = unsafe { *api.get(b"UHFSetBeep\0") }
            .map_err(|error| format!("Fungsi mute buzzer R3 tidak tersedia: {error}"))?;
        let get_beep: GetBeep = unsafe { *api.get(b"UHFGetBeep\0") }
            .map_err(|error| format!("Fungsi verifikasi buzzer R3 tidak tersedia: {error}"))?;
        let get_version: GetReaderVersion = unsafe { *api.get(b"UHFGetReaderVersion\0") }
            .map_err(|error| format!("Fungsi identitas R3 tidak tersedia: {error}"))?;
        let inventory_single: InventorySingle = unsafe { *api.get(b"UHFInventorySingle\0") }
            .map_err(|error| format!("Fungsi inventory R3 tidak tersedia: {error}"))?;

        let open_code = unsafe { usb_open() };
        if open_code != 0 {
            return Err(format!(
                "Chainway R3 belum bisa dibuka lewat USB (kode SDK {open_code})."
            ));
        }
        // From here on, dropping the session closes the reader.
        let mut session = Session {
            inventory_single,
            close,
            set_beep,
            get_beep,
            version: String::new(),
            _api: api,
            _libusb: libusb,
        };

        let set_code = unsafe { set_beep(0) };
        let mut beep_mode = u8::MAX;
        let get_code = unsafe { get_beep(&mut beep_mode) };
        if set_code != 0 || get_code != 0 || beep_mode != 0 {
            return Err(format!(
                "POS menghentikan pembacaan: buzzer R3 belum terverifikasi mati (set={set_code}, get={get_code}, mode={beep_mode})."
            ));
        }

        let mut version_bytes = [0_u8; 50];
        let version_code = unsafe { get_version(version_bytes.as_mut_ptr()) };
        if version_code != 0 {
            return Err(format!(
                "Firmware R3 tidak bisa diverifikasi (kode SDK {version_code})."
            ));
        }
        let version_length = usize::from(version_bytes[0]).min(version_bytes.len() - 1);
        let version = String::from_utf8_lossy(&version_bytes[1..1 + version_length])
            .trim_matches('\0')
            .to_owned();
        if !version
            .split(',')
            .any(|part| part.trim().eq_ignore_ascii_case("R3"))
        {
            return Err(format!(
                "Reader terhubung tetapi firmware tidak mengidentifikasi model R3 ({version})."
            ));
        }

        session.version = version;
        Ok(session)
    }

    /// Whether the open reader still answers and its buzzer is still off.
    /// `Err` with no message means the reader stopped answering at all.
    fn buzzer_verified_off(session: &Session) -> Result<(), Option<String>> {
        let mut mode = u8::MAX;
        let code = unsafe { (session.get_beep)(&mut mode) };
        if code != 0 {
            return Err(None);
        }
        if mode == 0 {
            return Ok(());
        }
        // Answering but beeping again (a power blip resets the setting):
        // mute it once more and insist on reading it back as off.
        let set_code = unsafe { (session.set_beep)(0) };
        let mut again = u8::MAX;
        let get_code = unsafe { (session.get_beep)(&mut again) };
        if set_code != 0 || get_code != 0 || again != 0 {
            return Err(Some(format!(
                "POS menghentikan pembacaan: buzzer R3 belum terverifikasi mati (set={set_code}, get={get_code}, mode={again})."
            )));
        }
        Ok(())
    }

    /// Run `action` on the kept-open R3, opening it on first use and
    /// reopening it once if it stopped answering since the last read.
    pub(super) fn with_silent_r3<T>(
        app: &AppHandle,
        action: impl FnOnce(&Session) -> Result<T, String>,
    ) -> Result<(String, T), String> {
        let mut slot = session_slot();

        if let Some(session) = slot.as_ref() {
            match buzzer_verified_off(session) {
                Ok(()) => {}
                Err(Some(refusal)) => {
                    *slot = None;
                    return Err(refusal);
                }
                // Unplugged or asleep: close the dead handle, reopen below.
                Err(None) => *slot = None,
            }
        }
        if slot.is_none() {
            *slot = Some(open(app)?);
        }
        let session = slot.as_ref().expect("session was just opened");

        let result = action(session);
        result.map(|value| (session.version.clone(), value))
    }
}

#[cfg(test)]
mod tests {
    use super::epc_hex;

    #[test]
    fn strips_the_gen2_pc_word_from_a_chainway_uii() {
        let mut uii = vec![0x30, 0x00]; // six 16-bit EPC words follow
        uii.extend([
            0xa0, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12,
        ]);
        assert_eq!(
            epc_hex(&uii).expect("valid PC + EPC"),
            "A01234567890123456789012"
        );
    }

    #[test]
    fn accepts_a_bare_96_bit_epc() {
        let epc = [
            0xa0, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12,
        ];
        assert_eq!(epc_hex(&epc).expect("bare EPC"), "A01234567890123456789012");
    }

    #[test]
    fn refuses_an_empty_or_malformed_uii() {
        assert!(epc_hex(&[]).is_err());
        assert!(epc_hex(&[0x00; 14]).is_err());
    }
}
