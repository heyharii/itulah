//! The ZKTeco fingerprint scanner on HR's PC (ZK9500 / SLK20R class, ZKFinger
//! Standard SDK 5.3.0.33): head office enrols a person's fingers when it
//! registers them, and every store server takes them from there (owner,
//! 24 Oct 2026).
//!
//! # What this binds, and where it came from
//!
//! The enrolment half of `pos-desktop/src-tauri/src/fingerprint.rs`, with the
//! same binding: `libzkfp.dll` loaded at run time with `libloading`, so a PC
//! without the driver still starts Central. `Init` → `OpenDevice(0)` →
//! `DBInit` → width and height from `GetParameters(1|2)` → `AcquireFingerprint`
//! polled → `DBMatch` between presses → `DBMerge` of three presses into one
//! enrolment template. No 1:N identify: matching is the POS's, against the
//! templates head office hands down. Every export is `__stdcall`, which on x64
//! is the one Windows convention, so `extern "system"` is exact.
//!
//! # The driver
//!
//! `libzkfp.dll` imports `ZKFPCap.dll` and `fpslib.dll`, which load the sensor
//! plug-ins and need the vendor's USB driver. IT installs all of it on the HR
//! PC with the vendor's installer (the one the POS ships under
//! `fingerprint-native/`); Central does not carry it. The DLL is looked for
//! where that installer puts it, `%SystemRoot%\System32`, after a
//! `fingerprint-native\libzkfp.dll` beside the app if someone put one there.
//!
//! # Threads
//!
//! One scanner, one call into it at a time: a capture holds `SCANNER` for its
//! whole length, waiting for fingers included, and runs on Tauri's blocking
//! pool, never on the window's thread. A status question that finds it held
//! answers "connected". A newer capture, or `cancel_capture`, calls off the
//! one running.
//!
//! Windows only. Elsewhere every command answers that it is not available on
//! this computer.

use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value};
use tauri::{AppHandle, Webview};

/// Presses merged into one enrolment, as the vendor's demo and the POS.
const PRESSES: u8 = 3;

/// The DOM event a press is announced with in the hub page.
const PRESS_EVENT: &str = "central-fingerprint";

#[cfg(not(target_os = "windows"))]
const NOT_HERE: &str = "Fingerprint enrolment works in Central on Windows only.";

/// One enrolment: the merged vendor template, and the capture's score when
/// the SDK gives one. `libzkfp`'s capture reports none, so it is `None` —
/// never zero, which would claim the capture was worthless.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
struct Captured {
    template: Vec<u8>,
    quality: Option<u8>,
}

// ── Calling a capture off ───────────────────────────────────────────────────

/// Moved on by every capture that starts and by every cancel: a capture runs
/// while it is still the number it started with.
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn begin() -> u64 {
    GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn called_off(mine: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) != mine
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 15)] as char);
    }
    out
}

/// A press, said to the page as a DOM event: the hub is remote, and this needs
/// no listener permission granted to it.
fn pressed(webview: &Webview, presses: u8, message: &str) {
    let detail = json!({ "presses": presses, "needed": PRESSES, "message": message });
    let _ = webview.eval(format!(
        "window.dispatchEvent(new CustomEvent({}, {{ detail: {detail} }}))",
        json!(PRESS_EVENT)
    ));
}

// ── The commands ────────────────────────────────────────────────────────────

/// `{ connected, problem }`: whether the scanner is there, opening it if it is
/// not open yet. `problem` is the sentence to show when it is not.
#[tauri::command]
pub async fn scanner_status(app: AppHandle) -> Value {
    let answer = tauri::async_runtime::spawn_blocking(move || state(&app))
        .await
        .unwrap_or_else(|error| Err(error.to_string()));
    match answer {
        Ok(()) => json!({ "connected": true, "problem": null }),
        Err(problem) => json!({ "connected": false, "problem": problem }),
    }
}

/// `{ template_hex, quality }` after three presses of the same finger. Each
/// press is announced as a `central-fingerprint` event on the page's window,
/// `detail: { presses, needed, message }`.
#[tauri::command]
pub async fn capture_finger(app: AppHandle, webview: Webview) -> Result<Value, String> {
    let mine = begin();
    let captured = tauri::async_runtime::spawn_blocking(move || {
        capture(&app, mine, &|presses: u8, message: &str| {
            pressed(&webview, presses, message)
        })
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(json!({
        "template_hex": hex(&captured.template),
        "quality": captured.quality,
    }))
}

/// Calls off the capture running, if there is one.
#[tauri::command]
pub fn cancel_capture() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

fn state(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows::state(app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err(NOT_HERE.into())
    }
}

fn capture(app: &AppHandle, mine: u64, progress: &dyn Fn(u8, &str)) -> Result<Captured, String> {
    #[cfg(target_os = "windows")]
    {
        return windows::enrol(app, mine, progress);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, mine, progress);
        Err(NOT_HERE.into())
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::os::raw::{c_int, c_uchar, c_uint, c_void};
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard, PoisonError, TryLockError};
    use std::time::{Duration, Instant};

    use libloading::Library;
    use tauri::{AppHandle, Manager};

    use super::{called_off, Captured, PRESSES};

    type Handle = *mut c_void;

    // `libzkfp.h`. `APICALL` is `__stdcall`, the x64 convention.
    type Init = unsafe extern "system" fn() -> c_int;
    type Terminate = unsafe extern "system" fn() -> c_int;
    type DeviceCount = unsafe extern "system" fn() -> c_int;
    type OpenDevice = unsafe extern "system" fn(c_int) -> Handle;
    type CloseDevice = unsafe extern "system" fn(Handle) -> c_int;
    type GetParameters = unsafe extern "system" fn(Handle, c_int, *mut c_uchar, *mut c_uint) -> c_int;
    type Acquire =
        unsafe extern "system" fn(Handle, *mut c_uchar, c_uint, *mut c_uchar, *mut c_uint) -> c_int;
    type DbInit = unsafe extern "system" fn() -> Handle;
    type DbFree = unsafe extern "system" fn(Handle) -> c_int;
    type DbMatch =
        unsafe extern "system" fn(Handle, *mut c_uchar, c_uint, *mut c_uchar, c_uint) -> c_int;
    type DbMerge = unsafe extern "system" fn(
        Handle,
        *mut c_uchar,
        *mut c_uchar,
        *mut c_uchar,
        *mut c_uchar,
        *mut c_uint,
    ) -> c_int;

    // `libzkfperrdef.h`.
    const OK: c_int = 0;
    const ALREADY_INIT: c_int = 1;
    const ERR_NO_DEVICE: c_int = -3;
    const ERR_INVALID_HANDLE: c_int = -7;
    const ERR_CAPTURE: c_int = -8;
    const ERR_EXTRACT_FP: c_int = -9;
    const ERR_ABSORT: c_int = -10;
    const ERR_BUSY: c_int = -12;
    const ERR_CANCEL: c_int = -18;
    const ERR_NOT_OPENED: c_int = -23;
    const ERR_TIMEOUT: c_int = -28;

    /// `MAX_TEMPLATE_SIZE` in `libzkfptype.h`.
    const MAX_TEMPLATE: usize = 2048;
    /// `GetParameters` codes for the image's width and height.
    const PARAM_WIDTH: c_int = 1;
    const PARAM_HEIGHT: c_int = 2;
    /// How often the scanner is asked for a finger.
    const POLL: Duration = Duration::from_millis(100);
    /// How long one press is waited for before the capture gives up.
    const PRESS_WAIT: Duration = Duration::from_secs(30);
    /// Unexplained capture errors in a row (two seconds of them) before the
    /// scanner is taken to be gone and is closed.
    const TROUBLE_LIMIT: u32 = 20;

    const NOT_INSTALLED: &str =
        "The fingerprint scanner driver is not installed on this PC. Ask IT to install ZKFinger.";
    const NOT_CONNECTED: &str = "The fingerprint scanner is not connected. Check its USB cable.";
    const UNPLUGGED: &str = "The fingerprint scanner was unplugged. Plug it back in and start again.";
    const NO_FINGER: &str = "No finger was read. Start again.";
    const CANCELLED: &str = "The capture was cancelled.";

    /// The SDK's entry points, out of a `libzkfp.dll` that is never unloaded.
    struct Sdk {
        init: Init,
        terminate: Terminate,
        device_count: DeviceCount,
        open_device: OpenDevice,
        close_device: CloseDevice,
        get_parameters: GetParameters,
        acquire: Acquire,
        db_init: DbInit,
        db_free: DbFree,
        db_match: DbMatch,
        db_merge: DbMerge,
    }

    struct Device {
        handle: Handle,
        /// `width × height`, as the scanner reported them on opening. The SDK
        /// writes the image here on every capture; nothing reads it.
        image: Vec<u8>,
    }

    struct Scanner {
        sdk: Option<&'static Sdk>,
        initialised: bool,
        device: Option<Device>,
        /// The SDK's matching cache, empty: `DBMatch` and `DBMerge` need one.
        db: Option<Handle>,
        /// A finger was read and has not been seen lifted since: a finger left
        /// on the glass is the same press, not the next one.
        awaiting_lift: bool,
    }

    // The handles are the SDK's pointers. They are only ever used with
    // `SCANNER` held, one thread at a time, which is all the SDK asks.
    unsafe impl Send for Scanner {}

    static SCANNER: Mutex<Scanner> = Mutex::new(Scanner {
        sdk: None,
        initialised: false,
        device: None,
        db: None,
        awaiting_lift: false,
    });

    fn lock() -> MutexGuard<'static, Scanner> {
        SCANNER.lock().unwrap_or_else(PoisonError::into_inner)
    }

    // ── Loading ─────────────────────────────────────────────────────────────

    fn system32() -> PathBuf {
        std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("System32")
    }

    /// Where Central looks for `libzkfp.dll`, in order.
    fn candidates(app: &AppHandle) -> Vec<PathBuf> {
        let mut found = Vec::new();
        if let Ok(resource) = app.path().resource_dir() {
            found.push(resource.join("fingerprint-native").join("libzkfp.dll"));
        }
        #[cfg(debug_assertions)]
        found.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("fingerprint-native")
                .join("libzkfp.dll"),
        );
        found.push(system32().join("libzkfp.dll"));
        found
    }

    fn load(app: &AppHandle) -> Result<&'static Sdk, String> {
        let mut problems = Vec::new();
        let mut library = None;
        for path in candidates(app).into_iter().filter(|path| path.is_file()) {
            // Its own imports (ZKFPCap.dll, fpslib.dll) from its own folder.
            match unsafe {
                libloading::os::windows::Library::load_with_flags(
                    &path,
                    libloading::os::windows::LOAD_WITH_ALTERED_SEARCH_PATH,
                )
            } {
                Ok(loaded) => {
                    library = Some(Library::from(loaded));
                    break;
                }
                Err(error) => problems.push(format!("{}: {error}", path.display())),
            }
        }
        if library.is_none() {
            // The ordinary search, for a driver installed somewhere on the PATH.
            if let Ok(loaded) = unsafe { Library::new("libzkfp.dll") } {
                library = Some(loaded);
            }
        }
        let Some(library) = library else {
            return Err(if problems.is_empty() {
                NOT_INSTALLED.to_string()
            } else {
                format!(
                    "The fingerprint scanner driver could not be loaded ({}). Ask IT to reinstall \
                     ZKFinger.",
                    problems.join("; ")
                )
            });
        };
        let api: &'static Library = Box::leak(Box::new(library));
        let sdk = Sdk {
            init: symbol(api, &[b"ZKFPM_Init\0"])?,
            terminate: symbol(api, &[b"ZKFPM_Terminate\0"])?,
            device_count: symbol(api, &[b"ZKFPM_GetDeviceCount\0"])?,
            open_device: symbol(api, &[b"ZKFPM_OpenDevice\0"])?,
            close_device: symbol(api, &[b"ZKFPM_CloseDevice\0"])?,
            get_parameters: symbol(api, &[b"ZKFPM_GetParameters\0"])?,
            acquire: symbol(api, &[b"ZKFPM_AcquireFingerprint\0"])?,
            db_init: symbol(api, &[b"ZKFPM_DBInit\0", b"ZKFPM_CreateDBCache\0"])?,
            db_free: symbol(api, &[b"ZKFPM_DBFree\0", b"ZKFPM_CloseDBCache\0"])?,
            db_match: symbol(api, &[b"ZKFPM_DBMatch\0", b"ZKFPM_MatchFinger\0"])?,
            db_merge: symbol(api, &[b"ZKFPM_DBMerge\0", b"ZKFPM_GenRegTemplate\0"])?,
        };
        Ok(Box::leak(Box::new(sdk)))
    }

    fn symbol<T: Copy>(api: &'static Library, names: &[&[u8]]) -> Result<T, String> {
        for name in names {
            if let Ok(found) = unsafe { api.get::<T>(name) } {
                return Ok(*found);
            }
        }
        let name = String::from_utf8_lossy(names[0].strip_suffix(b"\0").unwrap_or(names[0]));
        Err(format!(
            "The fingerprint scanner driver on this PC has no {name}. Ask IT to reinstall ZKFinger."
        ))
    }

    // ── Opening ─────────────────────────────────────────────────────────────

    fn free_db(sdk: &Sdk, scanner: &mut Scanner) {
        if let Some(db) = scanner.db.take() {
            unsafe { (sdk.db_free)(db) };
        }
    }

    fn close(sdk: &Sdk, scanner: &mut Scanner) {
        free_db(sdk, scanner);
        if let Some(device) = scanner.device.take() {
            unsafe { (sdk.close_device)(device.handle) };
        }
        scanner.awaiting_lift = false;
    }

    fn init(sdk: &Sdk, scanner: &mut Scanner) -> Result<(), String> {
        if scanner.initialised {
            return Ok(());
        }
        let answer = unsafe { (sdk.init)() };
        if answer != OK && answer != ALREADY_INIT {
            return Err(format!(
                "The fingerprint scanner driver refused to start (ZKFPM_Init {answer}). Unplug \
                 the scanner, plug it back in and try again."
            ));
        }
        scanner.initialised = true;
        Ok(())
    }

    /// The scanner open and ready for a capture, loading and initialising
    /// the SDK the first time.
    fn open(app: &AppHandle, scanner: &mut Scanner) -> Result<&'static Sdk, String> {
        let sdk = match scanner.sdk {
            Some(sdk) => sdk,
            None => {
                let sdk = load(app)?;
                scanner.sdk = Some(sdk);
                sdk
            }
        };
        init(sdk, scanner)?;
        if scanner.device.is_some() {
            return Ok(sdk);
        }

        let mut count = unsafe { (sdk.device_count)() };
        if count <= 0 {
            // The SDK counts scanners when it is initialised: one plugged in
            // since then is found by initialising it again.
            free_db(sdk, scanner);
            unsafe { (sdk.terminate)() };
            scanner.initialised = false;
            init(sdk, scanner)?;
            count = unsafe { (sdk.device_count)() };
        }
        if count <= 0 {
            return Err(NOT_CONNECTED.into());
        }

        let handle = unsafe { (sdk.open_device)(0) };
        if handle.is_null() {
            return Err("The fingerprint scanner is connected but could not be opened. Close any \
                        other app using it and try again."
                .into());
        }
        let width = parameter(sdk, handle, PARAM_WIDTH);
        let height = parameter(sdk, handle, PARAM_HEIGHT);
        // A scanner that will not say its size gets room for the largest
        // image this family makes, rather than a buffer it could overrun.
        let size = if width > 0 && height > 0 {
            (width as usize) * (height as usize)
        } else {
            640 * 480
        };
        scanner.device = Some(Device {
            handle,
            image: vec![0; size],
        });
        scanner.awaiting_lift = false;
        Ok(sdk)
    }

    /// An integer parameter of the open scanner, little-endian; 0 when it
    /// will not say.
    fn parameter(sdk: &Sdk, handle: Handle, code: c_int) -> i32 {
        let mut value = [0u8; 4];
        let mut size: c_uint = 4;
        let answer = unsafe { (sdk.get_parameters)(handle, code, value.as_mut_ptr(), &mut size) };
        if answer != OK {
            return 0;
        }
        i32::from_le_bytes(value)
    }

    /// The empty matching cache, made the first time a capture needs it.
    fn ensure_db(sdk: &Sdk, scanner: &mut Scanner) -> Result<Handle, String> {
        if let Some(db) = scanner.db {
            return Ok(db);
        }
        let handle = unsafe { (sdk.db_init)() };
        if handle.is_null() {
            return Err("The fingerprint scanner driver could not prepare matching \
                        (ZKFPM_DBInit). Restart Central."
                .into());
        }
        scanner.db = Some(handle);
        Ok(handle)
    }

    // ── A finger ────────────────────────────────────────────────────────────

    /// Wait for a finger until `deadline`. `Ok(None)`: nobody pressed, or the
    /// capture was called off. A finger already on the glass from the last
    /// read counts only once it has been lifted and placed again.
    fn capture(
        sdk: &Sdk,
        scanner: &mut Scanner,
        deadline: Instant,
        mine: u64,
    ) -> Result<Option<Vec<u8>>, String> {
        let mut trouble = 0u32;
        loop {
            if called_off(mine) {
                return Ok(None);
            }
            let Some(device) = scanner.device.as_mut() else {
                return Err(NOT_CONNECTED.into());
            };
            let mut template = vec![0u8; MAX_TEMPLATE];
            let mut size = MAX_TEMPLATE as c_uint;
            let answer = unsafe {
                (sdk.acquire)(
                    device.handle,
                    device.image.as_mut_ptr(),
                    device.image.len() as c_uint,
                    template.as_mut_ptr(),
                    &mut size,
                )
            };
            match answer {
                OK if size > 0 && (size as usize) <= MAX_TEMPLATE => {
                    trouble = 0;
                    if !scanner.awaiting_lift {
                        scanner.awaiting_lift = true;
                        template.truncate(size as usize);
                        return Ok(Some(template));
                    }
                }
                // A finger is there but too poor to read: still on the glass.
                OK | ERR_EXTRACT_FP => trouble = 0,
                // No finger: whatever was on the glass has been lifted.
                ERR_CAPTURE | ERR_ABSORT | ERR_BUSY | ERR_CANCEL | ERR_TIMEOUT => {
                    trouble = 0;
                    scanner.awaiting_lift = false;
                }
                ERR_NO_DEVICE | ERR_INVALID_HANDLE | ERR_NOT_OPENED => {
                    close(sdk, scanner);
                    return Err(UNPLUGGED.into());
                }
                other => {
                    scanner.awaiting_lift = false;
                    trouble += 1;
                    if trouble >= TROUBLE_LIMIT {
                        close(sdk, scanner);
                        return Err(format!("{UNPLUGGED} (ZKFPM_AcquireFingerprint {other})"));
                    }
                }
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(POLL);
        }
    }

    // ── What the commands call ──────────────────────────────────────────────

    pub fn state(app: &AppHandle) -> Result<(), String> {
        let mut scanner = match SCANNER.try_lock() {
            Ok(scanner) => scanner,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            // Held by a capture: it is there and listening.
            Err(TryLockError::WouldBlock) => return Ok(()),
        };
        open(app, &mut scanner).map(|_| ())
    }

    /// Three presses of one finger, merged into one enrolment template.
    pub fn enrol(
        app: &AppHandle,
        mine: u64,
        progress: &dyn Fn(u8, &str),
    ) -> Result<Captured, String> {
        let mut guard = lock();
        let scanner: &mut Scanner = &mut guard;
        let sdk = open(app, scanner)?;
        let db = ensure_db(sdk, scanner)?;

        let mut presses: Vec<Vec<u8>> = Vec::with_capacity(PRESSES as usize);
        while presses.len() < PRESSES as usize {
            let deadline = Instant::now() + PRESS_WAIT;
            let Some(mut template) = capture(sdk, scanner, deadline, mine)? else {
                return Err(if called_off(mine) {
                    CANCELLED.into()
                } else {
                    NO_FINGER.into()
                });
            };
            // Every press after the first must be the same finger as the one
            // before it.
            if let Some(previous) = presses.last() {
                let mut previous = previous.clone();
                let score = unsafe {
                    (sdk.db_match)(
                        db,
                        previous.as_mut_ptr(),
                        previous.len() as c_uint,
                        template.as_mut_ptr(),
                        template.len() as c_uint,
                    )
                };
                if score <= 0 {
                    progress(
                        presses.len() as u8,
                        "Not the same finger. Press the finger you pressed first.",
                    );
                    continue;
                }
            }
            presses.push(template);
            let left = PRESSES as usize - presses.len();
            if left > 0 {
                progress(
                    presses.len() as u8,
                    &format!("Lift the finger and press it again ({left} more)."),
                );
            }
        }
        progress(PRESSES, "Read three times.");

        let mut merged = vec![0u8; MAX_TEMPLATE];
        let mut size = MAX_TEMPLATE as c_uint;
        let merge = unsafe {
            (sdk.db_merge)(
                db,
                presses[0].as_mut_ptr(),
                presses[1].as_mut_ptr(),
                presses[2].as_mut_ptr(),
                merged.as_mut_ptr(),
                &mut size,
            )
        };
        if merge != OK || size == 0 || size as usize > MAX_TEMPLATE {
            return Err(format!(
                "The three presses could not be merged (ZKFPM_DBMerge {merge}). Start again."
            ));
        }
        merged.truncate(size as usize);
        Ok(Captured {
            template: merged,
            quality: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_pairs() {
        assert_eq!(hex(&[]), "");
        assert_eq!(hex(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
    }

    #[test]
    fn a_newer_capture_or_a_cancel_calls_one_off() {
        let first = begin();
        assert!(!called_off(first));
        let second = begin();
        assert!(called_off(first));
        assert!(!called_off(second));
        cancel_capture();
        assert!(called_off(second));
    }
}
