//! The counter's hardware, and what this shell can honestly say about it today.
//!
//! This file exists because of one sentence in `POS-SHELL-PLAN.md`: a desktop
//! shell is worth building only when a till has a device the browser cannot
//! reach. That is now the case — the counter has a USB RFID reader and a
//! fingerprint scanner — and this is where those live.
//!
//! # Device bindings
//!
//! The Chainway R3 is bound on Windows through the vendor's C SDK. Every read
//! first turns the reader buzzer off and verifies that state, then asks for one
//! tag only. Fingerprint remains an explicit stub until its SDK is bound.
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
//! **RFID** has two lanes: signed network readers post sweep observations to
//! `/api/v1/rfid/observations`; the counter's Chainway R3 is a local USB reader
//! and contributes a one-shot EPC to the unsold basket.
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
pub fn rfid_state(app: tauri::AppHandle) -> DeviceState {
    match crate::rfid::reader_state(&app) {
        Ok(version) => DeviceState {
            bound: true,
            detail: format!("Chainway R3 terhubung ({version}); buzzer mati dan terverifikasi."),
        },
        Err(detail) => DeviceState {
            bound: false,
            detail,
        },
    }
}

/// Read exactly one tag from the Chainway R3 after confirming the buzzer is
/// off. Returns only the EPC, which the existing scan path validates.
#[tauri::command]
pub fn rfid_read_single(app: tauri::AppHandle) -> Result<String, String> {
    crate::rfid::read_single(&app)
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
pub fn fingerprint_identify(
    node: tauri::State<'_, crate::edge::Node>,
    enrolled: Vec<EnrolledFinger>,
) -> Identified {
    // A development build may be told to pretend, so that everything around the
    // sensor can be exercised on a machine that has none: the roster coming
    // down, the claim being signed, the sequence being burned, the grant being
    // spent once and expiring. The block is compiled out of a release, so a
    // till in a shop cannot be talked into simulating a supervisor by editing a
    // config file — and every simulated answer says so in the words the cashier
    // reads, because a screen that cannot tell a rehearsal from the real thing
    // is how a rehearsal reaches a customer.
    #[cfg(debug_assertions)]
    {
        let pretend = node
            .0
            .lock()
            .expect("node config")
            .simulate_fingerprint
            .clone();
        if let Some(who) = pretend.filter(|who| !who.trim().is_empty()) {
            let who = who.trim();
            return match enrolled
                .iter()
                .find(|one| one.actor_id.eq_ignore_ascii_case(who))
            {
                Some(found) => Identified {
                    bound: true,
                    actor_id: Some(found.actor_id.clone()),
                    score: Some(0),
                    detail: format!(
                        "SIMULASI — tidak ada sidik jari yang dibaca. \
                         Terminal ini disetel berpura-pura mengenali {who}."
                    ),
                },
                None => Identified {
                    bound: true,
                    actor_id: None,
                    score: None,
                    detail: format!(
                        "SIMULASI — {who} tidak ada di daftar sidik jari toko ini, \
                         jadi dijawab seperti jari yang tidak dikenali."
                    ),
                },
            };
        }
    }
    let _ = enrolled;
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
