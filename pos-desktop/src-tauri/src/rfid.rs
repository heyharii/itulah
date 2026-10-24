//! Chainway R3 and R3S USB access for the Windows till.
//!
//! # Loading
//!
//! The vendor SDK is loaded from the packaged `rfid-native` resource folder
//! once per process, and never unloaded: first the Visual C++ runtime it was
//! built against (shipped beside it, app-local), then `libusb-1.0.dll`, then
//! `UHFAPI.dll`, each by its full path so Windows cannot resolve a same-named
//! library from an unrelated search path. The SDK runs threads of its own, and
//! code unloaded under them is a crash nobody could reproduce, so a reconnect
//! is only `UsbClose` and `UsbOpen`, and the SDK is never asked to open a link
//! over one it still holds. Loading also gives the SDK the one callback it
//! keeps for every link, the reader's stop acknowledgement (`8D`), which only
//! counts (`# Reading the pad`).
//!
//! # What the SDK answers
//!
//! All of this was read in the pinned `UHFAPI.dll` (x64, SHA-256
//! `25c044a8…def8`); the addresses, the evidence and what only the bench can
//! settle are in `docs/research/2026-10-22-chainway-sdk-knobs.md`. Its UHF
//! calls answer 0 or −1 and nothing between: −1 for a refusal, an answer it
//! could not read and silence alike, the last after a fixed 1500 ms. Its
//! transceive looks only at the first frame of each chunk the reader sends,
//! so every setting is read at rest, never while an inventory runs. And
//! `UsbOpen` proves nothing: the SDK opens only VID 0x2047 / PID 0x0301, and
//! with no such device it still answers 0 and makes current a link with
//! nothing behind it. So a link is a reader only once something on it
//! answers. The SDK's disconnect callback says when it has given up on a link;
//! it keeps one per link and forgets it once it fires, so every new link is
//! given it again, and it only counts, because it can run inside the till's
//! own call.
//!
//! # Opening
//!
//! The reader is opened once and kept open. Opening first stops any inventory
//! a previous run left going: during continuous inventory the reader answers
//! nothing but stop, and `UHFStopGet` sends one only on a link where this SDK
//! started the inventory, which a new link never is, so the stop frame itself
//! goes out through `SendBytes` and its acknowledgement is waited for. An
//! acknowledged stop, or else an answer to the first question after it, is
//! what shows a reader is there; with neither, the cashier is told it is not
//! connected. The reader is known by its USB identity alone: the SDK opens
//! only VID 0x2047 / PID 0x0301, so a reader that answers on the link is an
//! R3 or an R3S, whatever its firmware text says, and nothing promises that
//! text names the model. Then opening mutes the buzzer and reads it back,
//! reads the firmware version for Test read and logs the bytes the SDK handed
//! back (a version that cannot be read is logged, never refused), selects
//! EPC-only output, sets this counter's power without saving it in the reader
//! and reads it back, clears any tag filter, and pins the radio profile.
//! Before every read the buzzer and power are checked for a reset. The radio
//! profile is also read back at rest, so a module-only reset that leaves board
//! buzzer and power unchanged cannot silently retain different inventory controls.
//! A profile that cannot be confirmed discards that connection generation and
//! refuses the read; the next request opens and configures it again.
//!
//! # The radio profile
//!
//! Nothing another app left in the reader is trusted. On the handheld's
//! module, from the same vendor, our own tags measured FastID costing 16 of
//! 58, Gen2X link modes leaving all but 11 of 31 silent, and sessions S2 and
//! S3 keeping a tag silent long after it was read; and a tag filter saved in
//! the reader hides every tag it does not match. So before any inventory the
//! filter is cleared on all three memory banks, FastID and Tag Focus are
//! switched off, and the Query asks session S0 for target A — a tag's S0 flag
//! falls back as soon as the carrier stops, so every tag on the pad answers
//! in every short read when no other reader keeps the tag energised. The fixed
//! recipe uses dynamic Q (start 6, min 0, max 15), Select target SL/action 0,
//! Query Sel 0 (ignore SL), and link 1 (Gen2, Miller 4, 250 kHz). Low-level
//! timing fields are kept from the module after choosing that link. Nothing is saved in the reader: the filters and the RF link are
//! set with save 0, and the other calls take no save flag. Every setting the
//! SDK can read is read back (a filter it cannot, so the answer to clearing
//! one is what is checked), and a reader that will not take one, or whose
//! link cannot be read, is not read at all: a pad read with a profile nobody
//! checked can leave a garment off the basket. Fast Inventory, which the
//! vendor's tools can also save in the reader, is switched off the same way,
//! not saved. So is a wait between reads: a wait time other than 0 is set to
//! 0, not saved, with the work time kept as the reader held it, and the
//! values it had are logged. Then, once everything is made, the settings this
//! till leaves alone are read: a wait that still reads back other than 0, an
//! air protocol other than Gen2 or an output other than EPC only refuses the
//! reader, because each can leave a garment off the basket. The antenna mask
//! is logged and shown, never judged: the first R3 probed read `00 0F` with
//! antenna 1 reading, which fits the high byte coming first, but one reader
//! is not proof. The work mode, dual or single target and the reader's own
//! repeat filter are not asked at all: on that R3 (firmware V2.2.9) each
//! answered only −1, after the full 1.5 s, which would add 4.5 s to every
//! open. A setting the SDK has no call for, or that the reader does not
//! answer, is logged and not held against it. The region and the channels
//! the reader hops over are read and shown by the vendor's names (an empty
//! channel list is the region's own channels), and never written:
//! which band a store may use is its owner's decision.
//!
//! # Reading the pad
//!
//! One read is a short continuous inventory: start, collect tags for this
//! counter's window, stop, collect what was already on its way. Nothing else is
//! sent to the reader while it runs. `UHFInventory` and `UHFStopGet` answer 0
//! whatever happens, so the read counts only once the reader acknowledges the
//! stop, within 600 ms. Without that the SDK goes back to polling the reader in
//! the background, so the reader is told to stop once more, straight, closed
//! if that goes unanswered too, and the read is not used. What was on its way
//! is taken until the queue has been quiet for 40 ms: the SDK answers an empty
//! queue and a record it dropped the same way, and records still arrive after
//! the acknowledgement. Every record must carry a PC word whose
//! length field matches its EPC; records are folded into one tag per EPC with
//! the strongest signal it was heard at, and a tag heard only below this
//! counter's floor is left out (Test read lists those, with their signal, so
//! the floor can be set). A read starts no sooner than a second after the
//! last one ended: back to back, the bench R3 alternated full and half reads.
//! Power/window are fixed recipe values, while floor remains site calibration
//! (README). RSSI cannot guarantee a physical pad boundary: on the bench R3
//! the power did not change the reach at all (5 against 25 dBm moved the
//! signal by 0.1 dB, and a tag a metre away read −75 to −78 dBm at every
//! power). Nothing reads on its own — a read happens when the cashier asks
//! for one.
//!
//! # Closing
//!
//! A link is reopened no sooner than 1.2 s after it was closed. Each link
//! has a USB thread of the SDK's own that waits up to 1000 ms for the reader,
//! and `UsbClose` does not wait for it: when it ends it frees its queue in
//! what may by then be the next link, reusing the same memory, which leaves
//! that link with no queue, so the SDK gives it up. The disconnect callback
//! is counted per link, by the id the SDK names it with, so a call for a link
//! this till closed never marks the one it holds now.
//!
//! # Status and errors
//!
//! The till shows the reader in one of four states — Ready, Busy, Needs
//! attention, Not connected (`ReaderStatus`) — worked out from what this
//! module last learned: whether a read holds the reader, whether the driver
//! has given up on the link, how the last open, check or read ended, and the
//! last radio check, which is a Test reader run or a read on a counter with a
//! check tag. Asking never waits for a read: a reader held by one is Busy.
//! Every way a step can fail is a `Fault` from one catalogue (`CATALOGUE`,
//! written out for support in `docs/rfid-status-and-errors.md`): a stable
//! code, one sentence for the cashier, one thing to do, and the detail for
//! support. The check tag (`r3_canary_epc`) is a tag fixed at the pad: it is
//! never among a read's tags, and a read that does not hear it, or hears it
//! within 2 dB of the floor, needs attention. The last SDK calls with their
//! answers, the last reads and the last faults are kept for the diagnostics
//! bundle; the stop and disconnect callbacks still only count.

// The record parsing is built and tested on every platform; only the Windows
// build reads a reader with it.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::atomic::{AtomicI32, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::AppHandle;

/// How this counter reads its pad: the `r3_*` fields of `Peripherals` in
/// `peripherals.rs`, which also says what each one is for.
#[derive(Clone, Debug, PartialEq)]
pub struct PadSettings {
    pub power_dbm: u8,
    pub window_ms: u32,
    pub min_rssi_dbm: i16,
    /// This counter's check tag, upper-case hex: never among a read's tags.
    /// `None`: the counter has none.
    pub canary_epc: Option<String>,
}

impl PadSettings {
    /// This till's settings. Refused rather than stretched when they are out of
    /// range: a power quietly clamped to the top would read nothing (30 dBm
    /// did, on the bench R3), and a floor clamped would let in the racks.
    fn of(app: &AppHandle) -> Result<Self, Fault> {
        let peripherals = saved_peripherals(app);
        let invalid = |problem: String| Fault::new(&SETTINGS_INVALID, problem);
        crate::peripherals::check_desk_reader(&peripherals).map_err(invalid)?;
        let canary_epc = crate::peripherals::canary_epc(&peripherals).map_err(invalid)?;
        Ok(Self {
            power_dbm: peripherals.r3_power_dbm,
            window_ms: peripherals.r3_read_ms,
            min_rssi_dbm: peripherals.r3_min_rssi_dbm,
            canary_epc,
        })
    }
}

/// This till's peripherals as saved, with the reader recipe applied.
fn saved_peripherals(app: &AppHandle) -> crate::peripherals::Peripherals {
    use tauri::Manager;
    let mut peripherals = match app.try_state::<crate::edge::Node>() {
        Some(node) => crate::edge::lock(node.inner()).peripherals.clone(),
        None => crate::peripherals::Peripherals::default(),
    };
    crate::peripherals::apply_reader_recipe(&mut peripherals);
    peripherals
}

/// How the reader stands, as the till shows it: Ready, Busy, Needs attention
/// or Not connected.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReaderState {
    /// Open, its settings confirmed, and nothing since has gone wrong.
    Ready,
    /// Opening, reading, testing or calibrating. Ask again once it is done.
    Busy,
    /// Opened, but a check failed: a setting it would not take or keep, a
    /// read it could not finish cleanly, its check tag missing or faint, or
    /// a Test reader run that failed.
    Attention,
    /// No reader answers, or it went away.
    NotConnected,
}

/// One entry of the catalogue. `docs/rfid-status-and-errors.md` has each
/// code with what support checks and where in this file it comes from.
#[derive(Debug, PartialEq, Eq)]
pub struct Entry {
    pub code: &'static str,
    /// What the till shows while this is the last thing it learned. `None`
    /// for a note about one read or one calibration that says nothing about
    /// the reader itself: the state is left as it was.
    pub state: Option<ReaderState>,
    /// What happened, in one sentence for the cashier.
    pub says: &'static str,
    /// The one thing the cashier can do about it.
    pub action: &'static str,
}

const fn entry(
    code: &'static str,
    state: Option<ReaderState>,
    says: &'static str,
    action: &'static str,
) -> Entry {
    Entry {
        code,
        state,
        says,
        action,
    }
}

const GONE: Option<ReaderState> = Some(ReaderState::NotConnected);
const LOOK: Option<ReaderState> = Some(ReaderState::Attention);
const NOTE: Option<ReaderState> = None;

const CHECK_CABLE: &str = "Check its USB cable, then read again.";
const REPLUG: &str = "Unplug the R3, plug it back in, then read again.";
const READ_AGAIN: &str = "Read the pad again.";
const CALL_SUPPORT: &str = "Call support.";

// Not connected: the app, the driver and the cable. R3-01 and R3-08 are also
// raised by the window itself (`ui/src/edge.ts`), when there is no shell to
// ask or the shell did not answer, and R3-23 and R3-24 only there: listed here
// so the catalogue is whole.
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub const NOT_THIS_APP: Entry = entry(
    "R3-01",
    GONE,
    "This till app cannot use the R3.",
    "Use the Windows till app.",
);
pub const DRIVER_MISSING: Entry = entry(
    "R3-02",
    GONE,
    "The R3 driver is missing from this till app.",
    CALL_SUPPORT,
);
pub const DRIVER_NOT_LOADED: Entry = entry(
    "R3-03",
    GONE,
    "The R3 driver could not be loaded.",
    CALL_SUPPORT,
);
pub const DRIVER_UNKNOWN: Entry = entry(
    "R3-04",
    GONE,
    "This R3 driver is a version the till does not know.",
    CALL_SUPPORT,
);
pub const NOT_CONNECTED: Entry = entry("R3-05", GONE, "The R3 is not connected.", CHECK_CABLE);
pub const DISCONNECTED_MID_READ: Entry = entry(
    "R3-06",
    GONE,
    "The R3 was disconnected during the read, so it was not used.",
    CHECK_CABLE,
);
pub const DISCONNECTED: Entry = entry("R3-07", GONE, "The R3 was disconnected.", CHECK_CABLE);
pub const APP_NO_ANSWER: Entry = entry(
    "R3-08",
    GONE,
    "The till app could not ask the R3.",
    "Restart the till app.",
);
// Needs attention: what this till sets in the reader.
pub const SETTINGS_INVALID: Entry = entry(
    "R3-10",
    LOOK,
    "This till's R3 settings are not valid.",
    CALL_SUPPORT,
);
pub const BUZZER_NOT_OFF: Entry = entry(
    "R3-11",
    LOOK,
    "The R3 did not take this till's settings.",
    REPLUG,
);
pub const EPC_ONLY_NOT_SET: Entry = entry(
    "R3-12",
    LOOK,
    "The R3 did not take this till's settings.",
    REPLUG,
);
pub const POWER_NOT_SET: Entry = entry(
    "R3-13",
    LOOK,
    "The R3 did not take this till's settings.",
    REPLUG,
);
pub const FILTER_NOT_CLEARED: Entry = entry(
    "R3-14",
    LOOK,
    "The R3 did not take this till's settings.",
    REPLUG,
);
pub const PROFILE_NOT_HELD: Entry = entry(
    "R3-15",
    LOOK,
    "The R3 did not take this till's settings.",
    REPLUG,
);
pub const HOLDS_RISKY_SETTINGS: Entry = entry(
    "R3-16",
    LOOK,
    "The R3 holds settings that can miss tags.",
    REPLUG,
);
pub const CHANGED_SINCE_OPEN: Entry = entry(
    "R3-17",
    LOOK,
    "The R3's settings changed since it was set up, so it was not read.",
    READ_AGAIN,
);
// Reads.
pub const STOP_NOT_CONFIRMED: Entry = entry(
    "R3-21",
    LOOK,
    "The R3 did not confirm the read ended, so it was not used.",
    READ_AGAIN,
);
pub const WENT_BACK: Entry = entry(
    "R3-22",
    LOOK,
    "The R3 went back to its own settings, so the read was not used.",
    READ_AGAIN,
);
pub const NOTHING_HEARD: Entry = entry(
    "R3-23",
    NOTE,
    "No tag was heard on the pad.",
    "Put the items on the pad, then read again.",
);
#[allow(dead_code)]
pub const NOT_ON_THAT_LINE: Entry = entry(
    "R3-24",
    NOTE,
    "None of the tags on the pad is on that line.",
    "Put only the item to take off on the pad, then read again.",
);
// Checks: the check tag, Test reader and Calibrate.
pub const CHECK_TAG_MISSING: Entry = entry(
    "R3-31",
    LOOK,
    "The R3 did not hear its check tag, so an item may be missing.",
    READ_AGAIN,
);
pub const CHECK_TAG_FAINT: Entry = entry(
    "R3-32",
    LOOK,
    "The R3 heard its check tag only faintly, so an item may be missing.",
    READ_AGAIN,
);
pub const READS_DIFFER: Entry = entry(
    "R3-33",
    LOOK,
    "The tags heard changed from one read to the next.",
    "Keep the items still on the pad, then test again in Till devices.",
);
pub const MARGIN_THIN: Entry = entry(
    "R3-34",
    LOOK,
    "The weakest item reads too close to the floor.",
    "Calibrate and test the reader in Till devices.",
);
pub const NO_SUGGESTION: Entry = entry(
    "R3-35",
    NOTE,
    "No floor could be suggested.",
    "Put the test items on the pad, then calibrate again.",
);
pub const OFF_PAD_NEAR_FLOOR: Entry = entry(
    "R3-36",
    NOTE,
    "A tag off the pad reads close to the suggested floor.",
    "Move tagged goods away from the counter, then calibrate again.",
);

/// Every code, in order: what the doc lists, no more and no less.
#[allow(dead_code)]
pub const CATALOGUE: [&Entry; 26] = [
    &NOT_THIS_APP,
    &DRIVER_MISSING,
    &DRIVER_NOT_LOADED,
    &DRIVER_UNKNOWN,
    &NOT_CONNECTED,
    &DISCONNECTED_MID_READ,
    &DISCONNECTED,
    &APP_NO_ANSWER,
    &SETTINGS_INVALID,
    &BUZZER_NOT_OFF,
    &EPC_ONLY_NOT_SET,
    &POWER_NOT_SET,
    &FILTER_NOT_CLEARED,
    &PROFILE_NOT_HELD,
    &HOLDS_RISKY_SETTINGS,
    &CHANGED_SINCE_OPEN,
    &STOP_NOT_CONFIRMED,
    &WENT_BACK,
    &NOTHING_HEARD,
    &NOT_ON_THAT_LINE,
    &CHECK_TAG_MISSING,
    &CHECK_TAG_FAINT,
    &READS_DIFFER,
    &MARGIN_THIN,
    &NO_SUGGESTION,
    &OFF_PAD_NEAR_FLOOR,
];

/// One step that failed, by its catalogue code, with what happened in the
/// cashier's words and in support's.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Fault {
    pub code: &'static str,
    pub state: Option<ReaderState>,
    pub says: &'static str,
    pub action: &'static str,
    /// For whoever supports the till: the step that failed, in the words the
    /// log uses, with what the SDK answered.
    pub detail: String,
}

impl Fault {
    pub fn new(entry: &'static Entry, detail: impl Into<String>) -> Self {
        Self {
            code: entry.code,
            state: entry.state,
            says: entry.says,
            action: entry.action,
            detail: detail.into(),
        }
    }

    /// What the cashier reads: what happened, what to do, and the code.
    pub fn sentence(&self) -> String {
        format!("{} {} ({})", self.says, self.action, self.code)
    }
}

impl std::fmt::Display for Fault {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(out, "{} {} {}", self.code, self.says, self.detail)
    }
}

/// How the reader stands, for the chip beside the read button and on Till
/// devices.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReaderStatus {
    pub state: ReaderState,
    /// What made it Needs attention or Not connected. `None` while it is
    /// Ready or Busy.
    pub fault: Option<Fault>,
    /// For support: the reader as last confirmed, the fault's detail, or what
    /// it is busy with.
    pub detail: String,
}

impl ReaderStatus {
    fn of(fault: Fault) -> Self {
        Self {
            state: fault.state.unwrap_or(ReaderState::Attention),
            detail: fault.detail.clone(),
            fault: Some(fault),
        }
    }

    fn busy() -> Self {
        Self {
            state: ReaderState::Busy,
            fault: None,
            detail: "The R3 is opening, reading or being tested.".into(),
        }
    }
}

/// The status from what the till holds. `link`: the link it holds, `true`
/// once the driver has given up on it; `None`: none is open. `fault`: how the
/// last open, check or read ended, when it did not end well. `health`: the
/// last radio check, when it did not pass. `reader`: what to say about a
/// reader that is open and fine.
fn status_from(
    link: Option<bool>,
    fault: Option<&Fault>,
    health: Option<&Fault>,
    reader: &str,
) -> ReaderStatus {
    if link == Some(true) {
        return ReaderStatus::of(Fault::new(
            &DISCONNECTED,
            "The driver gave up on the link while the till was not reading.",
        ));
    }
    if let Some(fault) = [fault, health]
        .into_iter()
        .flatten()
        .find(|fault| fault.state.is_some())
    {
        return ReaderStatus::of(fault.clone());
    }
    match link {
        Some(_) => ReaderStatus {
            state: ReaderState::Ready,
            fault: None,
            detail: reader.to_string(),
        },
        None => ReaderStatus::of(Fault::new(
            &NOT_CONNECTED,
            "The till has not opened the R3 yet.",
        )),
    }
}

/// How far above the floor the check tag, and the Test reader's weakest tag,
/// must be heard, in tenths of a dB: any closer and a garment a little weaker
/// than them falls under it.
const THIN_MARGIN_TENTHS: i32 = 20;
/// How far under the weakest tag on the pad Calibrate puts the floor, in
/// tenths of a dB: the 3 to 5 dB the bench R3 left between the pad and a tag
/// a metre away.
const CALIBRATION_MARGIN_TENTHS: i32 = 30;
/// How close a tag off the pad may come to a suggested floor before
/// Calibrate warns, in tenths of a dB.
const OFF_PAD_GAP_TENTHS: i32 = 60;
/// How many reads the Test reader and Calibrate make, the usual gap apart.
const CHECK_READS: usize = 3;

/// One tag the pad heard.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PadTag {
    /// Upper-case hex, without the PC word.
    pub epc: String,
    /// The strongest it was heard at, in dBm.
    pub rssi_dbm: f64,
    /// How many times it was heard during the read.
    pub reads: u32,
}

/// One tag heard only below this counter's floor, and so left out of the
/// basket. Listed on Test read so the floor can be set between the pad's
/// garments and the rest.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WeakTag {
    /// Upper-case hex, without the PC word.
    pub epc: String,
    /// The strongest it was heard at, in dBm. `None`: its records carried no
    /// signal strength, so it cannot be shown to be on the pad.
    pub rssi_dbm: Option<f64>,
    /// How many times it was heard during the read.
    pub reads: u32,
}

/// One read of the pad.
#[derive(Debug, Serialize)]
pub struct PadRead {
    /// Every tag at or above the floor, strongest first.
    pub tags: Vec<PadTag>,
    /// Tags heard only below the floor, and so left out.
    pub too_weak: u32,
    /// Those tags, strongest first, the ones with no signal strength last.
    pub left_out: Vec<WeakTag>,
    /// Records that could not be read as a PC word and its EPC, and so were
    /// left out.
    pub unreadable: u32,
    /// Every record the read took, readable or not. The bench R3 stopped
    /// sending after about 35 records in one inventory, however long the
    /// window, so a basket of 30 to 40 garments may not be read whole.
    pub records: u32,
    /// What the reader was set to for this read.
    pub power_dbm: u8,
    pub window_ms: u32,
    pub min_rssi_dbm: i16,
    /// The reader's firmware version, as it reported it.
    pub firmware: String,
    pub profile: RadioProfile,
    /// The counter's check tag, as this read heard it: never in `tags` or
    /// `left_out`. `None`: the counter has none.
    pub canary: Option<CanaryRead>,
    /// What this read leaves needing attention: its check tag not heard, or
    /// heard too close to the floor. `None`: nothing.
    pub attention: Option<Fault>,
    /// From the request to the last record, without the wait for the gap
    /// after the last read.
    pub took_ms: u64,
    /// The wait for that gap.
    pub waited_ms: u64,
}

/// The counter's check tag in one read.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CanaryRead {
    pub epc: String,
    pub heard: bool,
    /// The strongest it was heard at, in dBm. `None`: not heard, or heard
    /// with no signal strength.
    pub rssi_dbm: Option<f64>,
    pub reads: u32,
    /// How far above the floor it was heard, in dB; below it, negative.
    pub margin_db: Option<f64>,
}

/// The radio profile a read ran with, as the reader read it back when it was
/// last set up: on opening, or after a reset (`# The radio profile` above).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RadioProfile {
    pub fast_id: bool,
    pub tag_focus: bool,
    /// The session the Query asks, `S0` to `S3`.
    pub session: String,
    /// The flag the Query asks for, `A` or `B`.
    pub target: String,
    /// The RF link mode, as the vendor's API document names it.
    pub rf_link: String,
    /// The Gen2X mode the reader was on before this till moved it to
    /// `rf_link`. Not saved in the reader, so it is back on that mode once it
    /// is switched off, and moved again when it is next opened.
    pub rf_link_moved_from: Option<String>,
    /// The region the reader is set to, by the name the vendor's settings
    /// tool gives it, with its code. Read only: the band is the owner's
    /// decision. `None`: it could not be read.
    pub region: Option<String>,
    /// The channels the reader hops over: "the region's own channels" when
    /// the reader answers with an empty list, as the first R3 probed did.
    /// `None`: they could not be read.
    pub channels: Option<String>,
    /// The antenna mask `UHFGetANT` answered, its two bytes in hex as they
    /// came. One bit per antenna; the first R3 probed read `00 0F` with
    /// antenna 1 reading, which fits the high byte coming first, but it is
    /// still shown and never judged. `None`: it could not be read.
    pub antennas: Option<String>,
    /// How long the reader reads and then waits, as the read ran with it:
    /// a wait other than 0 is set to 0 by this till, not saved in the reader,
    /// and the wait it had is named. `None`: it could not be read.
    pub work_wait: Option<String>,
}

/// What a Test reader run found: a fresh open with every setting read back,
/// then `CHECK_READS` reads the usual gap apart.
#[derive(Debug, Serialize)]
pub struct ReaderTest {
    pub passed: bool,
    /// The first check that failed, or what passed, in one sentence.
    pub reason: String,
    /// The check that failed, by its code.
    pub fault: Option<Fault>,
    /// How long the open took, its settings read back included. `None`: the
    /// run did not get that far.
    pub open_ms: Option<u64>,
    pub firmware: Option<String>,
    pub profile: Option<RadioProfile>,
    /// Each read, in order; a read that fails ends the run.
    pub reads: Vec<ReadSummary>,
    /// Every read kept the same tags.
    pub stable: bool,
    /// The weakest tag any read kept, and how far above the floor it was.
    pub weakest: Option<PadTag>,
    pub margin_db: Option<f64>,
    /// The recipe the reader was set to (`R3_PROFILE_ID`).
    pub profile_id: &'static str,
    pub power_dbm: u8,
    pub window_ms: u32,
    pub gap_ms: u32,
    pub floor_dbm: i16,
    /// The last read in full, for its lists of tags.
    pub last: Option<PadRead>,
}

/// One read of a Test reader run or of Calibrate.
#[derive(Debug, Serialize)]
pub struct ReadSummary {
    pub took_ms: u64,
    pub waited_ms: u64,
    pub tags: u32,
    pub left_out: u32,
    pub unreadable: u32,
    /// Every record the read took, readable or not (`PadRead::records`).
    pub records: u32,
    /// The EPCs it heard, each once: kept, left out and the check tag.
    pub epcs: u32,
    pub canary: Option<CanaryRead>,
    /// Why it failed.
    pub fault: Option<Fault>,
}

/// What Calibrate suggests from `CHECK_READS` reads of the test items on the
/// pad. Nothing is saved here: the installer confirms it on Till devices.
#[derive(Debug, Serialize)]
pub struct Calibration {
    /// The weakest tag on the pad less 3 dB, rounded down to a whole dBm.
    /// `None`: none could be suggested, and `warnings` says why.
    pub suggested_dbm: Option<i16>,
    /// The floor in force now.
    pub floor_dbm: i16,
    /// The weakest any read heard a tag on the pad at: a tag one of the reads
    /// kept, or the check tag.
    pub weakest: Option<SeenTag>,
    /// The strongest any read heard a tag that none of them kept.
    pub strongest_off: Option<SeenTag>,
    /// Tags on the pad, the check tag among them.
    pub on_pad: u32,
    /// Tags on the pad that a read missed.
    pub unsteady: u32,
    pub warnings: Vec<Fault>,
    pub reads: Vec<ReadSummary>,
}

/// One tag as Calibrate weighs it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SeenTag {
    pub epc: String,
    pub rssi_dbm: f64,
    pub check_tag: bool,
}

/// Said by a build that cannot drive the R3.
#[cfg(not(target_os = "windows"))]
const NOT_HERE: &str = "This build does not drive the R3: only the Windows till app does.";

/// How the reader stands. `open`: open it if it is not open yet and confirm
/// its settings, as a read would; otherwise say only what the till already
/// knows, which never touches the reader. Never waits for a read: a reader a
/// read holds is Busy.
pub fn reader_status(app: &AppHandle, open: bool) -> ReaderStatus {
    #[cfg(target_os = "windows")]
    {
        let settings = open.then(|| PadSettings::of(app));
        return windows::status(app, settings);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, open);
        ReaderStatus::of(Fault::new(&NOT_THIS_APP, NOT_HERE))
    }
}

/// Read every tag on the pad.
pub fn read_pad(app: &AppHandle) -> Result<PadRead, Fault> {
    #[cfg(target_os = "windows")]
    {
        return windows::read_pad(app, PadSettings::of(app));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err(Fault::new(&NOT_THIS_APP, NOT_HERE))
    }
}

/// Open the reader afresh, read its settings back, and read the pad
/// `CHECK_READS` times the usual gap apart (`ReaderTest`).
pub fn test_reader(app: &AppHandle) -> ReaderTest {
    #[cfg(target_os = "windows")]
    {
        return windows::test(app, PadSettings::of(app));
    }

    #[cfg(not(target_os = "windows"))]
    {
        reader_test(
            &PadSettings::as_saved(app),
            Err(Fault::new(&NOT_THIS_APP, NOT_HERE)),
            None,
            Vec::new(),
        )
    }
}

/// Read the test items on the pad `CHECK_READS` times and suggest a floor
/// (`Calibration`).
pub fn calibrate(app: &AppHandle) -> Calibration {
    #[cfg(target_os = "windows")]
    {
        return windows::calibrate(app, PadSettings::of(app));
    }

    #[cfg(not(target_os = "windows"))]
    {
        calibration(
            &PadSettings::as_saved(app),
            vec![Err(Fault::new(&NOT_THIS_APP, NOT_HERE))],
        )
    }
}

/// Everything support needs to see how this till's reader stands, as text
/// for the clipboard: the app, the settings, the driver, the reader as it
/// last read back, and the last reads, faults and SDK calls.
pub fn diagnostics(app: &AppHandle) -> String {
    use tauri::Manager;
    let info = app.package_info();
    let mut sections: Vec<(&'static str, Vec<String>)> = vec![
        (
            "App",
            vec![
                format!("{} {}", info.name, info.version),
                format!("Reader profile {}", crate::peripherals::R3_PROFILE_ID),
            ],
        ),
        ("Settings", settings_lines(&saved_peripherals(app))),
    ];
    #[cfg(target_os = "windows")]
    sections.extend(windows::diagnostics());
    #[cfg(not(target_os = "windows"))]
    sections.push(("Reader", vec![NOT_HERE.to_string()]));
    bundle(now_ms(), sections, &journal())
}

impl PadSettings {
    /// The settings as saved, valid or not, for a report that has to say
    /// what they are.
    fn as_saved(app: &AppHandle) -> Self {
        let peripherals = saved_peripherals(app);
        Self {
            power_dbm: peripherals.r3_power_dbm,
            window_ms: peripherals.r3_read_ms,
            min_rssi_dbm: peripherals.r3_min_rssi_dbm,
            canary_epc: crate::peripherals::canary_epc(&peripherals).ok().flatten(),
        }
    }
}

/// The saved settings, in the bundle's lines.
fn settings_lines(peripherals: &crate::peripherals::Peripherals) -> Vec<String> {
    vec![
        format!(
            "Desk reader {}",
            peripherals.desk_reader.as_deref().unwrap_or("none")
        ),
        format!(
            "Power {} dBm, read {} ms, floor {} dBm, gap {} ms",
            peripherals.r3_power_dbm,
            peripherals.r3_read_ms,
            peripherals.r3_min_rssi_dbm,
            crate::peripherals::R3_READ_GAP_MS
        ),
        format!(
            "Check tag {}",
            match crate::peripherals::canary_epc(peripherals) {
                Ok(Some(epc)) => epc,
                Ok(None) => "none".into(),
                Err(problem) => format!("not valid: {problem}"),
            }
        ),
        match crate::peripherals::check_desk_reader(peripherals) {
            Ok(()) => "Settings in range".into(),
            Err(problem) => format!("Settings refused: {problem}"),
        },
        format!(
            "Margins: check tag and weakest tag {} dB, calibration {} dB, off the pad {} dB",
            dbm(THIN_MARGIN_TENTHS),
            dbm(CALIBRATION_MARGIN_TENTHS),
            dbm(OFF_PAD_GAP_TENTHS)
        ),
    ]
}

/// Tenths of a dBm, or of a dB, as a number of them.
fn dbm(tenths: i32) -> f64 {
    f64::from(tenths) / 10.0
}

/// Back to tenths: every signal here started as tenths, so this is exact.
fn tenths_of(value: f64) -> i32 {
    (value * 10.0).round() as i32
}

/// The end of an EPC, as the till names a tag: `…A1B2C3D4`.
fn tail(epc: &str) -> &str {
    epc.get(epc.len().saturating_sub(8)..).unwrap_or(epc)
}

fn count(items: usize) -> u32 {
    u32::try_from(items).unwrap_or(u32::MAX)
}

/// What a read's check tag leaves needing attention: not heard, or heard
/// closer to the floor than `THIN_MARGIN_TENTHS`.
fn check_tag_health(canary: Option<&CanaryRead>) -> Option<Fault> {
    let canary = canary?;
    if !canary.heard {
        return Some(Fault::new(
            &CHECK_TAG_MISSING,
            format!("The check tag {} was not heard in this read.", canary.epc),
        ));
    }
    match (canary.rssi_dbm, canary.margin_db) {
        (_, Some(margin)) if tenths_of(margin) >= THIN_MARGIN_TENTHS => None,
        (Some(rssi), Some(margin)) => Some(Fault::new(
            &CHECK_TAG_FAINT,
            format!(
                "The check tag {} was heard at {rssi:.1} dBm, {margin:.1} dB from the floor.",
                canary.epc
            ),
        )),
        _ => Some(Fault::new(
            &CHECK_TAG_FAINT,
            format!("The check tag {} came with no signal strength.", canary.epc),
        )),
    }
}

fn summary(read: &Result<PadRead, Fault>) -> ReadSummary {
    match read {
        Ok(read) => ReadSummary {
            took_ms: read.took_ms,
            waited_ms: read.waited_ms,
            tags: count(read.tags.len()),
            left_out: count(read.left_out.len()),
            unreadable: read.unreadable,
            records: read.records,
            epcs: count(
                read.tags.len()
                    + read.left_out.len()
                    + usize::from(read.canary.as_ref().is_some_and(|canary| canary.heard)),
            ),
            canary: read.canary.clone(),
            fault: None,
        },
        Err(fault) => ReadSummary {
            took_ms: 0,
            waited_ms: 0,
            tags: 0,
            left_out: 0,
            unreadable: 0,
            records: 0,
            epcs: 0,
            canary: None,
            fault: Some(fault.clone()),
        },
    }
}

/// The weakest tag any of these reads kept.
fn weakest_kept(reads: &[&PadRead]) -> Option<PadTag> {
    reads
        .iter()
        .flat_map(|read| read.tags.iter())
        .min_by(|one, other| {
            one.rssi_dbm
                .total_cmp(&other.rssi_dbm)
                .then_with(|| one.epc.cmp(&other.epc))
        })
        .cloned()
}

/// What a Test reader run comes to: why it passed, or the first check that
/// failed, in a sentence, with its fault.
fn judge(
    opened: &Result<(String, RadioProfile), Fault>,
    reads: &[Result<PadRead, Fault>],
    floor_dbm: i16,
) -> Result<String, (String, Fault)> {
    if let Err(fault) = opened {
        return Err((
            format!("The reader did not open. {}", fault.says),
            fault.clone(),
        ));
    }
    let mut heard = Vec::new();
    for (at, read) in reads.iter().enumerate() {
        match read {
            Ok(read) => heard.push(read),
            Err(fault) => {
                return Err((
                    format!("Read {} failed. {}", at + 1, fault.says),
                    fault.clone(),
                ))
            }
        }
    }
    if heard.iter().all(|read| read.tags.is_empty()) {
        return Err((
            "No read heard a tag above the floor.".into(),
            Fault::new(
                &NOTHING_HEARD,
                "Every read of the test came back with no tag above the floor.",
            ),
        ));
    }
    for (at, read) in heard.iter().enumerate() {
        if let Some(canary) = read.canary.as_ref().filter(|canary| !canary.heard) {
            return Err((
                format!(
                    "Read {} did not hear the check tag …{}.",
                    at + 1,
                    tail(&canary.epc)
                ),
                Fault::new(
                    &CHECK_TAG_MISSING,
                    format!(
                        "The check tag {} was not heard in read {}.",
                        canary.epc,
                        at + 1
                    ),
                ),
            ));
        }
    }
    let counts: Vec<usize> = heard.iter().map(|read| read.tags.len()).collect();
    let listed = counts
        .iter()
        .map(usize::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    let kept: Vec<BTreeSet<&str>> = heard
        .iter()
        .map(|read| read.tags.iter().map(|tag| tag.epc.as_str()).collect())
        .collect();
    if kept.windows(2).any(|pair| pair[0] != pair[1]) {
        let reason = if counts.windows(2).all(|pair| pair[0] == pair[1]) {
            format!("The reads kept {listed} tags, but not the same ones.")
        } else {
            format!("The reads kept {listed} tags.")
        };
        let detail = format!("Tags kept per read: {listed}, not one set each time.");
        return Err((reason, Fault::new(&READS_DIFFER, detail)));
    }
    let floor = i32::from(floor_dbm) * 10;
    let weakest = weakest_kept(&heard);
    if let Some(weakest) = &weakest {
        let margin = tenths_of(weakest.rssi_dbm) - floor;
        if margin < THIN_MARGIN_TENTHS {
            let said = format!(
                "The weakest tag, …{} at {:.1} dBm, is {:.1} dB above the floor of {floor_dbm} dBm.",
                tail(&weakest.epc),
                weakest.rssi_dbm,
                dbm(margin)
            );
            let detail = format!(
                "{} read at {:.1} dBm, {:.1} dB above the {floor_dbm} dBm floor: under {} dB.",
                weakest.epc,
                weakest.rssi_dbm,
                dbm(margin),
                dbm(THIN_MARGIN_TENTHS)
            );
            return Err((said, Fault::new(&MARGIN_THIN, detail)));
        }
    }
    for (at, read) in heard.iter().enumerate() {
        if let Some(fault) = check_tag_health(read.canary.as_ref()) {
            return Err((format!("Read {}: {}", at + 1, fault.detail), fault));
        }
    }
    Ok(match &weakest {
        Some(weakest) => format!(
            "{} reads kept the same {} tags; the weakest, …{} at {:.1} dBm, is {:.1} dB above the floor.",
            heard.len(),
            kept[0].len(),
            tail(&weakest.epc),
            weakest.rssi_dbm,
            dbm(tenths_of(weakest.rssi_dbm) - floor)
        ),
        None => format!("{} reads kept the same tags.", heard.len()),
    })
}

/// A Test reader run, from what it saw (`judge`).
fn reader_test(
    settings: &PadSettings,
    opened: Result<(String, RadioProfile), Fault>,
    open_ms: Option<u64>,
    mut reads: Vec<Result<PadRead, Fault>>,
) -> ReaderTest {
    let judged = judge(&opened, &reads, settings.min_rssi_dbm);
    let heard: Vec<&PadRead> = reads.iter().filter_map(|read| read.as_ref().ok()).collect();
    let stable = !heard.is_empty()
        && heard.windows(2).all(|pair| {
            let epcs = |read: &PadRead| -> BTreeSet<String> {
                read.tags.iter().map(|tag| tag.epc.clone()).collect()
            };
            epcs(pair[0]) == epcs(pair[1])
        });
    let weakest = weakest_kept(&heard);
    let floor = i32::from(settings.min_rssi_dbm) * 10;
    let margin_db = weakest
        .as_ref()
        .map(|tag| dbm(tenths_of(tag.rssi_dbm) - floor));
    let summaries = reads.iter().map(summary).collect();
    let (firmware, profile) = match opened {
        Ok((firmware, profile)) => (Some(firmware), Some(profile)),
        Err(_) => (None, None),
    };
    let (passed, reason, fault) = match judged {
        Ok(reason) => (true, reason, None),
        Err((reason, fault)) => (false, reason, Some(fault)),
    };
    ReaderTest {
        passed,
        reason,
        fault,
        open_ms,
        firmware,
        profile,
        reads: summaries,
        stable,
        weakest,
        margin_db,
        profile_id: crate::peripherals::R3_PROFILE_ID,
        power_dbm: settings.power_dbm,
        window_ms: settings.window_ms,
        gap_ms: crate::peripherals::R3_READ_GAP_MS,
        floor_dbm: settings.min_rssi_dbm,
        last: reads.pop().and_then(Result::ok),
    }
}

/// A Test reader run as a radio check, for the status: `None` when it says
/// nothing about the radio — a step broke first (`broke`), or nothing was on
/// the pad — and otherwise whether it passed.
fn check_from(test: &ReaderTest, broke: bool) -> Option<Option<Fault>> {
    if broke {
        return None;
    }
    if test.passed {
        return Some(None);
    }
    test.fault
        .clone()
        .filter(|fault| fault.state.is_some())
        .map(Some)
}

/// One tag across the reads of a calibration.
#[derive(Default)]
struct Sighting {
    /// The weakest and the strongest it was heard at, in tenths of a dBm.
    weakest: Option<i32>,
    strongest: Option<i32>,
    /// Reads that kept it, and reads that heard it at all.
    kept: u32,
    heard: u32,
    check_tag: bool,
}

fn sighted<'a>(
    seen: &mut BTreeMap<&'a str, Sighting>,
    epc: &'a str,
    rssi_dbm: Option<f64>,
    kept: bool,
    check_tag: bool,
) {
    let sighting = seen.entry(epc).or_default();
    if let Some(tenths) = rssi_dbm.map(tenths_of) {
        sighting.weakest = Some(sighting.weakest.map_or(tenths, |was| was.min(tenths)));
        sighting.strongest = Some(sighting.strongest.map_or(tenths, |was| was.max(tenths)));
    }
    sighting.kept += u32::from(kept);
    sighting.heard += 1;
    sighting.check_tag |= check_tag;
}

/// What these reads of the test items suggest for the floor. A tag is on the
/// pad when a read kept it, at the floor in force, and so is the check tag
/// whatever it read at; a tag no read kept is off it. The floor suggested is
/// the weakest any read heard a tag on the pad, less 3 dB, rounded down, and
/// a tag off the pad within 6 dB of it is a warning.
fn calibration(settings: &PadSettings, reads: Vec<Result<PadRead, Fault>>) -> Calibration {
    let heard: Vec<&PadRead> = reads.iter().filter_map(|read| read.as_ref().ok()).collect();
    let mut seen: BTreeMap<&str, Sighting> = BTreeMap::new();
    for read in &heard {
        for tag in &read.tags {
            sighted(&mut seen, &tag.epc, Some(tag.rssi_dbm), true, false);
        }
        for tag in &read.left_out {
            sighted(&mut seen, &tag.epc, tag.rssi_dbm, false, false);
        }
        if let Some(canary) = read.canary.as_ref().filter(|canary| canary.heard) {
            sighted(&mut seen, &canary.epc, canary.rssi_dbm, true, true);
        }
    }
    let on_pad = seen.values().filter(|tag| tag.kept > 0).count();
    let unsteady = seen
        .values()
        .filter(|tag| tag.kept > 0 && (tag.heard as usize) < heard.len())
        .count();
    let weakest = seen
        .iter()
        .filter(|(_, tag)| tag.kept > 0)
        .filter_map(|(epc, tag)| tag.weakest.map(|tenths| (tenths, *epc, tag.check_tag)))
        .min_by(|one, other| one.0.cmp(&other.0).then_with(|| one.1.cmp(other.1)));
    let strongest_off = seen
        .iter()
        .filter(|(_, tag)| tag.kept == 0)
        .filter_map(|(epc, tag)| tag.strongest.map(|tenths| (tenths, *epc, tag.check_tag)))
        .max_by(|one, other| one.0.cmp(&other.0).then_with(|| other.1.cmp(one.1)));

    let mut warnings: Vec<Fault> = reads
        .iter()
        .filter_map(|read| read.as_ref().err().cloned())
        .collect();
    let suggested_dbm = match weakest {
        None => {
            warnings.push(Fault::new(
                &NO_SUGGESTION,
                if heard.is_empty() {
                    "No read of the calibration finished."
                } else {
                    "No read kept a tag above the floor in force, so nothing on the pad could be told from the rest."
                },
            ));
            None
        }
        Some((tenths, _, _)) => {
            let floor = (tenths - CALIBRATION_MARGIN_TENTHS).div_euclid(10);
            let range = crate::peripherals::R3_MIN_RSSI_RANGE;
            match i16::try_from(floor)
                .ok()
                .filter(|floor| range.contains(floor))
            {
                Some(floor) => Some(floor),
                None => {
                    warnings.push(Fault::new(
                        &NO_SUGGESTION,
                        format!(
                            "{floor} dBm is outside the floors this till takes, {} to {} dBm.",
                            range.start(),
                            range.end()
                        ),
                    ));
                    None
                }
            }
        }
    };
    if let (Some(floor), Some((tenths, epc, _))) = (suggested_dbm, strongest_off) {
        let under = i32::from(floor) * 10 - tenths;
        if under < OFF_PAD_GAP_TENTHS {
            let how = if under > 0 {
                format!("{:.1} dB under", dbm(under))
            } else {
                format!("{:.1} dB above", dbm(-under))
            };
            warnings.push(Fault::new(
                &OFF_PAD_NEAR_FLOOR,
                format!(
                    "{epc}, which no read kept, was heard at {:.1} dBm, {how} the suggested {floor} dBm.",
                    dbm(tenths)
                ),
            ));
        }
    }
    if unsteady > 0 {
        warnings.push(Fault::new(
            &READS_DIFFER,
            format!("{unsteady} of the {on_pad} tags on the pad were not heard in every read."),
        ));
    }
    let seen_tag = |(tenths, epc, check_tag): (i32, &str, bool)| SeenTag {
        epc: epc.to_string(),
        rssi_dbm: dbm(tenths),
        check_tag,
    };
    Calibration {
        suggested_dbm,
        floor_dbm: settings.min_rssi_dbm,
        weakest: weakest.map(seen_tag),
        strongest_off: strongest_off.map(seen_tag),
        on_pad: count(on_pad),
        unsteady: count(unsteady),
        warnings,
        reads: reads.iter().map(summary).collect(),
    }
}

/// One SDK call as the diagnostics bundle lists it.
#[derive(Clone, Debug, PartialEq)]
struct Call {
    /// Unix milliseconds when it returned.
    at_ms: u64,
    /// The call and what it was given: `UHFSetPower(0, 15)`.
    what: String,
    /// Its code, then what it wrote.
    answer: String,
    took_ms: u64,
}

/// What the diagnostics bundle shows of the till's recent past with the
/// reader, oldest first.
struct Journal {
    calls: VecDeque<Call>,
    reads: VecDeque<(u64, String)>,
    faults: VecDeque<(u64, Fault)>,
}

const CALLS_KEPT: usize = 40;
const READS_KEPT: usize = 10;
const FAULTS_KEPT: usize = 10;

impl Journal {
    const fn new() -> Self {
        Self {
            calls: VecDeque::new(),
            reads: VecDeque::new(),
            faults: VecDeque::new(),
        }
    }

    fn sections(&self) -> Vec<(&'static str, Vec<String>)> {
        vec![
            (
                "Last reads, oldest first",
                self.reads
                    .iter()
                    .map(|(at, line)| format!("{} {line}", utc(*at)))
                    .collect(),
            ),
            (
                "Last faults, oldest first",
                self.faults
                    .iter()
                    .map(|(at, fault)| {
                        format!(
                            "{} {} {} {}",
                            utc(*at),
                            fault.code,
                            fault.says,
                            fault.detail
                        )
                    })
                    .collect(),
            ),
            (
                "Last SDK calls, oldest first",
                self.calls
                    .iter()
                    .map(|call| {
                        format!(
                            "{} {} -> {} ({} ms)",
                            utc(call.at_ms),
                            call.what,
                            call.answer,
                            call.took_ms
                        )
                    })
                    .collect(),
            ),
        ]
    }
}

fn keep_last<T>(queue: &mut VecDeque<T>, kept: usize, item: T) {
    while queue.len() >= kept {
        queue.pop_front();
    }
    queue.push_back(item);
}

static JOURNAL: Mutex<Journal> = Mutex::new(Journal::new());

fn journal() -> MutexGuard<'static, Journal> {
    JOURNAL.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One SDK call, kept for the bundle.
fn note_call(what: String, answer: String, took: Duration) {
    let call = Call {
        at_ms: now_ms(),
        what,
        answer,
        took_ms: ms(took),
    };
    keep_last(&mut journal().calls, CALLS_KEPT, call);
}

/// One read that finished, kept for the bundle as a line.
fn note_read(read: &PadRead) {
    let line = read_line(read);
    keep_last(&mut journal().reads, READS_KEPT, (now_ms(), line));
}

/// A fault the till has learned: logged, and kept for the bundle.
fn learned(fault: &Fault) {
    eprintln!("Chainway R3 {fault}");
    keep_last(
        &mut journal().faults,
        FAULTS_KEPT,
        (now_ms(), fault.clone()),
    );
}

fn read_line(read: &PadRead) -> String {
    let mut line = format!(
        "{} tags, {} left out, {} unreadable, {} records, took {} ms after a {} ms wait",
        read.tags.len(),
        read.left_out.len(),
        read.unreadable,
        read.records,
        read.took_ms,
        read.waited_ms
    );
    if let Some(canary) = &read.canary {
        line.push_str(&match (canary.rssi_dbm, canary.margin_db) {
            (Some(rssi), Some(margin)) => {
                format!(", check tag {rssi:.1} dBm ({margin:+.1} dB to the floor)")
            }
            _ if canary.heard => ", check tag heard with no signal strength".into(),
            _ => ", check tag not heard".into(),
        });
    }
    if let Some(fault) = &read.attention {
        line.push_str(&format!(", {}", fault.code));
    }
    line
}

/// The diagnostics bundle: plain text, a heading per section, each line
/// indented under it.
fn bundle(made_ms: u64, sections: Vec<(&'static str, Vec<String>)>, journal: &Journal) -> String {
    let mut text = format!("Chainway R3 diagnostics, made {}\n", utc(made_ms));
    for (heading, lines) in sections.into_iter().chain(journal.sections()) {
        text.push('\n');
        text.push_str(heading);
        text.push('\n');
        if lines.is_empty() {
            text.push_str("  none\n");
        }
        for line in lines {
            text.push_str("  ");
            text.push_str(&line);
            text.push('\n');
        }
    }
    text
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, ms)
}

fn ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// Unix milliseconds in UTC, to the millisecond: `2026-10-23 03:04:05.678Z`.
fn utc(at_ms: u64) -> String {
    let seconds = at_ms / 1000;
    let (year, month, day) = civil(i64::try_from(seconds / 86_400).unwrap_or(0));
    let in_day = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}.{:03}Z",
        in_day / 3600,
        in_day / 60 % 60,
        in_day % 60,
        at_ms % 1000
    )
}

/// Days since 1970-01-01 as a calendar date (Howard Hinnant's
/// `civil_from_days`).
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let of_era = z.rem_euclid(146_097);
    let year_of_era = (of_era - of_era / 1_460 + of_era / 36_524 - of_era / 146_096) / 365;
    let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted = (5 * of_year + 2) / 153;
    let day = of_year - (153 * shifted + 2) / 5 + 1;
    let month = if shifted < 10 {
        shifted + 3
    } else {
        shifted - 9
    };
    (year_of_era + era * 400 + i64::from(month <= 2), month, day)
}

/// Bytes as lower-case hex, as SHA-256 sums are written.
fn hex_lower(bytes: &[u8]) -> String {
    hex_upper(bytes).to_ascii_lowercase()
}

/// The SDK files the Windows build pins (`pos-windows.yml`), by SHA-256.
const PINNED: [(&str, &str); 2] = [
    (
        "UHFAPI.dll",
        "25c044a8f0160d3365df4bb31608f645074f13cf153eaa1476bb91c42e1cdef8",
    ),
    (
        "libusb-1.0.dll",
        "5072054cb3002ae071f382ad5c2c2b0092d9451c537d0c13444c2b6f968f7251",
    ),
];

/// One SDK file's line in the bundle: its sum, and whether it is the file
/// the Windows build pins.
fn file_line(name: &str, sha256: &str) -> String {
    let pinned = PINNED
        .iter()
        .any(|(file, sum)| file.eq_ignore_ascii_case(name) && *sum == sha256);
    format!(
        "{name} sha256 {sha256}{}",
        if pinned {
            ", the pinned build"
        } else {
            ", NOT the pinned build"
        }
    )
}

/// The firmware text in a `UHFGetReaderVersion` answer, and the answer's
/// bytes in hex, from its length byte on.
///
/// The SDK builds the answer itself from the reader's `C8` reply:
/// `version[0]` is the length, then `V<a>.<b>.<c>` and, for each value the
/// reader sent, a comma and the value's raw bytes, with no NUL after them.
/// Nothing in the SDK or in the vendor's tool promises that a value names the
/// model, so the text is shown and never judged, and the bytes are logged
/// with it for the bench.
fn version_reply(reply: &[u8]) -> (String, String) {
    let length = reply.first().map_or(0, |&length| usize::from(length));
    let answer = reply.get(..1 + length).unwrap_or(reply);
    let text = String::from_utf8_lossy(answer.get(1..).unwrap_or(&[]))
        .trim_matches('\0')
        .trim()
        .to_owned();
    (text, hex_spaced(answer))
}

/// One EPC from a record's PC word and EPC bytes, as the reader sent them.
///
/// The PC word's length field gives the exact EPC byte count, and a record
/// whose bytes disagree with it is refused rather than guessed at: a misread
/// EPC is another garment's tag.
fn epc_hex(uii: &[u8]) -> Result<String, String> {
    if uii.len() < 2 {
        return Err(format!(
            "A record of {} bytes is too short to carry a PC word.",
            uii.len()
        ));
    }
    let pc = u16::from_be_bytes([uii[0], uii[1]]);
    let epc = &uii[2..];
    let length = usize::from((pc >> 11) & 0x1f) * 2;
    if length == 0 || epc.len() != length {
        return Err(format!(
            "A record's PC word says {length} EPC bytes, but {} came.",
            epc.len()
        ));
    }
    Ok(hex_upper(epc))
}

fn hex_upper(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
    let mut rendered = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        rendered.push(char::from(DIGITS[usize::from(byte >> 4)]));
        rendered.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    rendered
}

/// Bytes as upper-case hex pairs with a space between, for a message or the
/// log: `0B 56 31`.
fn hex_spaced(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| hex_upper(&[*byte]))
        .collect::<Vec<_>>()
        .join(" ")
}

/// One record the reader sent, before records are folded per EPC.
#[derive(Debug, PartialEq)]
struct Heard {
    epc: String,
    /// Tenths of a dBm; `None` when the record carried no signal strength.
    rssi_tenths: Option<i32>,
    /// The record carried TID bytes: the reader is not in EPC-only output.
    carried_tid: bool,
}

/// The vendor's RSSI: two bytes, high first, read as `(value - 65535) / 10`
/// dBm (`ReadTagFromBuffer` and `GetTagData` in the SDK's `UHFAPI.cs`).
fn rssi_tenths(high: u8, low: u8) -> i32 {
    i32::from(u16::from_be_bytes([high, low])) - 65_535
}

/// The cell types `UHFGetTagData` answers in (`CELL_DATA_TYPE` in `UHFAPI.h`).
const CELL_PC: u8 = 3;
const CELL_RSSI: u8 = 4;
const CELL_EPC: u8 = 6;
const CELL_TID: u8 = 7;

/// One record's cells, as they arrive.
#[derive(Default)]
struct Cells<'a> {
    pc: Option<&'a [u8]>,
    epc: Option<&'a [u8]>,
    rssi: Option<&'a [u8]>,
    tid: Option<&'a [u8]>,
}

impl<'a> Cells<'a> {
    fn is_empty(&self) -> bool {
        self.pc.is_none() && self.epc.is_none() && self.rssi.is_none() && self.tid.is_none()
    }

    /// Take one cell. `false` when this record already holds a cell of that
    /// type, which means the cell begins the next record.
    fn put(&mut self, kind: u8, content: &'a [u8]) -> bool {
        let slot = match kind {
            CELL_PC => &mut self.pc,
            CELL_EPC => &mut self.epc,
            CELL_RSSI => &mut self.rssi,
            CELL_TID => &mut self.tid,
            // The link id, the antenna, phase and the like: nothing a pad read
            // decides on.
            _ => return true,
        };
        if slot.is_some() {
            return false;
        }
        *slot = Some(content);
        true
    }

    fn heard(&self) -> Result<Heard, String> {
        let (Some(pc), Some(epc)) = (self.pc, self.epc) else {
            return Err("A record came without its PC word or without its EPC.".into());
        };
        if pc.len() != 2 {
            return Err(format!("A record's PC word was {} bytes long.", pc.len()));
        }
        let mut uii = Vec::with_capacity(2 + epc.len());
        uii.extend_from_slice(pc);
        uii.extend_from_slice(epc);
        Ok(Heard {
            epc: epc_hex(&uii)?,
            rssi_tenths: match self.rssi {
                Some(&[high, low]) => Some(rssi_tenths(high, low)),
                _ => None,
            },
            carried_tid: self.tid.is_some_and(|tid| !tid.is_empty()),
        })
    }
}

/// Every record in one `UHFGetTagData` answer: cells of `type, length,
/// content`, one record's cells after another. An answer usually holds one
/// record; a cell type seen twice begins the next one, so an answer that packs
/// two tags is never read as one.
fn heard_in_cells(data: &[u8]) -> Vec<Result<Heard, String>> {
    const CUT: &str = "An answer from the reader was cut short.";
    let mut records = Vec::new();
    let mut cells = Cells::default();
    let mut at = 0;
    while at < data.len() {
        let kind = data[at];
        let Some(&length) = data.get(at + 1) else {
            records.push(Err(CUT.into()));
            return records;
        };
        let start = at + 2;
        let end = start + usize::from(length);
        let Some(content) = data.get(start..end) else {
            records.push(Err(CUT.into()));
            return records;
        };
        if !cells.put(kind, content) {
            records.push(cells.heard());
            cells = Cells::default();
            cells.put(kind, content);
        }
        at = end;
    }
    if !cells.is_empty() {
        records.push(cells.heard());
    }
    records
}

/// One `UHF_GetReceived_EX` answer: `[PC+EPC length][PC][EPC][TID length]
/// [TID][RSSI high][RSSI low][antenna]`, as `ReadTagFromBuffer` in the SDK's
/// `UHFAPI.cs` reads it, with every length checked against what arrived.
fn heard_in_received(data: &[u8]) -> Result<Heard, String> {
    let cut = || "An answer from the reader was cut short.".to_string();
    let uii_length = usize::from(*data.first().ok_or_else(cut)?);
    let uii = data.get(1..1 + uii_length).ok_or_else(cut)?;
    let tid_length = usize::from(*data.get(1 + uii_length).ok_or_else(cut)?);
    let rssi_at = 2 + uii_length + tid_length;
    let &[high, low] = data.get(rssi_at..rssi_at + 2).ok_or_else(cut)? else {
        return Err(cut());
    };
    Ok(Heard {
        epc: epc_hex(uii)?,
        rssi_tenths: Some(rssi_tenths(high, low)),
        carried_tid: tid_length > 0,
    })
}

/// One read's records, folded into one entry per EPC.
#[derive(Default)]
struct Gathered {
    /// EPC → the strongest signal it was heard at (tenths of a dBm), and how
    /// many times it was heard.
    tags: BTreeMap<String, (Option<i32>, u32)>,
    unreadable: u32,
    carried_tid: bool,
}

impl Gathered {
    fn add(&mut self, record: Result<Heard, String>) {
        match record {
            Ok(heard) => {
                self.carried_tid |= heard.carried_tid;
                let entry = self.tags.entry(heard.epc).or_insert((None, 0));
                entry.0 = match (entry.0, heard.rssi_tenths) {
                    (Some(best), Some(now)) => Some(best.max(now)),
                    (best, now) => best.or(now),
                };
                entry.1 = entry.1.saturating_add(1);
            }
            Err(_) => self.unreadable = self.unreadable.saturating_add(1),
        }
    }

    /// Every record added, readable or not.
    fn records(&self) -> u32 {
        self.tags.values().fold(self.unreadable, |all, (_, reads)| {
            all.saturating_add(*reads)
        })
    }

    /// The tags at or above the floor, strongest first, and the ones heard
    /// only below it, strongest first. A tag that came with no signal strength
    /// cannot be shown to be on the pad, so it counts as below, last. The
    /// counter's check tag, `canary`, is in neither: it is said apart, heard
    /// or not, with how far above the floor it was.
    fn finish(
        mut self,
        min_rssi_dbm: i16,
        canary: Option<&str>,
    ) -> (Vec<PadTag>, Vec<WeakTag>, Option<CanaryRead>) {
        let floor = i32::from(min_rssi_dbm) * 10;
        let canary = canary.map(|epc| {
            let heard = self.tags.remove(epc);
            let best = heard.and_then(|(best, _)| best);
            CanaryRead {
                epc: epc.to_string(),
                heard: heard.is_some(),
                rssi_dbm: best.map(dbm),
                reads: heard.map_or(0, |(_, reads)| reads),
                margin_db: best.map(|tenths| dbm(tenths - floor)),
            }
        });
        let mut kept = Vec::new();
        let mut left_out = Vec::new();
        for (epc, (best, reads)) in self.tags {
            match best {
                Some(tenths) if tenths >= floor => kept.push(PadTag {
                    epc,
                    rssi_dbm: f64::from(tenths) / 10.0,
                    reads,
                }),
                _ => left_out.push(WeakTag {
                    epc,
                    rssi_dbm: best.map(|tenths| f64::from(tenths) / 10.0),
                    reads,
                }),
            }
        }
        kept.sort_by(|one, other| {
            other
                .rssi_dbm
                .total_cmp(&one.rssi_dbm)
                .then_with(|| one.epc.cmp(&other.epc))
        });
        left_out.sort_by(|one, other| {
            let signal = |tag: &WeakTag| tag.rssi_dbm.unwrap_or(f64::NEG_INFINITY);
            signal(other)
                .total_cmp(&signal(one))
                .then_with(|| one.epc.cmp(&other.epc))
        });
        (kept, left_out, canary)
    }
}

/// The reader's Gen2 settings: `UHFGetGen2`'s fourteen fields, in its order.
/// Named for the Gen2 command each belongs to, because the header's names
/// mislead: its `Target` is the Select command's, and the Query's target, A
/// or B, is its `G` (the vendor's API document says which is which).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Gen2 {
    /// Which flag a Select changes: a session's, 0–3, or SL, 4 (`Target`).
    select_target: u8,
    /// What a Select does to the tags it matches and to the rest (`Action`).
    select_action: u8,
    /// Whether a Select truncates (`T`).
    select_truncate: u8,
    /// 0 for a fixed Q, 1 for a dynamic one (`Q`).
    q_algorithm: u8,
    start_q: u8,
    min_q: u8,
    max_q: u8,
    /// The Query's divide ratio (`D`).
    query_dr: u8,
    /// The Query's M, how a tag encodes its reply (`C`, read as `Coding`).
    query_m: u8,
    /// The Query's TRext, the pilot tone (`P`).
    query_trext: u8,
    /// Which tags the Query asks, by their SL flag (`Sel`).
    query_sel: u8,
    /// The Query's session, 0–3 for S0–S3 (`Session`).
    query_session: u8,
    /// The Query's target, 0 for A and 1 for B (`G`).
    query_target: u8,
    /// The backscatter link frequency (`LF`).
    link_frequency: u8,
}

/// The Query's session S0 and target A, as `UHFSetGen2` takes them.
const SESSION_S0: u8 = 0;
const TARGET_A: u8 = 0;
const RECIPE_RF_LINK: u8 = 1;

impl Gen2 {
    /// Every field at a value none of them can hold, for the SDK to write
    /// over: a field it left alone can never pass for S0 or A.
    const UNREAD: Self = Self {
        select_target: u8::MAX,
        select_action: u8::MAX,
        select_truncate: u8::MAX,
        q_algorithm: u8::MAX,
        start_q: u8::MAX,
        min_q: u8::MAX,
        max_q: u8::MAX,
        query_dr: u8::MAX,
        query_m: u8::MAX,
        query_trext: u8::MAX,
        query_sel: u8::MAX,
        query_session: u8::MAX,
        query_target: u8::MAX,
        link_frequency: u8::MAX,
    };

    /// The conservative inventory controls: no session suppression from a retained
    /// Select, no SL filtering, dynamic Q starting with 64 slots, S0/target A.
    /// Hardware timing stays as read after selecting the fixed RF link.
    fn pinned(self) -> Self {
        Self {
            select_target: 4,
            select_action: 0,
            select_truncate: 0,
            q_algorithm: 1,
            start_q: 6,
            min_q: 0,
            max_q: 15,
            query_sel: 0,
            query_session: SESSION_S0,
            query_target: TARGET_A,
            ..self
        }
    }

    fn is_pinned(&self) -> bool {
        *self == self.pinned()
            && self.query_dr <= 1
            && self.query_m <= 3
            && self.query_trext <= 1
            && self.link_frequency <= 7
    }

    fn session(&self) -> String {
        format!("S{}", self.query_session)
    }

    fn target(&self) -> String {
        match self.query_target {
            TARGET_A => "A".into(),
            1 => "B".into(),
            other => format!("{other}"),
        }
    }

    /// Every field on one line, for the diagnostics bundle.
    fn brief(&self) -> String {
        format!(
            "Select target {} action {} truncate {}, Q algorithm {} start {} min {} max {}, \
             DR {} M {} TRext {}, Sel {}, session {} target {}, LF {}",
            self.select_target,
            self.select_action,
            self.select_truncate,
            self.q_algorithm,
            self.start_q,
            self.min_q,
            self.max_q,
            self.query_dr,
            self.query_m,
            self.query_trext,
            self.query_sel,
            self.session(),
            self.target(),
            self.link_frequency
        )
    }
}

/// What an RF link mode runs on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LinkKind {
    /// Plain Gen2.
    PrAsk,
    /// Impinj's Gen2X extensions.
    Gen2X,
    /// What the vendor's document calls Autoset, without saying more.
    Autoset,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RfLink {
    mode: u8,
    kind: LinkKind,
    miller: u8,
    khz: u16,
}

const fn link(mode: u8, kind: LinkKind, miller: u8, khz: u16) -> RfLink {
    RfLink {
        mode,
        kind,
        miller,
        khz,
    }
}

/// The modes `UHFSetRFLink` takes and `UHFGetRFLink` answers, as the vendor's
/// API document lists them (V1.0.3, whose V1.0.2 "updated the link
/// parameters") and as the SDK demo's settings form offers them. The comment
/// in `UHFAPI.h` still lists four older modes (from 0, DSB-ASK/FM0/40 kHz, to
/// 3, DSB-ASK/FM0/400 kHz) and no Gen2X mode at all, so a reader that answers
/// 10–15 is one this table describes.
const RF_LINKS: [RfLink; 18] = [
    link(0, LinkKind::PrAsk, 8, 160),
    link(1, LinkKind::PrAsk, 4, 250),
    link(2, LinkKind::PrAsk, 4, 320),
    link(3, LinkKind::PrAsk, 4, 640),
    link(4, LinkKind::PrAsk, 2, 320),
    link(5, LinkKind::PrAsk, 2, 640),
    link(10, LinkKind::Gen2X, 8, 160),
    link(11, LinkKind::Gen2X, 4, 250),
    link(12, LinkKind::Gen2X, 4, 320),
    link(13, LinkKind::Gen2X, 4, 640),
    link(14, LinkKind::Gen2X, 2, 320),
    link(15, LinkKind::Gen2X, 2, 640),
    link(20, LinkKind::Autoset, 8, 160),
    link(21, LinkKind::Autoset, 4, 250),
    link(22, LinkKind::Autoset, 4, 320),
    link(23, LinkKind::Autoset, 4, 640),
    link(24, LinkKind::Autoset, 2, 320),
    link(25, LinkKind::Autoset, 2, 640),
];

fn rf_link(mode: u8) -> Option<RfLink> {
    RF_LINKS.into_iter().find(|link| link.mode == mode)
}

/// The plain Gen2 twin of a Gen2X mode: the one PR-ASK mode with the same
/// Miller encoding and link frequency. `None` for a mode that is not Gen2X,
/// and for one the table gives no single twin — that one is left as it is.
fn plain_twin(mode: u8) -> Option<u8> {
    let gen2x = rf_link(mode).filter(|link| link.kind == LinkKind::Gen2X)?;
    let mut twins = RF_LINKS.into_iter().filter(|link| {
        link.kind == LinkKind::PrAsk && link.miller == gen2x.miller && link.khz == gen2x.khz
    });
    match (twins.next(), twins.next()) {
        (Some(twin), None) => Some(twin.mode),
        _ => None,
    }
}

/// A mode as the vendor's document names it, with its number for whoever
/// supports the till.
fn describe_link(mode: u8) -> String {
    let Some(link) = rf_link(mode) else {
        return format!("mode {mode}, which the vendor's document does not list");
    };
    let kind = match link.kind {
        LinkKind::PrAsk => "PR-ASK",
        LinkKind::Gen2X => "Gen2X",
        LinkKind::Autoset => "Autoset",
    };
    format!(
        "{kind}, Miller {}, {} kHz (mode {mode})",
        link.miller, link.khz
    )
}

/// The radio profile as the reader last read it back.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Profile {
    fast_id: bool,
    tag_focus: bool,
    gen2: Gen2,
    rf_link: u8,
    /// The Gen2X mode the link was moved off, for as long as it still reads
    /// back as the twin it was moved to.
    rf_link_was: Option<u8>,
    /// The region code, read and never written. `None`: not read.
    region: Option<u8>,
    /// The channels the reader hops over. `None`: not read.
    channels: Option<Channels>,
    /// `UHFGetANT`'s two bytes, read and never judged. `None`: not read.
    antennas: Option<[u8; 2]>,
    /// The work and wait time, in ms, as read back once the wait was set to
    /// 0. `None`: not read.
    duty: Option<(u16, u16)>,
    /// The wait the reader had before this till set it to 0, not saved in
    /// the reader. `None`: it was 0 already, or not read.
    wait_was: Option<u16>,
    /// Everything read at rest once the profile was made, for the
    /// diagnostics bundle.
    rest: Rest,
}

impl Profile {
    /// What in this profile is not this counter's, in words: empty when every
    /// setting is.
    fn unpinned(&self) -> Vec<String> {
        let mut off = Vec::new();
        if self.fast_id {
            off.push("FastID on".to_string());
        }
        if self.tag_focus {
            off.push("Tag Focus on".to_string());
        }
        if !self.gen2.is_pinned() {
            off.push(format!(
                "inventory controls differ from the recipe (session {}, target {})",
                self.gen2.session(),
                self.gen2.target()
            ));
        }
        if self.rf_link != RECIPE_RF_LINK {
            off.push(format!("link {}", describe_link(self.rf_link)));
        }
        off
    }

    fn report(&self) -> RadioProfile {
        RadioProfile {
            fast_id: self.fast_id,
            tag_focus: self.tag_focus,
            session: self.gen2.session(),
            target: self.gen2.target(),
            rf_link: describe_link(self.rf_link),
            rf_link_moved_from: self.rf_link_was.map(describe_link),
            region: self.region.map(describe_region),
            channels: self.channels.map(|channels| channels.describe()),
            antennas: self.antennas.map(|antennas| hex_spaced(&antennas)),
            work_wait: self.duty.map(|duty| describe_duty(duty, self.wait_was)),
        }
    }
}

/// The regions the vendor's settings tool offers, by the code `UHFGetRegion`
/// answers, with the tool's own names and bands (`ConfigForm` in the SDK's
/// `UHFAPP.exe`). Read only: which band a store may use is its owner's
/// decision, not this till's.
const REGIONS: [(u8, &str); 21] = [
    (0x01, "China Standard1, 840–845 MHz"),
    (0x02, "China Standard2, 920–925 MHz"),
    (0x04, "Europe Standard, 865–868 MHz"),
    (0x08, "USA, 902–928 MHz"),
    (0x16, "Korea, 917–923 MHz"),
    (0x32, "Japan, 916.8–920.8 MHz"),
    (0x33, "South Africa, 915–919 MHz"),
    (0x34, "China Taiwan, 920–928 MHz"),
    (0x35, "Vietnam, 918–923 MHz"),
    (0x36, "Peru, 915–928 MHz"),
    (0x37, "Russia, 860–867.6 MHz"),
    (0x3b, "Malaysia, 919–923 MHz"),
    (0x3c, "Brazil, 902–907.5 and 915–928 MHz"),
    (0x3d, "ETSI_UPPER, 915–921 MHz"),
    (0x3e, "Australia, 920–926 MHz"),
    (0x3f, "Indonesia, 920–923 MHz"),
    (0x40, "Israel, 915–917 MHz"),
    (0x41, "HK, 920–925 MHz"),
    (0x42, "New Zealand, 920–928 MHz"),
    (0x43, "880–930 MHz"),
    (0x44, "Singapore"),
];

/// A region code as the vendor's tool names it, with the code for whoever
/// supports the till.
fn describe_region(code: u8) -> String {
    match REGIONS.iter().find(|(known, _)| *known == code) {
        Some((_, name)) => format!("{name} (0x{code:02X})"),
        None => format!("0x{code:02X}, which the vendor's tool does not name"),
    }
}

/// The channels a reader hops over, as far as a reader's profile shows them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Channels {
    count: usize,
    lowest_khz: u32,
    highest_khz: u32,
}

impl Channels {
    fn of(khz: &[u32]) -> Self {
        Self {
            count: khz.len(),
            lowest_khz: khz.iter().copied().min().unwrap_or(0),
            highest_khz: khz.iter().copied().max().unwrap_or(0),
        }
    }

    /// The channels in words. An empty list is no broken answer: the first R3
    /// probed answered with one, which leaves the reader on its region's own
    /// channels.
    fn describe(&self) -> String {
        match self.count {
            0 => "the region's own channels".into(),
            1 => format!("1 channel, {} MHz", mhz(self.lowest_khz)),
            count => format!(
                "{count} channels, {}–{} MHz",
                mhz(self.lowest_khz),
                mhz(self.highest_khz)
            ),
        }
    }
}

/// The channels in a `UHFGetJumpFrequency` answer: the count, then each
/// channel in kHz, one `unsigned int` apiece (the SDK unpacks them from the
/// reader's three bytes each, with no status byte to check). `None` when the
/// count runs past the answer.
fn channels_in(reply: &[u32]) -> Option<&[u32]> {
    let count = usize::try_from(*reply.first()?).ok()?;
    reply.get(1..1 + count)
}

/// kHz as MHz, to the kHz: 920125 is "920.125".
fn mhz(khz: u32) -> String {
    format!("{}.{:03}", khz / 1000, khz % 1000)
}

/// `UHFGetProtocolType`'s answer for ISO 18000-6C, the Gen2 every tag here
/// speaks (`UHFAPI.h`).
const PROTOCOL_GEN2: u8 = 0;

/// The settings a reader holds that this till reads but does not pin, as the
/// reader answered them at rest once everything else was set. `None`: the
/// SDK has no call for it, or the reader did not answer, which is logged and
/// never held against the reader.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Rest {
    /// `UHFGetFastInventory`, after this till switched it off: 0 for off.
    fast_inventory: Option<u8>,
    /// `UHFGetWorkTime`: how long the reader reads, then how long it waits
    /// before reading again, in ms (`duty`), as read back once this till set
    /// a wait other than 0 to 0, or as first read when it was 0 already or
    /// could not be set.
    duty: Option<(u16, u16)>,
    /// `UHFGetANT`: one bit per antenna, two bytes the SDK copies as they came
    /// with no status byte to check. Logged and shown, never refused. The
    /// vendor's Java reads antenna 1 as the low bit of the second byte, and
    /// the first R3 probed (23 Oct) read `00 0F` with antenna 1 reading, which
    /// fits; one reader is not proof.
    antennas: Option<[u8; 2]>,
    /// `UHFGetProtocolType`: [`PROTOCOL_GEN2`] or another air protocol.
    protocol: Option<u8>,
    /// `UHFGetEPCTIDUSERMode`: the output (0 EPC only, 1 EPC+TID, 2
    /// EPC+TID+USER), then the USER area's start and length, in words.
    output: Option<[u8; 3]>,
    // Not asked: `UHFGetWorkMode`, `UHFGetDualSingelMode` and
    // `GetURTagFilter`. On the first R3 probed (firmware V2.2.9) each answered
    // only −1, after the full 1.5 s, and they were only ever logged.
}

impl Rest {
    /// What in these answers can leave a garment off the basket, in words:
    /// empty when nothing does. Only what the reader answered counts.
    fn refused(&self) -> Vec<String> {
        let mut off = Vec::new();
        if let Some(fast_inventory) = self.fast_inventory {
            if fast_inventory != 0 {
                off.push(format!("Fast Inventory on ({fast_inventory})"));
            }
        }
        if let Some((_, wait)) = self.duty {
            if wait != 0 {
                off.push(format!(
                    "a wait time of {wait} ms between reads, which could not be set to 0"
                ));
            }
        }
        if let Some(protocol) = self.protocol {
            if protocol != PROTOCOL_GEN2 {
                off.push(format!("air protocol {}", describe_protocol(protocol)));
            }
        }
        if let Some([output, ..]) = self.output {
            if output != 0 {
                off.push(format!("output {}", describe_output(output)));
            }
        }
        off
    }

    /// Every answer, for the log.
    fn describe(&self) -> String {
        fn or_unread<T>(answer: Option<T>, show: impl Fn(T) -> String) -> String {
            answer.map_or_else(|| "unread".to_string(), show)
        }
        [
            format!(
                "Fast Inventory {}",
                or_unread(self.fast_inventory, |value| match value {
                    0 => "off".to_string(),
                    other => format!("on ({other})"),
                })
            ),
            format!(
                "work/wait {}",
                or_unread(self.duty, |(work, wait)| format!("{work}/{wait} ms"))
            ),
            format!(
                "antennas {}",
                or_unread(self.antennas, |antennas| hex_spaced(&antennas))
            ),
            format!("protocol {}", or_unread(self.protocol, describe_protocol)),
            format!(
                "output {}",
                or_unread(self.output, |[output, start, length]| format!(
                    "{} (USER from word {start}, {length} words)",
                    describe_output(output)
                ))
            ),
        ]
        .join(", ")
    }
}

/// The work and wait time as the read ran with them, with the wait this till
/// moved off when it set it to 0.
fn describe_duty((work, wait): (u16, u16), wait_was: Option<u16>) -> String {
    let ran = format!("work {work} ms, wait {wait} ms");
    match wait_was {
        Some(was) => format!("{ran} · wait switched from {was} ms, not saved in the reader"),
        None => ran,
    }
}

/// `UHFGetWorkTime`'s four bytes: the work time, then the wait time, each in
/// ms, high byte first (`UHFAPI.h`). `UHFSetWorkTime` takes them in the same
/// order, after its save flag.
fn duty(bytes: [u8; 4]) -> (u16, u16) {
    (
        u16::from_be_bytes([bytes[0], bytes[1]]),
        u16::from_be_bytes([bytes[2], bytes[3]]),
    )
}

fn describe_protocol(protocol: u8) -> String {
    match protocol {
        PROTOCOL_GEN2 => "ISO 18000-6C".into(),
        1 => "GB/T 29768".into(),
        2 => "GJB 7377.1".into(),
        other => format!("{other}"),
    }
}

fn describe_output(output: u8) -> String {
    match output {
        0 => "EPC only".into(),
        1 => "EPC+TID".into(),
        2 => "EPC+TID+USER".into(),
        other => format!("{other}"),
    }
}

/// The stop command as the SDK itself sends it: `A5 5A`, the frame's length
/// (8, high byte first), `8C`, the XOR of the length and the command, `0D 0A`.
const STOP_FRAME: [u8; 8] = [0xa5, 0x5a, 0x00, 0x08, 0x8c, 0x84, 0x0d, 0x0a];

/// The ids the SDK gives its links: the slot each one sits in, 0 to 255.
const LINK_SLOTS: usize = 256;

/// What the SDK has said about lost links, link by link. Its disconnect
/// callback names the link it gave up on, so a call for a link this till
/// already closed cannot mark the one it holds now. Atomics only: the
/// callback may run inside the till's own SDK call, `READER` held.
struct LostLinks {
    by_link: [AtomicU64; LINK_SLOTS],
    /// Every call, whatever link it named: what counts for a link whose id
    /// is not known.
    any: AtomicU64,
    /// The id the last call named, for the log; −1 before any.
    last: AtomicI32,
}

/// One link as this till holds it, and what had been said about it when it
/// was opened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LinkWatch {
    /// The link's id, as `LinkGetSelected` answered right after `UsbOpen`.
    /// `None`: not known, so any disconnect counts.
    link: Option<usize>,
    /// The count for that link, or for all of them, as the watch began.
    seen: u64,
}

impl LostLinks {
    const fn new() -> Self {
        Self {
            by_link: [const { AtomicU64::new(0) }; LINK_SLOTS],
            any: AtomicU64::new(0),
            last: AtomicI32::new(-1),
        }
    }

    /// One disconnect callback, naming `link`.
    fn record(&self, link: i32) {
        self.last.store(link, Ordering::SeqCst);
        if let Some(count) = usize::try_from(link)
            .ok()
            .and_then(|id| self.by_link.get(id))
        {
            count.fetch_add(1, Ordering::SeqCst);
        }
        self.any.fetch_add(1, Ordering::SeqCst);
    }

    fn count(&self, link: Option<usize>) -> u64 {
        match link.and_then(|id| self.by_link.get(id)) {
            Some(count) => count.load(Ordering::SeqCst),
            None => self.any.load(Ordering::SeqCst),
        }
    }

    /// A watch on `link` from now on; an id past the slots is not known.
    fn watch(&self, link: Option<usize>) -> LinkWatch {
        let link = link.filter(|id| *id < LINK_SLOTS);
        LinkWatch {
            link,
            seen: self.count(link),
        }
    }

    /// Whether the SDK has given up on the watched link since the watch
    /// began.
    fn lost(&self, watch: LinkWatch) -> bool {
        self.count(watch.link) != watch.seen
    }

    /// The id the last disconnect callback named, for the log.
    fn last(&self) -> i32 {
        self.last.load(Ordering::SeqCst)
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::os::raw::c_int;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, MutexGuard, PoisonError, TryLockError};
    use std::time::{Duration, Instant};

    use libloading::Library;
    use tauri::{AppHandle, Manager};

    use crate::peripherals::R3_READ_GAP_MS;

    use super::{
        channels_in, check_from, check_tag_health, describe_link, describe_region, duty, file_line,
        heard_in_cells, heard_in_received, hex_lower, ms, reader_test, status_from, version_reply,
        Calibration, Channels, Fault, Gathered, Gen2, LinkWatch, LostLinks, PadRead, PadSettings,
        Profile, RadioProfile, ReaderStatus, ReaderTest, Rest, BUZZER_NOT_OFF, CHANGED_SINCE_OPEN,
        CHECK_READS, DISCONNECTED_MID_READ, DRIVER_MISSING, DRIVER_NOT_LOADED, DRIVER_UNKNOWN,
        EPC_ONLY_NOT_SET, FILTER_NOT_CLEARED, HOLDS_RISKY_SETTINGS, NOT_CONNECTED, POWER_NOT_SET,
        PROFILE_NOT_HELD, RECIPE_RF_LINK, STOP_FRAME, STOP_NOT_CONFIRMED, WENT_BACK,
    };

    // Every export is cdecl (`UHFAPI.h`; `CallingConvention.Cdecl` in the SDK's
    // `UHFAPI.cs`), which is what `extern "C"` is on x64 Windows.
    type UsbOpen = unsafe extern "C" fn() -> c_int;
    type UsbClose = unsafe extern "C" fn();
    /// `LinkGetSelected`: the current link's id, its slot. Asked right after a
    /// `UsbOpen` that answered 0, when the current link is the one it made.
    type LinkSelected = unsafe extern "C" fn() -> c_int;
    /// What the SDK calls back with: the link's id. (`UHFAPI.h` calls the
    /// disconnect callback's argument the link's kind; the DLL passes the id.)
    type Callback = extern "C" fn(c_int);
    /// `setOnEventStopInventory`: one callback for every link, kept until it
    /// is replaced.
    type SetStopEvent = unsafe extern "C" fn(Callback);
    /// `SetDisconnectCallback`: a callback for the current link only; −1 when
    /// no link is open.
    type SetDisconnect = unsafe extern "C" fn(Callback) -> c_int;
    /// `SendBytes`: bytes sent as they are, with no framing added. It answers
    /// the length once they are out, the length also when the link has no
    /// device behind it and nothing went, and 0 when the write failed.
    type SendBytes = unsafe extern "C" fn(*const u8, c_int) -> c_int;
    /// `UHFSetBeep`, `UHFSetFastID`, `UHFSetTagfocus`: one `unsigned char`,
    /// 0 for off.
    type SetFlag = unsafe extern "C" fn(u8) -> c_int;
    /// `UHFGetBeep`, `UHFGetPower`, `UHFGetReaderVersion`, `UHFGetFastID`,
    /// `UHFGetTagfocus`, `UHFGetRFLink`, and the settings read at rest
    /// (`UHFGetFastInventory`, `UHFGetWorkTime`, `UHFGetANT`,
    /// `UHFGetProtocolType`, `UHFGetRegion`): one output buffer.
    type ReadInto = unsafe extern "C" fn(*mut u8) -> c_int;
    /// `UHFSetPower`, `UHFSetRFLink`, `UHFSetFastInventory`: the save flag,
    /// always 0 here, then the value.
    type SetValue = unsafe extern "C" fn(u8, u8) -> c_int;
    /// `UHFGetEPCTIDUSERMode`: two reserved bytes, both 0, then three bytes
    /// out; it answers 3 when it read them.
    type GetOutput = unsafe extern "C" fn(u8, u8, *mut u8) -> c_int;
    /// `UHFGetJumpFrequency`: the count, then each channel in kHz, one
    /// `unsigned int` apiece.
    type GetChannels = unsafe extern "C" fn(*mut u32) -> c_int;
    /// `UHFSetWorkTime`: the save flag, always 0 here, then the work time and
    /// the wait time, each high byte first; sent as `3C` with the five bytes
    /// in that order.
    type SetWorkTime = unsafe extern "C" fn(u8, u8, u8, u8, u8) -> c_int;
    type SetEpcTidUserMode = unsafe extern "C" fn(u8, u8, u8, u8) -> c_int;
    /// `UHFSetFilter`: the save flag, the memory bank, the start address and
    /// the length (both `unsigned int`, in bits), then the data.
    type SetFilter = unsafe extern "C" fn(u8, u8, u32, u32, *mut u8) -> c_int;
    /// `UHFSetGen2`: fourteen `unsigned char`, in `Gen2`'s order.
    type SetGen2 =
        unsafe extern "C" fn(u8, u8, u8, u8, u8, u8, u8, u8, u8, u8, u8, u8, u8, u8) -> c_int;
    /// `UHFGetGen2`: fourteen `unsigned char *`, in `Gen2`'s order, one byte
    /// written to each.
    type GetGen2 = unsafe extern "C" fn(
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
        *mut u8,
    ) -> c_int;
    type Inventory = unsafe extern "C" fn() -> c_int;
    type StopGet = unsafe extern "C" fn() -> c_int;
    type GetTagData = unsafe extern "C" fn(*mut u8, c_int) -> c_int;
    type GetReceivedEx = unsafe extern "C" fn(*mut c_int, *mut u8) -> c_int;
    type SetLogLevel = unsafe extern "C" fn(c_int);
    type SaveLogFile = unsafe extern "C" fn(c_int);

    /// The size of every buffer handed to the SDK. It copies some answers by
    /// the length the reader sent rather than the length it was given, so no
    /// buffer is smaller than anything the reader could send back.
    const REPLY: usize = 4096;

    /// How long a stop's acknowledgement may take. The SDK's own stop resends
    /// for 500 ms, and on a new link its receive thread sleeps 500 ms before
    /// it reads anything, so an `8D` the reader sent at once surfaces only
    /// then.
    const STOP_WAIT: Duration = Duration::from_millis(600);

    /// How long the tag queue must stay empty before what was on its way has
    /// all been taken. `UHFGetTagData` answers −1 both when nothing is waiting
    /// and when it drops a record it cannot read, and records keep arriving
    /// after the stop is acknowledged.
    const QUIET: Duration = Duration::from_millis(40);

    /// How long a closed link is given before the next one is opened. The
    /// SDK's USB thread for a link (0x180021ed0) waits up to 1000 ms for the
    /// reader and `UsbClose` does not wait for it; when it ends it frees its
    /// queue in what may by then be the next link (`# Closing` in the module
    /// docs).
    const REOPEN_GAP: Duration = Duration::from_millis(1200);

    /// Every stop acknowledgement (`8D`) the SDK has parsed since it was
    /// loaded, whatever sent the stop: counted by `on_stop`, and only there.
    static STOPS: AtomicU64 = AtomicU64::new(0);
    /// Every link the SDK has given up on, by link: counted by
    /// `on_disconnect`.
    static LOST: LostLinks = LostLinks::new();
    /// When the last link was closed, for `REOPEN_GAP`.
    static CLOSED_AT: Mutex<Option<Instant>> = Mutex::new(None);

    /// The stop acknowledgement's callback. The SDK runs it on its receive
    /// thread, synchronously, for every `8D` on any link, whoever sent the
    /// stop (`UHFInventory` sends one itself when it finds an inventory still
    /// running), and passes no status. So it only counts: an SDK call from
    /// here would wait 1.5 s for an answer only this same thread can deliver,
    /// and `READER` is held by the read waiting for this very count.
    extern "C" fn on_stop(_link: c_int) {
        STOPS.fetch_add(1, Ordering::SeqCst);
    }

    /// The disconnect callback, which the SDK runs once per link, naming it:
    /// on its receive thread, on the thread closing it, or on the till's own
    /// thread inside a call whose send failed, `READER` held. So it too only
    /// counts, by link.
    extern "C" fn on_disconnect(link: c_int) {
        LOST.record(link);
    }

    /// Whether the SDK has given up on the watched link since it was opened.
    fn link_lost(watch: LinkWatch) -> bool {
        LOST.lost(watch)
    }

    /// The log line for a link the SDK gave up on: which one this till held,
    /// and which one the last disconnect callback named.
    fn log_lost(watch: LinkWatch, when: &str) {
        let said = lost_line(watch, when);
        eprintln!("{said}");
        super::note_call("disconnect callback".into(), said, Duration::ZERO);
    }

    fn lost_line(watch: LinkWatch, when: &str) -> String {
        format!(
            "Chainway R3 link {} given up on by the driver {when}; its last disconnect callback named link {}.",
            link_name(watch),
            LOST.last()
        )
    }

    fn link_name(watch: LinkWatch) -> String {
        watch
            .link
            .map_or_else(|| "(id unknown)".to_string(), |id| id.to_string())
    }

    /// The reader went away during a read, which is not used.
    fn lost_mid_read(watch: LinkWatch) -> Fault {
        Fault::new(&DISCONNECTED_MID_READ, lost_line(watch, "during a read"))
    }

    /// One SDK call, kept for the diagnostics bundle with what it answered
    /// and how long it took.
    fn trace(what: impl Into<String>, started: Instant, answer: impl Into<String>) {
        super::note_call(what.into(), answer.into(), started.elapsed());
    }

    /// A call that answers only a code, made and kept.
    fn coded(what: &str, call: impl FnOnce() -> c_int) -> c_int {
        let started = Instant::now();
        let code = call();
        trace(what, started, code.to_string());
        code
    }

    /// Waits out `REOPEN_GAP` after the last close, so the SDK's USB thread
    /// for the closed link has ended before the next link exists.
    fn wait_after_close() {
        let closed_at = *CLOSED_AT.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(closed_at) = closed_at {
            let ready_at = closed_at + REOPEN_GAP;
            let now = Instant::now();
            if ready_at > now {
                std::thread::sleep(ready_at - now);
            }
        }
    }

    /// The Visual C++ runtime `UHFAPI.dll` and `libusb-1.0.dll` import, in the
    /// order they import each other. Shipped app-local in `rfid-native`.
    const RUNTIME: [&str; 3] = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

    /// The SDK's entry points, out of a `UHFAPI.dll` that is never unloaded,
    /// so they stay valid for as long as the process runs.
    struct Sdk {
        usb_open: UsbOpen,
        usb_close: UsbClose,
        /// `None`: a DLL without it, where any disconnect counts against the
        /// link this till holds.
        link_selected: Option<LinkSelected>,
        set_disconnect: SetDisconnect,
        send_bytes: SendBytes,
        set_beep: SetFlag,
        get_beep: ReadInto,
        get_version: ReadInto,
        set_power: SetValue,
        get_power: ReadInto,
        set_mode: SetEpcTidUserMode,
        set_filter: SetFilter,
        set_fast_id: SetFlag,
        get_fast_id: ReadInto,
        set_tag_focus: SetFlag,
        get_tag_focus: ReadInto,
        set_gen2: SetGen2,
        get_gen2: GetGen2,
        set_rf_link: SetValue,
        get_rf_link: ReadInto,
        inventory: Inventory,
        stop: StopGet,
        drain: Drain,
        // Read at rest beyond what is pinned, and set in the case of Fast
        // Inventory and the wait time: each an export a DLL may lack, which
        // is logged and never held against the reader.
        set_fast_inventory: Option<SetValue>,
        get_fast_inventory: Option<ReadInto>,
        set_work_time: Option<SetWorkTime>,
        get_work_time: Option<ReadInto>,
        get_antennas: Option<ReadInto>,
        get_protocol: Option<ReadInto>,
        get_output: Option<GetOutput>,
        get_region: Option<ReadInto>,
        get_channels: Option<GetChannels>,
        /// Where the SDK was loaded from, for the diagnostics bundle.
        directory: PathBuf,
    }

    impl Sdk {
        /// The calls a DLL may lack that this one does, for the diagnostics
        /// bundle.
        fn lacks(&self) -> Vec<&'static str> {
            [
                ("LinkGetSelected", self.link_selected.is_none()),
                ("UHFGetTagData", matches!(self.drain, Drain::Received(_))),
                ("UHFSetFastInventory", self.set_fast_inventory.is_none()),
                ("UHFGetFastInventory", self.get_fast_inventory.is_none()),
                ("UHFSetWorkTime", self.set_work_time.is_none()),
                ("UHFGetWorkTime", self.get_work_time.is_none()),
                ("UHFGetANT", self.get_antennas.is_none()),
                ("UHFGetProtocolType", self.get_protocol.is_none()),
                ("UHFGetEPCTIDUSERMode", self.get_output.is_none()),
                ("UHFGetRegion", self.get_region.is_none()),
                ("UHFGetJumpFrequency", self.get_channels.is_none()),
            ]
            .into_iter()
            .filter_map(|(name, lacking)| lacking.then_some(name))
            .collect()
        }
    }

    /// How tags are taken from a running inventory.
    #[derive(Clone, Copy)]
    enum Drain {
        /// `UHFGetTagData`. It is handed `REPLY` as its length but refuses
        /// only 0: it writes a record's cells whatever length it is given, a
        /// few hundred bytes at most for the 8 to 256 bytes a record it takes
        /// may hold.
        Cells(GetTagData),
        /// `UHF_GetReceived_EX`, for a DLL without `UHFGetTagData`.
        Received(GetReceivedEx),
    }

    impl Drain {
        fn name(self) -> &'static str {
            match self {
                Self::Cells(_) => "UHFGetTagData",
                Self::Received(_) => "UHF_GetReceived_EX",
            }
        }
    }

    /// The reader while it is open. Dropping it closes the USB handle, and
    /// only that: the SDK stays loaded.
    struct Open {
        sdk: &'static Sdk,
        /// This link, watched from before it was given the disconnect
        /// callback: any call for it after that is this link given up on.
        watch: LinkWatch,
        version: String,
        /// The bytes `UHFGetReaderVersion` handed back, in hex, for the
        /// diagnostics bundle.
        version_bytes: String,
        power_dbm: u8,
        profile: Profile,
        /// The last read came back with TID bytes: the reader is on the
        /// output it has saved, and so, it must be assumed, on everything else
        /// it has saved. Everything is set again before the next read.
        reverted: bool,
        /// How long opening and setting it up took.
        opened_ms: u64,
    }

    impl Drop for Open {
        fn drop(&mut self) {
            let started = Instant::now();
            unsafe { (self.sdk.usb_close)() };
            trace("UsbClose()", started, "closed");
            *CLOSED_AT.lock().unwrap_or_else(PoisonError::into_inner) = Some(Instant::now());
        }
    }

    struct Reader {
        sdk: Option<&'static Sdk>,
        open: Option<Open>,
        /// When the last read ended, for the gap before the next one.
        read_ended: Option<Instant>,
        /// How the last open, check or read ended, when it did not end well
        /// (`# Status and errors` in the module docs).
        fault: Option<Fault>,
        /// The last radio check, when it did not pass: a Test reader run, or
        /// a read on a counter with a check tag.
        health: Option<Fault>,
    }

    impl Reader {
        /// How an open, a check or a read ended: `None`, well.
        fn learn(&mut self, fault: Option<Fault>) {
            if let Some(fault) = &fault {
                super::learned(fault);
            }
            self.fault = fault;
        }

        /// A radio check's verdict: `None`, it passed.
        fn checked(&mut self, verdict: Option<Fault>) {
            if let Some(fault) = &verdict {
                super::learned(fault);
            }
            self.health = verdict;
        }
    }

    /// One reader per till, and one call into it at a time: a pad read holds
    /// this for its whole window, so nothing else reaches the reader while an
    /// inventory runs.
    static READER: Mutex<Reader> = Mutex::new(Reader {
        sdk: None,
        open: None,
        read_ended: None,
        fault: None,
        health: None,
    });

    fn lock_reader() -> MutexGuard<'static, Reader> {
        // A panic mid-read leaves nothing half-written worth refusing over:
        // the next buzzer check decides whether the reader is still good.
        READER.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// How the reader stands (`super::reader_status`). `settings`: open and
    /// confirm it first, with these; `None`: only say what the till knows.
    pub(super) fn status(
        app: &AppHandle,
        settings: Option<Result<PadSettings, Fault>>,
    ) -> ReaderStatus {
        let mut reader = match READER.try_lock() {
            Ok(reader) => reader,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return ReaderStatus::busy(),
        };
        if let Some(settings) = settings {
            let opened =
                settings.and_then(|settings| ready(app, &mut reader, &settings).map(|_| ()));
            reader.learn(opened.err());
        }
        status_now(&reader)
    }

    /// The status from what the reader holds now, asking it nothing.
    fn status_now(reader: &Reader) -> ReaderStatus {
        let link = reader.open.as_ref().map(|open| link_lost(open.watch));
        let about = reader.open.as_ref().map_or_else(String::new, |open| {
            format!(
                "Chainway R3 connected ({}) at {} dBm; buzzer off and verified; profile {}.",
                open.version,
                open.power_dbm,
                crate::peripherals::R3_PROFILE_ID
            )
        });
        status_from(link, reader.fault.as_ref(), reader.health.as_ref(), &about)
    }

    pub(super) fn read_pad(
        app: &AppHandle,
        settings: Result<PadSettings, Fault>,
    ) -> Result<PadRead, Fault> {
        let mut reader = lock_reader();
        let settings = match settings {
            Ok(settings) => settings,
            Err(fault) => {
                reader.learn(Some(fault.clone()));
                return Err(fault);
            }
        };
        let read = read_locked(app, &mut reader, &settings);
        reader.learn(read.as_ref().err().cloned());
        // A read on a counter with a check tag is a radio check; one on a
        // counter without says nothing about the radio, and leaves the last
        // check as it was.
        if let Ok(read) = &read {
            if settings.canary_epc.is_some() {
                reader.checked(read.attention.clone());
            }
        }
        read
    }

    /// One read of the pad, the reader held: made ready first (`ready`), then
    /// read (`# Reading the pad` in the module docs).
    fn read_locked(
        app: &AppHandle,
        reader: &mut Reader,
        settings: &PadSettings,
    ) -> Result<PadRead, Fault> {
        let started = Instant::now();
        let open = ready(app, reader, settings)?;
        let (sdk, watch) = (open.sdk, open.watch);
        let (firmware, profile) = (open.version.clone(), open.profile.report());
        let mut reply = [0_u8; REPLY];
        // Back to back, the bench R3 heard about half the tags every other
        // read; a second after the last read ended, all of them every time.
        let mut waited = Duration::ZERO;
        if let Some(ended) = reader.read_ended {
            let ready_at = ended + Duration::from_millis(u64::from(R3_READ_GAP_MS));
            let now = Instant::now();
            if ready_at > now {
                waited = ready_at - now;
                std::thread::sleep(waited);
            }
        }

        let mut gathered = Gathered::default();
        // `UHFInventory` empties the SDK's tag queue before it sends the
        // start, so nothing an earlier read left there reaches this one. It
        // answers 0 whatever the reader does with the start: one the reader
        // ignored shows itself at the stop, which nobody then acknowledges.
        coded("UHFInventory()", || unsafe { (sdk.inventory)() });
        // Only the drain call from here to the stop: the reader is not sent
        // anything else while it runs.
        let window = Instant::now();
        let (mut polls, mut answers) = (0_u32, 0_u32);
        let until = Instant::now() + Duration::from_millis(u64::from(settings.window_ms));
        while Instant::now() < until {
            polls = polls.saturating_add(1);
            match next(sdk.drain, &mut reply) {
                Some(length) => {
                    answers = answers.saturating_add(1);
                    collect(sdk.drain, &reply[..length], &mut gathered)
                }
                None => std::thread::sleep(Duration::from_millis(5)),
            }
        }
        trace(
            format!("{}() x{polls} during the read window", sdk.drain.name()),
            window,
            format!("{answers} answers"),
        );
        // `UHFStopGet` answers 0 whatever happens too. The reader's
        // acknowledgement is the one sign it stopped: without it the SDK goes
        // back to polling the reader in the background.
        let stops = STOPS.load(Ordering::SeqCst);
        let asked = Instant::now();
        coded("UHFStopGet()", || unsafe { (sdk.stop)() });
        if !stop_heard(stops, asked + STOP_WAIT, watch) {
            let lost = link_lost(watch);
            if lost {
                log_lost(watch, "during a read");
            }
            // Told once more, straight. A reader that leaves that unanswered
            // too is closed, and opened again by the next read, which begins
            // with a stop.
            let closed = lost || !stop_raw(sdk, watch);
            if closed {
                reader.open = None;
            }
            reader.read_ended = Some(Instant::now());
            return Err(if lost {
                lost_mid_read(watch)
            } else {
                Fault::new(
                    &STOP_NOT_CONFIRMED,
                    format!(
                        "No stop acknowledgement (8D) came within {} ms of UHFStopGet; one more stop, sent straight, {}.",
                        STOP_WAIT.as_millis(),
                        if closed {
                            "went unanswered too, so the link was closed"
                        } else {
                            "was acknowledged"
                        }
                    ),
                )
            });
        }
        // What was already on its way when the reader stopped belongs to
        // this read.
        let after = Instant::now();
        let late = take_waiting(sdk, &mut reply, |record| {
            collect(sdk.drain, record, &mut gathered)
        });
        trace(
            format!("{}() after the stop", sdk.drain.name()),
            after,
            format!("{late} answers"),
        );
        reader.read_ended = Some(Instant::now());
        if link_lost(watch) {
            log_lost(watch, "during a read");
            reader.open = None;
            return Err(lost_mid_read(watch));
        }

        // TID bytes mean the reader went back to the output it has saved, as
        // a reset does — and so, it must be assumed, to its saved power,
        // filter and radio profile. Such a read cannot be shown to hold every
        // tag on the pad and only the pad's, so it is not used, and the next
        // read sets everything again first.
        if gathered.carried_tid {
            if let Some(open) = reader.open.as_mut() {
                open.reverted = true;
            }
            return Err(Fault::new(
                &WENT_BACK,
                "Records came with TID bytes: the reader went back to the output it has saved, \
                 and so, it must be assumed, to the rest of what it has saved.",
            ));
        }
        let power_dbm = reader
            .open
            .as_ref()
            .map_or(settings.power_dbm, |open| open.power_dbm);
        let unreadable = gathered.unreadable;
        let records = gathered.records();
        let (tags, left_out, canary) =
            gathered.finish(settings.min_rssi_dbm, settings.canary_epc.as_deref());
        let attention = check_tag_health(canary.as_ref());
        let read = PadRead {
            tags,
            too_weak: u32::try_from(left_out.len()).unwrap_or(u32::MAX),
            left_out,
            unreadable,
            records,
            power_dbm,
            window_ms: settings.window_ms,
            min_rssi_dbm: settings.min_rssi_dbm,
            firmware,
            profile,
            canary,
            attention,
            took_ms: ms(started.elapsed().saturating_sub(waited)),
            waited_ms: ms(waited),
        };
        super::note_read(&read);
        Ok(read)
    }

    /// The Test reader (`super::test_reader`): the reader closed and opened
    /// afresh, timed, its settings read back, then `CHECK_READS` reads.
    pub(super) fn test(app: &AppHandle, settings: Result<PadSettings, Fault>) -> ReaderTest {
        let mut reader = lock_reader();
        let settings = match settings {
            Ok(settings) => settings,
            Err(fault) => {
                reader.learn(Some(fault.clone()));
                return reader_test(&PadSettings::as_saved(app), Err(fault), None, Vec::new());
            }
        };
        // Closed first, and the gap after a close waited out before the
        // clock starts: the open timed is the one a till pays.
        reader.open = None;
        wait_after_close();
        let started = Instant::now();
        let opened: Result<(String, RadioProfile), Fault> = ready(app, &mut reader, &settings)
            .map(|open| (open.version.clone(), open.profile.report()));
        let open_ms = opened.is_ok().then(|| ms(started.elapsed()));
        let mut reads = Vec::new();
        if opened.is_ok() {
            for _ in 0..CHECK_READS {
                let read = read_locked(app, &mut reader, &settings);
                let failed = read.is_err();
                reads.push(read);
                if failed {
                    break;
                }
            }
        }
        let broke = opened
            .as_ref()
            .err()
            .cloned()
            .or_else(|| reads.iter().find_map(|read| read.as_ref().err().cloned()));
        let test = reader_test(&settings, opened, open_ms, reads);
        let said = check_from(&test, broke.is_some());
        reader.learn(broke);
        if let Some(verdict) = said {
            reader.checked(verdict);
        }
        eprintln!(
            "Chainway R3 Test reader {}: {}",
            if test.passed { "PASS" } else { "FAIL" },
            test.reason
        );
        test
    }

    /// Calibrate (`super::calibrate`): `CHECK_READS` reads of what is on the
    /// pad, the reader opened only if it is not open.
    pub(super) fn calibrate(app: &AppHandle, settings: Result<PadSettings, Fault>) -> Calibration {
        let mut reader = lock_reader();
        let settings = match settings {
            Ok(settings) => settings,
            Err(fault) => {
                reader.learn(Some(fault.clone()));
                return super::calibration(&PadSettings::as_saved(app), vec![Err(fault)]);
            }
        };
        let mut reads = Vec::new();
        for _ in 0..CHECK_READS {
            let read = read_locked(app, &mut reader, &settings);
            let failed = read.is_err();
            reads.push(read);
            if failed {
                break;
            }
        }
        let broke = reads.iter().find_map(|read| read.as_ref().err().cloned());
        reader.learn(broke);
        super::calibration(&settings, reads)
    }

    /// The driver and the reader, for the diagnostics bundle.
    pub(super) fn diagnostics() -> Vec<(&'static str, Vec<String>)> {
        let reader = lock_reader();
        let mut driver = Vec::new();
        match reader.sdk {
            None => driver.push("Not loaded yet".to_string()),
            Some(sdk) => {
                driver.push(format!("Loaded from {}", sdk.directory.display()));
                for name in ["UHFAPI.dll", "libusb-1.0.dll"] {
                    driver.push(file_line(name, &sha256_of(&sdk.directory.join(name))));
                }
                let lacks = sdk.lacks();
                driver.push(if lacks.is_empty() {
                    "Every call the till can use is there".to_string()
                } else {
                    format!("Without {}", lacks.join(", "))
                });
            }
        }
        let status = status_now(&reader);
        let mut held = vec![
            format!(
                "Status {:?}{}",
                status.state,
                status
                    .fault
                    .as_ref()
                    .map_or_else(String::new, |fault| format!(", {} {}", fault.code, fault.says))
            ),
            format!("Status detail {}", status.detail),
            format!(
                "Stop acknowledgements since loading {}; disconnect callbacks {}, the last naming link {}",
                STOPS.load(Ordering::SeqCst),
                LOST.count(None),
                LOST.last()
            ),
        ];
        if let Some(fault) = &reader.health {
            held.push(format!(
                "Last radio check failed: {} {} {}",
                fault.code, fault.says, fault.detail
            ));
        }
        match reader.open.as_ref() {
            None => held.push("No link open".into()),
            Some(open) => {
                let profile = open.profile.report();
                held.extend([
                    format!(
                        "Link {}, lost since it opened: {}",
                        link_name(open.watch),
                        if link_lost(open.watch) { "yes" } else { "no" }
                    ),
                    format!("Opened and set up in {} ms", open.opened_ms),
                    format!("Firmware {}", open.version),
                    format!("C8 answer {}", open.version_bytes),
                    format!("Power {} dBm, read back", open.power_dbm),
                    format!(
                        "Region {}",
                        profile.region.as_deref().unwrap_or("not read")
                    ),
                    format!(
                        "Channels {}",
                        profile.channels.as_deref().unwrap_or("not read")
                    ),
                    format!(
                        "Profile read back: FastID {}, Tag Focus {}, session {}, target {}, link {}{}",
                        if profile.fast_id { "on" } else { "off" },
                        if profile.tag_focus { "on" } else { "off" },
                        profile.session,
                        profile.target,
                        profile.rf_link,
                        profile
                            .rf_link_moved_from
                            .as_deref()
                            .map_or_else(String::new, |was| format!(", moved from {was}"))
                    ),
                    format!("Gen2 {}", open.profile.gen2.brief()),
                    format!(
                        "Work and wait {}",
                        profile.work_wait.as_deref().unwrap_or("not read")
                    ),
                    format!("At rest: {}", open.profile.rest.describe()),
                    format!(
                        "Reverted since the last set-up: {}",
                        if open.reverted { "yes" } else { "no" }
                    ),
                ]);
            }
        }
        vec![("Driver", driver), ("Reader", held)]
    }

    /// The SDK loaded and the reader open and set up for a read (`set_up`).
    ///
    /// A reader that stayed open is asked two questions before a read, and
    /// only two: the buzzer and the power. While the till holds the reader no
    /// other app can change it, and a reset puts back what the reader has
    /// saved: the buzzer on, and the power it has saved, which a counter
    /// reading only its pad seldom shares. Both as this till left them: the
    /// read goes ahead. Either moved, or the last read came back with TID
    /// bytes: everything is set again exactly as opening sets it. No answer,
    /// or a link the SDK has given up on: the reader is told to stop, the dead
    /// handle is closed and the reader opened again, which sets everything.
    fn ready<'r>(
        app: &AppHandle,
        reader: &'r mut Reader,
        settings: &PadSettings,
    ) -> Result<&'r mut Open, Fault> {
        let sdk = match reader.sdk {
            Some(sdk) => sdk,
            None => {
                let sdk = load(app)?;
                reader.sdk = Some(sdk);
                sdk
            }
        };
        // A link the SDK has given up on is not asked: it would take 1.5 s
        // to say nothing.
        let answers = reader.open.as_ref().map(|open| {
            if link_lost(open.watch) {
                log_lost(open.watch, "between reads");
                None
            } else {
                beep_and_power(open)
            }
        });
        if let Some(None) = answers {
            // Unplugged, asleep, or reading: a reader left in continuous
            // inventory answers nothing but stop, so it is told to stop
            // first, and the handle is closed whatever it answers. Closed
            // before the reader is opened again: the SDK holds one handle,
            // and closing the old one after would close the new.
            if let Some(open) = reader.open.as_ref().filter(|open| !link_lost(open.watch)) {
                stop_raw(open.sdk, open.watch);
            }
            reader.open = None;
        }
        if reader.open.is_none() {
            reader.open = Some(open_reader(sdk, settings)?);
        } else if let Some(open) = reader.open.as_mut() {
            if let Some(Some((beep, power))) = answers {
                if let Err(problem) = ready_again(open, settings, beep != 0, power) {
                    let problem = if link_lost(open.watch) {
                        log_lost(open.watch, "while being set again");
                        eprintln!("Chainway R3 lost while being set again: {problem}");
                        not_connected("the link was lost while it was being set up")
                    } else {
                        problem
                    };
                    reader.open = None;
                    return Err(problem);
                }
            }
        }
        // A module-only reset can leave both board buzzer and power unchanged.
        // Verify the actual inventory controls before every read, at rest.
        if let Some(open) = reader.open.as_ref() {
            let verified = profile_now(open.sdk, None)
                .map_err(|fault| fault.detail)
                .and_then(|fresh| {
                    let different = fresh.unpinned();
                    if different.is_empty() {
                        Ok(())
                    } else {
                        Err(different.join("; "))
                    }
                });
            if let Err(problem) = verified {
                // Discard this generation; the next request opens and pins it again.
                reader.open = None;
                return Err(Fault::new(
                    &CHANGED_SINCE_OPEN,
                    format!(
                        "The R3 profile could not be confirmed ({problem}). No pad read was started."
                    ),
                ));
            }
        }
        reader
            .open
            .as_mut()
            .ok_or_else(|| not_connected("it could not be opened"))
    }

    /// The buzzer and the power of a reader that stayed open, asked in that
    /// order. `None`: it did not answer one of them.
    fn beep_and_power(open: &Open) -> Option<(u8, u8)> {
        let (code, beep) = read_byte(open.sdk.get_beep, "UHFGetBeep()");
        if code != 0 {
            return None;
        }
        let (code, power) = read_byte(open.sdk.get_power, "UHFGetPower()");
        (code == 0).then_some((beep, power))
    }

    /// The reader opened, stopped and set up (`# Opening` in the module
    /// docs).
    fn open_reader(sdk: &'static Sdk, settings: &PadSettings) -> Result<Open, Fault> {
        wait_after_close();
        let started = Instant::now();
        let code = coded("UsbOpen()", || unsafe { (sdk.usb_open)() });
        // From here on, dropping `open` closes the link, whatever `UsbOpen`
        // answered: the SDK is never asked to open over a link it still holds.
        let mut open = Open {
            sdk,
            watch: LOST.watch(None),
            version: String::new(),
            version_bytes: String::new(),
            power_dbm: 0,
            profile: Profile::default(),
            reverted: false,
            opened_ms: 0,
        };
        if code != 0 {
            return Err(not_connected(&format!("UsbOpen answered R3 code {code}")));
        }
        // Watched from before the link is given its callback, so nothing the
        // SDK reports about it can be missed, and by its id, so nothing it
        // reports about a link closed before can count.
        let link = sdk.link_selected.and_then(|get| {
            let asked = Instant::now();
            let id = unsafe { get() };
            trace("LinkGetSelected()", asked, id.to_string());
            usize::try_from(id).ok()
        });
        open.watch = LOST.watch(link);
        // The SDK keeps one disconnect callback per link and forgets it once
        // it fires, so every new link is given it.
        if coded("SetDisconnectCallback(on_disconnect)", || unsafe {
            (sdk.set_disconnect)(on_disconnect)
        }) != 0
        {
            return Err(not_connected("the driver holds no open link"));
        }
        // A reader a previous run left in continuous inventory answers
        // nothing but stop, and `UHFStopGet` stops only an inventory this SDK
        // started, which on a new link is none: so the stop frame itself
        // goes first.
        let stopped = stop_raw(sdk, open.watch);
        if link_lost(open.watch) {
            log_lost(open.watch, "as it opened");
            return Err(not_connected("the driver found nothing behind the link"));
        }
        // `UsbOpen` answers 0 with no reader at all. An acknowledged stop, or
        // else an answer to the first question, shows one is there.
        if !stopped && read_byte(sdk.get_beep, "UHFGetBeep()").0 != 0 {
            return Err(not_connected("nothing answered once it was opened"));
        }
        if let Err(problem) = set_up(&mut open, settings) {
            if link_lost(open.watch) {
                log_lost(open.watch, "while being set up");
                eprintln!("Chainway R3 lost while being set up: {problem}");
                return Err(not_connected("the link was lost while it was being set up"));
            }
            return Err(problem);
        }
        open.opened_ms = ms(started.elapsed());
        Ok(open)
    }

    /// No reader answers on the link, with what showed it for whoever
    /// supports the till.
    fn not_connected(detail: &str) -> Fault {
        Fault::new(
            &NOT_CONNECTED,
            format!("The Chainway R3 is not connected ({detail})."),
        )
    }

    /// A reader that stayed open, once its buzzer and power have answered:
    /// left as it is when both are as this till left them, its power is this
    /// counter's and the last read did not show it reverted; set up again
    /// otherwise. A power this till did not set is a reset even when it
    /// happens to be the counter's new setting.
    fn ready_again(
        open: &mut Open,
        settings: &PadSettings,
        beeping: bool,
        power: u8,
    ) -> Result<(), Fault> {
        let reason = if beeping {
            "is beeping again"
        } else if power != open.power_dbm {
            "is at a power this till did not set"
        } else if power != settings.power_dbm {
            "is to read at this till's new power"
        } else if open.reverted {
            "came back with TID bytes"
        } else {
            return Ok(());
        };
        eprintln!("Chainway R3 {reason} ({power} dBm): everything is set again.");
        set_up(open, settings)
    }

    /// Everything this till sets in the reader, the same on opening and after
    /// a reset: the buzzer off, EPC-only output, this counter's power, no tag
    /// filter and the radio profile, with the firmware version read for
    /// Test read. Nothing is saved in the reader; whatever the SDK can read
    /// back is read back. A reader left reading is stopped before this, on
    /// opening (`open_reader`); one that answered the buzzer and the power
    /// after a reset is not reading.
    fn set_up(open: &mut Open, settings: &PadSettings) -> Result<(), Fault> {
        let sdk = open.sdk;
        mute(sdk)?;
        (open.version, open.version_bytes) = firmware(sdk);
        epc_only(sdk)?;
        open.power_dbm = set_power(sdk, settings.power_dbm)?;
        clear_filters(sdk)?;
        open.profile = pin_profile(sdk)?;
        open.reverted = false;
        Ok(())
    }

    fn sdk_directory(app: &AppHandle) -> Result<PathBuf, Fault> {
        let resource = app
            .path()
            .resource_dir()
            .map_err(|error| {
                Fault::new(
                    &DRIVER_MISSING,
                    format!("The till app's resource folder could not be opened: {error}"),
                )
            })?
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

        Err(Fault::new(
            &DRIVER_MISSING,
            format!(
                "UHFAPI.dll and libusb-1.0.dll are not both in {}.",
                resource.display()
            ),
        ))
    }

    /// Load the SDK for the life of the process.
    fn load(app: &AppHandle) -> Result<&'static Sdk, Fault> {
        let directory = sdk_directory(app)?;
        for name in RUNTIME {
            let path = directory.join(name);
            // A development folder may hold only the vendor's two DLLs; the
            // machine's own runtime is then the one Windows finds.
            if path.is_file() {
                keep(&path, "The Visual C++ runtime the R3 driver needs")?;
            }
        }
        keep(&directory.join("libusb-1.0.dll"), "The R3's USB library")?;
        let api = keep(&directory.join("UHFAPI.dll"), "The R3 driver")?;

        let sdk = Sdk {
            usb_open: symbol(api, b"UsbOpen\0")?,
            usb_close: symbol(api, b"UsbClose\0")?,
            link_selected: symbol(api, b"LinkGetSelected\0").ok(),
            set_disconnect: symbol(api, b"SetDisconnectCallback\0")?,
            send_bytes: symbol(api, b"SendBytes\0")?,
            set_beep: symbol(api, b"UHFSetBeep\0")?,
            get_beep: symbol(api, b"UHFGetBeep\0")?,
            get_version: symbol(api, b"UHFGetReaderVersion\0")?,
            set_power: symbol(api, b"UHFSetPower\0")?,
            get_power: symbol(api, b"UHFGetPower\0")?,
            set_mode: symbol(api, b"UHFSetEPCTIDUSERMode\0")?,
            set_filter: symbol(api, b"UHFSetFilter\0")?,
            set_fast_id: symbol(api, b"UHFSetFastID\0")?,
            get_fast_id: symbol(api, b"UHFGetFastID\0")?,
            set_tag_focus: symbol(api, b"UHFSetTagfocus\0")?,
            get_tag_focus: symbol(api, b"UHFGetTagfocus\0")?,
            set_gen2: symbol(api, b"UHFSetGen2\0")?,
            get_gen2: symbol(api, b"UHFGetGen2\0")?,
            set_rf_link: symbol(api, b"UHFSetRFLink\0")?,
            get_rf_link: symbol(api, b"UHFGetRFLink\0")?,
            inventory: symbol(api, b"UHFInventory\0")?,
            stop: symbol(api, b"UHFStopGet\0")?,
            drain: match symbol::<GetTagData>(api, b"UHFGetTagData\0") {
                Ok(cells) => Drain::Cells(cells),
                Err(_) => Drain::Received(symbol(api, b"UHF_GetReceived_EX\0")?),
            },
            set_fast_inventory: symbol(api, b"UHFSetFastInventory\0").ok(),
            get_fast_inventory: symbol(api, b"UHFGetFastInventory\0").ok(),
            set_work_time: symbol(api, b"UHFSetWorkTime\0").ok(),
            get_work_time: symbol(api, b"UHFGetWorkTime\0").ok(),
            get_antennas: symbol(api, b"UHFGetANT\0").ok(),
            get_protocol: symbol(api, b"UHFGetProtocolType\0").ok(),
            get_output: symbol(api, b"UHFGetEPCTIDUSERMode\0").ok(),
            get_region: symbol(api, b"UHFGetRegion\0").ok(),
            get_channels: symbol(api, b"UHFGetJumpFrequency\0").ok(),
            directory,
        };
        // The stop acknowledgement is one callback for every link, so it is
        // given once, here, for as long as the SDK stays loaded: for good.
        let set_stop_event: SetStopEvent = symbol(api, b"setOnEventStopInventory\0")?;
        unsafe { set_stop_event(on_stop) };
        // Both off by default; said off here so a till never writes logs into
        // its install folder whatever a later DLL defaults to.
        if let Ok(level) = symbol::<SetLogLevel>(api, b"SetLogLevel\0") {
            unsafe { level(0) };
        }
        if let Ok(save) = symbol::<SaveLogFile>(api, b"SaveLogFile\0") {
            unsafe { save(0) };
        }
        Ok(Box::leak(Box::new(sdk)))
    }

    /// Load one library by its full path and keep it loaded for good.
    fn keep(path: &Path, what: &str) -> Result<&'static Library, Fault> {
        let library = unsafe { Library::new(path) }.map_err(|error| {
            Fault::new(
                &DRIVER_NOT_LOADED,
                format!(
                    "{what} could not be loaded from {}: {error}",
                    path.display()
                ),
            )
        })?;
        Ok(Box::leak(Box::new(library)))
    }

    fn symbol<T: Copy>(api: &'static Library, name: &[u8]) -> Result<T, Fault> {
        unsafe { api.get::<T>(name) }
            .map(|found| *found)
            .map_err(|error| {
                let name = String::from_utf8_lossy(name.strip_suffix(b"\0").unwrap_or(name));
                Fault::new(
                    &DRIVER_UNKNOWN,
                    format!("The R3 driver has no {name}: {error}"),
                )
            })
    }

    /// A file's SHA-256, for the diagnostics bundle.
    fn sha256_of(path: &Path) -> String {
        use sha2::{Digest, Sha256};
        match std::fs::read(path) {
            Ok(bytes) => hex_lower(Sha256::digest(&bytes).as_slice()),
            Err(error) => format!("not read ({error})"),
        }
    }

    /// One byte the SDK writes back, into a buffer it cannot overrun. Filled
    /// with 0xFF first, a value none of these settings has, so a byte the SDK
    /// did not write can never pass for "off".
    fn read_byte(get: ReadInto, what: &str) -> (c_int, u8) {
        let mut reply = [u8::MAX; REPLY];
        let started = Instant::now();
        let code = unsafe { get(reply.as_mut_ptr()) };
        trace(what, started, format!("{code}, {:02X}", reply[0]));
        (code, reply[0])
    }

    /// One byte from a getter the DLL may lack, which answers 0 when it read
    /// it. `None`: no such getter, or no answer.
    fn byte_from(get: Option<ReadInto>, what: &str) -> Option<u8> {
        let (code, value) = read_byte(get?, what);
        (code == 0).then_some(value)
    }

    /// The first `N` bytes from a getter the DLL may lack, when it answers
    /// `read`, its own way of saying it read them.
    fn bytes_from<const N: usize>(
        get: Option<ReadInto>,
        read: c_int,
        what: &str,
    ) -> Option<[u8; N]> {
        let get = get?;
        let mut reply = [u8::MAX; REPLY];
        let started = Instant::now();
        let code = unsafe { get(reply.as_mut_ptr()) };
        trace(
            what,
            started,
            format!("{code}, {}", super::hex_spaced(&reply[..N])),
        );
        if code != read {
            return None;
        }
        let mut bytes = [0_u8; N];
        bytes.copy_from_slice(&reply[..N]);
        Some(bytes)
    }

    fn mute(sdk: &Sdk) -> Result<(), Fault> {
        let set = coded("UHFSetBeep(0)", || unsafe { (sdk.set_beep)(0) });
        let (get, mode) = read_byte(sdk.get_beep, "UHFGetBeep()");
        if set != 0 || get != 0 || mode != 0 {
            return Err(Fault::new(
                &BUZZER_NOT_OFF,
                format!(
                    "Reading stopped: the R3's buzzer could not be confirmed off (set {set}, read {get}, mode {mode})."
                ),
            ));
        }
        Ok(())
    }

    /// The firmware version as the reader reports it (`C8`), for Test read and
    /// the log, with the bytes the SDK handed back. Never a reason to refuse
    /// the reader: the SDK opens only VID 0x2047 / PID 0x0301, so a reader
    /// answering on the link is an R3 or an R3S whatever this says. One that
    /// cannot be read is logged and shown as not read.
    fn firmware(sdk: &Sdk) -> (String, String) {
        let mut reply = [0_u8; REPLY];
        let started = Instant::now();
        let code = unsafe { (sdk.get_version)(reply.as_mut_ptr()) };
        if code != 0 {
            trace("UHFGetReaderVersion()", started, code.to_string());
            eprintln!("Chainway R3 firmware could not be read. {}", said(code));
            return ("not read".into(), String::new());
        }
        let (version, bytes) = version_reply(&reply);
        trace("UHFGetReaderVersion()", started, format!("{code}, {bytes}"));
        eprintln!("Chainway R3 firmware “{version}”, as the SDK answered it: {bytes}");
        (version, bytes)
    }

    /// EPC-only output, not saved in the reader: memory 0 (`setEPCMode` in the
    /// SDK's `UHFAPI.cs`), no USER area. A reader left in EPC+TID output spends
    /// every tag on a second read, and a tag that answers the first and not the
    /// second is a garment the pad never reports.
    fn epc_only(sdk: &Sdk) -> Result<(), Fault> {
        let code = coded("UHFSetEPCTIDUSERMode(0, 0, 0, 0)", || unsafe {
            (sdk.set_mode)(0, 0, 0, 0)
        });
        if code != 0 {
            return Err(Fault::new(
                &EPC_ONLY_NOT_SET,
                format!(
                    "The R3 could not be switched to reading EPCs only. {}",
                    said(code)
                ),
            ));
        }
        Ok(())
    }

    fn power_now(sdk: &Sdk) -> Result<u8, Fault> {
        let (code, power) = read_byte(sdk.get_power, "UHFGetPower()");
        if code != 0 {
            return Err(Fault::new(
                &POWER_NOT_SET,
                format!("The R3's power could not be read. {}", said(code)),
            ));
        }
        Ok(power)
    }

    /// This counter's power, not saved in the reader (`save` 0), and read back:
    /// a power the reader did not take is a reach nobody chose.
    fn set_power(sdk: &Sdk, wanted: u8) -> Result<u8, Fault> {
        let code = coded(&format!("UHFSetPower(0, {wanted})"), || unsafe {
            (sdk.set_power)(0, wanted)
        });
        if code != 0 {
            return Err(Fault::new(
                &POWER_NOT_SET,
                format!(
                    "The R3's power could not be set to {wanted} dBm. {}",
                    said(code)
                ),
            ));
        }
        let now = power_now(sdk)?;
        if now != wanted {
            return Err(Fault::new(
                &POWER_NOT_SET,
                format!(
                    "The R3 was set to {wanted} dBm but reads back {now} dBm, so it is not used."
                ),
            ));
        }
        Ok(now)
    }

    /// This counter's radio profile, pinned before any inventory (`# The
    /// radio profile` in the module docs): each setting set and read back,
    /// then all of them asked once more, then what this till leaves alone
    /// read once, and the region and channels last. All of it at rest: the
    /// SDK checks only the first frame of each chunk the reader sends, so
    /// tags arriving mid-inventory could hide a getter's answer.
    fn pin_profile(sdk: &Sdk) -> Result<Profile, Fault> {
        eprintln!("Chainway R3 applying {}", crate::peripherals::R3_PROFILE_ID);
        // Asked first only so the log can say what another app left behind.
        let fast_id_was = flag_now(sdk.get_fast_id, "FastID");
        let tag_focus_was = flag_now(sdk.get_tag_focus, "Tag Focus");
        let fast_inventory_was = byte_from(sdk.get_fast_inventory, "UHFGetFastInventory()");
        // Asked first because setting the wait keeps the work time read here.
        let duty_was = duty_now(sdk);
        // The RF link first and the Gen2 settings last, so that the session
        // and target are read back after every other setting is made.
        let link_was = rf_link_now(sdk)?;
        let rf_link = pin_rf_link(sdk, link_was)?;
        switch_off(sdk.set_fast_id, sdk.get_fast_id, "FastID")?;
        switch_off(sdk.set_tag_focus, sdk.get_tag_focus, "Tag Focus")?;
        fast_inventory_off(sdk);
        let duty = wait_off(sdk, duty_was);
        let gen2_was = gen2_now(sdk)?;
        write_gen2(sdk, gen2_was.pinned())?;
        // A reader that moved one setting while taking another is not read
        // with.
        let mut profile = profile_now(sdk, (rf_link != link_was).then_some(link_was))?;
        let off = profile.unpinned();
        if !off.is_empty() {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!(
                    "The R3 did not keep this till's radio settings once all of them were made ({}), so it is not used.",
                    off.join("; ")
                ),
            ));
        }
        let rest = rest_now(sdk, duty);
        let refused = rest.refused();
        if !refused.is_empty() {
            eprintln!("Chainway R3 refused, as it holds: {}", rest.describe());
            return Err(Fault::new(
                &HOLDS_RISKY_SETTINGS,
                format!(
                    "The R3 holds settings that can leave a garment off the basket ({}), so it is not used.",
                    refused.join("; ")
                ),
            ));
        }
        profile.antennas = rest.antennas;
        profile.duty = rest.duty;
        profile.wait_was = duty_was.map(|(_, wait)| wait).filter(|wait| *wait != 0);
        profile.rest = rest;
        profile.region = byte_from(sdk.get_region, "UHFGetRegion()");
        let channels = channels_now(sdk);
        profile.channels = channels.as_deref().map(Channels::of);
        let was = |flag: Result<bool, Fault>| match flag {
            Ok(true) => "on",
            Ok(false) => "off",
            Err(_) => "unread",
        };
        eprintln!(
            "Chainway R3 radio profile: FastID {} -> off, Tag Focus {} -> off, \
             session {} -> S0, target {} -> A, link {} -> {}; Gen2 now {:?}",
            was(fast_id_was),
            was(tag_focus_was),
            gen2_was.session(),
            gen2_was.target(),
            describe_link(link_was),
            describe_link(profile.rf_link),
            profile.gen2,
        );
        eprintln!(
            "Chainway R3 at rest: Fast Inventory before {}, work/wait before {}; {}",
            fast_inventory_was.map_or_else(|| "unread".to_string(), |value| value.to_string()),
            duty_was.map_or_else(
                || "unread".to_string(),
                |(work, wait)| format!("{work}/{wait} ms")
            ),
            rest.describe(),
        );
        eprintln!(
            "Chainway R3 region {}, channels {}",
            profile
                .region
                .map_or_else(|| "unread".to_string(), describe_region),
            channels.map_or_else(
                || "unread".to_string(),
                |khz| format!("{} (kHz {khz:?})", Channels::of(&khz).describe())
            ),
        );
        Ok(profile)
    }

    /// Fast Inventory off, not saved in the reader (`UHFSetFastInventory`,
    /// save 0, enable 0). A DLL without the call, or a reader that does not
    /// take it, is only logged: what decides is the reading back (`Rest`).
    fn fast_inventory_off(sdk: &Sdk) {
        let Some(set) = sdk.set_fast_inventory else {
            eprintln!("Chainway R3: this driver cannot set Fast Inventory, so it is only read.");
            return;
        };
        let code = coded("UHFSetFastInventory(0, 0)", || unsafe { set(0, 0) });
        if code != 0 {
            eprintln!(
                "Chainway R3 did not take Fast Inventory off; it is read back. {}",
                said(code)
            );
        }
    }

    /// The work and wait time the reader holds now. `None`: the DLL has no
    /// `UHFGetWorkTime`, or the reader did not answer, which is logged with
    /// the rest and never held against it.
    fn duty_now(sdk: &Sdk) -> Option<(u16, u16)> {
        // 4, the bytes it wrote, when it read them (`UHFAPI.h`).
        bytes_from::<4>(sdk.get_work_time, 4, "UHFGetWorkTime()").map(duty)
    }

    /// The work and wait time a read runs with: a wait other than 0 set to 0,
    /// not saved in the reader (`UHFSetWorkTime`, save 0), with the work time
    /// kept as the reader held it, then read back. A wait unread, or one that
    /// is 0 already, is left alone. A DLL without the call, or a reader that
    /// does not take it, is only logged: what decides is the reading back,
    /// and a wait that still reads other than 0 refuses the reader (`Rest`).
    fn wait_off(sdk: &Sdk, was: Option<(u16, u16)>) -> Option<(u16, u16)> {
        let (work, wait) = was?;
        if wait == 0 {
            return was;
        }
        eprintln!("Chainway R3 waits {wait} ms after each {work} ms of reading: the wait is set to 0, not saved.");
        let Some(set) = sdk.set_work_time else {
            eprintln!(
                "Chainway R3: this driver cannot set the wait time, so it stays at {wait} ms."
            );
            return was;
        };
        let [work_high, work_low] = work.to_be_bytes();
        let code = coded(
            &format!("UHFSetWorkTime(0, {work_high}, {work_low}, 0, 0)"),
            || unsafe { set(0, work_high, work_low, 0, 0) },
        );
        if code != 0 {
            eprintln!(
                "Chainway R3 did not take a wait time of 0; it is read back. {}",
                said(code)
            );
        }
        duty_now(sdk)
    }

    /// The settings this till reads but does not pin, each asked once, with
    /// the work and wait time as `wait_off` left them.
    fn rest_now(sdk: &Sdk, duty: Option<(u16, u16)>) -> Rest {
        Rest {
            fast_inventory: byte_from(sdk.get_fast_inventory, "UHFGetFastInventory()"),
            duty,
            // The SDK copies the first two bytes of the answer as they came:
            // there is no status byte to check.
            antennas: bytes_from::<2>(sdk.get_antennas, 0, "UHFGetANT()"),
            protocol: byte_from(sdk.get_protocol, "UHFGetProtocolType()"),
            output: sdk.get_output.and_then(|get| {
                let mut reply = [u8::MAX; REPLY];
                // Two reserved bytes, both 0; 3, the bytes it wrote, when it
                // read them (`UHFAPI.h`).
                let started = Instant::now();
                let code = unsafe { get(0, 0, reply.as_mut_ptr()) };
                trace(
                    "UHFGetEPCTIDUSERMode(0, 0)",
                    started,
                    format!("{code}, {}", super::hex_spaced(&reply[..3])),
                );
                (code == 3).then(|| [reply[0], reply[1], reply[2]])
            }),
        }
    }

    /// The channels the reader hops over, in kHz. `None`: the DLL has no
    /// `UHFGetJumpFrequency`, or the reader did not answer.
    fn channels_now(sdk: &Sdk) -> Option<Vec<u32>> {
        let get = sdk.get_channels?;
        let mut reply = [0_u32; REPLY / 4];
        let started = Instant::now();
        let code = unsafe { get(reply.as_mut_ptr()) };
        trace(
            "UHFGetJumpFrequency()",
            started,
            format!("{code}, {} channels", reply[0]),
        );
        if code != 0 {
            return None;
        }
        channels_in(&reply).map(<[u32]>::to_vec)
    }

    /// No tag filter, for this session only (`save` 0), the way the vendor
    /// demo resets one: a filter of length 0 on each of the EPC, TID and USER
    /// banks, from bit 4, with the data `{0}` (`ReadEPCForm.cs`). A filter
    /// another app saved in the reader hides every tag it does not match, and
    /// the SDK cannot read one back, so each answer is all there is to check.
    fn clear_filters(sdk: &Sdk) -> Result<(), Fault> {
        for (bank, name) in [(1, "EPC"), (2, "TID"), (3, "USER")] {
            let mut data = [0_u8; 1];
            let code = coded(&format!("UHFSetFilter(0, {bank}, 4, 0, 00)"), || unsafe {
                (sdk.set_filter)(0, bank, 4, 0, data.as_mut_ptr())
            });
            if code != 0 {
                return Err(Fault::new(
                    &FILTER_NOT_CLEARED,
                    format!(
                        "The R3's tag filter on its {name} memory could not be cleared, and a filter can hide tags on the pad, so it is not used. {}",
                        said(code)
                    ),
                ));
            }
        }
        Ok(())
    }

    /// The radio profile as the reader holds it now, each setting asked once.
    /// The antenna mask, the work and wait time, the region and the channels
    /// are left to `pin_profile`, which reads them last.
    fn profile_now(sdk: &Sdk, rf_link_was: Option<u8>) -> Result<Profile, Fault> {
        Ok(Profile {
            fast_id: flag_now(sdk.get_fast_id, "FastID")?,
            tag_focus: flag_now(sdk.get_tag_focus, "Tag Focus")?,
            gen2: gen2_now(sdk)?,
            rf_link: rf_link_now(sdk)?,
            rf_link_was,
            region: None,
            channels: None,
            antennas: None,
            duty: None,
            wait_was: None,
            rest: Rest::default(),
        })
    }

    /// The SDK's setter and getter for one of the reader's on/off features,
    /// by the name this file gives the feature, for the diagnostics bundle.
    fn flag_calls(feature: &str) -> (&'static str, &'static str) {
        match feature {
            "FastID" => ("UHFSetFastID(0)", "UHFGetFastID()"),
            "Tag Focus" => ("UHFSetTagfocus(0)", "UHFGetTagfocus()"),
            _ => ("set(0)", "get()"),
        }
    }

    /// Whether one of the reader's on/off features is on.
    fn flag_now(get: ReadInto, feature: &str) -> Result<bool, Fault> {
        let (code, value) = read_byte(get, flag_calls(feature).1);
        if code != 0 {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!(
                    "The R3's {feature} setting could not be read. {}",
                    said(code)
                ),
            ));
        }
        Ok(value != 0)
    }

    /// One of the reader's on/off features switched off and read back as
    /// off. Neither call takes a save flag (`UHFAPI.h`).
    fn switch_off(set: SetFlag, get: ReadInto, feature: &str) -> Result<(), Fault> {
        let (setter, getter) = flag_calls(feature);
        let set_code = coded(setter, || unsafe { set(0) });
        let (read, value) = read_byte(get, getter);
        if set_code != 0 || read != 0 || value != 0 {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!(
                    "Reading stopped: the R3's {feature} could not be confirmed off (set {set_code}, read {read}, value {value})."
                ),
            ));
        }
        Ok(())
    }

    fn gen2_now(sdk: &Sdk) -> Result<Gen2, Fault> {
        let mut gen2 = Gen2::UNREAD;
        let started = Instant::now();
        let code = unsafe {
            (sdk.get_gen2)(
                &mut gen2.select_target,
                &mut gen2.select_action,
                &mut gen2.select_truncate,
                &mut gen2.q_algorithm,
                &mut gen2.start_q,
                &mut gen2.min_q,
                &mut gen2.max_q,
                &mut gen2.query_dr,
                &mut gen2.query_m,
                &mut gen2.query_trext,
                &mut gen2.query_sel,
                &mut gen2.query_session,
                &mut gen2.query_target,
                &mut gen2.link_frequency,
            )
        };
        trace("UHFGetGen2()", started, format!("{code}, {}", gen2.brief()));
        if code != 0 {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!("The R3's Gen2 settings could not be read. {}", said(code)),
            ));
        }
        Ok(gen2)
    }

    /// These Gen2 settings written, and read back field for field.
    /// `UHFSetGen2` takes no save flag (`UHFAPI.h`).
    fn write_gen2(sdk: &Sdk, wanted: Gen2) -> Result<Gen2, Fault> {
        let started = Instant::now();
        let code = unsafe {
            (sdk.set_gen2)(
                wanted.select_target,
                wanted.select_action,
                wanted.select_truncate,
                wanted.q_algorithm,
                wanted.start_q,
                wanted.min_q,
                wanted.max_q,
                wanted.query_dr,
                wanted.query_m,
                wanted.query_trext,
                wanted.query_sel,
                wanted.query_session,
                wanted.query_target,
                wanted.link_frequency,
            )
        };
        trace(
            format!("UHFSetGen2({})", wanted.brief()),
            started,
            code.to_string(),
        );
        if code != 0 {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!(
                    "The R3 could not be set to session {}, target {}. {}",
                    wanted.session(),
                    wanted.target(),
                    said(code)
                ),
            ));
        }
        let back = gen2_now(sdk)?;
        if (back.query_session, back.query_target) != (wanted.query_session, wanted.query_target) {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!(
                    "The R3 was set to session {}, target {} but reads back session {}, target {}, so it is not used.",
                    wanted.session(),
                    wanted.target(),
                    back.session(),
                    back.target()
                ),
            ));
        }
        if back != wanted {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                "The R3's Gen2 settings did not read back as they were written, so it is not used.",
            ));
        }
        Ok(back)
    }

    fn rf_link_now(sdk: &Sdk) -> Result<u8, Fault> {
        let (code, mode) = read_byte(sdk.get_rf_link, "UHFGetRFLink()");
        if code != 0 {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!(
                    "The R3's radio link could not be read, so a Gen2X link cannot be ruled out and the R3 is not used. {}",
                    said(code)
                ),
            ));
        }
        Ok(mode)
    }

    /// One plain Gen2 link on every counter, without saving it in the reader,
    /// then read back. Gen2X, Autoset and other Gen2 links are all replaced.
    fn pin_rf_link(sdk: &Sdk, found: u8) -> Result<u8, Fault> {
        if found == RECIPE_RF_LINK {
            return Ok(found);
        }
        let wanted = RECIPE_RF_LINK;
        let code = coded(&format!("UHFSetRFLink(0, {wanted})"), || unsafe {
            (sdk.set_rf_link)(0, wanted)
        });
        if code != 0 {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!(
                    "The R3 is on radio link {}, and could not be moved to the recipe's {}. {}",
                    describe_link(found),
                    describe_link(wanted),
                    said(code)
                ),
            ));
        }
        let now = rf_link_now(sdk)?;
        if now != wanted {
            return Err(Fault::new(
                &PROFILE_NOT_HELD,
                format!(
                    "The R3 was moved to {} but reads back {}, so it is not used.",
                    describe_link(wanted),
                    describe_link(now)
                ),
            ));
        }
        Ok(now)
    }

    /// The stop frame sent straight to the reader, and whether the reader
    /// acknowledged it within `STOP_WAIT`. This is the stop for a reader the
    /// SDK did not set reading: `UHFStopGet` sends one only on a link where
    /// this SDK started the inventory. Only for an open link: the SDK sends
    /// it on whatever link is current without checking there is one.
    fn stop_raw(sdk: &Sdk, watch: LinkWatch) -> bool {
        let stops = STOPS.load(Ordering::SeqCst);
        let until = Instant::now() + STOP_WAIT;
        let length = STOP_FRAME.len() as c_int;
        let sent = coded("SendBytes(A5 5A 00 08 8C 84 0D 0A)", || unsafe {
            (sdk.send_bytes)(STOP_FRAME.as_ptr(), length)
        });
        if sent != length {
            return false;
        }
        stop_heard(stops, until, watch)
    }

    /// Whether a stop acknowledgement has come since `stops` was counted,
    /// waiting for one until `until`. The acknowledgement carries no status,
    /// so any `8D` counts. A link the SDK gives up on ends the wait at once.
    fn stop_heard(stops: u64, until: Instant, watch: LinkWatch) -> bool {
        let started = Instant::now();
        let heard = loop {
            if STOPS.load(Ordering::SeqCst) != stops {
                break true;
            }
            if link_lost(watch) || Instant::now() >= until {
                break false;
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        trace(
            "8D stop acknowledgement",
            started,
            if heard {
                "heard"
            } else if link_lost(watch) {
                "not heard: the link was given up on"
            } else {
                "not heard in time"
            },
        );
        heard
    }

    /// The next record waiting in the SDK, as a length into `reply`. `None`
    /// when nothing is waiting, and also when the SDK dropped the record it
    /// took (`UHFGetTagData` answers −1 for both), so one `None` does not show
    /// the queue is empty (`take_waiting`).
    fn next(drain: Drain, reply: &mut [u8; REPLY]) -> Option<usize> {
        let length = match drain {
            Drain::Cells(get) => unsafe { get(reply.as_mut_ptr(), REPLY as c_int) },
            Drain::Received(get) => {
                let mut length: c_int = 0;
                let code = unsafe { get(&mut length, reply.as_mut_ptr()) };
                if code != 0 {
                    return None;
                }
                length
            }
        };
        // Never trust a length past the buffer.
        usize::try_from(length)
            .ok()
            .filter(|length| *length > 0)
            .map(|length| length.min(REPLY))
    }

    fn collect(drain: Drain, record: &[u8], gathered: &mut Gathered) {
        match drain {
            Drain::Cells(_) => {
                for heard in heard_in_cells(record) {
                    gathered.add(heard);
                }
            }
            Drain::Received(_) => gathered.add(heard_in_received(record)),
        }
    }

    /// Hand every record waiting in the SDK, and every one still arriving, to
    /// `each`, until the queue has stayed empty for `QUIET`; bounded so a
    /// reader that never stops talking cannot hold the till. Answers how many
    /// it handed on.
    fn take_waiting(sdk: &Sdk, reply: &mut [u8; REPLY], mut each: impl FnMut(&[u8])) -> u32 {
        let until = Instant::now() + Duration::from_millis(300);
        let mut heard_at = Instant::now();
        let mut taken = 0_u32;
        for _ in 0..2048 {
            let now = Instant::now();
            if now >= until {
                return taken;
            }
            match next(sdk.drain, reply) {
                Some(length) => {
                    each(&reply[..length]);
                    taken = taken.saturating_add(1);
                    heard_at = Instant::now();
                }
                None if now.duration_since(heard_at) >= QUIET => return taken,
                None => std::thread::sleep(Duration::from_millis(2)),
            }
        }
        taken
    }

    /// What an SDK answer means, in the cashier's words, with the number kept
    /// for whoever supports the till. This DLL's UHF calls answer 0 or −1
    /// (two getters answer the byte count they read): −1 for a refusal, an
    /// answer it could not read and silence alike, the last after the 1500 ms
    /// it waits for every answer, and nothing tells them apart.
    fn said(code: c_int) -> String {
        let meaning = match code {
            -1 => "The reader refused it, or did not answer within 1.5 seconds.",
            _ => "The reader reported an error.",
        };
        format!("{meaning} (R3 code {code})")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        bundle, calibration, channels_in, check_from, check_tag_health, count, describe_duty,
        describe_link, describe_region, duty, epc_hex, file_line, heard_in_cells,
        heard_in_received, hex_lower, keep_last, mhz, plain_twin, read_line, reader_test,
        status_from, utc, version_reply, Call, CanaryRead, Channels, Fault, Gathered, Gen2, Heard,
        Journal, LostLinks, PadRead, PadSettings, PadTag, Profile, RadioProfile, ReaderState,
        ReaderStatus, Rest, SeenTag, WeakTag, CALLS_KEPT, CATALOGUE, CHECK_TAG_FAINT, FAULTS_KEPT,
        NOTHING_HEARD, NOT_CONNECTED, REGIONS, RF_LINKS, STOP_FRAME, STOP_NOT_CONFIRMED,
    };

    const EPC_96: [u8; 12] = [
        0xa0, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12,
    ];

    fn confirmed_profile() -> Profile {
        Profile {
            gen2: Gen2::default().pinned(),
            rf_link: super::RECIPE_RF_LINK,
            ..Profile::default()
        }
    }

    #[test]
    fn strips_the_gen2_pc_word_from_a_chainway_uii() {
        let mut uii = vec![0x30, 0x00]; // six 16-bit EPC words follow
        uii.extend(EPC_96);
        assert_eq!(epc_hex(&uii), Ok("A01234567890123456789012".to_string()));
    }

    #[test]
    fn refuses_a_record_whose_pc_word_disagrees_with_its_epc() {
        assert!(epc_hex(&[]).is_err());
        assert!(epc_hex(&[0x30]).is_err());
        // Twelve bytes with no PC word: the length field would say 20 words.
        assert!(epc_hex(&EPC_96).is_err());
        assert!(epc_hex(&[0x00; 14]).is_err());
        let mut short = vec![0x30, 0x00];
        short.extend(&EPC_96[..10]);
        assert!(epc_hex(&short).is_err());
    }

    #[test]
    fn reads_the_vendors_own_tag_data_example() {
        // `GetTagData` in the SDK's `UHFAPI.cs`: link id, PC, EPC, TID, RSSI,
        // antenna — the PC says five words and ten EPC bytes follow.
        let answer = [
            0x01, 0x02, 0x00, 0x01, //
            0x03, 0x02, 0x28, 0x00, //
            0x06, 0x0a, 0x00, 0x00, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34, 0x34, //
            0x07, 0x04, 0x00, 0x00, 0x00, 0x00, //
            0x04, 0x02, 0xfd, 0xd9, //
            0x05, 0x01, 0x01,
        ];
        assert_eq!(
            heard_in_cells(&answer),
            vec![Ok(Heard {
                epc: "00003434343434343434".into(),
                rssi_tenths: Some(-550),
                carried_tid: true,
            })]
        );
    }

    #[test]
    fn splits_an_answer_that_packs_two_tags() {
        let mut answer = Vec::new();
        for last in [0x01, 0x02] {
            answer.extend([0x03, 0x02, 0x30, 0x00, 0x06, 0x0c]);
            answer.extend(&EPC_96[..11]);
            answer.push(last);
            answer.extend([0x04, 0x02, 0xfe, 0x70]);
        }
        let heard = heard_in_cells(&answer);
        assert_eq!(heard.len(), 2);
        assert_eq!(
            heard[1],
            Ok(Heard {
                epc: "A01234567890123456789002".into(),
                rssi_tenths: Some(-399),
                carried_tid: false,
            })
        );
    }

    #[test]
    fn refuses_a_cut_short_or_incomplete_answer() {
        assert!(matches!(
            heard_in_cells(&[0x06, 0x0c, 0xa0]).as_slice(),
            [Err(_)]
        ));
        // An EPC with no PC word cannot be checked, so it is not read.
        let mut no_pc = vec![0x06, 0x0c];
        no_pc.extend(EPC_96);
        assert!(matches!(heard_in_cells(&no_pc).as_slice(), [Err(_)]));
    }

    #[test]
    fn reads_the_received_ex_layout() {
        let mut answer = vec![14, 0x30, 0x00];
        answer.extend(EPC_96);
        answer.extend([0, 0xfe, 0xd6, 0x01]);
        assert_eq!(
            heard_in_received(&answer),
            Ok(Heard {
                epc: "A01234567890123456789012".into(),
                rssi_tenths: Some(-297),
                carried_tid: false,
            })
        );
        assert!(heard_in_received(&answer[..10]).is_err());
    }

    #[test]
    fn keeps_each_epc_once_with_its_strongest_signal_above_the_floor() {
        let heard = |epc: &str, rssi: Option<i32>| {
            Ok(Heard {
                epc: epc.into(),
                rssi_tenths: rssi,
                carried_tid: false,
            })
        };
        let mut gathered = Gathered::default();
        gathered.add(heard("AA", Some(-600)));
        gathered.add(heard("AA", Some(-505)));
        gathered.add(heard("BB", Some(-450)));
        gathered.add(heard("CC", Some(-800)));
        gathered.add(heard("DD", None));
        gathered.add(heard("EE", Some(-731)));
        gathered.add(Err("cut short".into()));
        assert_eq!(gathered.unreadable, 1);
        // Six records of five EPCs, and the one that could not be read.
        assert_eq!(gathered.records(), 7);
        let (tags, left_out, canary) = gathered.finish(-70, None);
        assert_eq!(canary, None);
        let kept: Vec<(&str, f64, u32)> = tags
            .iter()
            .map(|tag| (tag.epc.as_str(), tag.rssi_dbm, tag.reads))
            .collect();
        assert_eq!(kept, vec![("BB", -45.0, 1), ("AA", -50.5, 2)]);
        // Left out with their signal, strongest first, so Test read can show
        // where to set the floor; no signal at all comes last.
        assert_eq!(
            left_out,
            vec![
                WeakTag {
                    epc: "EE".into(),
                    rssi_dbm: Some(-73.1),
                    reads: 1,
                },
                WeakTag {
                    epc: "CC".into(),
                    rssi_dbm: Some(-80.0),
                    reads: 1,
                },
                WeakTag {
                    epc: "DD".into(),
                    rssi_dbm: None,
                    reads: 1,
                },
            ]
        );
    }

    #[test]
    fn counts_a_lost_link_only_against_that_link() {
        let lost = LostLinks::new();
        let old = lost.watch(Some(4));
        // The old link is closed and a new one opened; the old one's call
        // can still come after that, and must not mark the new one.
        let new = lost.watch(Some(5));
        lost.record(4);
        assert!(lost.lost(old));
        assert!(!lost.lost(new));
        lost.record(5);
        assert!(lost.lost(new));
        assert_eq!(lost.last(), 5);
        // A link whose id is not known: any call counts.
        let unknown = lost.watch(None);
        assert!(!lost.lost(unknown));
        lost.record(9);
        assert!(lost.lost(unknown));
        // An id past the slots, or none, never marks a known link.
        let named = lost.watch(Some(7));
        lost.record(300);
        lost.record(-1);
        assert!(!lost.lost(named));
        assert_eq!(lost.watch(Some(256)).link, None);
    }

    #[test]
    fn replaces_inherited_filters_slots_and_session_but_keeps_link_timing() {
        let found = Gen2 {
            select_target: 4,
            select_action: 3,
            select_truncate: 1,
            q_algorithm: 1,
            start_q: 4,
            min_q: 2,
            max_q: 15,
            query_dr: 1,
            query_m: 2,
            query_trext: 1,
            query_sel: 3,
            query_session: 2,
            query_target: 1,
            link_frequency: 3,
        };
        assert!(!found.is_pinned());
        let pinned = found.pinned();
        assert!(pinned.is_pinned());
        assert_eq!(
            pinned,
            Gen2 {
                select_target: 4,
                select_action: 0,
                select_truncate: 0,
                q_algorithm: 1,
                start_q: 6,
                min_q: 0,
                max_q: 15,
                query_sel: 0,
                query_session: 0,
                query_target: 0,
                ..found
            }
        );
        // The header's `Target` is Select SL; the Query asks all tags, ignoring SL.
        assert_eq!(pinned.select_target, 4);
        assert_eq!(pinned.session(), "S0");
        assert_eq!(pinned.target(), "A");
        // Nothing the SDK left unwritten passes for S0 or A.
        assert!(!Gen2::UNREAD.is_pinned());
        assert!(!Gen2::UNREAD.pinned().is_pinned());
    }

    #[test]
    fn moves_each_gen2x_link_to_the_pr_ask_mode_with_its_miller_and_frequency() {
        let mut modes: Vec<u8> = RF_LINKS.iter().map(|link| link.mode).collect();
        modes.sort_unstable();
        modes.dedup();
        assert_eq!(modes.len(), RF_LINKS.len());
        for (gen2x, plain) in [(10, 0), (11, 1), (12, 2), (13, 3), (14, 4), (15, 5)] {
            assert_eq!(plain_twin(gen2x), Some(plain));
        }
        // Plain, Autoset and unlisted modes are left as they are.
        for mode in [0, 1, 5, 6, 9, 16, 20, 25, 26, u8::MAX] {
            assert_eq!(plain_twin(mode), None);
        }
        assert_eq!(describe_link(11), "Gen2X, Miller 4, 250 kHz (mode 11)");
        assert_eq!(describe_link(1), "PR-ASK, Miller 4, 250 kHz (mode 1)");
        assert!(describe_link(7).contains("does not list"));
    }

    #[test]
    fn reports_a_moved_link_with_the_mode_it_came_from() {
        let profile = Profile {
            fast_id: false,
            tag_focus: false,
            gen2: Gen2::default().pinned(),
            rf_link: 1,
            rf_link_was: Some(11),
            ..confirmed_profile()
        };
        assert!(profile.unpinned().is_empty());
        let report = profile.report();
        assert!(!report.fast_id && !report.tag_focus);
        assert_eq!(
            (report.session.as_str(), report.target.as_str()),
            ("S0", "A")
        );
        assert_eq!(report.rf_link, "PR-ASK, Miller 4, 250 kHz (mode 1)");
        assert_eq!(
            report.rf_link_moved_from.as_deref(),
            Some("Gen2X, Miller 4, 250 kHz (mode 11)")
        );
        // Nothing read, nothing claimed.
        assert_eq!(
            (
                report.region,
                report.channels,
                report.antennas,
                report.work_wait
            ),
            (None, None, None, None)
        );
    }

    #[test]
    fn reports_the_wait_the_read_ran_with_and_the_one_it_replaced() {
        let set = Profile {
            duty: Some((1000, 0)),
            wait_was: Some(100),
            ..confirmed_profile()
        };
        assert!(set.unpinned().is_empty());
        assert_eq!(
            set.report().work_wait.as_deref(),
            Some("work 1000 ms, wait 0 ms · wait switched from 100 ms, not saved in the reader")
        );
        // Already 0: nothing was switched.
        assert_eq!(
            describe_duty(duty([0x00, 0xc8, 0x00, 0x00]), None),
            "work 200 ms, wait 0 ms"
        );
        // Not read back: the wait it had is not shown on its own.
        let unread = Profile {
            wait_was: Some(100),
            ..confirmed_profile()
        };
        assert_eq!(unread.report().work_wait, None);
    }

    #[test]
    fn reports_the_region_channels_and_antennas_as_read() {
        let profile = Profile {
            region: Some(0x3f),
            channels: Some(Channels::of(&[920_625, 921_125, 922_375])),
            // Whichever byte holds antenna 1, the mask is only shown.
            antennas: Some([0x01, 0x00]),
            ..confirmed_profile()
        };
        // Read only: none of them is ever a reason to refuse the reader.
        assert!(profile.unpinned().is_empty());
        let report = profile.report();
        assert_eq!(
            report.region.as_deref(),
            Some("Indonesia, 920–923 MHz (0x3F)")
        );
        assert_eq!(
            report.channels.as_deref(),
            Some("3 channels, 920.625–922.375 MHz")
        );
        assert_eq!(report.antennas.as_deref(), Some("01 00"));
    }

    #[test]
    fn names_each_region_the_vendors_tool_offers() {
        assert_eq!(describe_region(0x02), "China Standard2, 920–925 MHz (0x02)");
        assert_eq!(describe_region(0x41), "HK, 920–925 MHz (0x41)");
        assert_eq!(describe_region(0x08), "USA, 902–928 MHz (0x08)");
        assert!(describe_region(0x05).contains("does not name"));
        let mut codes: Vec<u8> = REGIONS.iter().map(|(code, _)| *code).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), REGIONS.len());
    }

    #[test]
    fn reads_the_channel_list_as_the_sdk_unpacks_it() {
        // The count, then each channel in kHz; what follows is not read.
        let reply = [3, 920_125, 920_625, 921_125, 7, 0];
        assert_eq!(channels_in(&reply), Some(&[920_125, 920_625, 921_125][..]));
        assert_eq!(channels_in(&[0, 920_125]), Some(&[][..]));
        // A count past the answer is not guessed at.
        assert_eq!(channels_in(&[5, 920_125, 920_625]), None);
        assert_eq!(channels_in(&[]), None);
        // An empty list, as the first R3 probed answered: no list of its own,
        // so the reader hops over its region's.
        assert_eq!(Channels::of(&[]).describe(), "the region's own channels");
        assert_eq!(
            Channels::of(&[920_625]).describe(),
            "1 channel, 920.625 MHz"
        );
        // Lowest and highest, whatever order the reader lists them in.
        assert_eq!(
            Channels::of(&[922_875, 920_125, 921_000]).describe(),
            "3 channels, 920.125–922.875 MHz"
        );
        assert_eq!(mhz(920_000), "920.000");
    }

    #[test]
    fn keeps_the_firmware_text_and_the_bytes_it_came_in() {
        let mut reply = [0_u8; 32];
        let answer = b"V1.0.3,R3S";
        reply[0] = 10;
        reply[1..11].copy_from_slice(answer);
        let (text, bytes) = version_reply(&reply);
        assert_eq!(text, "V1.0.3,R3S");
        assert_eq!(bytes, "0A 56 31 2E 30 2E 33 2C 52 33 53");
        // NULs at either end are dropped from the text, never from the bytes.
        let (text, bytes) = version_reply(&[4, b'R', b'3', 0, 0, 0x99]);
        assert_eq!(text, "R3");
        assert_eq!(bytes, "04 52 33 00 00");
        assert_eq!(version_reply(&[]), (String::new(), String::new()));
    }

    #[test]
    fn refuses_only_a_setting_read_back_that_can_leave_a_garment_off() {
        // As the first R3 probed answered: antennas `00 0F`, EPC only.
        let good = Rest {
            fast_inventory: Some(0),
            duty: Some(duty([0x03, 0xe8, 0x00, 0x00])),
            antennas: Some([0x00, 0x0f]),
            protocol: Some(0),
            output: Some([0, 0, 0]),
        };
        assert_eq!(good.duty, Some((1000, 0)));
        assert!(good.refused().is_empty());
        // Unread is not held against the reader.
        assert!(Rest::default().refused().is_empty());
        assert!(Rest::default().describe().contains("Fast Inventory unread"));

        // The antenna mask is never judged, whatever its bytes say.
        for antennas in [[0x00, 0x00], [0x01, 0x00], [0x00, 0x02]] {
            let shown = Rest {
                antennas: Some(antennas),
                ..good
            };
            assert!(shown.refused().is_empty(), "{antennas:?}");
        }
        assert!(good.describe().contains("antennas 00 0F"));

        let bad = Rest {
            fast_inventory: Some(1),
            duty: Some(duty([0x00, 0xc8, 0x00, 0x64])),
            antennas: Some([0x00, 0x00]),
            protocol: Some(1),
            output: Some([1, 0, 0]),
        };
        assert_eq!(
            bad.refused(),
            vec![
                "Fast Inventory on (1)".to_string(),
                "a wait time of 100 ms between reads, which could not be set to 0".to_string(),
                "air protocol GB/T 29768".to_string(),
                "output EPC+TID".to_string(),
            ]
        );
        assert!(bad.describe().contains("work/wait 200/100 ms"));
    }

    #[test]
    fn sends_the_stop_frame_the_sdk_itself_sends() {
        let [a5, x5a, high, low, command, check, cr, lf] = STOP_FRAME;
        assert_eq!((a5, x5a, cr, lf), (0xa5, 0x5a, 0x0d, 0x0a));
        assert_eq!(
            usize::from(u16::from_be_bytes([high, low])),
            STOP_FRAME.len()
        );
        assert_eq!(command, 0x8c);
        assert_eq!(check, high ^ low ^ command);
    }

    #[test]
    fn names_every_setting_that_is_not_this_counters() {
        let left = Profile {
            fast_id: true,
            tag_focus: false,
            gen2: Gen2 {
                query_session: 2,
                ..Gen2::default()
            },
            rf_link: 11,
            rf_link_was: None,
            ..confirmed_profile()
        };
        assert_eq!(
            left.unpinned(),
            vec![
                "FastID on".to_string(),
                "inventory controls differ from the recipe (session S2, target A)".to_string(),
                "link Gen2X, Miller 4, 250 kHz (mode 11)".to_string(),
            ]
        );
        // Autoset, unknown and other Gen2 links all differ from the fixed recipe.
        for rf_link in [20, 7] {
            let profile = Profile {
                rf_link,
                ..confirmed_profile()
            };
            assert!(!profile.unpinned().is_empty());
        }
    }

    // ── The status, the catalogue, the check tag, Test reader and Calibrate ──

    fn pad_read(
        tags: &[(&str, f64)],
        left_out: &[(&str, f64)],
        canary: Option<CanaryRead>,
    ) -> PadRead {
        PadRead {
            tags: tags
                .iter()
                .map(|(epc, rssi_dbm)| PadTag {
                    epc: (*epc).into(),
                    rssi_dbm: *rssi_dbm,
                    reads: 1,
                })
                .collect(),
            too_weak: count(left_out.len()),
            left_out: left_out
                .iter()
                .map(|(epc, rssi_dbm)| WeakTag {
                    epc: (*epc).into(),
                    rssi_dbm: Some(*rssi_dbm),
                    reads: 1,
                })
                .collect(),
            unreadable: 0,
            records: count(tags.len() + left_out.len())
                + canary.as_ref().map_or(0, |canary| canary.reads),
            power_dbm: 15,
            window_ms: 2000,
            min_rssi_dbm: -70,
            firmware: "V2.2.9,R3".into(),
            profile: confirmed_profile().report(),
            attention: check_tag_health(canary.as_ref()),
            canary,
            took_ms: 2200,
            waited_ms: 0,
        }
    }

    /// The check tag `CAFE0001`, heard at `rssi_dbm` against a −70 dBm floor.
    fn check_tag(rssi_dbm: Option<f64>) -> CanaryRead {
        CanaryRead {
            epc: "CAFE0001".into(),
            heard: rssi_dbm.is_some(),
            rssi_dbm,
            reads: u32::from(rssi_dbm.is_some()),
            margin_db: rssi_dbm.map(|rssi| rssi + 70.0),
        }
    }

    fn settings() -> PadSettings {
        PadSettings {
            power_dbm: 15,
            window_ms: 2000,
            min_rssi_dbm: -70,
            canary_epc: Some("CAFE0001".into()),
        }
    }

    fn opened() -> Result<(String, RadioProfile), Fault> {
        Ok(("V2.2.9,R3".into(), confirmed_profile().report()))
    }

    fn codes(faults: &[Fault]) -> Vec<&str> {
        faults.iter().map(|fault| fault.code).collect()
    }

    #[test]
    fn lists_every_code_once_with_one_short_sentence_and_one_action() {
        let mut listed: Vec<&str> = CATALOGUE.iter().map(|entry| entry.code).collect();
        let all = listed.len();
        listed.sort_unstable();
        listed.dedup();
        assert_eq!(listed.len(), all, "a code is listed twice");
        for entry in CATALOGUE {
            let number = entry.code.strip_prefix("R3-").unwrap_or_default();
            assert!(
                number.len() == 2 && number.bytes().all(|byte| byte.is_ascii_digit()),
                "{}",
                entry.code
            );
            for words in [entry.says, entry.action] {
                assert!(
                    words.ends_with('.') && words.len() <= 80,
                    "{}: {words}",
                    entry.code
                );
            }
            // 0x: the app, the driver and the link, and nothing else, say Not
            // connected.
            assert_eq!(
                entry.state == Some(ReaderState::NotConnected),
                number.starts_with('0'),
                "{}",
                entry.code
            );
        }
        let notes: Vec<&str> = CATALOGUE
            .iter()
            .filter(|entry| entry.state.is_none())
            .map(|entry| entry.code)
            .collect();
        assert_eq!(notes, ["R3-23", "R3-24", "R3-35", "R3-36"]);
        let fault = Fault::new(&NOT_CONNECTED, "UsbOpen answered R3 code -1");
        assert_eq!(
            fault.sentence(),
            "The R3 is not connected. Check its USB cable, then read again. (R3-05)"
        );
        assert_eq!(
            serde_json::to_string(&ReaderState::NotConnected)
                .ok()
                .as_deref(),
            Some("\"not_connected\"")
        );
    }

    #[test]
    fn the_support_doc_lists_every_code_with_the_words_the_till_shows() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/rfid-status-and-errors.md");
        let Ok(doc) = std::fs::read_to_string(&path) else {
            // A copy of the till without the repository around it, as on the
            // bench: there is no doc to hold the catalogue against.
            eprintln!(
                "{} not found: the catalogue is not checked against it.",
                path.display()
            );
            return;
        };
        let mut in_doc: Vec<&str> = doc
            .match_indices("R3-")
            .filter_map(|(at, _)| doc.get(at..at + 5))
            .filter(|code| code[3..].bytes().all(|byte| byte.is_ascii_digit()))
            .collect();
        in_doc.sort_unstable();
        in_doc.dedup();
        let mut ours: Vec<&str> = CATALOGUE.iter().map(|entry| entry.code).collect();
        ours.sort_unstable();
        assert_eq!(in_doc, ours, "the doc and CATALOGUE name different codes");
        for entry in CATALOGUE {
            let start = format!("| {} |", entry.code);
            let row = doc
                .lines()
                .find(|line| line.starts_with(&start))
                .unwrap_or_else(|| panic!("the doc has no row for {}", entry.code));
            assert!(row.contains(entry.says), "{}: “{}”", entry.code, entry.says);
            assert!(
                row.contains(entry.action),
                "{}: “{}”",
                entry.code,
                entry.action
            );
        }
    }

    #[test]
    fn says_ready_only_while_the_link_is_open_and_nothing_since_went_wrong() {
        let ready = status_from(Some(false), None, None, "Chainway R3 connected");
        assert_eq!(
            ready,
            ReaderStatus {
                state: ReaderState::Ready,
                fault: None,
                detail: "Chainway R3 connected".into(),
            }
        );
        let code = |status: &ReaderStatus| status.fault.as_ref().map(|fault| fault.code);
        // Not opened yet.
        let never = status_from(None, None, None, "");
        assert_eq!(
            (never.state, code(&never)),
            (ReaderState::NotConnected, Some("R3-05"))
        );
        // The driver gave up on the link: Not connected, whatever came before.
        let faint = Fault::new(&CHECK_TAG_FAINT, "faint");
        let lost = status_from(Some(true), None, Some(&faint), "");
        assert_eq!(
            (lost.state, code(&lost)),
            (ReaderState::NotConnected, Some("R3-07"))
        );
        // How the last open, check or read ended comes before the radio check.
        let stop = Fault::new(&STOP_NOT_CONFIRMED, "no 8D");
        let both = status_from(Some(false), Some(&stop), Some(&faint), "");
        assert_eq!(
            (both.state, code(&both)),
            (ReaderState::Attention, Some("R3-21"))
        );
        assert_eq!(both.detail, "no 8D");
        let check = status_from(Some(false), None, Some(&faint), "");
        assert_eq!(
            (check.state, code(&check)),
            (ReaderState::Attention, Some("R3-32"))
        );
        // A failed open leaves no link, and says why.
        let gone = Fault::new(&NOT_CONNECTED, "UsbOpen answered R3 code -1");
        let closed = status_from(None, Some(&gone), None, "");
        assert_eq!(
            (closed.state, closed.detail.as_str()),
            (ReaderState::NotConnected, "UsbOpen answered R3 code -1")
        );
        // A note never decides the state.
        let empty = Fault::new(&NOTHING_HEARD, "nothing");
        assert_eq!(
            status_from(Some(false), Some(&empty), None, "").state,
            ReaderState::Ready
        );
        assert_eq!(ReaderStatus::busy().state, ReaderState::Busy);
    }

    #[test]
    fn keeps_the_check_tag_out_of_the_basket_and_says_how_it_was_heard() {
        let heard = |epc: &str, tenths: i32| {
            Ok(Heard {
                epc: epc.into(),
                rssi_tenths: Some(tenths),
                carried_tid: false,
            })
        };
        let mut gathered = Gathered::default();
        gathered.add(heard("AA", -500));
        gathered.add(heard("CAFE0001", -660));
        gathered.add(heard("CAFE0001", -655));
        gathered.add(heard("BB", -760));
        let (tags, left_out, canary) = gathered.finish(-70, Some("CAFE0001"));
        let kept: Vec<&str> = tags.iter().map(|tag| tag.epc.as_str()).collect();
        let weak: Vec<&str> = left_out.iter().map(|tag| tag.epc.as_str()).collect();
        assert_eq!((kept, weak), (vec!["AA"], vec!["BB"]));
        assert_eq!(
            canary,
            Some(CanaryRead {
                epc: "CAFE0001".into(),
                heard: true,
                rssi_dbm: Some(-65.5),
                reads: 2,
                margin_db: Some(4.5),
            })
        );
        assert_eq!(check_tag_health(canary.as_ref()), None);

        let (_, _, missing) = Gathered::default().finish(-70, Some("CAFE0001"));
        assert_eq!(
            missing
                .as_ref()
                .map(|tag| (tag.heard, tag.reads, tag.rssi_dbm)),
            Some((false, 0, None))
        );
        assert_eq!(
            check_tag_health(missing.as_ref()).map(|fault| fault.code),
            Some("R3-31")
        );
        // Under the floor it is faint, and still in no list of tags.
        let mut under = Gathered::default();
        under.add(heard("CAFE0001", -720));
        let (_, left_out, canary) = under.finish(-70, Some("CAFE0001"));
        assert!(left_out.is_empty());
        assert_eq!(
            check_tag_health(canary.as_ref()).map(|fault| fault.code),
            Some("R3-32")
        );
        // 2 dB above the floor is enough; 1.9 is not.
        for (tenths, faint) in [(-680, false), (-681, true)] {
            let mut edge = Gathered::default();
            edge.add(heard("CAFE0001", tenths));
            let (_, _, canary) = edge.finish(-70, Some("CAFE0001"));
            assert_eq!(
                check_tag_health(canary.as_ref()).is_some(),
                faint,
                "{tenths}"
            );
        }
        assert_eq!(check_tag_health(None), None);
    }

    #[test]
    fn passes_a_test_only_when_every_read_keeps_the_same_tags_well_above_the_floor() {
        let good = || pad_read(&[("AA", -50.0), ("BB", -61.2)], &[("CC", -79.0)], None);
        let test = reader_test(
            &settings(),
            opened(),
            Some(2400),
            vec![Ok(good()), Ok(good()), Ok(good())],
        );
        assert!(test.passed, "{}", test.reason);
        assert!(test.stable);
        assert_eq!(
            test.weakest.as_ref().map(|tag| tag.epc.as_str()),
            Some("BB")
        );
        assert_eq!(test.margin_db, Some(8.8));
        assert_eq!(
            test.reason,
            "3 reads kept the same 2 tags; the weakest, …BB at -61.2 dBm, is 8.8 dB above the floor."
        );
        assert_eq!((test.reads.len(), test.open_ms), (3, Some(2400)));
        // Records and EPCs per read: the bench R3 stopped at about 35
        // records an inventory, which a large basket can reach.
        assert_eq!((test.reads[0].records, test.reads[0].epcs), (3, 3));
        assert_eq!(test.profile_id, "r3-conservative-v1");
        assert_eq!(test.last.as_ref().map(|read| read.tags.len()), Some(2));
        assert_eq!(check_from(&test, false), Some(None));

        let code = |test: &super::ReaderTest| test.fault.as_ref().map(|fault| fault.code);
        let closed = reader_test(
            &settings(),
            Err(Fault::new(&NOT_CONNECTED, "UsbOpen answered R3 code -1")),
            None,
            Vec::new(),
        );
        assert_eq!((closed.passed, code(&closed)), (false, Some("R3-05")));
        assert_eq!(check_from(&closed, true), None);

        let broke = reader_test(
            &settings(),
            opened(),
            Some(2400),
            vec![Ok(good()), Err(Fault::new(&STOP_NOT_CONFIRMED, "no 8D"))],
        );
        assert_eq!(code(&broke), Some("R3-21"));
        assert!(
            broke.reason.starts_with("Read 2 failed."),
            "{}",
            broke.reason
        );

        // Nothing on the pad says nothing about the radio.
        let empty = || pad_read(&[], &[("CC", -79.0)], None);
        let nothing = reader_test(
            &settings(),
            opened(),
            Some(2400),
            vec![Ok(empty()), Ok(empty()), Ok(empty())],
        );
        assert_eq!(code(&nothing), Some("R3-23"));
        assert_eq!(check_from(&nothing, false), None);

        let other = pad_read(&[("AA", -50.0), ("DD", -61.0)], &[], None);
        let swapped = reader_test(
            &settings(),
            opened(),
            Some(2400),
            vec![Ok(good()), Ok(other), Ok(good())],
        );
        assert_eq!((code(&swapped), swapped.stable), (Some("R3-33"), false));
        assert_eq!(
            swapped.reason,
            "The reads kept 2, 2, 2 tags, but not the same ones."
        );
        assert!(matches!(check_from(&swapped, false), Some(Some(_))));
        let fewer = reader_test(
            &settings(),
            opened(),
            Some(2400),
            vec![
                Ok(good()),
                Ok(pad_read(&[("AA", -50.0)], &[], None)),
                Ok(good()),
            ],
        );
        assert_eq!(fewer.reason, "The reads kept 2, 1, 2 tags.");

        let thin = || pad_read(&[("AA", -50.0), ("BB", -68.5)], &[], None);
        let close = reader_test(
            &settings(),
            opened(),
            Some(2400),
            vec![Ok(thin()), Ok(thin()), Ok(thin())],
        );
        assert_eq!((code(&close), close.margin_db), (Some("R3-34"), Some(1.5)));

        let with = |rssi: Option<f64>| pad_read(&[("AA", -50.0)], &[], Some(check_tag(rssi)));
        let missing = reader_test(
            &settings(),
            opened(),
            Some(2400),
            vec![Ok(with(Some(-52.0))), Ok(with(None)), Ok(with(Some(-52.0)))],
        );
        assert_eq!(code(&missing), Some("R3-31"));
        assert_eq!(
            missing.reason,
            "Read 2 did not hear the check tag …CAFE0001."
        );
        let faint = reader_test(
            &settings(),
            opened(),
            Some(2400),
            vec![
                Ok(with(Some(-69.0))),
                Ok(with(Some(-69.0))),
                Ok(with(Some(-69.0))),
            ],
        );
        assert_eq!(code(&faint), Some("R3-32"));
    }

    #[test]
    fn suggests_a_floor_3_db_under_the_weakest_tag_on_the_pad_rounded_down() {
        // As the bench R3 heard its pad: a tag a metre away under the floor.
        let read =
            |weakest: f64| pad_read(&[("AA", -45.0), ("BB", weakest)], &[("FAR", -76.0)], None);
        let calibrated = calibration(
            &settings(),
            vec![Ok(read(-61.2)), Ok(read(-62.0)), Ok(read(-61.6))],
        );
        assert_eq!(calibrated.suggested_dbm, Some(-65));
        assert_eq!(
            calibrated.weakest,
            Some(SeenTag {
                epc: "BB".into(),
                rssi_dbm: -62.0,
                check_tag: false,
            })
        );
        assert_eq!(
            calibrated
                .strongest_off
                .as_ref()
                .map(|tag| (tag.epc.as_str(), tag.rssi_dbm)),
            Some(("FAR", -76.0))
        );
        assert_eq!((calibrated.on_pad, calibrated.unsteady), (2, 0));
        assert!(calibrated.warnings.is_empty(), "{:?}", calibrated.warnings);
        assert_eq!(calibrated.reads.len(), 3);
        // -61.4 less 3 is -64.4: down to -65, 3.6 dB under the tag, never up.
        assert_eq!(
            calibration(&settings(), vec![Ok(read(-61.4))]).suggested_dbm,
            Some(-65)
        );

        // A tag off the pad within 6 dB of the suggestion is a warning.
        let near = calibration(
            &settings(),
            vec![Ok(pad_read(&[("AA", -66.0)], &[("FAR", -73.0)], None))],
        );
        assert_eq!(near.suggested_dbm, Some(-69));
        assert_eq!(codes(&near.warnings), ["R3-36"]);

        // The check tag is on the pad whatever it read at, and can be the
        // weakest there.
        let tagged = calibration(
            &settings(),
            vec![Ok(pad_read(
                &[("AA", -50.0)],
                &[],
                Some(check_tag(Some(-72.0))),
            ))],
        );
        assert_eq!(
            tagged
                .weakest
                .as_ref()
                .map(|tag| (tag.epc.as_str(), tag.check_tag)),
            Some(("CAFE0001", true))
        );
        assert_eq!((tagged.suggested_dbm, tagged.on_pad), (Some(-75), 2));

        let missed = calibration(
            &settings(),
            vec![
                Ok(read(-61.0)),
                Ok(pad_read(&[("AA", -45.0)], &[("FAR", -76.0)], None)),
            ],
        );
        assert_eq!((missed.suggested_dbm, missed.unsteady), (Some(-64), 1));
        assert_eq!(codes(&missed.warnings), ["R3-33"]);

        let nothing = calibration(
            &settings(),
            vec![Ok(pad_read(&[], &[("FAR", -76.0)], None))],
        );
        assert_eq!(
            (nothing.suggested_dbm, codes(&nothing.warnings)),
            (None, vec!["R3-35"])
        );
        let deep = calibration(&settings(), vec![Ok(pad_read(&[("AA", -98.5)], &[], None))]);
        assert_eq!(
            (deep.suggested_dbm, codes(&deep.warnings)),
            (None, vec!["R3-35"])
        );

        // A read that failed is said, with what the others suggest.
        let broke = calibration(
            &settings(),
            vec![
                Ok(read(-61.0)),
                Err(Fault::new(&STOP_NOT_CONFIRMED, "no 8D")),
            ],
        );
        assert_eq!(
            (broke.suggested_dbm, codes(&broke.warnings)),
            (Some(-64), vec!["R3-21"])
        );
    }

    #[test]
    fn writes_times_in_utc() {
        assert_eq!(utc(0), "1970-01-01 00:00:00.000Z");
        assert_eq!(utc(1_792_708_446_702), "2026-10-22 22:34:06.702Z");
        assert_eq!(utc(951_782_400_000), "2000-02-29 00:00:00.000Z");
        assert_eq!(utc(1_709_164_800_000), "2024-02-29 00:00:00.000Z");
        assert_eq!(utc(4_102_444_800_000), "2100-01-01 00:00:00.000Z");
    }

    #[test]
    fn bundles_the_last_40_calls_and_the_last_faults_as_text() {
        let mut journal = Journal::new();
        for at in 0..45_u64 {
            keep_last(
                &mut journal.calls,
                CALLS_KEPT,
                Call {
                    at_ms: at * 1000,
                    what: format!("call {at}"),
                    answer: "0".into(),
                    took_ms: 1,
                },
            );
        }
        keep_last(
            &mut journal.faults,
            FAULTS_KEPT,
            (0, Fault::new(&STOP_NOT_CONFIRMED, "no 8D")),
        );
        let text = bundle(
            1_000,
            vec![
                ("App", vec!["Central POS 0.1.0".into()]),
                ("Reader", Vec::new()),
            ],
            &journal,
        );
        assert!(text.starts_with("Chainway R3 diagnostics, made 1970-01-01 00:00:01.000Z\n"));
        assert!(text.contains("\nApp\n  Central POS 0.1.0\n"));
        assert!(text.contains("\nReader\n  none\n"));
        assert!(text
            .contains(" R3-21 The R3 did not confirm the read ended, so it was not used. no 8D\n"));
        assert!(!text.contains(" call 4 -> "));
        assert!(text.contains(" call 5 -> 0 (1 ms)\n"));
        assert!(text.contains(" call 44 -> 0 (1 ms)\n"));
        assert_eq!(text.matches(" -> 0 (1 ms)").count(), 40);
        assert_eq!(
            read_line(&pad_read(&[("AA", -50.0)], &[("CC", -79.0)], Some(check_tag(None)))),
            "1 tags, 1 left out, 0 unreadable, 2 records, took 2200 ms after a 0 ms wait, check tag not heard, R3-31"
        );
    }

    #[test]
    fn says_whether_an_sdk_file_is_the_pinned_build() {
        let pinned = "25c044a8f0160d3365df4bb31608f645074f13cf153eaa1476bb91c42e1cdef8";
        assert!(file_line("UHFAPI.dll", pinned).ends_with(", the pinned build"));
        assert!(file_line("UHFAPI.dll", &"0".repeat(64)).ends_with(", NOT the pinned build"));
        assert!(file_line("libusb-1.0.dll", pinned).ends_with(", NOT the pinned build"));
        assert_eq!(hex_lower(&[0xab, 0x01]), "ab01");
    }
}
