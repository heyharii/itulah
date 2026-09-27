//! The stage catalogue: what each step of a flow MEANS, fixed in code.
//!
//! A template (data, edited by Admin) says which stages a route runs and who
//! performs each. What a stage *does* is not the template's to say: that pick
//! takes goods off the racks, that depart puts them on the road, that receive
//! is one confirm with no refusal. Those meanings are here, one entry per
//! [`StageKind`], and a template can only choose among them — never redefine
//! one. The owner's words, 27 Sep: "alur sebagai template", with the stage's
//! meaning, its movements, its journal meaning and its proof living in code.
//!
//! # What one entry carries
//!
//! * **Where it happens** ([`StageSide`]) and **who writes it down**
//!   ([`ExecutedAt`]): a pick happens at the origin and its node writes it; an
//!   approval happens at head office, in the hub.
//! * **Custody** ([`Custody`]): whether the stage hands the goods on. Depart
//!   lets the dispatch leave, receive (and, for a supplier's lorry, verification)
//!   accepts them, handover gives them to somebody outside the company. The
//!   template invariants are phrased in these terms.
//! * **What it emits** ([`Emission`]): the pool stages goods move between,
//!   the claims it publishes, the records it keeps. Descriptive — the action
//!   that completes the stage produces the matching effects.
//! * **Its journal meaning** ([`JournalRule`]): a MEANING, never an account
//!   (`FINANCE-HARD-RULES.md` I9). Crossing units at depart and at receive
//!   books inter-unit goods whatever the template says; handing goods back to
//!   a supplier reduces what head office owes it.
//! * **Proof** ([`ProofKind`]): which kinds a template may ask for, and which
//!   the stage demands whatever the template asks.
//! * **Fixed rules** ([`FixedRule`]): receive's one confirm, no refusal,
//!   differences to Missing and damaged goods to reject; the blind count that
//!   never sees the ordered quantity; the verifier who is never the checker.
//!
//! # The outbound stages, and the numbers they print
//!
//! Allotment V1 §3 counts a promise through `TO_PACK → pack → AT_PACKED →
//! ship → AT_SHIPMENT → load → AT_LOADED → depart → AT_IN_TRANSIT →
//! receive`, and the Gudang's node prints a number at three of those steps
//! (`edge::outbound::NumberKind`): KOLI for a sealed box, SJ for the surat
//! jalan — one shipment for ONE destination, the paper that destination
//! signs against — and DSP for a dispatch, one vehicle run that may carry
//! several SJ to several destinations. So the catalogue has them as stages
//! of their own: close koli (KOLI), ship (SJ), load (onto a DSP), depart (the
//! DSP leaves; when load is skipped, depart opens the DSP itself).
//!
//! Allotment's reversals stay possible: unpack, unship and unload take goods
//! back one step while nothing has departed (`FLOW_ACTION_REVERSE_STAGE`).
//! They are corrections of a physical step, not an exception workflow
//! (allotment §4).
//!
//! # A plan is not a stage
//!
//! The allotment (MD's decision) is the plan a flow runs, not a step inside
//! it: every outbound flow document is born from one — to a store, between
//! stores, back to the Gudang, back to a supplier — and a receiving flow is
//! born from a purchase order or a delivery. The document names its source
//! (`super::FlowSource`); no stage "creates" it.
//!
//! Pure: no clock, no database. The server that enforces a rule and the editor
//! that draws it read this one list.

use serde::{Deserialize, Serialize};

/// One step type. The set is closed; a new kind is a code change, because a
/// new kind is a new meaning.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StageKind {
    Pick,
    Pack,
    CloseKoli,
    /// Koli into a surat jalan (SJ): one shipment per destination.
    Ship,
    /// Onto a dispatch (DSP): one vehicle run.
    Load,
    Depart,
    Receive,
    Inspect,
    ReadyForPickup,
    HandoverWithProof,
    Approval,
    // The receiving stages: a supplier's lorry at the Gudang.
    Arrival,
    BlindCount,
    Verification,
    Tagging,
    Putaway,
}

impl StageKind {
    pub const ALL: [StageKind; 16] = [
        Self::Approval,
        Self::Pick,
        Self::Pack,
        Self::CloseKoli,
        Self::Ship,
        Self::Load,
        Self::Depart,
        Self::Receive,
        Self::Inspect,
        Self::ReadyForPickup,
        Self::HandoverWithProof,
        Self::Arrival,
        Self::BlindCount,
        Self::Verification,
        Self::Tagging,
        Self::Putaway,
    ];

    /// The spelling `flow_template_stage.stage_kind` stores.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Pick => "PICK",
            Self::Pack => "PACK",
            Self::CloseKoli => "CLOSE_KOLI",
            Self::Ship => "SHIP",
            Self::Load => "LOAD",
            Self::Depart => "DEPART",
            Self::Receive => "RECEIVE",
            Self::Inspect => "INSPECT",
            Self::ReadyForPickup => "READY_FOR_PICKUP",
            Self::HandoverWithProof => "HANDOVER_WITH_PROOF",
            Self::Approval => "APPROVAL",
            Self::Arrival => "ARRIVAL",
            Self::BlindCount => "BLIND_COUNT",
            Self::Verification => "VERIFICATION",
            Self::Tagging => "TAGGING",
            Self::Putaway => "PUTAWAY",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        let code = code.trim();
        Self::ALL.into_iter().find(|kind| kind.code() == code)
    }

    /// This kind's catalogue entry.
    pub fn spec(self) -> &'static StageSpec {
        match self {
            Self::Pick => &PICK,
            Self::Pack => &PACK,
            Self::CloseKoli => &CLOSE_KOLI,
            Self::Ship => &SHIP,
            Self::Load => &LOAD,
            Self::Depart => &DEPART,
            Self::Receive => &RECEIVE,
            Self::Inspect => &INSPECT,
            Self::ReadyForPickup => &READY_FOR_PICKUP,
            Self::HandoverWithProof => &HANDOVER_WITH_PROOF,
            Self::Approval => &APPROVAL,
            Self::Arrival => &ARRIVAL,
            Self::BlindCount => &BLIND_COUNT,
            Self::Verification => &VERIFICATION,
            Self::Tagging => &TAGGING,
            Self::Putaway => &PUTAWAY,
        }
    }

    /// The stages a correction may take back one step while nothing has
    /// departed: unpack, reopen a koli, unship, unload (allotment §4).
    pub const fn is_reversible(self) -> bool {
        matches!(self, Self::Pack | Self::CloseKoli | Self::Ship | Self::Load)
    }

    /// The stages that come after goods are ours at the destination and move
    /// them only inside that site. The only stages a template may put after
    /// the stage that accepts custody.
    pub const fn is_after_receipt(self) -> bool {
        matches!(self, Self::Inspect | Self::Tagging | Self::Putaway)
    }

    /// Whether completing this stage moves goods (or hands them on). An
    /// approval has to come before every one of these: approving a return
    /// after it left is not an approval.
    pub const fn moves_goods(self) -> bool {
        matches!(
            self,
            Self::Pick
                | Self::Pack
                | Self::Ship
                | Self::Load
                | Self::Depart
                | Self::Receive
                | Self::Inspect
                | Self::HandoverWithProof
                | Self::Verification
                | Self::Putaway
        )
    }
}

/// Where a stage happens, relative to the route.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StageSide {
    /// At the site the goods leave from.
    Origin,
    /// At the site the goods arrive at.
    Destination,
    /// At head office, whatever the route: an approval.
    HeadOffice,
}

/// Who writes the stage down.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutedAt {
    /// The node that owns the site's ledger: the only machine entitled to
    /// write its movements. The flow parks until the node's fact resumes it.
    Node,
    /// The hub: a decision or a document, not a scan.
    Hub,
}

/// What a stage does to custody of the goods.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Custody {
    None,
    /// The goods leave the origin (depart).
    Leaves,
    /// Our destination takes them (receive; verification for a supplier's
    /// lorry, where the accepted receipt is the moment they become ours).
    Accepts,
    /// Somebody outside the company takes them (handover with proof).
    HandsOver,
}

/// A physical stage goods stand in, named by its ROLE on the route rather than
/// by a pool id: the template does not know which site it will run between.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PoolStage {
    /// Where the origin keeps saleable stock: the Gudang racks, a shop's
    /// stockroom.
    OriginStock,
    Picked,
    Packed,
    /// In a surat jalan for one destination (`AT_SHIPMENT`).
    Shipment,
    /// On a dispatch's vehicle, still on the yard (`AT_LOADED`).
    Loaded,
    InTransit,
    /// The template's destination pool role (a store's stockroom, the
    /// store's return pool at the Gudang, the racks).
    DestinationPool,
    /// The destination pool, in the missing state: handed over, not found.
    DestinationMissing,
    /// The destination's reject pool.
    DestinationReject,
    /// Where the destination keeps saleable stock once it is checked: the
    /// Gudang racks after an inspection.
    DestinationStock,
    /// Receiving/pending at the Gudang: accepted, not yet on the racks.
    Pending,
    /// A supplier or a customer.
    OutsideParty,
}

/// What a stage publishes that is not a movement.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClaimKind {
    /// The origin says the goods left (`IN_TRANSIT`).
    InTransit,
    /// The destination says what arrived (`RECEIVED`).
    Received,
    /// Goods are waiting at the counter for somebody to collect.
    ReadyForPickup,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Emission {
    Movement { from: PoolStage, to: PoolStage },
    Claim { claim: ClaimKind },
    /// A record the stage keeps without moving anything: a delivery, a count,
    /// a decision, a seal.
    Record { record: &'static str },
}

/// A journal MEANING. Which account it lands in is the account map's decision
/// (`account_link`, 0460), never a template's and never this file's.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JournalMeaning {
    /// Goods left one unit's site for another unit's (the accountant's SJD):
    /// each side books its half of the inter-unit goods balance.
    InterunitGoodsDispatched,
    /// Goods another unit sent were taken into custody here.
    InterunitGoodsReceived,
    /// Goods went back to a supplier: head office owes it less.
    SupplierReturnHandedOver,
}

impl JournalMeaning {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InterunitGoodsDispatched => "INTERUNIT_GOODS_DISPATCHED",
            Self::InterunitGoodsReceived => "INTERUNIT_GOODS_RECEIVED",
            Self::SupplierReturnHandedOver => "SUPPLIER_RETURN_HANDED_OVER",
        }
    }
}

/// When a stage produces a journal meaning. Decided by the route and the
/// units it crosses, never by the template.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "when", content = "meaning", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JournalRule {
    Never,
    /// Only when the origin's unit is not the destination's.
    WhenCrossingUnits(JournalMeaning),
    /// Only when the outside party is a supplier.
    WhenPartyIsSupplier(JournalMeaning),
}

/// Evidence a stage may be asked for.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProofKind {
    /// A handheld sweep: the EPCs are the count.
    RfidScan,
    /// A person typed the number.
    ManualCount,
    Photo,
    Signature,
    /// The supplier's signed return note (nota retur).
    SignedReturnNote,
}

impl ProofKind {
    pub const ALL: [ProofKind; 5] = [
        Self::RfidScan,
        Self::ManualCount,
        Self::Photo,
        Self::Signature,
        Self::SignedReturnNote,
    ];

    pub const fn code(self) -> &'static str {
        match self {
            Self::RfidScan => "RFID_SCAN",
            Self::ManualCount => "MANUAL_COUNT",
            Self::Photo => "PHOTO",
            Self::Signature => "SIGNATURE",
            Self::SignedReturnNote => "SIGNED_RETURN_NOTE",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        let code = code.trim();
        Self::ALL.into_iter().find(|kind| kind.code() == code)
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::RfidScan => "Scan RFID",
            Self::ManualCount => "Hitung manual",
            Self::Photo => "Foto",
            Self::Signature => "Tanda tangan",
            Self::SignedReturnNote => "Nota retur bertanda tangan",
        }
    }

    /// Scan and manual count are two ways of saying one number: a stage asks
    /// for one of them, never both.
    pub const fn is_count_method(self) -> bool {
        matches!(self, Self::RfidScan | Self::ManualCount)
    }
}

/// Proof a stage demands whatever the template asks.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "type", content = "kinds", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RequiredProof {
    None,
    /// A count method: scan or manual, one of the two.
    CountMethod,
    /// At least one of these.
    AnyOf(&'static [ProofKind]),
}

/// A rule of the stage that no template can switch off.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FixedRule {
    /// Receive is confirmed once. A second confirm is refused, not added.
    OneConfirm,
    /// Nothing at receive reads as a refusal: an internal shipment is not
    /// refused, only counted (allotment ALT-INV-07).
    NoRefusal,
    /// Handed over and not found becomes Missing at the destination
    /// (ALT-D02), opened automatically.
    DifferenceToMissing,
    /// Found but unsaleable is still received, into the reject pool (ALT-D03).
    DamagedToReject,
    /// No stage may pass on more than the stage before it handed on.
    NotMoreThanUpstream,
    /// The checker never sees the ordered quantity or the price.
    BlindToOrderedQuantity,
    /// The verifier is never the checker.
    CheckerIsNotVerifier,
    /// An arrival is filed under a delivery number.
    NeedsDeliveryNumber,
    /// The person who approves is not the person who asked.
    ApproverIsNotInitiator,
    /// Goods leave custody only against proof.
    ProofOfHandover,
    /// A supplier handover needs the supplier's signed return note.
    SupplierSignsReturnNote,
    /// A surat jalan is for one destination: what that destination signs.
    OneShipmentPerDestination,
    /// Taken back one step (unpack, unship, unload) only while nothing has
    /// departed.
    ReversibleUntilDeparture,
}

impl FixedRule {
    pub const fn text(self) -> &'static str {
        match self {
            Self::OneConfirm => "Dikonfirmasi satu kali. Konfirmasi kedua ditolak, tidak ditambahkan.",
            Self::NoRefusal => "Tidak ada penolakan: kiriman internal dihitung, tidak ditolak.",
            Self::DifferenceToMissing => "Selisih antara yang diserahkan dan yang ditemukan menjadi Missing di tujuan.",
            Self::DamagedToReject => "Barang rusak tetap diterima, lalu masuk pool reject.",
            Self::NotMoreThanUpstream => "Tidak boleh melebihi yang diteruskan tahap sebelumnya.",
            Self::BlindToOrderedQuantity => "Penghitung tidak melihat kuantitas PO maupun harga.",
            Self::CheckerIsNotVerifier => "Verifier tidak boleh orang yang sama dengan checker.",
            Self::NeedsDeliveryNumber => "Kedatangan dicatat dengan nomor delivery.",
            Self::ApproverIsNotInitiator => "Penyetuju bukan orang yang mengajukan.",
            Self::ProofOfHandover => "Barang lepas dari tangan kita hanya dengan bukti serah terima.",
            Self::SupplierSignsReturnNote => "Serah terima ke supplier wajib nota retur bertanda tangan.",
            Self::OneShipmentPerDestination => "Satu surat jalan untuk satu tujuan: itu yang ditandatangani tujuan.",
            Self::ReversibleUntilDeparture => "Bisa dibalik satu langkah (unpack, unship, unload) selama belum berangkat.",
        }
    }
}

/// Whether a stage records quantities of its own.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CountRule {
    /// Records nothing: an approval, an arrival.
    None,
    /// Must record what it handled before it completes.
    MustCount,
    /// May record; when it does not, it carries on what the stage before
    /// handed it (a sealed koli, a departing lorry).
    CarriesUpstream,
}

/// Why a stage may wait for the world: a scan, a decision, a signature.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ParkReason {
    Scan,
    Approval,
    Handover,
}

impl ParkReason {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Scan => "SCAN",
            Self::Approval => "APPROVAL",
            Self::Handover => "HANDOVER",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code.trim() {
            "SCAN" => Some(Self::Scan),
            "APPROVAL" => Some(Self::Approval),
            "HANDOVER" => Some(Self::Handover),
            _ => None,
        }
    }
}

/// One catalogue entry.
#[derive(Debug, Serialize)]
pub struct StageSpec {
    pub kind: StageKind,
    /// What the hub calls it.
    pub label: &'static str,
    /// One sentence: what doing it means.
    pub meaning: &'static str,
    pub side: StageSide,
    pub executed_at: ExecutedAt,
    pub custody: Custody,
    pub emits: &'static [Emission],
    pub journal: JournalRule,
    pub count: CountRule,
    /// Whether the checker may see the planned quantity while doing it.
    pub blind: bool,
    pub allowed_proof: &'static [ProofKind],
    pub required_proof: RequiredProof,
    pub fixed_rules: &'static [FixedRule],
    /// Whether any template may mark it skippable at all.
    pub may_skip: bool,
    /// What it waits for when it parks. `None`: it never parks.
    pub parks: Option<ParkReason>,
}

const COUNTING: &[ProofKind] = &[ProofKind::RfidScan, ProofKind::ManualCount, ProofKind::Photo];

static PICK: StageSpec = StageSpec {
    kind: StageKind::Pick,
    label: "Ambil (pick)",
    meaning: "Barang diambil dari rak atau gudang belakang ke area keluar. Belum terikat ke tujuan mana pun.",
    side: StageSide::Origin,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[Emission::Movement { from: PoolStage::OriginStock, to: PoolStage::Picked }],
    journal: JournalRule::Never,
    count: CountRule::MustCount,
    blind: false,
    allowed_proof: COUNTING,
    required_proof: RequiredProof::CountMethod,
    fixed_rules: &[FixedRule::NotMoreThanUpstream],
    may_skip: false,
    parks: Some(ParkReason::Scan),
};

static PACK: StageSpec = StageSpec {
    kind: StageKind::Pack,
    label: "Kemas (pack)",
    meaning: "Barang masuk karton untuk satu tujuan. Di sinilah sepotong barang terikat ke satu toko. Bisa dibongkar lagi (unpack) selama belum berangkat.",
    side: StageSide::Origin,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[Emission::Movement { from: PoolStage::Picked, to: PoolStage::Packed }],
    journal: JournalRule::Never,
    count: CountRule::MustCount,
    blind: false,
    allowed_proof: COUNTING,
    required_proof: RequiredProof::CountMethod,
    fixed_rules: &[FixedRule::NotMoreThanUpstream, FixedRule::ReversibleUntilDeparture],
    may_skip: false,
    parks: Some(ParkReason::Scan),
};

static CLOSE_KOLI: StageSpec = StageSpec {
    kind: StageKind::CloseKoli,
    label: "Tutup koli",
    meaning: "Karton disegel menjadi koli bernomor (KOLI). Isinya yang kelak dihitung sebagai yang diserahkan. Segel bisa dibuka lagi selama belum berangkat.",
    side: StageSide::Origin,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[Emission::Record { record: "koli (KOLI)" }],
    journal: JournalRule::Never,
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: &[ProofKind::RfidScan, ProofKind::ManualCount, ProofKind::Photo],
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::NotMoreThanUpstream, FixedRule::ReversibleUntilDeparture],
    may_skip: false,
    parks: None,
};

static SHIP: StageSpec = StageSpec {
    kind: StageKind::Ship,
    label: "Masuk surat jalan",
    meaning: "Koli yang sudah disegel masuk satu surat jalan (SJ) untuk satu tujuan: dokumen yang ditandatangani tujuan. Bisa ditarik lagi (unship) selama belum berangkat.",
    side: StageSide::Origin,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[
        Emission::Movement { from: PoolStage::Packed, to: PoolStage::Shipment },
        Emission::Record { record: "surat jalan (SJ)" },
    ],
    journal: JournalRule::Never,
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: &[ProofKind::Signature, ProofKind::Photo],
    required_proof: RequiredProof::None,
    fixed_rules: &[
        FixedRule::OneShipmentPerDestination,
        FixedRule::NotMoreThanUpstream,
        FixedRule::ReversibleUntilDeparture,
    ],
    // Skippable on a route to a customer; never on one to our own site,
    // where the SJ is what the destination signs (`validate_template`).
    may_skip: true,
    parks: None,
};

static LOAD: StageSpec = StageSpec {
    kind: StageKind::Load,
    label: "Muat (dispatch)",
    meaning: "Koli dan SJ naik ke satu dispatch (DSP): satu perjalanan kendaraan, bisa membawa beberapa SJ ke beberapa tujuan. Masih di halaman, belum di jalan; bisa diturunkan lagi (unload) sebelum berangkat.",
    side: StageSide::Origin,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[
        Emission::Movement { from: PoolStage::Shipment, to: PoolStage::Loaded },
        Emission::Record { record: "dispatch (DSP)" },
    ],
    journal: JournalRule::Never,
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: COUNTING,
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::NotMoreThanUpstream, FixedRule::ReversibleUntilDeparture],
    may_skip: true,
    parks: Some(ParkReason::Scan),
};

static DEPART: StageSpec = StageSpec {
    kind: StageKind::Depart,
    label: "Berangkat",
    meaning: "Dispatch (DSP) berangkat: barang dalam perjalanan. Bila Muat dilewati, dispatch dibuka di sini. Bila lintas unit, interunit barang dibukukan otomatis.",
    side: StageSide::Origin,
    executed_at: ExecutedAt::Node,
    custody: Custody::Leaves,
    emits: &[
        Emission::Movement { from: PoolStage::Loaded, to: PoolStage::InTransit },
        Emission::Record { record: "dispatch (DSP)" },
        Emission::Claim { claim: ClaimKind::InTransit },
    ],
    journal: JournalRule::WhenCrossingUnits(JournalMeaning::InterunitGoodsDispatched),
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: &[ProofKind::Photo, ProofKind::Signature],
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::NotMoreThanUpstream],
    may_skip: false,
    parks: None,
};

static RECEIVE: StageSpec = StageSpec {
    kind: StageKind::Receive,
    label: "Terima",
    meaning: "Tujuan menyatakan apa yang sungguh sampai, dengan satu konfirmasi. Selisih jadi Missing, yang rusak ke reject.",
    side: StageSide::Destination,
    executed_at: ExecutedAt::Node,
    custody: Custody::Accepts,
    emits: &[
        Emission::Movement { from: PoolStage::InTransit, to: PoolStage::DestinationPool },
        Emission::Movement { from: PoolStage::InTransit, to: PoolStage::DestinationMissing },
        Emission::Movement { from: PoolStage::InTransit, to: PoolStage::DestinationReject },
        Emission::Claim { claim: ClaimKind::Received },
    ],
    journal: JournalRule::WhenCrossingUnits(JournalMeaning::InterunitGoodsReceived),
    count: CountRule::MustCount,
    blind: true,
    allowed_proof: COUNTING,
    required_proof: RequiredProof::CountMethod,
    fixed_rules: &[
        FixedRule::OneConfirm,
        FixedRule::NoRefusal,
        FixedRule::DifferenceToMissing,
        FixedRule::DamagedToReject,
        FixedRule::NotMoreThanUpstream,
    ],
    may_skip: false,
    parks: Some(ParkReason::Scan),
};

static INSPECT: StageSpec = StageSpec {
    kind: StageKind::Inspect,
    label: "Periksa",
    meaning: "Barang yang sudah diterima diperiksa: yang layak ke rak, yang tidak ke reject.",
    side: StageSide::Destination,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[
        Emission::Movement { from: PoolStage::DestinationPool, to: PoolStage::DestinationStock },
        Emission::Movement { from: PoolStage::DestinationPool, to: PoolStage::DestinationReject },
    ],
    journal: JournalRule::Never,
    count: CountRule::MustCount,
    blind: false,
    allowed_proof: &[ProofKind::RfidScan, ProofKind::ManualCount, ProofKind::Photo],
    required_proof: RequiredProof::CountMethod,
    fixed_rules: &[FixedRule::NotMoreThanUpstream],
    may_skip: true,
    parks: Some(ParkReason::Scan),
};

static READY_FOR_PICKUP: StageSpec = StageSpec {
    kind: StageKind::ReadyForPickup,
    label: "Siap diambil",
    meaning: "Barang menunggu di konter untuk diambil pelanggan.",
    side: StageSide::Origin,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[Emission::Claim { claim: ClaimKind::ReadyForPickup }],
    journal: JournalRule::Never,
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: &[ProofKind::Photo],
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::NotMoreThanUpstream],
    may_skip: true,
    parks: None,
};

static HANDOVER_WITH_PROOF: StageSpec = StageSpec {
    kind: StageKind::HandoverWithProof,
    label: "Serah terima dengan bukti",
    meaning: "Barang berpindah ke pihak luar (supplier atau pelanggan) dengan bukti tanda tangan atau nota retur.",
    side: StageSide::Origin,
    executed_at: ExecutedAt::Hub,
    custody: Custody::HandsOver,
    emits: &[Emission::Movement { from: PoolStage::InTransit, to: PoolStage::OutsideParty }],
    journal: JournalRule::WhenPartyIsSupplier(JournalMeaning::SupplierReturnHandedOver),
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: &[
        ProofKind::Photo,
        ProofKind::Signature,
        ProofKind::SignedReturnNote,
    ],
    required_proof: RequiredProof::AnyOf(&[ProofKind::Signature, ProofKind::SignedReturnNote]),
    fixed_rules: &[
        FixedRule::ProofOfHandover,
        FixedRule::SupplierSignsReturnNote,
        FixedRule::NotMoreThanUpstream,
    ],
    may_skip: false,
    parks: Some(ParkReason::Handover),
};

static APPROVAL: StageSpec = StageSpec {
    kind: StageKind::Approval,
    label: "Persetujuan",
    meaning: "Seseorang selain pengaju menyetujui atau menolak, sebelum barang bergerak.",
    side: StageSide::HeadOffice,
    executed_at: ExecutedAt::Hub,
    custody: Custody::None,
    emits: &[Emission::Record { record: "decision" }],
    journal: JournalRule::Never,
    count: CountRule::None,
    blind: false,
    allowed_proof: &[],
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::ApproverIsNotInitiator],
    may_skip: false,
    parks: Some(ParkReason::Approval),
};

static ARRIVAL: StageSpec = StageSpec {
    kind: StageKind::Arrival,
    label: "Kedatangan",
    meaning: "Lori supplier datang dan diberi nomor delivery, diterima atau tidak barangnya.",
    side: StageSide::Destination,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[Emission::Record { record: "delivery" }],
    journal: JournalRule::Never,
    count: CountRule::None,
    blind: true,
    allowed_proof: &[ProofKind::Photo],
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::NeedsDeliveryNumber],
    may_skip: false,
    parks: None,
};

static BLIND_COUNT: StageSpec = StageSpec {
    kind: StageKind::BlindCount,
    label: "Hitung buta",
    meaning: "Satu orang mencatat apa yang fisik datang, tanpa melihat kuantitas PO maupun harga.",
    side: StageSide::Destination,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[Emission::Record { record: "blind_count" }],
    journal: JournalRule::Never,
    count: CountRule::MustCount,
    blind: true,
    allowed_proof: COUNTING,
    required_proof: RequiredProof::CountMethod,
    fixed_rules: &[FixedRule::BlindToOrderedQuantity],
    may_skip: false,
    parks: Some(ParkReason::Scan),
};

static VERIFICATION: StageSpec = StageSpec {
    kind: StageKind::Verification,
    label: "Verifikasi",
    meaning: "Orang kedua menerima hitungan checker. Sejak itu barang jadi stok operasional (accepted receipt).",
    side: StageSide::Destination,
    executed_at: ExecutedAt::Node,
    custody: Custody::Accepts,
    emits: &[Emission::Movement { from: PoolStage::OutsideParty, to: PoolStage::Pending }],
    journal: JournalRule::Never,
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: &[ProofKind::Photo, ProofKind::Signature],
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::CheckerIsNotVerifier],
    may_skip: false,
    parks: None,
};

static TAGGING: StageSpec = StageSpec {
    kind: StageKind::Tagging,
    label: "Tagging",
    meaning: "Barang yang sudah diterima diberi identitas kita: artikel, SKU, dan tag EPC per potong.",
    side: StageSide::Destination,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[Emission::Record { record: "identification" }],
    journal: JournalRule::Never,
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: &[ProofKind::RfidScan, ProofKind::ManualCount],
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::NotMoreThanUpstream],
    may_skip: true,
    parks: Some(ParkReason::Scan),
};

static PUTAWAY: StageSpec = StageSpec {
    kind: StageKind::Putaway,
    label: "Simpan ke rak",
    meaning: "Barang pindah dari area penerimaan ke pool tujuan (rak Gudang).",
    side: StageSide::Destination,
    executed_at: ExecutedAt::Node,
    custody: Custody::None,
    emits: &[Emission::Movement { from: PoolStage::Pending, to: PoolStage::DestinationPool }],
    journal: JournalRule::Never,
    count: CountRule::CarriesUpstream,
    blind: false,
    allowed_proof: &[ProofKind::RfidScan, ProofKind::ManualCount],
    required_proof: RequiredProof::None,
    fixed_rules: &[FixedRule::NotMoreThanUpstream],
    may_skip: true,
    parks: Some(ParkReason::Scan),
};

/// Every entry, in the order the editor offers them.
pub fn stage_catalogue() -> Vec<&'static StageSpec> {
    StageKind::ALL.into_iter().map(StageKind::spec).collect()
}

/// A catalogue entry as the hub reads it, with the fixed rules spelled out.
#[derive(Debug, Serialize)]
pub struct StageCatalogueEntry {
    pub code: &'static str,
    #[serde(flatten)]
    pub spec: &'static StageSpec,
    pub fixed_rule_texts: Vec<&'static str>,
}

pub fn stage_catalogue_entries() -> Vec<StageCatalogueEntry> {
    stage_catalogue()
        .into_iter()
        .map(|spec| StageCatalogueEntry {
            code: spec.kind.code(),
            spec,
            fixed_rule_texts: spec.fixed_rules.iter().map(|rule| rule.text()).collect(),
        })
        .collect()
}
