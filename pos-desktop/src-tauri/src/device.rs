//! The counter's hardware, and what this shell can honestly say about it today.
//!
//! This file exists because of one sentence in `POS-SHELL-PLAN.md`: a desktop
//! shell is worth building only when a till has a device the browser cannot
//! reach. That is now the case — the counter has a USB RFID reader and a
//! fingerprint scanner — and this is where those live.
//!
//! # Device bindings
//!
//! The Chainway R3 is bound on Windows through the vendor's C SDK. The reader
//! is opened once and kept open with its buzzer off, reading EPCs only at this
//! counter's power with no tag filter and its radio profile pinned (FastID
//! and Tag Focus off, session S0, target A, no Gen2X link); every read first
//! asks the buzzer and the power — a reset moves one or the other, and then
//! everything is set again — and reads the whole pad for a short window
//! (`rfid.rs`). Its state — Ready, Busy, Needs attention, Not connected — and
//! every coded fault come from one catalogue (`docs/rfid-status-and-errors.md`),
//! and Till devices tests it, calibrates its floor and copies its diagnostics
//! through the commands here. They all run off the window's thread: the SDK
//! waits up to a second and a half for each answer, and a counter must not
//! freeze for it.
//!
//! The ZKTeco fingerprint scanner is bound on Windows through the vendor's C
//! API, `libzkfp.dll` (`fingerprint.rs`), the same calls the owner's working
//! attendance bridge makes (`retail/attendance-terminal/zk-bridge/ZkDevice.cs`).
//! The shape is `pos-electron`'s, deliberately: status, enrol, identify.
//! Identify is the one that matters — matching happens **here**, on the till,
//! against templates the node handed down, so a counter can still open when
//! the line to head office is down. A design that sent the captured print to a
//! server to be matched would be a till that cannot sign anybody in during an
//! outage, which at a counter means a shop that cannot trade. Every scanner
//! call runs off the window's thread, waiting for a finger included.
//!
//! **RFID** has two lanes: signed network readers post sweep observations to
//! `/api/v1/rfid/observations`; the counter's Chainway R3 is a local USB reader
//! and contributes the EPCs on its pad to the unsold basket, one read at a
//! time when the cashier asks.
//!
//! **Printing does not belong here.** Receipts are ESC/POS rendered by the
//! edge, which is already the party on the printer's LAN. A desktop shell that
//! rendered its own receipt would be a second opinion about what a sale said.

use serde::Serialize;

/// What the window is told about a device it asked for.
#[derive(Serialize)]
pub struct DeviceState {
    /// Whether this shell can drive it at all yet.
    pub bound: bool,
    /// Said to the cashier, in the words they should read on screen.
    pub detail: String,
}

/// Open the Chainway R3 if it is not open yet, and say how it stands, in the
/// shape every device answers in. The window itself asks `rfid_status`.
#[tauri::command]
pub async fn rfid_state(app: tauri::AppHandle) -> DeviceState {
    let status = crate::edge::off_the_window(move || {
        Ok::<_, String>(crate::rfid::reader_status(&app, true))
    })
    .await;
    match status {
        Ok(status) => DeviceState {
            bound: !matches!(status.state, crate::rfid::ReaderState::NotConnected),
            detail: status
                .fault
                .as_ref()
                .map_or(status.detail.clone(), crate::rfid::Fault::sentence),
        },
        Err(detail) => DeviceState {
            bound: false,
            detail,
        },
    }
}

/// How the Chainway R3 stands: Ready, Busy, Needs attention or Not
/// connected, with the coded fault behind the last two. `open`: open it and
/// confirm its settings first, as a read would; otherwise say only what the
/// shell already knows, which never touches the reader and never waits for a
/// read.
#[tauri::command]
pub async fn rfid_status(app: tauri::AppHandle, open: bool) -> crate::rfid::ReaderStatus {
    let asked = crate::edge::off_the_window(move || {
        Ok::<_, String>(crate::rfid::reader_status(&app, open))
    })
    .await;
    asked.unwrap_or_else(|problem| crate::rfid::ReaderStatus {
        state: crate::rfid::ReaderState::NotConnected,
        fault: Some(crate::rfid::Fault::new(
            &crate::rfid::APP_NO_ANSWER,
            problem.clone(),
        )),
        detail: problem,
    })
}

/// Read every tag on the Chainway R3's pad, after asking its buzzer and its
/// power (everything set again if either moved). Returns each EPC once, with
/// the strongest signal it was heard at, the counter's check tag apart; the
/// window puts each one through the scan path, which decides what joins the
/// basket. A failed read answers its coded fault.
#[tauri::command]
pub async fn rfid_read_pad(
    app: tauri::AppHandle,
) -> Result<crate::rfid::PadRead, crate::rfid::Fault> {
    crate::edge::off_the_window(move || Ok(crate::rfid::read_pad(&app)))
        .await
        .unwrap_or_else(|problem| {
            Err(crate::rfid::Fault::new(
                &crate::rfid::APP_NO_ANSWER,
                problem,
            ))
        })
}

/// Till devices' Test reader: the R3 opened afresh, its settings read back,
/// and the pad read three times a second apart, with a PASS or a FAIL.
#[tauri::command]
pub async fn rfid_test_reader(app: tauri::AppHandle) -> Result<crate::rfid::ReaderTest, String> {
    crate::edge::off_the_window(move || Ok(crate::rfid::test_reader(&app))).await
}

/// Till devices' Calibrate: three reads of the test items on the pad and the
/// floor they suggest, never saved here.
#[tauri::command]
pub async fn rfid_calibrate(app: tauri::AppHandle) -> Result<crate::rfid::Calibration, String> {
    crate::edge::off_the_window(move || Ok(crate::rfid::calibrate(&app))).await
}

/// Till devices' Copy diagnostics: the reader's facts for support, as text.
#[tauri::command]
pub async fn rfid_diagnostics(app: tauri::AppHandle) -> Result<String, String> {
    crate::edge::off_the_window(move || Ok(crate::rfid::diagnostics(&app))).await
}

/// Whether the fingerprint scanner is there, opening it the first time. Off
/// the window's thread: loading the driver and opening the scanner can take a
/// moment, and a wait for a finger holds the scanner (then it is "ready,
/// waiting").
#[tauri::command]
pub async fn fingerprint_state(app: tauri::AppHandle) -> DeviceState {
    #[cfg(debug_assertions)]
    {
        if let Some(who) = pretend(&app) {
            return DeviceState {
                bound: true,
                detail: format!(
                    "SIMULASI — tidak ada pemindai yang dibaca. Terminal ini disetel \
                     berpura-pura mengenali {who}."
                ),
            };
        }
    }
    let asked = crate::edge::off_the_window(move || {
        Ok::<_, String>(crate::fingerprint::state(&app))
    })
    .await;
    match asked {
        Ok((bound, detail)) => DeviceState { bound, detail },
        Err(detail) => DeviceState {
            bound: false,
            detail,
        },
    }
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

/// Whose finger a debug build was told to pretend matched (`Setelan
/// terminal`), when it was.
#[cfg(debug_assertions)]
fn pretend(app: &tauri::AppHandle) -> Option<String> {
    use tauri::Manager;
    let node = app.state::<crate::edge::Node>();
    let who = crate::edge::lock(node.inner()).simulate_fingerprint.clone();
    who.map(|who| who.trim().to_string())
        .filter(|who| !who.is_empty())
}

/// Match the finger on the scanner against what the node has enrolled.
///
/// Takes the templates rather than fetching them: which fingers may open this
/// till is the node's decision, and a shell that fetched its own list would be
/// a second opinion about who works here. Matching happens here, on the till,
/// so a counter can still open when the line to head office is down.
///
/// Waits up to `wait_ms` (ten seconds unless told) for a finger, off the
/// window's thread. `watch` names the wait so `fingerprint_cancel` can call it
/// off: the door listens with one and stops the moment its screen changes.
/// `placed: false` is "nobody pressed", and must not be claimed at the node.
#[tauri::command]
pub async fn fingerprint_identify(
    app: tauri::AppHandle,
    enrolled: Vec<crate::fingerprint::EnrolledFinger>,
    wait_ms: Option<u64>,
    watch: Option<String>,
) -> crate::fingerprint::Identified {
    let wait = crate::fingerprint::wait_of(wait_ms);
    // A development build may be told to pretend, so that everything around
    // the sensor can be exercised on a machine that has none: the roster
    // coming down, the claim being signed, the sequence being burned, the
    // grant being spent once and expiring. The block is compiled out of a
    // release, so a till in a shop cannot be talked into simulating a
    // supervisor by editing a config file — and every simulated answer says so
    // in the words the cashier reads. A door that is only listening (`watch`)
    // is never answered by the pretence: it would sign somebody in the moment
    // the screen opened.
    #[cfg(debug_assertions)]
    {
        if let Some(who) = pretend(&app) {
            return crate::edge::off_the_window(move || {
                if watch.is_some() {
                    crate::fingerprint::idle(wait, watch.as_deref());
                    return Ok(crate::fingerprint::Identified {
                        bound: true,
                        placed: false,
                        actor_id: None,
                        score: None,
                        detail: "SIMULASI — menunggu tekanan pada sensor di layar.".into(),
                    });
                }
                let found = enrolled.iter().find(|one| {
                    one.username
                        .as_deref()
                        .unwrap_or(&one.actor_id)
                        .eq_ignore_ascii_case(&who)
                });
                Ok(match found {
                    Some(found) => crate::fingerprint::Identified {
                        bound: true,
                        placed: true,
                        actor_id: Some(found.actor_id.clone()),
                        score: Some(0),
                        detail: format!(
                            "SIMULASI — tidak ada sidik jari yang dibaca. \
                             Terminal ini disetel berpura-pura mengenali {who}."
                        ),
                    },
                    None => crate::fingerprint::Identified {
                        bound: true,
                        placed: true,
                        actor_id: None,
                        score: None,
                        detail: format!(
                            "SIMULASI — {who} tidak ada di daftar sidik jari toko ini, \
                             jadi dijawab seperti jari yang tidak dikenali."
                        ),
                    },
                })
            })
            .await
            .unwrap_or_else(|problem| crate::fingerprint::Identified {
                bound: false,
                placed: false,
                actor_id: None,
                score: None,
                detail: problem,
            });
        }
    }
    crate::edge::off_the_window(move || {
        Ok(crate::fingerprint::identify(
            &app,
            &enrolled,
            wait,
            watch.as_deref(),
        ))
    })
    .await
    .unwrap_or_else(|problem| crate::fingerprint::Identified {
        bound: false,
        placed: false,
        actor_id: None,
        score: None,
        detail: problem,
    })
}

/// One press towards enrolling a finger, returning the template to be stored
/// once three presses of the same finger have been merged.
///
/// `restart` begins a new enrolment; give it the shop's roster (`enrolled`)
/// and a finger already enrolled to anybody is refused on its first press.
/// Enrolment is the node's record, not this machine's: the window posts the
/// template to `POST /api/v1/auth/fingerprints`.
#[tauri::command]
pub async fn fingerprint_enroll(
    app: tauri::AppHandle,
    restart: Option<bool>,
    enrolled: Option<Vec<crate::fingerprint::EnrolledFinger>>,
    wait_ms: Option<u64>,
    watch: Option<String>,
) -> crate::fingerprint::Enrolled {
    let wait = crate::fingerprint::wait_of(wait_ms);
    let restart = restart.unwrap_or(false);
    let asked = crate::edge::off_the_window(move || {
        Ok::<_, String>(crate::fingerprint::enrol(
            &app,
            restart,
            enrolled.as_deref(),
            wait,
            watch.as_deref(),
        ))
    })
    .await;
    asked.unwrap_or_else(|problem| crate::fingerprint::Enrolled {
        bound: false,
        placed: false,
        presses: 0,
        needed: crate::fingerprint::ENROL_PRESSES,
        template_base64: None,
        duplicate_of: None,
        retry: false,
        reader_kind: crate::fingerprint::READER_KIND,
        detail: problem,
    })
}

/// Call off a wait for a finger by the name it was given. Synchronous and
/// instant: the wait itself notices within a tenth of a second.
#[tauri::command]
pub fn fingerprint_cancel(watch: String) {
    crate::fingerprint::cancel(&watch);
}

/// Run the scanner's driver installer that ships with the till (Windows).
#[tauri::command]
pub async fn fingerprint_install_driver(app: tauri::AppHandle) -> Result<(), String> {
    crate::edge::off_the_window(move || crate::fingerprint::install_driver(&app)).await
}
