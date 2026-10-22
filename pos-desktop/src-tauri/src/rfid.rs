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
//! is only `UsbClose` and `UsbOpen`.
//!
//! # Opening
//!
//! The reader is opened once and kept open. Opening stops any inventory a
//! previous run left going (during continuous inventory the reader answers
//! nothing but stop), mutes the buzzer and reads it back, confirms the
//! firmware names an R3 or an R3S (anything else is refused, with the
//! firmware string it reported), selects EPC-only output, sets this counter's
//! power without saving it in the reader and reads it back, clears any tag
//! filter, and pins the radio profile. After that, while the till holds the
//! reader, no other app can change it; what can is a reset putting back what
//! the reader has saved. So before every read two questions are asked, and
//! only two: the buzzer, which a reset turns back on, and the power, which a
//! reset puts back to the reader's saved one. Both as this till left them:
//! the read goes ahead. Either moved: everything is set again exactly as
//! opening sets it, then the read goes ahead. No answer: the reader is closed
//! and opened once more before the read gives up. A read that comes back with
//! TID bytes shows the reader reverted all the same; it is not used, and the
//! next read sets everything again first.
//!
//! What the two questions cannot see: a reset of the radio module alone on a
//! reader whose saved power happens to be this counter's. The buzzer is a
//! setting of the reader board (`UHFGetBeep` is command 0xA1, with the
//! reader's IP and IO settings); the power and everything else set here are
//! the radio module's, so such a reset moves neither answer. The TID check
//! still catches it when the reader's saved output is EPC+TID; otherwise the
//! read runs on what the reader had saved.
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
//! in every short read — with every other Gen2 field written back exactly as
//! the reader held it. A Gen2X RF link is moved to the PR-ASK mode with the
//! same Miller encoding and link frequency; any other link is left as it is,
//! and shown. Nothing is saved in the reader: the filters and the RF link are
//! set with save 0, and the other calls take no save flag. Every setting the
//! SDK can read is read back (a filter it cannot, so the answer to clearing
//! one is what is checked), and a reader that will not take one, or whose
//! link cannot be read, is not read at all: a pad read with a profile nobody
//! checked can leave a garment off the basket. Fast Inventory, which the
//! vendor's tools can also save in the reader, is not set here.
//!
//! # Reading the pad
//!
//! One read is a short continuous inventory: start, collect tags for this
//! counter's window, stop, collect what was already on its way. Nothing else is
//! sent to the reader while it runs. Every record must carry a PC word whose
//! length field matches its EPC; records are folded into one tag per EPC with
//! the strongest signal it was heard at, and a tag heard only below this
//! counter's floor is left out. Power, window and floor are bench values
//! (README): the power decides how far the reader reaches, and only the pad may
//! be within reach. Nothing reads on its own — a read happens when the cashier
//! asks for one.

// The record parsing is built and tested on every platform; only the Windows
// build reads a reader with it.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::collections::BTreeMap;

use serde::Serialize;
use tauri::AppHandle;

/// How this counter reads its pad: the `r3_*` fields of `Peripherals` in
/// `peripherals.rs`, which also says what each one is for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PadSettings {
    pub power_dbm: u8,
    pub window_ms: u32,
    pub min_rssi_dbm: i16,
}

impl PadSettings {
    /// This till's settings. Refused rather than stretched when they are out of
    /// range: a power quietly clamped to the top would read the racks.
    fn of(app: &AppHandle) -> Result<Self, String> {
        use tauri::Manager;
        let peripherals = match app.try_state::<crate::edge::Node>() {
            Some(node) => crate::edge::lock(node.inner()).peripherals.clone(),
            None => crate::peripherals::Peripherals::default(),
        };
        crate::peripherals::check_desk_reader(&peripherals)?;
        Ok(Self {
            power_dbm: peripherals.r3_power_dbm,
            window_ms: peripherals.r3_read_ms,
            min_rssi_dbm: peripherals.r3_min_rssi_dbm,
        })
    }
}

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

/// One read of the pad.
#[derive(Debug, Serialize)]
pub struct PadRead {
    /// Every tag at or above the floor, strongest first.
    pub tags: Vec<PadTag>,
    /// Tags heard only below the floor, and so left out.
    pub too_weak: u32,
    /// Records that could not be read as a PC word and its EPC, and so were
    /// left out.
    pub unreadable: u32,
    /// What the reader was set to for this read.
    pub power_dbm: u8,
    pub window_ms: u32,
    pub min_rssi_dbm: i16,
    /// The reader's firmware version, as it reported it.
    pub firmware: String,
    pub profile: RadioProfile,
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
}

/// The reader, as the status bar and the devices screen describe it.
pub struct ReaderInfo {
    pub version: String,
    pub power_dbm: u8,
}

/// Open the reader if it is not open yet, and say what it is.
pub fn reader_state(app: &AppHandle) -> Result<ReaderInfo, String> {
    #[cfg(target_os = "windows")]
    {
        let settings = PadSettings::of(app)?;
        return windows::reader_state(app, &settings);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("The Chainway R3 USB reader works only in the Windows till app.".into())
    }
}

/// Read every tag on the pad.
pub fn read_pad(app: &AppHandle) -> Result<PadRead, String> {
    #[cfg(target_os = "windows")]
    {
        let settings = PadSettings::of(app)?;
        return windows::read_pad(app, &settings);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("The Chainway R3 can only be read by the Windows till app.".into())
    }
}

/// The desk readers this binding drives. The firmware version must name one
/// of them as one of its comma-separated parts, in any case; any other reader
/// is refused.
const DESK_READERS: [&str; 2] = ["R3", "R3S"];

fn names_a_desk_reader(version: &str) -> bool {
    version.split(',').any(|part| {
        DESK_READERS
            .iter()
            .any(|model| part.trim().eq_ignore_ascii_case(model))
    })
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

    /// The tags at or above the floor, strongest first, and how many were
    /// heard only below it. A tag that came with no signal strength cannot be
    /// shown to be on the pad, so it counts as below.
    fn finish(self, min_rssi_dbm: i16) -> (Vec<PadTag>, u32) {
        let floor = i32::from(min_rssi_dbm) * 10;
        let mut kept = Vec::new();
        let mut too_weak = 0_u32;
        for (epc, (best, reads)) in self.tags {
            match best {
                Some(tenths) if tenths >= floor => kept.push(PadTag {
                    epc,
                    rssi_dbm: f64::from(tenths) / 10.0,
                    reads,
                }),
                _ => too_weak = too_weak.saturating_add(1),
            }
        }
        kept.sort_by(|one, other| {
            other
                .rssi_dbm
                .total_cmp(&one.rssi_dbm)
                .then_with(|| one.epc.cmp(&other.epc))
        });
        (kept, too_weak)
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

    /// These settings with the Query asking session S0 for target A, and
    /// every other field exactly as the reader held it: nothing has been
    /// measured here to choose a Q, a link frequency or a Select by.
    fn pinned(self) -> Self {
        Self {
            query_session: SESSION_S0,
            query_target: TARGET_A,
            ..self
        }
    }

    fn is_pinned(&self) -> bool {
        self.query_session == SESSION_S0 && self.query_target == TARGET_A
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
                "session {}, target {}",
                self.gen2.session(),
                self.gen2.target()
            ));
        }
        if plain_twin(self.rf_link).is_some() {
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
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::os::raw::c_int;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, MutexGuard, PoisonError};
    use std::time::{Duration, Instant};

    use libloading::Library;
    use tauri::{AppHandle, Manager};

    use super::{
        describe_link, heard_in_cells, heard_in_received, names_a_desk_reader, plain_twin,
        Gathered, Gen2, PadRead, PadSettings, Profile, ReaderInfo,
    };

    // Every export is cdecl (`UHFAPI.h`; `CallingConvention.Cdecl` in the SDK's
    // `UHFAPI.cs`), which is what `extern "C"` is on x64 Windows.
    type UsbOpen = unsafe extern "C" fn() -> c_int;
    type UsbClose = unsafe extern "C" fn();
    /// `UHFSetBeep`, `UHFSetFastID`, `UHFSetTagfocus`: one `unsigned char`,
    /// 0 for off.
    type SetFlag = unsafe extern "C" fn(u8) -> c_int;
    /// `UHFGetBeep`, `UHFGetPower`, `UHFGetReaderVersion`, `UHFGetFastID`,
    /// `UHFGetTagfocus`, `UHFGetRFLink`: one output buffer.
    type ReadInto = unsafe extern "C" fn(*mut u8) -> c_int;
    /// `UHFSetPower`, `UHFSetRFLink`: the save flag, always 0 here, then the
    /// value.
    type SetValue = unsafe extern "C" fn(u8, u8) -> c_int;
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

    /// The Visual C++ runtime `UHFAPI.dll` and `libusb-1.0.dll` import, in the
    /// order they import each other. Shipped app-local in `rfid-native`.
    const RUNTIME: [&str; 3] = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

    /// The SDK's entry points, out of a `UHFAPI.dll` that is never unloaded,
    /// so they stay valid for as long as the process runs.
    struct Sdk {
        usb_open: UsbOpen,
        usb_close: UsbClose,
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
    }

    /// How tags are taken from a running inventory.
    #[derive(Clone, Copy)]
    enum Drain {
        /// `UHFGetTagData`, which never writes past the length it is given.
        Cells(GetTagData),
        /// `UHF_GetReceived_EX`, for a DLL without the bounded call.
        Received(GetReceivedEx),
    }

    /// The reader while it is open. Dropping it closes the USB handle, and
    /// only that: the SDK stays loaded.
    struct Open {
        sdk: &'static Sdk,
        version: String,
        power_dbm: u8,
        profile: Profile,
        /// The last read came back with TID bytes: the reader is on the
        /// output it has saved, and so, it must be assumed, on everything else
        /// it has saved. Everything is set again before the next read.
        reverted: bool,
    }

    impl Drop for Open {
        fn drop(&mut self) {
            unsafe { (self.sdk.usb_close)() };
        }
    }

    struct Reader {
        sdk: Option<&'static Sdk>,
        open: Option<Open>,
    }

    /// One reader per till, and one call into it at a time: a pad read holds
    /// this for its whole window, so nothing else reaches the reader while an
    /// inventory runs.
    static READER: Mutex<Reader> = Mutex::new(Reader {
        sdk: None,
        open: None,
    });

    fn lock_reader() -> MutexGuard<'static, Reader> {
        // A panic mid-read leaves nothing half-written worth refusing over:
        // the next buzzer check decides whether the reader is still good.
        READER.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn reader_state(
        app: &AppHandle,
        settings: &PadSettings,
    ) -> Result<ReaderInfo, String> {
        let mut reader = lock_reader();
        let open = ready(app, &mut reader, settings)?;
        Ok(ReaderInfo {
            version: open.version.clone(),
            power_dbm: open.power_dbm,
        })
    }

    pub(super) fn read_pad(app: &AppHandle, settings: &PadSettings) -> Result<PadRead, String> {
        let mut reader = lock_reader();
        let open = ready(app, &mut reader, settings)?;
        let (sdk, firmware, profile) = (open.sdk, open.version.clone(), open.profile.report());
        let mut reply = [0_u8; REPLY];
        // Whatever an earlier read left behind is not on the pad now.
        take_waiting(sdk, &mut reply, |_| {});

        let mut gathered = Gathered::default();
        let started = unsafe { (sdk.inventory)() };
        if started != 0 {
            // It may have started regardless; a reader left running answers
            // nothing else, so it is told to stop and closed.
            let _ = stop(sdk);
            reader.open = None;
            return Err(format!("The R3 did not start reading. {}", said(started)));
        }
        // Only the drain call from here to the stop: the reader is not sent
        // anything else while it runs.
        let until = Instant::now() + Duration::from_millis(u64::from(settings.window_ms));
        while Instant::now() < until {
            match next(sdk.drain, &mut reply) {
                Some(length) => collect(sdk.drain, &reply[..length], &mut gathered),
                None => std::thread::sleep(Duration::from_millis(5)),
            }
        }
        if let Err(code) = stop(sdk) {
            // A reader that will not stop answers nothing else. Closed, it is
            // opened again by the next read, which begins with a stop.
            reader.open = None;
            return Err(format!(
                "The R3 did not stop reading, so this read was not used. {}",
                said(code)
            ));
        }
        // What was already on its way when the reader stopped belongs to
        // this read.
        take_waiting(sdk, &mut reply, |record| {
            collect(sdk.drain, record, &mut gathered)
        });

        // TID bytes mean the reader went back to the output it has saved, as
        // a reset does — and so, it must be assumed, to its saved power,
        // filter and radio profile. Such a read cannot be shown to hold every
        // tag on the pad and only the pad's, so it is not used, and the next
        // read sets everything again first.
        if gathered.carried_tid {
            if let Some(open) = reader.open.as_mut() {
                open.reverted = true;
            }
            return Err(
                "The R3 went back to its own settings during this read, so the read was not used. Read the pad again."
                    .into(),
            );
        }
        let power_dbm = reader
            .open
            .as_ref()
            .map_or(settings.power_dbm, |open| open.power_dbm);
        let unreadable = gathered.unreadable;
        let (tags, too_weak) = gathered.finish(settings.min_rssi_dbm);
        Ok(PadRead {
            tags,
            too_weak,
            unreadable,
            power_dbm,
            window_ms: settings.window_ms,
            min_rssi_dbm: settings.min_rssi_dbm,
            firmware,
            profile,
        })
    }

    /// The SDK loaded and the reader open and set up for a read (`set_up`).
    ///
    /// A reader that stayed open is asked two questions before a read, and
    /// only two: the buzzer and the power. While the till holds the reader no
    /// other app can change it, and a reset puts back what the reader has
    /// saved: the buzzer on, and the power it has saved, which a counter
    /// reading only its pad seldom shares. Both as this till left them: the
    /// read goes ahead. Either moved, or the last read came back with TID
    /// bytes: everything is set again exactly as opening sets it. No answer:
    /// the dead handle is closed and the reader opened again, which sets
    /// everything.
    fn ready<'r>(
        app: &AppHandle,
        reader: &'r mut Reader,
        settings: &PadSettings,
    ) -> Result<&'r mut Open, String> {
        let sdk = match reader.sdk {
            Some(sdk) => sdk,
            None => {
                let sdk = load(app)?;
                reader.sdk = Some(sdk);
                sdk
            }
        };
        let answers = reader.open.as_ref().map(beep_and_power);
        if let Some(None) = answers {
            // Unplugged or asleep. The dead handle is closed before the
            // reader is opened again: the SDK holds one handle, and closing
            // the old one after would close the new.
            reader.open = None;
        }
        if reader.open.is_none() {
            reader.open = Some(open_reader(sdk, settings)?);
        } else if let Some(open) = reader.open.as_mut() {
            if let Some(Some((beep, power))) = answers {
                if let Err(problem) = ready_again(open, settings, beep != 0, power) {
                    reader.open = None;
                    return Err(problem);
                }
            }
        }
        reader
            .open
            .as_mut()
            .ok_or_else(|| "The Chainway R3 could not be opened.".to_string())
    }

    /// The buzzer and the power of a reader that stayed open, asked in that
    /// order. `None`: it did not answer one of them.
    fn beep_and_power(open: &Open) -> Option<(u8, u8)> {
        let (code, beep) = read_byte(open.sdk.get_beep);
        if code != 0 {
            return None;
        }
        let (code, power) = read_byte(open.sdk.get_power);
        (code == 0).then_some((beep, power))
    }

    fn open_reader(sdk: &'static Sdk, settings: &PadSettings) -> Result<Open, String> {
        let code = unsafe { (sdk.usb_open)() };
        if code != 0 {
            return Err(format!(
                "The Chainway R3 is not connected. Check its USB cable, then try again. (R3 code {code})"
            ));
        }
        // From here on, dropping `open` closes the reader.
        let mut open = Open {
            sdk,
            version: String::new(),
            power_dbm: 0,
            profile: Profile::default(),
            reverted: false,
        };
        set_up(&mut open, settings)?;
        Ok(open)
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
    ) -> Result<(), String> {
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
    /// a reset: no inventory left running, the buzzer off, an R3 or R3S,
    /// EPC-only output, this counter's power, no tag filter and the radio
    /// profile. Nothing is saved in the reader; whatever the SDK can read
    /// back is read back.
    fn set_up(open: &mut Open, settings: &PadSettings) -> Result<(), String> {
        let sdk = open.sdk;
        // A reader a previous run left in continuous inventory answers nothing
        // but stop. One that was not running may answer the stop with an
        // error, so the answer is not held against it: the buzzer below is
        // the first command that must succeed.
        let _ = stop(sdk);
        let mut reply = [0_u8; REPLY];
        take_waiting(sdk, &mut reply, |_| {});
        mute(sdk)?;
        open.version = firmware(sdk)?;
        epc_only(sdk)?;
        open.power_dbm = set_power(sdk, settings.power_dbm)?;
        clear_filters(sdk)?;
        open.profile = pin_profile(sdk)?;
        open.reverted = false;
        Ok(())
    }

    fn sdk_directory(app: &AppHandle) -> Result<PathBuf, String> {
        let resource = app
            .path()
            .resource_dir()
            .map_err(|error| {
                format!("The till app's resource folder could not be opened: {error}")
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

        Err("The Chainway R3 driver is missing from this till app's installation.".into())
    }

    /// Load the SDK for the life of the process.
    fn load(app: &AppHandle) -> Result<&'static Sdk, String> {
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
        };
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
    fn keep(path: &Path, what: &str) -> Result<&'static Library, String> {
        let library = unsafe { Library::new(path) }.map_err(|error| {
            format!(
                "{what} could not be loaded from {}: {error}",
                path.display()
            )
        })?;
        Ok(Box::leak(Box::new(library)))
    }

    fn symbol<T: Copy>(api: &'static Library, name: &[u8]) -> Result<T, String> {
        unsafe { api.get::<T>(name) }
            .map(|found| *found)
            .map_err(|error| {
                let name = String::from_utf8_lossy(name.strip_suffix(b"\0").unwrap_or(name));
                format!("The R3 driver has no {name}: {error}")
            })
    }

    /// One byte the SDK writes back, into a buffer it cannot overrun. Filled
    /// with 0xFF first, a value none of these settings has, so a byte the SDK
    /// did not write can never pass for "off".
    fn read_byte(get: ReadInto) -> (c_int, u8) {
        let mut reply = [u8::MAX; REPLY];
        let code = unsafe { get(reply.as_mut_ptr()) };
        (code, reply[0])
    }

    fn mute(sdk: &Sdk) -> Result<(), String> {
        let set = unsafe { (sdk.set_beep)(0) };
        let (get, mode) = read_byte(sdk.get_beep);
        if set != 0 || get != 0 || mode != 0 {
            return Err(format!(
                "Reading stopped: the R3's buzzer could not be confirmed off (set {set}, read {get}, mode {mode})."
            ));
        }
        Ok(())
    }

    fn firmware(sdk: &Sdk) -> Result<String, String> {
        let mut reply = [0_u8; REPLY];
        let code = unsafe { (sdk.get_version)(reply.as_mut_ptr()) };
        if code != 0 {
            return Err(format!(
                "The reader's firmware could not be read. {}",
                said(code)
            ));
        }
        // `version[0]` is the length, the text follows.
        let length = usize::from(reply[0]).min(REPLY - 1);
        let version = String::from_utf8_lossy(&reply[1..1 + length])
            .trim_matches('\0')
            .trim()
            .to_owned();
        if !names_a_desk_reader(&version) {
            return Err(format!(
                "The reader answered, but its firmware names neither an R3 nor an R3S, so it is not used. Its firmware: “{version}”."
            ));
        }
        Ok(version)
    }

    /// EPC-only output, not saved in the reader: memory 0 (`setEPCMode` in the
    /// SDK's `UHFAPI.cs`), no USER area. A reader left in EPC+TID output spends
    /// every tag on a second read, and a tag that answers the first and not the
    /// second is a garment the pad never reports.
    fn epc_only(sdk: &Sdk) -> Result<(), String> {
        let code = unsafe { (sdk.set_mode)(0, 0, 0, 0) };
        if code != 0 {
            return Err(format!(
                "The R3 could not be switched to reading EPCs only. {}",
                said(code)
            ));
        }
        Ok(())
    }

    fn power_now(sdk: &Sdk) -> Result<u8, String> {
        let (code, power) = read_byte(sdk.get_power);
        if code != 0 {
            return Err(format!("The R3's power could not be read. {}", said(code)));
        }
        Ok(power)
    }

    /// This counter's power, not saved in the reader (`save` 0), and read back:
    /// a power the reader did not take is a reach nobody chose.
    fn set_power(sdk: &Sdk, wanted: u8) -> Result<u8, String> {
        let code = unsafe { (sdk.set_power)(0, wanted) };
        if code != 0 {
            return Err(format!(
                "The R3's power could not be set to {wanted} dBm. {}",
                said(code)
            ));
        }
        let now = power_now(sdk)?;
        if now != wanted {
            return Err(format!(
                "The R3 was set to {wanted} dBm but reads back {now} dBm, so it is not used."
            ));
        }
        Ok(now)
    }

    /// This counter's radio profile, pinned before any inventory (`# The
    /// radio profile` in the module docs): each setting set and read back,
    /// then all of them asked once more.
    fn pin_profile(sdk: &Sdk) -> Result<Profile, String> {
        // Asked first only so the log can say what another app left behind.
        let fast_id_was = flag_now(sdk.get_fast_id, "FastID");
        let tag_focus_was = flag_now(sdk.get_tag_focus, "Tag Focus");
        // The RF link first and the Gen2 settings last, so that the session
        // and target are read back after every other setting is made.
        let link_was = rf_link_now(sdk)?;
        let rf_link = off_gen2x(sdk, link_was)?;
        switch_off(sdk.set_fast_id, sdk.get_fast_id, "FastID")?;
        switch_off(sdk.set_tag_focus, sdk.get_tag_focus, "Tag Focus")?;
        let gen2_was = gen2_now(sdk)?;
        write_gen2(sdk, gen2_was.pinned())?;
        // A reader that moved one setting while taking another is not read
        // with.
        let profile = profile_now(sdk, (rf_link != link_was).then_some(link_was))?;
        let off = profile.unpinned();
        if !off.is_empty() {
            return Err(format!(
                "The R3 did not keep this till's radio settings once all of them were made ({}), so it is not used.",
                off.join("; ")
            ));
        }
        let was = |flag: Result<bool, String>| match flag {
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
        Ok(profile)
    }

    /// No tag filter, for this session only (`save` 0), the way the vendor
    /// demo resets one: a filter of length 0 on each of the EPC, TID and USER
    /// banks, from bit 4, with the data `{0}` (`ReadEPCForm.cs`). A filter
    /// another app saved in the reader hides every tag it does not match, and
    /// the SDK cannot read one back, so each answer is all there is to check.
    fn clear_filters(sdk: &Sdk) -> Result<(), String> {
        for (bank, name) in [(1, "EPC"), (2, "TID"), (3, "USER")] {
            let mut data = [0_u8; 1];
            let code = unsafe { (sdk.set_filter)(0, bank, 4, 0, data.as_mut_ptr()) };
            if code != 0 {
                return Err(format!(
                    "The R3's tag filter on its {name} memory could not be cleared, and a filter can hide tags on the pad, so it is not used. {}",
                    said(code)
                ));
            }
        }
        Ok(())
    }

    /// The radio profile as the reader holds it now, each setting asked once.
    fn profile_now(sdk: &Sdk, rf_link_was: Option<u8>) -> Result<Profile, String> {
        Ok(Profile {
            fast_id: flag_now(sdk.get_fast_id, "FastID")?,
            tag_focus: flag_now(sdk.get_tag_focus, "Tag Focus")?,
            gen2: gen2_now(sdk)?,
            rf_link: rf_link_now(sdk)?,
            rf_link_was,
        })
    }

    /// Whether one of the reader's on/off features is on.
    fn flag_now(get: ReadInto, feature: &str) -> Result<bool, String> {
        let (code, value) = read_byte(get);
        if code != 0 {
            return Err(format!(
                "The R3's {feature} setting could not be read. {}",
                said(code)
            ));
        }
        Ok(value != 0)
    }

    /// One of the reader's on/off features switched off and read back as
    /// off. Neither call takes a save flag (`UHFAPI.h`).
    fn switch_off(set: SetFlag, get: ReadInto, feature: &str) -> Result<(), String> {
        let set_code = unsafe { set(0) };
        let (read, value) = read_byte(get);
        if set_code != 0 || read != 0 || value != 0 {
            return Err(format!(
                "Reading stopped: the R3's {feature} could not be confirmed off (set {set_code}, read {read}, value {value})."
            ));
        }
        Ok(())
    }

    fn gen2_now(sdk: &Sdk) -> Result<Gen2, String> {
        let mut gen2 = Gen2::UNREAD;
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
        if code != 0 {
            return Err(format!(
                "The R3's Gen2 settings could not be read. {}",
                said(code)
            ));
        }
        Ok(gen2)
    }

    /// These Gen2 settings written, and read back field for field.
    /// `UHFSetGen2` takes no save flag (`UHFAPI.h`).
    fn write_gen2(sdk: &Sdk, wanted: Gen2) -> Result<Gen2, String> {
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
        if code != 0 {
            return Err(format!(
                "The R3 could not be set to session {}, target {}. {}",
                wanted.session(),
                wanted.target(),
                said(code)
            ));
        }
        let back = gen2_now(sdk)?;
        if (back.query_session, back.query_target) != (wanted.query_session, wanted.query_target) {
            return Err(format!(
                "The R3 was set to session {}, target {} but reads back session {}, target {}, so it is not used.",
                wanted.session(),
                wanted.target(),
                back.session(),
                back.target()
            ));
        }
        if back != wanted {
            return Err(
                "The R3's Gen2 settings did not read back as they were written, so it is not used."
                    .into(),
            );
        }
        Ok(back)
    }

    fn rf_link_now(sdk: &Sdk) -> Result<u8, String> {
        let (code, mode) = read_byte(sdk.get_rf_link);
        if code != 0 {
            return Err(format!(
                "The R3's radio link could not be read, so a Gen2X link cannot be ruled out and the R3 is not used. {}",
                said(code)
            ));
        }
        Ok(mode)
    }

    /// The link a read runs on: the one found, unless it is Gen2X, which is
    /// moved to its plain twin without saving it in the reader (`save` 0) and
    /// read back.
    fn off_gen2x(sdk: &Sdk, found: u8) -> Result<u8, String> {
        let Some(twin) = plain_twin(found) else {
            return Ok(found);
        };
        let code = unsafe { (sdk.set_rf_link)(0, twin) };
        if code != 0 {
            return Err(format!(
                "The R3 is on a Gen2X radio link, {}, and could not be moved to {}. {}",
                describe_link(found),
                describe_link(twin),
                said(code)
            ));
        }
        let now = rf_link_now(sdk)?;
        if now != twin {
            return Err(format!(
                "The R3 was moved to {} but reads back {}, so it is not used.",
                describe_link(twin),
                describe_link(now)
            ));
        }
        Ok(now)
    }

    /// Stop a continuous inventory, asking twice: stop is the one command a
    /// running reader answers, and a reader left running answers nothing else.
    fn stop(sdk: &Sdk) -> Result<(), c_int> {
        let mut code = unsafe { (sdk.stop)() };
        if code != 0 {
            code = unsafe { (sdk.stop)() };
        }
        if code == 0 {
            Ok(())
        } else {
            Err(code)
        }
    }

    /// The next record waiting in the SDK, as a length into `reply`. `None`
    /// when nothing is waiting; a failing reader shows itself at the stop.
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

    /// Hand every record already waiting in the SDK to `each`, bounded so a
    /// reader that never stops talking cannot hold the till.
    fn take_waiting(sdk: &Sdk, reply: &mut [u8; REPLY], mut each: impl FnMut(&[u8])) {
        let until = Instant::now() + Duration::from_millis(300);
        for _ in 0..2048 {
            match next(sdk.drain, reply) {
                Some(length) => each(&reply[..length]),
                None => return,
            }
            if Instant::now() >= until {
                return;
            }
        }
    }

    /// What an SDK answer means, in the cashier's words (error codes in the
    /// vendor's API document), with the number kept for whoever supports the
    /// till.
    fn said(code: c_int) -> String {
        let meaning = match code {
            1 => "The reader refused it.",
            2..=7 => "The Chainway R3 is not connected. Check its USB cable, then try again.",
            251 => "The reader's answer was garbled. Try again.",
            252 => "Nothing could be sent to the reader. Check its USB cable, then try again.",
            253 => "The reader did not answer. Check its USB cable, then try again.",
            254 => "The reader sent nothing back. Try again.",
            255 => "The reader could not carry it out.",
            -2 => "The reader refused a setting.",
            -4 => "The reader's answer could not be read.",
            _ => "The reader reported an error.",
        };
        format!("{meaning} (R3 code {code})")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        describe_link, epc_hex, heard_in_cells, heard_in_received, names_a_desk_reader, plain_twin,
        Gathered, Gen2, Heard, Profile, RF_LINKS,
    };

    #[test]
    fn accepts_an_r3_or_an_r3s_and_no_other_reader() {
        for version in ["R3", "r3", "R3S", "r3s", "V1.0.3, R3S", " R3 ,2025"] {
            assert!(names_a_desk_reader(version), "{version}");
        }
        for version in ["", "R5", "UR4", "R3S-PLUS", "R3 S", "R3X", "XR3"] {
            assert!(!names_a_desk_reader(version), "{version}");
        }
    }

    const EPC_96: [u8; 12] = [
        0xa0, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12,
    ];

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
        gathered.add(Err("cut short".into()));
        assert_eq!(gathered.unreadable, 1);
        let (tags, too_weak) = gathered.finish(-70);
        let kept: Vec<(&str, f64, u32)> = tags
            .iter()
            .map(|tag| (tag.epc.as_str(), tag.rssi_dbm, tag.reads))
            .collect();
        assert_eq!(kept, vec![("BB", -45.0, 1), ("AA", -50.5, 2)]);
        assert_eq!(too_weak, 2);
    }

    #[test]
    fn pins_only_the_query_session_and_target() {
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
                query_session: 0,
                query_target: 0,
                ..found
            }
        );
        // The header's `Target` is the Select's: it stays as the reader had it.
        assert_eq!(pinned.select_target, 4);
        assert_eq!(pinned.session(), "S0");
        assert_eq!(pinned.target(), "A");
        // Nothing the SDK left unwritten passes for S0 or A.
        assert!(!Gen2::UNREAD.is_pinned());
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
        };
        assert_eq!(
            left.unpinned(),
            vec![
                "FastID on".to_string(),
                "session S2, target A".to_string(),
                "link Gen2X, Miller 4, 250 kHz (mode 11)".to_string(),
            ]
        );
        // An Autoset link or one the document does not list is left as it is.
        for rf_link in [20, 7] {
            let profile = Profile {
                rf_link,
                ..Profile::default()
            };
            assert!(profile.unpinned().is_empty());
        }
    }
}
