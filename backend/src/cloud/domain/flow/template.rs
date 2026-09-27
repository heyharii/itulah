//! A flow template: data an Admin edits, checked against invariants no
//! template can switch off.
//!
//! A template is a route (origin kind → destination kind, or an outside
//! party), an ordered list of stages chosen from the catalogue, who may start
//! it — that is, who may raise the allotment (or, from a supplier, the
//! order) the flow runs, since a plan is never a stage — who performs each
//! stage, the proof each asks for, a deadline per stage,
//! which stages may be skipped, and the pool role goods land in. It is saved
//! as a new VERSION every time; a running document keeps the version it
//! started on (`flow_document.template_version_id`, 0616).
//!
//! # The invariants, whatever the template says
//!
//! * A flow to our own site ends in Receive: exactly one stage accepts
//!   custody there (Receive; for a supplier's lorry, Verification — the
//!   accepted receipt), and after it only stages that move goods inside that
//!   site (inspect, tagging, putaway).
//! * A flow to an outside party ends in Handover with proof, and a supplier
//!   handover carries the supplier's signed return note.
//! * Goods travelling between our own sites travel under a surat jalan: the
//!   ship stage (SJ) is present and never skippable there, because the SJ is
//!   what the destination signs against and what `handed_over` is counted
//!   from (allotment ALT-D01).
//! * Crossing units posts inter-unit automatically. Nothing here can say
//!   otherwise because nothing here names a journal at all: the meaning is the
//!   stage's ([`super::JournalRule`]) and the account is the map's (I9). A
//!   template's parameters may not even carry a key that looks like an
//!   account.
//! * A supplier return leaves only from a head-office site, and goods from a
//!   supplier arrive only at one. Stores never deal with suppliers.
//! * Nothing is counted twice: a stage kind appears once per template, and a
//!   stage passes on no more than the stage before handed it (checked when
//!   the document runs, and again by the database).
//!
//! The same rules are held a second time in the database (0615's deferred
//! trigger), because a template can be written by a migration or by hand as
//! well as by this screen, and an invariant that lives only in validation
//! lives only as long as everybody goes through it.
//!
//! Every problem found is returned — not the first — with the stage it
//! belongs to, so the editor can put each sentence beside the row it is
//! about.

use super::stage::{ProofKind, RequiredProof, StageKind, StageSide};
use crate::cloud::domain::Role;
use crate::ids::SiteKind;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fmt;

/// Somebody outside the company.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PartyKind {
    Supplier,
    Customer,
}

impl PartyKind {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Supplier => "SUPPLIER",
            Self::Customer => "CUSTOMER",
        }
    }
}

/// One end of a route: a kind of our own site, or an outside party.
///
/// Spelled on the wire and in the database as one code — `HO`, `STORE`,
/// `SUPPLIER`, `CUSTOMER` — the site kinds being exactly what `site.kind`
/// stores. When the premises vocabulary (`OFFICE`, `WAREHOUSE`, `SHOP`) lands
/// in [`SiteKind`], a route end follows it without a change here.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub enum RouteEnd {
    Site(SiteKind),
    Party(PartyKind),
}

impl RouteEnd {
    pub fn code(self) -> &'static str {
        match self {
            Self::Site(kind) => kind.code(),
            Self::Party(party) => party.code(),
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        let code = code.trim().to_ascii_uppercase();
        match code.as_str() {
            "SUPPLIER" => Some(Self::Party(PartyKind::Supplier)),
            "CUSTOMER" => Some(Self::Party(PartyKind::Customer)),
            other => SiteKind::from_code(other).map(Self::Site),
        }
    }

    pub const fn site_kind(self) -> Option<SiteKind> {
        match self {
            Self::Site(kind) => Some(kind),
            Self::Party(_) => None,
        }
    }

    pub const fn party(self) -> Option<PartyKind> {
        match self {
            Self::Site(_) => None,
            Self::Party(party) => Some(party),
        }
    }

    pub const fn is_head_office(self) -> bool {
        matches!(self, Self::Site(SiteKind::HeadOffice))
    }

    /// How the hub names it.
    pub fn label(self) -> &'static str {
        match self {
            Self::Site(SiteKind::HeadOffice) => "Gudang (HO)",
            Self::Site(SiteKind::Store) => "Store",
            Self::Party(PartyKind::Supplier) => "Supplier",
            Self::Party(PartyKind::Customer) => "Customer",
        }
    }
}

impl TryFrom<String> for RouteEnd {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value).ok_or_else(|| {
            format!("`{value}` is not a route end: choose HO, STORE, SUPPLIER or CUSTOMER")
        })
    }
}

impl From<RouteEnd> for String {
    fn from(value: RouteEnd) -> Self {
        value.code().to_owned()
    }
}

impl fmt::Display for RouteEnd {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub struct FlowRoute {
    pub origin: RouteEnd,
    pub destination: RouteEnd,
}

impl FlowRoute {
    /// The kind of our own site at one side of the route, if that side is
    /// ours. Head office's side is always head office.
    pub fn site_kind_at(self, side: StageSide) -> Option<SiteKind> {
        match side {
            StageSide::Origin => self.origin.site_kind(),
            StageSide::Destination => self.destination.site_kind(),
            StageSide::HeadOffice => Some(SiteKind::HeadOffice),
        }
    }
}

/// Who may start a flow or perform a stage.
///
/// A closed vocabulary, because each maps to a rung of the one ladder
/// (`CASHIER < SUPERVISOR < ADMIN`) and to the kind of unit the person works
/// at. The ladder cannot yet tell a merchandiser from a buyer — both are head
/// office supervisors — so the rung is what is enforced today and the
/// function is what is recorded; the day people carry a function, only
/// [`FlowRole::holds`] changes.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FlowRole {
    /// Merchandising at head office: decides what goes to which store.
    HoMd,
    /// A buyer at head office: owns the supplier and the order.
    HoBuyer,
    /// Head office's administrator.
    HoAdmin,
    /// The Gudang floor: picker, packer, checker.
    GudangStaff,
    /// Whoever answers for the Gudang floor: a verifier, an inspector.
    GudangSupervisor,
    /// Head office's own delivery: the driver who takes goods out.
    HoDelivery,
    StoreStaff,
    StoreManager,
}

impl FlowRole {
    pub const ALL: [FlowRole; 8] = [
        Self::HoMd,
        Self::HoBuyer,
        Self::HoAdmin,
        Self::GudangStaff,
        Self::GudangSupervisor,
        Self::HoDelivery,
        Self::StoreStaff,
        Self::StoreManager,
    ];

    pub const fn code(self) -> &'static str {
        match self {
            Self::HoMd => "HO_MD",
            Self::HoBuyer => "HO_BUYER",
            Self::HoAdmin => "HO_ADMIN",
            Self::GudangStaff => "GUDANG_STAFF",
            Self::GudangSupervisor => "GUDANG_SUPERVISOR",
            Self::HoDelivery => "HO_DELIVERY",
            Self::StoreStaff => "STORE_STAFF",
            Self::StoreManager => "STORE_MANAGER",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        let code = code.trim();
        Self::ALL.into_iter().find(|role| role.code() == code)
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::HoMd => "HO · MD",
            Self::HoBuyer => "HO · Buyer",
            Self::HoAdmin => "HO · Admin",
            Self::GudangStaff => "Gudang · Staff",
            Self::GudangSupervisor => "Gudang · Supervisor",
            Self::HoDelivery => "HO · Delivery",
            Self::StoreStaff => "Store · Staff",
            Self::StoreManager => "Store · Manager",
        }
    }

    /// The kind of site the person works at.
    pub const fn works_at(self) -> SiteKind {
        match self {
            Self::StoreStaff | Self::StoreManager => SiteKind::Store,
            _ => SiteKind::HeadOffice,
        }
    }

    /// The lowest rung that may act in this role.
    pub const fn min_role(self) -> Role {
        match self {
            Self::GudangStaff | Self::HoDelivery | Self::StoreStaff => Role::Cashier,
            Self::HoMd | Self::HoBuyer | Self::GudangSupervisor | Self::StoreManager => {
                Role::Supervisor
            }
            Self::HoAdmin => Role::Admin,
        }
    }

    /// Whether somebody on this rung may act in this role. The rung only, for
    /// the reason in the type's doc; which unit they are posted at is the
    /// caller's to check against the document's sites.
    pub fn holds(self, rung: Role) -> bool {
        rung >= self.min_role()
    }
}

/// The role of the pool goods land in at the destination. Instances are data
/// (created from a site template); roles are fixed here.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PoolRole {
    /// Receiving at the Gudang: accepted, not yet on the racks.
    Pending,
    /// The Gudang racks.
    Warehouse,
    /// One store's return pool at the Gudang.
    Return,
    Reject,
    /// A shop's stockroom (gudang belakang).
    Stockroom,
    /// A shop's floor.
    Floor,
}

impl PoolRole {
    pub const ALL: [PoolRole; 6] = [
        Self::Pending,
        Self::Warehouse,
        Self::Return,
        Self::Reject,
        Self::Stockroom,
        Self::Floor,
    ];

    pub const fn code(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Warehouse => "WAREHOUSE",
            Self::Return => "RETURN",
            Self::Reject => "REJECT",
            Self::Stockroom => "STOCKROOM",
            Self::Floor => "FLOOR",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        let code = code.trim();
        Self::ALL.into_iter().find(|role| role.code() == code)
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Pending => "Receiving area",
            Self::Warehouse => "Gudang racks",
            Self::Return => "The store's return pool (Gudang)",
            Self::Reject => "Reject",
            Self::Stockroom => "Store stockroom",
            Self::Floor => "Store floor",
        }
    }

    /// Whether a site of this kind has a pool in this role.
    pub const fn exists_at(self, kind: SiteKind) -> bool {
        match self {
            Self::Pending | Self::Warehouse | Self::Return => {
                matches!(kind, SiteKind::HeadOffice)
            }
            Self::Stockroom | Self::Floor => matches!(kind, SiteKind::Store),
            Self::Reject => true,
        }
    }
}

/// One stage of a template, with its parameters.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateStage {
    pub kind: StageKind,
    pub performer: FlowRole,
    #[serde(default)]
    pub proof: Vec<ProofKind>,
    /// Hours from the moment the stage becomes current.
    #[serde(default)]
    pub deadline_hours: Option<u32>,
    #[serde(default)]
    pub skippable: bool,
    /// Free parameters the stage's code reads (`{"koli_max_pcs": 120}`).
    /// Never an account (I9).
    #[serde(default = "empty_object")]
    pub params: Value,
}

fn empty_object() -> Value {
    Value::Object(serde_json::Map::new())
}

/// A template as the editor sends it and a version stores it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlowTemplateDraft {
    pub code: String,
    pub name: String,
    pub route: FlowRoute,
    pub starters: Vec<FlowRole>,
    #[serde(default)]
    pub destination_pool: Option<PoolRole>,
    pub stages: Vec<TemplateStage>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// One thing wrong with a draft, placed where the editor can show it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TemplateProblem {
    /// The stage row it belongs to, when it belongs to one.
    pub stage: Option<usize>,
    /// The field it belongs to: `code`, `name`, `route`, `starters`,
    /// `destination_pool`, or on a stage `kind`, `performer`, `proof`,
    /// `deadline_hours`, `skippable`, `params`.
    pub field: Option<&'static str>,
    /// Stable, for a test or a screen that wants to react to one rule.
    pub rule: &'static str,
    pub message: String,
}

struct Problems(Vec<TemplateProblem>);

impl Problems {
    fn template(&mut self, field: &'static str, rule: &'static str, message: impl Into<String>) {
        self.0.push(TemplateProblem {
            stage: None,
            field: Some(field),
            rule,
            message: message.into(),
        });
    }

    fn stage(
        &mut self,
        index: usize,
        field: &'static str,
        rule: &'static str,
        message: impl Into<String>,
    ) {
        self.0.push(TemplateProblem {
            stage: Some(index),
            field: Some(field),
            rule,
            message: message.into(),
        });
    }
}

/// Stage pairs whose order is part of their meaning: when both are present,
/// the first comes first. Pack binds what pick fetched; depart takes what was
/// packed; the verifier accepts what the checker counted.
const PRECEDENCE: &[(StageKind, StageKind)] = &[
    (StageKind::Pick, StageKind::Pack),
    (StageKind::Pack, StageKind::CloseKoli),
    (StageKind::Pack, StageKind::Ship),
    (StageKind::CloseKoli, StageKind::Ship),
    (StageKind::Ship, StageKind::Load),
    (StageKind::Ship, StageKind::Depart),
    (StageKind::CloseKoli, StageKind::Load),
    (StageKind::Pack, StageKind::Load),
    (StageKind::Pick, StageKind::Depart),
    (StageKind::Pack, StageKind::Depart),
    (StageKind::CloseKoli, StageKind::Depart),
    (StageKind::Load, StageKind::Depart),
    (StageKind::Depart, StageKind::Receive),
    (StageKind::Receive, StageKind::Inspect),
    (StageKind::Depart, StageKind::HandoverWithProof),
    (StageKind::ReadyForPickup, StageKind::HandoverWithProof),
    (StageKind::Pick, StageKind::ReadyForPickup),
    (StageKind::Arrival, StageKind::BlindCount),
    (StageKind::BlindCount, StageKind::Verification),
    (StageKind::Verification, StageKind::Tagging),
    (StageKind::Verification, StageKind::Putaway),
    (StageKind::Tagging, StageKind::Putaway),
    (StageKind::Verification, StageKind::Inspect),
];

/// Stages that cannot stand without an earlier one.
const NEEDS: &[(StageKind, StageKind)] = &[
    (StageKind::Pack, StageKind::Pick),
    (StageKind::CloseKoli, StageKind::Pack),
    (StageKind::Ship, StageKind::Pack),
    (StageKind::Load, StageKind::Pack),
    (StageKind::Depart, StageKind::Pick),
    (StageKind::BlindCount, StageKind::Arrival),
    (StageKind::Verification, StageKind::BlindCount),
];

/// Everything wrong with a draft; empty when it may be saved.
pub fn validate_template(draft: &FlowTemplateDraft) -> Vec<TemplateProblem> {
    let mut problems = Problems(Vec::new());
    let route = draft.route;

    // --- the template itself ---------------------------------------------
    let code = draft.code.trim();
    let code_well_formed = code.len() >= 2
        && code.len() <= 40
        && code.starts_with(|first: char| first.is_ascii_uppercase())
        && code.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        });
    if !code_well_formed {
        problems.template(
            "code",
            "template.code",
            "A code is 2–40 characters: capital letters, digits or underscores, starting with a letter (e.g. KIRIM_GUDANG_TOKO).",
        );
    }
    if draft.name.trim().is_empty() {
        problems.template("name", "template.name", "A flow needs a name.");
    }
    if draft.starters.is_empty() {
        problems.template(
            "starters",
            "template.starters",
            "Choose at least one role that may start this flow.",
        );
    }
    let unique_starters: BTreeSet<FlowRole> = draft.starters.iter().copied().collect();
    if unique_starters.len() != draft.starters.len() {
        problems.template(
            "starters",
            "template.starters_repeat",
            "Name each role once.",
        );
    }

    // --- the route --------------------------------------------------------
    match (route.origin, route.destination) {
        (RouteEnd::Party(_), RouteEnd::Party(_)) => problems.template(
            "route",
            "route.party_to_party",
            "A flow must touch at least one of our sites: outside party to outside party is not a flow of our goods.",
        ),
        (RouteEnd::Party(PartyKind::Customer), _) => problems.template(
            "route",
            "route.customer_origin",
            "Goods from a customer have no flow yet: a customer return is recorded at the till.",
        ),
        (RouteEnd::Party(PartyKind::Supplier), destination) if !destination.is_head_office() => {
            problems.template(
                "route",
                "route.supplier_to_store",
                "Stores never deal with suppliers: goods from a supplier are received only at a head-office site (the Gudang).",
            )
        }
        (origin, RouteEnd::Party(PartyKind::Supplier)) if !origin.is_head_office() => problems
            .template(
                "route",
                "route.supplier_return_from_store",
                "A return to a supplier leaves only from a site of the head-office unit (the Gudang). Stores never deal with suppliers.",
            ),
        _ => {}
    }

    // --- the destination pool --------------------------------------------
    match (route.destination.site_kind(), draft.destination_pool) {
        (Some(_), None) => problems.template(
            "destination_pool",
            "pool.required",
            "A flow to one of our sites names the pool goods land in (e.g. the store stockroom, or the store's return pool at the Gudang).",
        ),
        (Some(kind), Some(pool)) if !pool.exists_at(kind) => problems.template(
            "destination_pool",
            "pool.not_at_destination",
            format!(
                "{} does not exist at {}.",
                pool.label(),
                route.destination.label()
            ),
        ),
        (Some(_), Some(PoolRole::Return))
            if route.origin.site_kind() != Some(SiteKind::Store) =>
        {
            problems.template(
                "destination_pool",
                "pool.return_is_a_store_s",
                "A store's return pool is only for goods coming back from a store.",
            )
        }
        (None, Some(_)) => problems.template(
            "destination_pool",
            "pool.outside_party",
            "A flow to an outside party does not end in a pool of ours; leave the destination pool empty.",
        ),
        _ => {}
    }

    // --- the stages -------------------------------------------------------
    if draft.stages.is_empty() {
        problems.template("route", "stages.empty", "A flow needs at least one stage.");
        return problems.0;
    }

    let position = |kind: StageKind| draft.stages.iter().position(|stage| stage.kind == kind);
    let mut seen = BTreeSet::new();
    for (index, stage) in draft.stages.iter().enumerate() {
        let spec = stage.kind.spec();
        let label = spec.label;

        // Nothing counted twice.
        if !seen.insert(stage.kind) {
            problems.stage(
                index,
                "kind",
                "stage.repeated",
                format!("{label} is already in this flow. Each kind of stage appears once, so nothing is counted twice."),
            );
        }

        // The stage belongs on this route.
        if let Some(message) = misplaced(stage.kind, route) {
            problems.stage(index, "kind", "stage.not_on_route", message);
        }

        // Who performs it works where it happens.
        if let Some(kind) = route.site_kind_at(spec.side) {
            if stage.performer.works_at() != kind {
                problems.stage(
                    index,
                    "performer",
                    "stage.performer_elsewhere",
                    format!(
                        "{label} happens at {}; {} does not work there.",
                        RouteEnd::Site(kind).label(),
                        stage.performer.label()
                    ),
                );
            }
        }

        // Skipping.
        if stage.skippable && !spec.may_skip {
            problems.stage(
                index,
                "skippable",
                "stage.never_skipped",
                format!("{label} can never be skipped."),
            );
        }
        if stage.skippable
            && stage.kind == StageKind::Ship
            && route.destination.site_kind().is_some()
        {
            problems.stage(
                index,
                "skippable",
                "stage.ship_to_own_site",
                "To our own site the surat jalan is never skipped: the SJ is what the destination signs.",
            );
        }

        // Proof.
        let mut proofs = BTreeSet::new();
        for proof in &stage.proof {
            if !proofs.insert(*proof) {
                problems.stage(
                    index,
                    "proof",
                    "proof.repeated",
                    format!("{} is named twice.", proof.label()),
                );
            }
            if !spec.allowed_proof.contains(proof) {
                problems.stage(
                    index,
                    "proof",
                    "proof.not_allowed",
                    format!("{label} does not take {} as proof.", proof.label()),
                );
            }
        }
        if proofs.contains(&ProofKind::RfidScan) && proofs.contains(&ProofKind::ManualCount) {
            problems.stage(
                index,
                "proof",
                "proof.two_count_methods",
                "Choose an RFID scan or a manual count, not both: they are two ways of saying one number.",
            );
        }
        match spec.required_proof {
            RequiredProof::None => {}
            RequiredProof::CountMethod => {
                if !proofs.iter().any(|proof| proof.is_count_method()) {
                    problems.stage(
                        index,
                        "proof",
                        "proof.count_method_required",
                        format!("{label} must name how it counts: an RFID scan or a manual count."),
                    );
                }
            }
            RequiredProof::AnyOf(kinds) => {
                if !kinds.iter().any(|kind| proofs.contains(kind)) {
                    let names: Vec<&str> = kinds.iter().map(|kind| kind.label()).collect();
                    problems.stage(
                        index,
                        "proof",
                        "proof.required",
                        format!("{label} requires proof: {}.", names.join(" or ")),
                    );
                }
            }
        }
        if stage.kind == StageKind::HandoverWithProof
            && route.destination == RouteEnd::Party(PartyKind::Supplier)
            && !proofs.contains(&ProofKind::SignedReturnNote)
        {
            problems.stage(
                index,
                "proof",
                "proof.supplier_return_note",
                "A handover to a supplier requires the supplier's signed return note.",
            );
        }

        // Deadline.
        if let Some(hours) = stage.deadline_hours {
            if hours == 0 || hours > 720 {
                problems.stage(
                    index,
                    "deadline_hours",
                    "stage.deadline_range",
                    "A deadline is 1 to 720 hours (30 days).",
                );
            }
        }

        // Parameters: an object, and never an account (I9).
        match &stage.params {
            Value::Null => {}
            Value::Object(_) => {
                if names_an_account(&stage.params) {
                    problems.stage(
                        index,
                        "params",
                        "stage.params_name_an_account",
                        "A template names meanings, never accounts (rule I9): parameters may not carry an account. Finance's account map decides the account.",
                    );
                }
            }
            _ => problems.stage(
                index,
                "params",
                "stage.params_shape",
                "Stage parameters are an object.",
            ),
        }
    }

    // Order and dependencies.
    for (first, second) in PRECEDENCE {
        if let (Some(a), Some(b)) = (position(*first), position(*second)) {
            if a > b {
                problems.stage(
                    b,
                    "kind",
                    "stage.order",
                    format!(
                        "{} must come after {}.",
                        second.spec().label,
                        first.spec().label
                    ),
                );
            }
        }
    }
    for (stage, needed) in NEEDS {
        if let Some(at) = position(*stage) {
            if position(*needed).is_none() {
                problems.stage(
                    at,
                    "kind",
                    "stage.needs",
                    format!(
                        "{} needs {} before it.",
                        stage.spec().label,
                        needed.spec().label
                    ),
                );
            }
        }
    }
    if let Some(approval) = position(StageKind::Approval) {
        if let Some(moving) = draft
            .stages
            .iter()
            .position(|stage| stage.kind.moves_goods() || stage.kind == StageKind::CloseKoli)
        {
            if moving < approval {
                problems.stage(
                    approval,
                    "kind",
                    "approval.after_goods_moved",
                    "Approval comes before any goods move: approving what has already gone is not an approval.",
                );
            }
        }
    }

    // How it ends.
    let last = draft.stages.len() - 1;
    match route.destination {
        RouteEnd::Site(_) => {
            let accepting = match route.origin {
                RouteEnd::Party(PartyKind::Supplier) => StageKind::Verification,
                _ => StageKind::Receive,
            };
            match position(accepting) {
                None => problems.template(
                    "route",
                    "end.own_site_receives",
                    format!(
                        "A flow to our own site ends in {}: that stage is missing.",
                        accepting.spec().label
                    ),
                ),
                Some(at) => {
                    for (index, stage) in draft.stages.iter().enumerate().skip(at + 1) {
                        if !stage.kind.is_after_receipt() {
                            problems.stage(
                                index,
                                "kind",
                                "end.after_receipt",
                                format!(
                                    "A flow to our own site ends in {}: only Inspect, Tagging or Putaway may follow it.",
                                    accepting.spec().label
                                ),
                            );
                        }
                    }
                }
            }
            if route.origin.site_kind().is_some() && position(StageKind::Depart).is_none() {
                problems.template(
                    "route",
                    "end.travel_departs",
                    "Goods moving between sites must Depart before they are received.",
                );
            }
            if route.origin.site_kind().is_some() && position(StageKind::Ship).is_none() {
                problems.template(
                    "route",
                    "end.travel_ships",
                    "Goods between our sites travel under a surat jalan: add Ship (surat jalan).",
                );
            }
        }
        RouteEnd::Party(party) => {
            if draft.stages[last].kind != StageKind::HandoverWithProof {
                problems.stage(
                    last,
                    "kind",
                    "end.party_handover",
                    "A flow to an outside party ends in Handover with proof.",
                );
            }
            if party == PartyKind::Supplier && position(StageKind::Depart).is_none() {
                problems.template(
                    "route",
                    "end.travel_departs",
                    "A return to a supplier must Depart before it is handed over.",
                );
            }
            if party == PartyKind::Customer
                && position(StageKind::Depart).is_none()
                && position(StageKind::ReadyForPickup).is_none()
            {
                problems.template(
                    "route",
                    "end.customer_collects_or_receives",
                    "To a customer: goods Depart (delivered) or are Ready for pickup before they are handed over.",
                );
            }
        }
    }

    problems.0
}

/// Why a stage kind does not belong on this route, if it does not.
fn misplaced(kind: StageKind, route: FlowRoute) -> Option<String> {
    let from_supplier = route.origin == RouteEnd::Party(PartyKind::Supplier);
    let from_own_site = route.origin.site_kind().is_some();
    let to_own_site = route.destination.site_kind().is_some();
    let label = kind.spec().label;
    let refuse = |why: &str| Some(format!("{label} {why}"));
    match kind {
        StageKind::Arrival | StageKind::BlindCount | StageKind::Verification if !from_supplier => {
            refuse("is only for goods arriving from a supplier.")
        }
        StageKind::Pick
        | StageKind::Pack
        | StageKind::CloseKoli
        | StageKind::Ship
        | StageKind::Load
        | StageKind::Depart
            if !from_own_site =>
        {
            refuse("is only for goods leaving one of our sites.")
        }
        StageKind::Receive if !(from_own_site && to_own_site) => {
            refuse("is only between our own sites; from a supplier, goods are received through Arrival, Blind count and Verification.")
        }
        StageKind::HandoverWithProof if to_own_site => {
            refuse("is only to an outside party; our own site receives through Receive.")
        }
        StageKind::ReadyForPickup if route.destination != RouteEnd::Party(PartyKind::Customer) => {
            refuse("is only for a customer who collects.")
        }
        StageKind::Tagging | StageKind::Putaway if !route.destination.is_head_office() => {
            refuse("happens only at the Gudang.")
        }
        StageKind::Inspect if !to_own_site => refuse("happens only at one of our sites."),
        _ => None,
    }
}

/// Whether a parameter object carries anything that looks like an account.
fn names_an_account(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, inner)| {
            let key = key.to_ascii_lowercase();
            key.contains("account")
                || key.contains("akun")
                || key == "coa"
                || names_an_account(inner)
        }),
        Value::Array(items) => items.iter().any(names_an_account),
        _ => false,
    }
}

/// The draft is valid, or here is everything wrong with it.
pub fn check_template(draft: &FlowTemplateDraft) -> Result<(), Vec<TemplateProblem>> {
    let problems = validate_template(draft);
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems)
    }
}
