//! The counter's hardware, and what this shell can honestly say about it today.
//!
//! This file exists because of one sentence in `POS-SHELL-PLAN.md`: a desktop
//! shell is worth building only when a till has a device the browser cannot
//! reach. That is now the case — the counter has a USB RFID reader and a
//! fingerprint scanner — and this is where those live.
//!
//! # Why they are stubs, and why the stubs say so out loud
//!
//! None of that hardware is on this machine, and neither vendor SDK has been
//! bound yet. A stub that returned an empty tag list, or "no match", would be
//! indistinguishable from a reader that saw nothing — which is the failure a
//! cashier cannot diagnose: they press a finger, nothing happens, and there is
//! no way to tell a broken scanner from an unrecognised print. So every call
//! here refuses by name, and the window is expected to show that refusal.
//!
//! # What will replace them
//!
//! **Fingerprint.** `~/Documents/retail/pos-fp-host` is a working precedent
//! against the same scanner: `Native/ZkfpNative.cs` is a P/Invoke surface over
//! `libzkfp.dll`, whose names come from `libzkfp.h` — a plain **C** API, which
//! Rust binds the same way .NET does. What C# has there is a binding that
//! already works, not a capability this shell lacks.
//!
//! The shape below is `pos-electron`'s, deliberately: status, enrol, verify,
//! identify. Identify is the one that matters — matching happens **here**, on
//! the till, against templates the node handed down, so a counter can still
//! open when the line to head office is down. A design that sent the captured
//! print to a server to be matched would be a till that cannot sign anybody in
//! during an outage, which at a counter means a shop that cannot trade.
//!
//! **RFID** may never need a driver at all. Our lane is networked and signed: a
//! reader proves possession of an enrolment key and POSTs a batch to
//! `/api/v1/rfid/observations`. A USB sled on this counter is the exception to
//! that, not a second way for tags to enter the estate.
//!
//! **Printing does not belong here.** Receipts are ESC/POS rendered by the
//! edge, which is already the party on the printer's LAN. A desktop shell that
//! rendered its own receipt would be a second opinion about what a sale said.

use serde::{Deserialize, Serialize};

/// What the window is told about a device it asked for.
#[derive(Serialize)]
pub struct DeviceState {
    /// Whether this shell can drive it at all yet.
    pub bound: bool,
    /// Said to the cashier, in the words they should read on screen.
    pub detail: String,
}

/// The refusal every unbound device gives, so the wording is written once.
fn unbound(what: &str) -> DeviceState {
    DeviceState {
        bound: false,
        detail: format!(
            "{what} belum tersambung ke aplikasi kasir ini. Driver perangkatnya \
             belum dipasang, jadi jawabannya bukan “tidak dikenali” — melainkan \
             belum ada yang membaca."
        ),
    }
}

#[tauri::command]
pub fn rfid_state() -> DeviceState {
    unbound("Pembaca RFID USB")
}

#[tauri::command]
pub fn fingerprint_state() -> DeviceState {
    unbound("Pemindai sidik jari")
}

/// The cash drawer, which on most counters is opened by the receipt printer
/// rather than by the terminal. Named here so the window has one place to ask —
/// and one answer while that is still true.
#[tauri::command]
pub fn open_drawer() -> DeviceState {
    DeviceState {
        bound: false,
        detail: "Laci kas dibuka oleh printer struk lewat node, bukan oleh \
                 aplikasi ini. Cetak struk dengan pulse laci untuk membukanya."
            .into(),
    }
}

/// One enrolled finger, as the node would hand it down.
///
/// The template is the vendor's own blob, base64'd. It is **not** an image and
/// cannot be turned back into one, which is the only reason it is acceptable
/// for it to travel to a till at all.
#[derive(Debug, Deserialize)]
pub struct EnrolledFinger {
    pub actor_id: String,
    pub template_base64: String,
}

/// Who the finger on the scanner belongs to.
///
/// `None` for the match is an ordinary answer — an unenrolled finger, a bad
/// press, a wet thumb — and is not the same as the scanner being absent, which
/// is why `bound` is reported separately.
#[derive(Serialize)]
pub struct Identified {
    pub bound: bool,
    pub actor_id: Option<String>,
    /// The vendor's own confidence, when there is one. Kept so a threshold can
    /// be argued about with numbers rather than adjectives.
    pub score: Option<i32>,
    pub detail: String,
}

/// Match the finger on the scanner against what the node has enrolled.
///
/// Takes the templates rather than fetching them: which fingers may open this
/// till is the node's decision, and a shell that fetched its own list would be
/// a second opinion about who works here.
#[tauri::command]
pub fn fingerprint_identify(_enrolled: Vec<EnrolledFinger>) -> Identified {
    Identified {
        bound: false,
        actor_id: None,
        score: None,
        detail: "Pemindai sidik jari belum tersambung ke aplikasi ini, jadi \
                 tidak ada yang dicocokkan. Masuk dengan nama pengguna dan kata \
                 sandi dulu."
            .into(),
    }
}

/// Capture a finger for enrolment, returning the template to be stored.
///
/// Enrolment is the node's record, not this machine's: a finger enrolled on one
/// till and unknown at the next one is a cashier who cannot cover a break.
#[derive(Serialize)]
pub struct Enrolled {
    pub bound: bool,
    pub template_base64: Option<String>,
    pub detail: String,
}

#[tauri::command]
pub fn fingerprint_enroll() -> Enrolled {
    Enrolled {
        bound: false,
        template_base64: None,
        detail: "Pemindai sidik jari belum tersambung, jadi tidak ada sidik jari \
                 yang bisa didaftarkan dari terminal ini."
            .into(),
    }
}
