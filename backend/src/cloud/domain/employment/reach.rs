//! *Where* a caller may act — the half of "may they" a rung cannot answer.
//!
//! # Two questions, and one of them was missing
//!
//! [`super::audit::required_role`] says which rung of `CASHIER < SUPERVISOR <
//! ADMIN` an action key needs. That was the whole answer while head office was
//! the only caller of this module. It stops being the whole answer the moment
//! a store manager may approve leave: every store manager holds the same rung,
//! and a rung cannot tell store-07's manager from store-03's.
//!
//! So authority is a pair — *which rung*, and *where* — and this module is the
//! second half. It deliberately knows nothing about the first: a [`Reach`] says
//! which units somebody may act in and nothing at all about what they may do
//! once there. Keeping them apart is what lets `required_role` stay the single
//! mapping from a key to a rung, exactly as `audit`'s module doc promised it
//! would when per-unit grants arrived.
//!
//! "Where" is a **unit** — head office or one store, the organisation that
//! owns books and people (`CONTEXT.md`, "The organisation") — and never a site.
//! A manager answers for Store 07, not for the building Store 07 trades from;
//! when a store opens a second premises, its manager reaches both through the
//! unit without anybody editing a grant. Until 2026-09-27 this was spelled
//! `org_place`, a second copy of the unit list under a second name; migration
//! 0451 dropped it.
//!
//! # Why the posting, and not the session
//!
//! `Principal` carries no unit, and it must not start. A session says who
//! signed in and which rung they hold; where somebody is *posted* is HR data
//! with a history and an authorising officer behind every change. A unit
//! copied into the session is wrong from the moment somebody is transferred
//! until the moment they next sign in — and a transfer is precisely the
//! occasion on which being wrong about this matters.
//!
//! So reach is resolved per request from `app_user.employee_id` → the one open
//! `employee_assignment` span. It costs a query on the routes that need it, and
//! it is right on the first request after the transfer rather than the first
//! request after the next sign-in.
//!
//! # The three answers, and the one that was withdrawn
//!
//! [`Reach::Everywhere`] for an Admin, whatever their posting or lack of one:
//! ending employment and setting the rules are head-office work by definition,
//! and a bound on them would only ever be a bound on the person who defines the
//! bounds. This is how head office reaches every unit: through the rung its HR
//! holds, not through the address its desks are at.
//!
//! [`Reach::Only`] for every other posting, head office included. One unit,
//! the one they are posted to.
//!
//! **Head office used to be a second route to `Everywhere`** — anybody posted
//! to a unit of kind `HO`, at any rung — on the reading that head office is
//! the employer rather than a fourteenth shop, so an HR assistant posted there
//! administers the whole workforce.
//!
//! That reading assumed head office contains HR and nobody else. It does not:
//! the buyers, the finance staff, the visual merchandisers and the IT people
//! are posted to head office as well (Hari, 2026-09-09 — "ho ada jg
//! karyawannya ya, ga hanya toko"). Under the old rule a procurement supervisor
//! reached every employee in the company and could decide leave in all
//! thirteen shops — not because anybody had made them HR, but because their
//! desk is in the same building as HR's. A rule that grants company-wide
//! authority by **office address** grants it to whoever happens to sit at that
//! address.
//!
//! So it is withdrawn, in the narrowing direction: a posting to head office
//! reaches head office, exactly as a posting to a shop reaches that shop.
//! Company-wide reach comes from the Admin rung, which is what HR head office
//! holds — the same signal `employerScope` already reads in the hub to decide
//! which face of the People module to offer. An HR assistant who must reach
//! every unit and must *not* approve payroll needs a third thing this model
//! does not have yet: a per-unit grant beside the rung. That is a decision, not
//! a default, and the safe reading while it stays open is the narrow one.
//!
//! [`Reach::Nowhere`] for a session with no open posting behind it. Not a
//! permissive default and not an error: we genuinely do not know where this
//! person works, so we cannot say whose roster is theirs. A supervisor login
//! with no employment record — a machine account, a login issued before HR got
//! round to the paperwork — reaches nothing until somebody posts them
//! somewhere, and that is the safe reading of an unanswered question.
//!
//! # The person in charge
//!
//! Each unit has a PIC (0452): the one person answerable for it, who gets its
//! reach and, as they arrive, its approvals. The PIC's reach is the unit they
//! answer for — and a PIC must be posted at that unit, which is exactly the
//! posting [`Reach::resolve`] already reads. So appointing a PIC widens
//! nobody's reach past their own unit, and a PIC who is transferred away stops
//! being the PIC (the reader of "who is in charge" requires the posting to
//! still hold) at the same moment they stop reaching the unit. What the
//! appointment adds is recorded on the [`Posting`] as
//! [`Posting::is_in_charge`], for the approvals that will turn on it.

use super::ids::UnitId;
use crate::cloud::domain::Role;

/// What kind of unit a posting names — `unit.kind`.
///
/// The kind of *organisation*, not of building: that is `site.kind`, and the
/// two are different questions — head office's Gudang is a warehouse site of
/// the `HO` unit, not a unit of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitKind {
    HeadOffice,
    Store,
    /// The online unit, when it is opened: its own books, with the web shop
    /// and the marketplaces as channels inside it. Admitted by `unit.kind`'s
    /// check already, so opening it is a row and not a deploy.
    Online,
}

impl UnitKind {
    /// The stored code, as `unit.kind`'s check constraint spells it.
    pub const fn code(self) -> &'static str {
        match self {
            Self::HeadOffice => "HO",
            Self::Store => "STORE",
            Self::Online => "ONLINE",
        }
    }

    /// `None` for a code this build has not been taught, which a caller must
    /// treat as "not head office" rather than as an error. A unit kind added
    /// to the table by a later migration must not silently widen anybody's
    /// reach in an older binary still serving traffic during a deploy.
    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "HO" => Some(Self::HeadOffice),
            "STORE" => Some(Self::Store),
            "ONLINE" => Some(Self::Online),
            _ => None,
        }
    }
}

/// A caller's own open posting: the unit, what kind of unit it is, and whether
/// they are its person in charge.
///
/// The kind travels with the id because a rule may turn on it, and resolving
/// `ho` against a hardcoded string here would be a second place that has to be
/// edited if the head-office unit's id ever changes — it is found by its kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Posting {
    unit_id: UnitId,
    kind: UnitKind,
    in_charge: bool,
}

impl Posting {
    pub fn new(unit_id: UnitId, kind: UnitKind) -> Self {
        Self {
            unit_id,
            kind,
            in_charge: false,
        }
    }

    /// The same posting, held by the unit's current PIC.
    #[must_use]
    pub fn in_charge(mut self) -> Self {
        self.in_charge = true;
        self
    }

    pub fn unit_id(&self) -> &UnitId {
        &self.unit_id
    }

    pub fn kind(&self) -> UnitKind {
        self.kind
    }

    /// Is this person the current PIC of the unit they are posted to?
    pub fn is_in_charge(&self) -> bool {
        self.in_charge
    }
}

/// The units one caller may act in, on one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reach {
    /// Every unit, including ones created after this request was resolved.
    Everywhere,
    /// Exactly one — the caller's own posting, which for a PIC is also the unit
    /// they answer for.
    Only(UnitId),
    /// None at all.
    Nowhere,
}

impl Reach {
    /// Resolve a caller's reach from their rung and their own open posting.
    ///
    /// The whole rule, in one function, so there is one place to read it and
    /// one place to change it.
    pub fn resolve(role: Role, posting: Option<&Posting>) -> Self {
        if role == Role::Admin {
            return Self::Everywhere;
        }
        match posting {
            None => Self::Nowhere,
            // Head office included: see the module doc. The kind is still
            // carried on `Posting` because it is true of the posting and the
            // next rule may want it; it no longer decides this one. A PIC is
            // posted at the unit they answer for, so their reach is this same
            // unit — see "The person in charge" above.
            Some(posting) => Self::Only(posting.unit_id.clone()),
        }
    }

    /// May the caller act on something that belongs to this unit?
    ///
    /// `None` means the thing belongs to no unit — an employment record
    /// nobody has posted anywhere yet. [`Reach::Everywhere`] covers it, because
    /// somebody has to be able to see a person before they can post them; a
    /// bounded reach does not, because a record in no unit is not in *this*
    /// unit, and a store manager finding unposted strangers in their team list
    /// is the same leak this bound exists to close.
    pub fn covers(&self, unit_id: Option<&str>) -> bool {
        match self {
            Self::Everywhere => true,
            Self::Nowhere => false,
            Self::Only(mine) => unit_id.is_some_and(|unit| unit == mine.as_str()),
        }
    }

    /// The single unit this reach is bounded to, when it is bounded to one.
    ///
    /// What a list query filters by. `None` for both of the other answers, and
    /// they are not interchangeable — see [`Reach::is_nowhere`] — so a caller
    /// that filters on this must check which it is holding first.
    pub fn sole_unit(&self) -> Option<&UnitId> {
        match self {
            Self::Only(unit) => Some(unit),
            _ => None,
        }
    }

    /// Nothing at all, as distinct from "no filter needed".
    ///
    /// The distinction is the whole reason this is an enum rather than an
    /// `Option<UnitId>`: `None` there would have to mean both "everywhere" and
    /// "nowhere", and a list query written against it returns the entire
    /// workforce for exactly the caller who should see none of it.
    pub fn is_nowhere(&self) -> bool {
        matches!(self, Self::Nowhere)
    }

    /// This reach, cut down to one unit — what a call relayed by a unit's own
    /// node may touch, whoever it is relayed for.
    ///
    /// A store node proves which unit its site belongs to; the person it relays
    /// for may reach more (an Admin reaches everywhere) or somewhere else
    /// entirely (an area supervisor posted to head office). Neither travels
    /// through the shop: a head-office login signed in at store-07's till
    /// reaches store-07, and a posting that is not store-07 reaches nothing
    /// there. `Everywhere` becomes `Only(unit)`, `Only(unit)` stays, any other
    /// `Only` and `Nowhere` are `Nowhere` — the intersection of the two bounds,
    /// and never wider than either.
    ///
    /// Applied once, where reach is resolved, rather than by each handler: a
    /// list that takes no unit in its query is bounded by the node exactly as
    /// one that does, because both read the same `Reach`.
    #[must_use]
    pub fn bounded_to(self, unit: &UnitId) -> Self {
        match self {
            Self::Everywhere => Self::Only(unit.clone()),
            Self::Only(mine) if &mine == unit => Self::Only(mine),
            Self::Only(_) | Self::Nowhere => Self::Nowhere,
        }
    }

    /// How to say this on the wire and in a refusal.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Everywhere => "EVERYWHERE",
            Self::Only(_) => "ONE_UNIT",
            Self::Nowhere => "NOWHERE",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn posting(unit: &str, kind: UnitKind) -> Posting {
        Posting::new(
            UnitId::try_new(unit).unwrap_or_else(|error| panic!("unit: {error}")),
            kind,
        )
    }

    /// The bound this whole module exists to impose: today any store
    /// supervisor can list every employee in the company.
    #[test]
    fn a_supervisor_posted_to_one_store_reaches_that_store_and_no_other() {
        let reach = Reach::resolve(
            Role::Supervisor,
            Some(&posting("store-07", UnitKind::Store)),
        );
        assert_eq!(
            reach,
            Reach::Only(
                UnitId::try_new("store-07").unwrap_or_else(|error| panic!("unit: {error}"))
            )
        );
        assert!(reach.covers(Some("store-07")));
        assert!(!reach.covers(Some("store-03")));
        assert!(!reach.covers(Some("dc")));
        assert!(!reach.covers(Some("ho")));
    }

    /// A login with no employment record behind it — a machine account, or a
    /// person HR has not finished the paperwork for.
    #[test]
    fn a_supervisor_with_no_posting_reaches_nothing() {
        let reach = Reach::resolve(Role::Supervisor, None);
        assert_eq!(reach, Reach::Nowhere);
        assert!(reach.is_nowhere());
        assert!(!reach.covers(Some("store-07")));
        assert!(!reach.covers(None));
        // And it must not be mistaken for "no filter needed".
        assert_eq!(reach.sole_unit(), None);
    }

    /// The rule this replaced granted `Everywhere` to any rung posted to a
    /// unit of kind `HO`. Head office employs buyers, finance staff and
    /// merchandisers as well as HR, so that rule handed the whole workforce to
    /// whoever sat in the building. Reach follows the rung now; the kind of
    /// unit somebody is posted to grants nothing by itself.
    #[test]
    fn head_office_is_a_unit_not_a_pass_to_every_unit() {
        let reach = Reach::resolve(Role::Supervisor, Some(&posting("ho", UnitKind::HeadOffice)));
        assert_eq!(reach, Reach::Only(unit("ho")));
        assert!(reach.covers(Some("ho")));
        assert!(
            !reach.covers(Some("store-03")),
            "a shop is not head office's"
        );
        assert!(!reach.covers(Some("dc")));
        // And an unposted record is not head office's either: seeing a person
        // nobody has placed yet is Admin work.
        assert!(!reach.covers(None));
    }

    /// Head office HR is Admin, and the rung is what carries company-wide
    /// reach — the same signal the hub reads to decide which face to offer.
    #[test]
    fn head_office_hr_reaches_everywhere_by_rung() {
        let reach = Reach::resolve(Role::Admin, Some(&posting("ho", UnitKind::HeadOffice)));
        assert_eq!(reach, Reach::Everywhere);
        assert!(reach.covers(Some("store-03")));
        assert!(reach.covers(None));
    }

    /// Decision taken with the formulation: Admin is unbounded, whatever their
    /// posting says. An HR officer who happens to be posted to a shop still
    /// terminates contracts for the whole company.
    #[test]
    fn an_admin_is_unbounded_even_when_posted_to_one_shop() {
        let reach = Reach::resolve(Role::Admin, Some(&posting("store-07", UnitKind::Store)));
        assert_eq!(reach, Reach::Everywhere);
        assert!(reach.covers(Some("store-03")));
        assert_eq!(Reach::resolve(Role::Admin, None), Reach::Everywhere);
    }

    /// A cashier posted to a shop reaches that shop, and the rung check refuses
    /// them separately. Reach answers where, never what.
    #[test]
    fn reach_says_where_and_never_what() {
        let reach = Reach::resolve(Role::Cashier, Some(&posting("store-07", UnitKind::Store)));
        assert_eq!(
            reach,
            Reach::Only(
                UnitId::try_new("store-07").unwrap_or_else(|error| panic!("unit: {error}"))
            )
        );
    }

    /// A kind a later migration adds must not widen anybody's reach in a binary
    /// that predates it.
    #[test]
    fn an_unknown_unit_kind_is_not_head_office() {
        assert_eq!(UnitKind::parse("REGION"), None);
        assert_eq!(
            UnitKind::parse("DC"),
            None,
            "the warehouse is a site, not a unit"
        );
        assert_eq!(UnitKind::parse("ho"), None, "the code is upper case");
        assert_eq!(UnitKind::parse("HO"), Some(UnitKind::HeadOffice));
        assert_eq!(UnitKind::HeadOffice.code(), "HO");
        assert_eq!(UnitKind::Store.code(), "STORE");
        assert_eq!(UnitKind::Online.code(), "ONLINE");
    }

    fn unit(id: &str) -> UnitId {
        UnitId::try_new(id).unwrap_or_else(|error| panic!("unit: {error}"))
    }

    /// Head office HR signed in at store-07's till reaches store-07 through it,
    /// and not the other twelve shops.
    #[test]
    fn a_relayed_admin_reaches_only_the_relaying_unit() {
        let reach = Reach::resolve(Role::Admin, None).bounded_to(&unit("store-07"));
        assert_eq!(reach, Reach::Only(unit("store-07")));
        assert!(reach.covers(Some("store-07")));
        assert!(!reach.covers(Some("store-03")));
        // Unposted strangers are Everywhere's, and a bounded reach is not.
        assert!(!reach.covers(None));
    }

    /// A posting somewhere else reaches nothing at this node — not its own
    /// unit, and not this one.
    #[test]
    fn a_relayed_posting_elsewhere_reaches_nothing() {
        let posted_elsewhere = Reach::resolve(
            Role::Supervisor,
            Some(&posting("store-03", UnitKind::Store)),
        );
        let reach = posted_elsewhere.bounded_to(&unit("store-07"));
        assert_eq!(reach, Reach::Nowhere);
        assert!(!reach.covers(Some("store-03")));
        assert!(!reach.covers(Some("store-07")));
    }

    #[test]
    fn a_relayed_posting_here_stays_and_nowhere_stays_nowhere() {
        let here = Reach::resolve(
            Role::Supervisor,
            Some(&posting("store-07", UnitKind::Store)),
        );
        assert_eq!(
            here.bounded_to(&unit("store-07")),
            Reach::Only(unit("store-07"))
        );
        assert_eq!(Reach::Nowhere.bounded_to(&unit("store-07")), Reach::Nowhere);
    }
}
