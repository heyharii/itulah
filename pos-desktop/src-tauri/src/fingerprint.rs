//! The ZKTeco fingerprint scanner on the Windows till (ZK9500 / SLK20R class,
//! ZKFinger Standard SDK 5.3.0.33).
//!
//! # What this binds, and where it came from
//!
//! `libzkfp.dll`, the SDK's plain C API (`libzkfp.h`), loaded at run time with
//! `libloading` so a till without the driver still starts and says "not
//! connected" instead of refusing to open. The calls, their order and their
//! buffer sizes follow the owner's working attendance bridge against the same
//! scanner (`heyharii/retail`, `attendance-terminal/zk-bridge/ZkDevice.cs`):
//! `Init` → `OpenDevice(0)` → `DBInit` → width and height from
//! `GetParameters(1|2)` → `AcquireFingerprint` polled → `DBAdd` /
//! `DBIdentify` for 1:N, `DBMatch` between enrolment presses and `DBMerge` of
//! three presses into one enrolment template. Every export is `APICALL`
//! (`__stdcall`), which on x64 is the one Windows calling convention, so
//! `extern "system"` is exact.
//!
//! # Where the DLL is found
//!
//! `libzkfp.dll` is not a self-contained library: it imports `ZKFPCap.dll`
//! and `fpslib.dll`, those load the sensor plug-ins under `ZKFPSensors\`, and
//! the scanner itself needs the vendor's libusb0 kernel driver
//! (`zkusbdevices.inf`). All of that is what the vendor's installer puts in
//! place, so the till ships that installer (`fingerprint-native/
//! ZKFinger-setup.exe`, run from Perangkat kasir → Pasang driver) and loads the
//! DLL from where it installs it, `%SystemRoot%\System32`. A
//! `fingerprint-native\libzkfp.dll` beside the app, when someone puts one
//! there, is tried first; its own imports are then resolved from its folder.
//!
//! # Threads
//!
//! One scanner, one call into it at a time: everything below holds `SCANNER`
//! for its whole length, waiting for a finger included, and runs on Tauri's
//! blocking pool (`edge::off_the_window`), never on the window's thread. A
//! status question that finds the scanner held answers "busy" rather than
//! waiting. A wait can be called off by name (`cancel`), which is how the
//! door stops listening the moment its screen changes.
//!
//! # A finger, once
//!
//! After every press the scanner has to see no finger before it counts the
//! next one, as `ZkDevice.cs` does with `_awaitLift`: a thumb left resting on
//! the glass after a refusal is the same press, not a second one.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, PoisonError};

/// Written on every enrolment the node stores (`reader_kind`), so a shop that
/// changes scanners knows which templates to redo.
pub const READER_KIND: &str = "ZKTeco ZKFinger 5.3 (libzkfp)";

/// Presses merged into one enrolment, as the vendor's demo and `ZkDevice.cs`.
pub const ENROL_PRESSES: u8 = 3;

/// How long one call waits for a finger when the window does not say.
const DEFAULT_WAIT_MS: u64 = 10_000;
/// And the longest it may ask for.
const LONGEST_WAIT_MS: u64 = 30_000;

pub fn wait_of(asked: Option<u64>) -> u64 {
    asked.unwrap_or(DEFAULT_WAIT_MS).clamp(200, LONGEST_WAIT_MS)
}

/// One enrolled finger, as the node hands it down.
///
/// The template is the vendor's own blob, base64'd. It is **not** an image and
/// cannot be turned back into one, which is the only reason it is acceptable
/// for it to travel to a till at all.
#[derive(Clone, Debug, Deserialize)]
pub struct EnrolledFinger {
    /// What a match answers with: the window sends the enrolment's
    /// `finger_id`, so the node is told which finger matched.
    pub actor_id: String,
    pub template_base64: String,
    /// Whose finger it is, for the debug build's pretend match.
    #[serde(default)]
    pub username: Option<String>,
}

/// Who the finger on the scanner belongs to.
///
/// `None` for the match is an ordinary answer — an unenrolled finger, a bad
/// press, a wet thumb — and is not the same as the scanner being absent, which
/// is why `bound` is reported separately; and neither is the same as nobody
/// pressing at all, which is `placed: false`.
#[derive(Serialize)]
pub struct Identified {
    pub bound: bool,
    /// A finger was read. False: the wait ran out or was called off, and
    /// nothing should be claimed.
    pub placed: bool,
    pub actor_id: Option<String>,
    /// The vendor's own confidence, when there is one. Kept so a threshold can
    /// be argued about with numbers rather than adjectives.
    pub score: Option<i32>,
    pub detail: String,
}

/// One press towards an enrolment, and where the enrolment stands.
///
/// Enrolment is the node's record, not this machine's: a finger enrolled on
/// one till and unknown at the next one is a cashier who cannot cover a break.
/// So the merged template comes back here and the window posts it.
#[derive(Serialize)]
pub struct Enrolled {
    pub bound: bool,
    pub placed: bool,
    /// Good presses so far, of `needed`.
    pub presses: u8,
    pub needed: u8,
    /// Set once the third press is merged: the template to store.
    pub template_base64: Option<String>,
    /// The press matched an enrolment already on the roster it was given
    /// (its `actor_id`); the enrolment started over.
    pub duplicate_of: Option<String>,
    /// The press was not the same finger as the one before; it did not count.
    pub retry: bool,
    /// What the node is told produced the template (`reader_kind`).
    pub reader_kind: &'static str,
    pub detail: String,
}

impl Identified {
    fn unbound(detail: String) -> Self {
        Self {
            bound: false,
            placed: false,
            actor_id: None,
            score: None,
            detail,
        }
    }
}

impl Enrolled {
    fn unbound(detail: String) -> Self {
        Self {
            bound: false,
            placed: false,
            presses: 0,
            needed: ENROL_PRESSES,
            template_base64: None,
            duplicate_of: None,
            retry: false,
            reader_kind: READER_KIND,
            detail,
        }
    }
}

// ── Calling a wait off ──────────────────────────────────────────────────────

/// Waits the window has called off, by the name it gave them. A name is
/// removed when its wait sees it; one that arrives after its wait ended stays
/// until the list is trimmed.
static CANCELLED: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn cancel(watch: &str) {
    let mut list = CANCELLED.lock().unwrap_or_else(PoisonError::into_inner);
    if list.len() >= 64 {
        list.drain(..32);
    }
    list.push(watch.to_string());
}

/// Whether the wait named `watch` has been called off; true takes the name
/// off the list.
fn called_off(watch: Option<&str>) -> bool {
    let Some(watch) = watch else { return false };
    let mut list = CANCELLED.lock().unwrap_or_else(PoisonError::into_inner);
    match list.iter().position(|one| one == watch) {
        Some(at) => {
            list.remove(at);
            true
        }
        None => false,
    }
}

/// Sleep up to `ms`, waking early when the wait is called off. True: called
/// off. What a debug build's pretend scanner does while it is only listening.
#[allow(dead_code)]
pub fn idle(ms: u64, watch: Option<&str>) -> bool {
    let until = std::time::Instant::now() + std::time::Duration::from_millis(ms);
    while std::time::Instant::now() < until {
        if called_off(watch) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    false
}

// ── Base64 ──────────────────────────────────────────────────────────────────
//
// Standard alphabet with padding, as .NET's `Convert.ToBase64String` (what
// `zkfp2.BlobToBase64` is) writes it — the form migration 536 and the node
// store. Written here rather than through the SDK's `ZKFPM_Base64ToBlob`,
// whose answer for a bad string is only "≤ 0".

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

pub fn decode_base64(text: &str) -> Option<Vec<u8>> {
    fn value(c: u8) -> Option<u32> {
        let sextet: u8 = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        };
        Some(u32::from(sextet))
    }
    let clean: Vec<u8> = text
        .bytes()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    let body: &[u8] = {
        let mut end = clean.len();
        while end > 0 && clean[end - 1] == b'=' {
            end -= 1;
        }
        &clean[..end]
    };
    if body.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(body.len() * 3 / 4);
    for chunk in body.chunks(4) {
        let mut n = 0u32;
        for (at, c) in chunk.iter().enumerate() {
            n |= value(*c)? << (18 - 6 * at);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

// ── What the commands call ──────────────────────────────────────────────────

#[cfg(not(target_os = "windows"))]
const NOT_HERE: &str = "Pemindai sidik jari hanya bisa dipakai di aplikasi kasir Windows.";

/// Whether the scanner is there, opening it if it is not open yet.
pub fn state(app: &tauri::AppHandle) -> (bool, String) {
    #[cfg(target_os = "windows")]
    {
        return windows::state(app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        (false, NOT_HERE.into())
    }
}

/// Wait up to `wait_ms` for a finger and match it against `enrolled`.
pub fn identify(
    app: &tauri::AppHandle,
    enrolled: &[EnrolledFinger],
    wait_ms: u64,
    watch: Option<&str>,
) -> Identified {
    #[cfg(target_os = "windows")]
    {
        return windows::identify(app, enrolled, wait_ms, watch);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, enrolled, wait_ms, watch);
        Identified::unbound(NOT_HERE.into())
    }
}

/// One enrolment press. `restart` forgets the presses so far and, with
/// `enrolled`, loads the shop's roster so a finger already enrolled is
/// refused on its first press.
pub fn enrol(
    app: &tauri::AppHandle,
    restart: bool,
    enrolled: Option<&[EnrolledFinger]>,
    wait_ms: u64,
    watch: Option<&str>,
) -> Enrolled {
    #[cfg(target_os = "windows")]
    {
        return windows::enrol(app, restart, enrolled, wait_ms, watch);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, restart, enrolled, wait_ms, watch);
        Enrolled::unbound(NOT_HERE.into())
    }
}

/// Run the vendor's driver installer shipped with the till.
pub fn install_driver(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows::install_driver(app);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
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

    use super::{
        called_off, decode_base64, encode_base64, EnrolledFinger, Enrolled, Identified,
        ENROL_PRESSES,
    };

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
    type DbAdd = unsafe extern "system" fn(Handle, c_uint, *mut c_uchar, c_uint) -> c_int;
    type DbIdentify =
        unsafe extern "system" fn(Handle, *mut c_uchar, c_uint, *mut c_uint, *mut c_uint) -> c_int;
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

    /// `MAX_TEMPLATE_SIZE` in `libzkfptype.h`; `TemplateBufSize` in `ZkDevice.cs`.
    const MAX_TEMPLATE: usize = 2048;
    /// `GetParameters` codes for the image's width and height (`ZkDevice.cs`).
    const PARAM_WIDTH: c_int = 1;
    const PARAM_HEIGHT: c_int = 2;
    /// How often the scanner is asked for a finger. `ZkDevice.cs` waits
    /// 200 ms; half that makes a press feel immediate and costs nothing.
    const POLL: Duration = Duration::from_millis(100);
    /// Unexplained capture errors in a row (two seconds of them) before the
    /// scanner is taken to be gone and is closed.
    const TROUBLE_LIMIT: u32 = 20;

    const NOT_INSTALLED: &str = "Driver pemindai sidik jari belum dipasang di komputer ini. \
         Pasang dari Perangkat kasir → Sidik jari → Pasang driver.";
    const NOT_CONNECTED: &str = "Pemindai sidik jari tidak terhubung. Periksa kabel USB-nya, \
         lalu coba lagi.";
    const UNPLUGGED: &str = "Pemindai sidik jari terlepas. Pasang lagi kabel USB-nya, lalu \
         tempelkan jari lagi.";

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
        db_add: DbAdd,
        db_identify: DbIdentify,
        db_match: DbMatch,
        db_merge: DbMerge,
        from: PathBuf,
    }

    struct Device {
        handle: Handle,
        /// `width × height`, as the scanner reported them on opening. The SDK
        /// writes the image here on every capture; nothing reads it.
        image: Vec<u8>,
    }

    /// The SDK's matching cache, holding one roster.
    struct Db {
        handle: Handle,
        /// The roster it holds, so the same roster is not loaded twice.
        digest: Vec<u8>,
        /// `actor_id` by fid − 1: fids are 1-based and in roster order.
        ids: Vec<Option<String>>,
    }

    struct Scanner {
        sdk: Option<&'static Sdk>,
        initialised: bool,
        device: Option<Device>,
        db: Option<Db>,
        /// A finger was read and has not been seen lifted since.
        awaiting_lift: bool,
        /// The enrolment presses so far.
        presses: Vec<Vec<u8>>,
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
        presses: Vec::new(),
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

    /// Where the till looks for `libzkfp.dll`, in order.
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
                    library = Some((Library::from(loaded), path));
                    break;
                }
                Err(error) => problems.push(format!("{}: {error}", path.display())),
            }
        }
        if library.is_none() {
            // What the C# bridge did: the ordinary search, for a driver
            // installed somewhere on the PATH.
            if let Ok(loaded) = unsafe { Library::new("libzkfp.dll") } {
                library = Some((loaded, PathBuf::from("libzkfp.dll")));
            }
        }
        let Some((library, from)) = library else {
            return Err(if problems.is_empty() {
                NOT_INSTALLED.to_string()
            } else {
                format!(
                    "Driver pemindai sidik jari tidak bisa dimuat ({}). Pasang ulang driver dari \
                     Perangkat kasir → Sidik jari.",
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
            db_add: symbol(api, &[b"ZKFPM_DBAdd\0", b"ZKFPM_AddRegTemplateToDBCache\0"])?,
            db_identify: symbol(api, &[b"ZKFPM_DBIdentify\0", b"ZKFPM_Identify\0"])?,
            db_match: symbol(api, &[b"ZKFPM_DBMatch\0", b"ZKFPM_MatchFinger\0"])?,
            db_merge: symbol(api, &[b"ZKFPM_DBMerge\0", b"ZKFPM_GenRegTemplate\0"])?,
            from,
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
            "Driver pemindai sidik jari di komputer ini tidak punya {name}. Pasang ulang driver \
             dari Perangkat kasir → Sidik jari."
        ))
    }

    // ── Opening ─────────────────────────────────────────────────────────────

    fn free_db(sdk: &Sdk, scanner: &mut Scanner) {
        if let Some(db) = scanner.db.take() {
            unsafe { (sdk.db_free)(db.handle) };
        }
    }

    fn close(sdk: &Sdk, scanner: &mut Scanner) {
        free_db(sdk, scanner);
        if let Some(device) = scanner.device.take() {
            unsafe { (sdk.close_device)(device.handle) };
        }
        scanner.awaiting_lift = false;
        scanner.presses.clear();
    }

    fn init(sdk: &Sdk, scanner: &mut Scanner) -> Result<(), String> {
        if scanner.initialised {
            return Ok(());
        }
        let answer = unsafe { (sdk.init)() };
        if answer != OK && answer != ALREADY_INIT {
            return Err(format!(
                "Driver pemindai sidik jari menolak dibuka (ZKFPM_Init {answer}). Cabut dan \
                 pasang lagi pemindainya, lalu coba lagi."
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
            return Err("Pemindai sidik jari terhubung tetapi tidak bisa dibuka. Tutup aplikasi \
                        lain yang memakai pemindai, lalu coba lagi."
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

    /// An integer parameter of the open scanner, little-endian as
    /// `zkfp2.ByteArray2Int` reads it; 0 when it will not say.
    fn parameter(sdk: &Sdk, handle: Handle, code: c_int) -> i32 {
        let mut value = [0u8; 4];
        let mut size: c_uint = 4;
        let answer = unsafe { (sdk.get_parameters)(handle, code, value.as_mut_ptr(), &mut size) };
        if answer != OK {
            return 0;
        }
        i32::from_le_bytes(value)
    }

    /// The scanner's matching cache, holding `enrolled` — loaded again only
    /// when the roster changed.
    fn load_db(sdk: &Sdk, scanner: &mut Scanner, enrolled: &[EnrolledFinger]) -> Result<(), String> {
        let digest = {
            use sha2::{Digest, Sha256};
            let mut hash = Sha256::new();
            for one in enrolled {
                hash.update(one.actor_id.as_bytes());
                hash.update([0]);
                hash.update(one.template_base64.trim().as_bytes());
                hash.update([0]);
            }
            hash.finalize().to_vec()
        };
        if scanner.db.as_ref().is_some_and(|db| db.digest == digest) {
            return Ok(());
        }
        free_db(sdk, scanner);
        let handle = unsafe { (sdk.db_init)() };
        if handle.is_null() {
            return Err("Driver pemindai sidik jari tidak bisa menyiapkan pencocokan \
                        (ZKFPM_DBInit). Mulai ulang aplikasi kasir."
                .into());
        }
        let mut ids = Vec::with_capacity(enrolled.len());
        for (at, one) in enrolled.iter().enumerate() {
            let added = decode_base64(&one.template_base64).is_some_and(|mut blob| {
                !blob.is_empty()
                    && unsafe {
                        (sdk.db_add)(handle, (at + 1) as c_uint, blob.as_mut_ptr(), blob.len() as c_uint)
                    } == OK
            });
            if !added {
                eprintln!("fingerprint: enrolment {} could not be loaded", one.actor_id);
            }
            ids.push(added.then(|| one.actor_id.clone()));
        }
        scanner.db = Some(Db {
            handle,
            digest,
            ids,
        });
        Ok(())
    }

    /// An empty cache, when nothing has been loaded yet: merging and
    /// matching enrolment presses need one.
    fn ensure_db(sdk: &Sdk, scanner: &mut Scanner) -> Result<(), String> {
        if scanner.db.is_some() {
            return Ok(());
        }
        load_db(sdk, scanner, &[])
    }

    // ── A finger ────────────────────────────────────────────────────────────

    /// Wait for a finger until `deadline`. `Ok(None)`: nobody pressed, or the
    /// wait was called off. A finger already on the glass from the last read
    /// counts only once it has been lifted and placed again.
    fn capture(
        sdk: &Sdk,
        scanner: &mut Scanner,
        deadline: Instant,
        watch: Option<&str>,
    ) -> Result<Option<Vec<u8>>, String> {
        let mut trouble = 0u32;
        loop {
            if called_off(watch) {
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
                        return Err(format!(
                            "{UNPLUGGED} (ZKFPM_AcquireFingerprint {other})"
                        ));
                    }
                }
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(POLL);
        }
    }

    // ── The commands ────────────────────────────────────────────────────────

    pub fn state(app: &AppHandle) -> (bool, String) {
        let mut scanner = match SCANNER.try_lock() {
            Ok(scanner) => scanner,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            // Held by a wait for a finger: it is there and listening.
            Err(TryLockError::WouldBlock) => {
                return (true, "Pemindai sidik jari siap — sedang menunggu jari.".into())
            }
        };
        match open(app, &mut scanner) {
            Ok(sdk) => (
                true,
                format!(
                    "Pemindai sidik jari siap (ZKTeco, driver {}).",
                    sdk.from.display()
                ),
            ),
            Err(problem) => (false, problem),
        }
    }

    pub fn identify(
        app: &AppHandle,
        enrolled: &[EnrolledFinger],
        wait_ms: u64,
        watch: Option<&str>,
    ) -> Identified {
        let deadline = Instant::now() + Duration::from_millis(wait_ms);
        let mut guard = lock();
        let scanner: &mut Scanner = &mut guard;
        let sdk = match open(app, scanner) {
            Ok(sdk) => sdk,
            Err(problem) => return Identified::unbound(problem),
        };
        if let Err(problem) = load_db(sdk, scanner, enrolled) {
            return Identified {
                bound: true,
                placed: false,
                actor_id: None,
                score: None,
                detail: problem,
            };
        }
        let template = match capture(sdk, scanner, deadline, watch) {
            Ok(Some(template)) => template,
            Ok(None) => {
                return Identified {
                    bound: true,
                    placed: false,
                    actor_id: None,
                    score: None,
                    detail: "Tidak ada jari yang terbaca.".into(),
                }
            }
            Err(problem) => return Identified::unbound(problem),
        };
        let (actor_id, score) = matched(sdk, scanner, template);
        Identified {
            bound: true,
            placed: true,
            detail: if actor_id.is_some() {
                "Jari dikenali.".into()
            } else {
                "Jari tidak dikenali.".into()
            },
            actor_id,
            score,
        }
    }

    /// 1:N against the loaded roster: whose finger, and the score.
    fn matched(sdk: &Sdk, scanner: &Scanner, mut template: Vec<u8>) -> (Option<String>, Option<i32>) {
        let Some(db) = scanner.db.as_ref() else {
            return (None, None);
        };
        if db.ids.iter().all(Option::is_none) {
            return (None, None);
        }
        let mut fid: c_uint = 0;
        let mut score: c_uint = 0;
        let answer = unsafe {
            (sdk.db_identify)(
                db.handle,
                template.as_mut_ptr(),
                template.len() as c_uint,
                &mut fid,
                &mut score,
            )
        };
        if answer != OK || fid == 0 {
            return (None, None);
        }
        let who = db
            .ids
            .get(fid as usize - 1)
            .and_then(Clone::clone);
        (who, Some(score as i32))
    }

    pub fn enrol(
        app: &AppHandle,
        restart: bool,
        enrolled: Option<&[EnrolledFinger]>,
        wait_ms: u64,
        watch: Option<&str>,
    ) -> Enrolled {
        let deadline = Instant::now() + Duration::from_millis(wait_ms);
        let mut guard = lock();
        let scanner: &mut Scanner = &mut guard;
        let sdk = match open(app, scanner) {
            Ok(sdk) => sdk,
            Err(problem) => return Enrolled::unbound(problem),
        };
        let progress = |scanner: &Scanner| scanner.presses.len() as u8;
        let answer = |scanner: &Scanner, placed: bool, detail: String| Enrolled {
            bound: true,
            placed,
            presses: progress(scanner),
            needed: ENROL_PRESSES,
            template_base64: None,
            duplicate_of: None,
            retry: false,
            reader_kind: super::READER_KIND,
            detail,
        };

        if restart {
            scanner.presses.clear();
            if let Some(enrolled) = enrolled {
                if let Err(problem) = load_db(sdk, scanner, enrolled) {
                    return answer(scanner, false, problem);
                }
            }
        }
        if let Err(problem) = ensure_db(sdk, scanner) {
            return answer(scanner, false, problem);
        }

        let template = match capture(sdk, scanner, deadline, watch) {
            Ok(Some(template)) => template,
            Ok(None) => return answer(scanner, false, "Tidak ada jari yang terbaca.".into()),
            Err(problem) => return Enrolled::unbound(problem),
        };

        // A finger already enrolled, to anybody, is refused on its first
        // press (`ZkDevice.cs`): one finger, one person.
        if scanner.presses.is_empty() {
            if let (Some(who), _) = matched(sdk, scanner, template.clone()) {
                return Enrolled {
                    duplicate_of: Some(who),
                    ..answer(scanner, true, "Jari ini sudah terdaftar.".into())
                };
            }
        }

        // Every press after the first must be the same finger as the one
        // before it.
        if let Some(previous) = scanner.presses.last() {
            let mut previous = previous.clone();
            let mut this = template.clone();
            let db = scanner.db.as_ref().map(|db| db.handle).unwrap_or(std::ptr::null_mut());
            let score = unsafe {
                (sdk.db_match)(
                    db,
                    previous.as_mut_ptr(),
                    previous.len() as c_uint,
                    this.as_mut_ptr(),
                    this.len() as c_uint,
                )
            };
            if score <= 0 {
                return Enrolled {
                    retry: true,
                    ..answer(
                        scanner,
                        true,
                        "Bukan jari yang sama. Tempelkan jari yang tadi.".into(),
                    )
                };
            }
        }

        scanner.presses.push(template);
        if scanner.presses.len() < ENROL_PRESSES as usize {
            let left = ENROL_PRESSES as usize - scanner.presses.len();
            return answer(
                scanner,
                true,
                format!("Bagus. Angkat jari, lalu tempelkan lagi ({left} kali lagi)."),
            );
        }

        // Three good presses: one enrolment template.
        let mut presses = std::mem::take(&mut scanner.presses);
        let mut merged = vec![0u8; MAX_TEMPLATE];
        let mut size = MAX_TEMPLATE as c_uint;
        let db = scanner.db.as_ref().map(|db| db.handle).unwrap_or(std::ptr::null_mut());
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
            return answer(
                scanner,
                true,
                format!("Tiga tempelan tidak bisa digabung (ZKFPM_DBMerge {merge}). Ulangi dari awal."),
            );
        }
        merged.truncate(size as usize);
        Enrolled {
            presses: ENROL_PRESSES,
            template_base64: Some(encode_base64(&merged)),
            ..answer(scanner, true, "Sidik jari terbaca tiga kali.".into())
        }
    }

    // ── The driver ──────────────────────────────────────────────────────────

    pub fn install_driver(app: &AppHandle) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let mut places = Vec::new();
        if let Ok(resource) = app.path().resource_dir() {
            places.push(resource.join("fingerprint-native").join("ZKFinger-setup.exe"));
        }
        #[cfg(debug_assertions)]
        places.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("fingerprint-native")
                .join("ZKFinger-setup.exe"),
        );
        let Some(setup) = places.into_iter().find(|path| path.is_file()) else {
            return Err("Pemasang driver sidik jari tidak ikut terpasang bersama aplikasi ini. \
                        Pasang “ZKFinger Standard SDK 5.3.0.33/setup.exe” secara manual."
                .into());
        };
        // `start` goes through ShellExecute, which is what raises the
        // installer's administrator prompt; a plain spawn of an installer
        // that asks for elevation is refused (error 740).
        std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(&setup)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Pemasang driver tidak bisa dijalankan: {error}"))
        // The next question loads the DLL afresh: what failed to load before
        // the driver was installed left nothing loaded to get in the way.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_as_dotnet_writes_it() {
        for bytes in [
            &b""[..],
            b"f",
            b"fo",
            b"foo",
            b"foob",
            b"fooba",
            b"foobar",
            &[0u8, 255, 128, 7, 9][..],
        ] {
            let text = encode_base64(bytes);
            assert_eq!(decode_base64(&text).as_deref(), Some(bytes));
        }
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(decode_base64("Zm8").as_deref(), Some(&b"fo"[..]));
        assert_eq!(decode_base64("Z m 9v\nYmFy").as_deref(), Some(&b"foobar"[..]));
        assert!(decode_base64("Zm9v!").is_none());
        assert!(decode_base64("Z").is_none());
    }

    #[test]
    fn a_called_off_wait_is_seen_once() {
        cancel("door-1");
        assert!(!called_off(Some("door-2")));
        assert!(called_off(Some("door-1")));
        assert!(!called_off(Some("door-1")));
        assert!(!called_off(None));
    }

    #[test]
    fn waits_are_bounded() {
        assert_eq!(wait_of(None), 10_000);
        assert_eq!(wait_of(Some(0)), 200);
        assert_eq!(wait_of(Some(999_999)), 30_000);
    }
}
