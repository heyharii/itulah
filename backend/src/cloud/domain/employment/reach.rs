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
//! which places somebody may act in and nothing at all about what they may do
//! once there. Keeping them apart is what lets `required_role` stay the single
//! mapping from a key to a rung, exactly as `audit`'s module doc promised it
//! would when per-place grants arrived.
//!
//! # Why the posting, and not the session
//!
//! `Principal` carries no place, and it must not start. A session says who
//! signed in and which rung they hold; where somebody is *posted* is HR data
//! with a history and an authorising officer behind every change. A place
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
//! bounds.
//!
//! [`Reach::Only`] for every other posting, head office included. One place,
//! the one they are posted to.
//!
//! **Head office used to be a second route to `Everywhere`** — anybody posted
//! to a place of kind `HO`, at any rung — on the reading that head office is
//! the employer rather than a fourteenth shop, so an HR assistant posted there
//! administers the whole workforce.
//!
//! That reading assumed head office contains HR and nobody else. It does not:
//! the buyers, the finance staff, the visual merchandisers and the IT people
//! are posted to `ho` as well (Hari, 2026-09-09 — "ho ada jg karyawannya ya,
//! ga hanya toko"). Under the old rule a procurement supervisor reached every
//! employee in the company and could decide leave in all thirteen shops — not
//! because anybody had made them HR, but because their desk is in the same
//! building as HR's. A rule that grants company-wide authority by **office
//! address** grants it to whoever happens to sit at that address.
//!
//! So it is withdrawn, in the narrowing direction: a posting to `ho` reaches
//! `ho`, exactly as a posting to a shop reaches that shop. Company-wide reach
//! comes from the Admin rung, which is what HR head office holds — the same
//! signal `employerScope` already reads in the hub to decide which face of the
//! People module to offer. An HR assistant who must reach every place and must
//! *not* approve payroll needs a third thing this model does not have yet: a
//! per-place grant beside the rung. That is a decision, not a default, and the
//! safe reading while it stays open is the narrow one.
//!
//! [`Reach::Nowhere`] for a session with no open posting behind it. Not a
//! permissive default and not an error: we genuinely do not know where this
//! person works, so we cannot say whose roster is theirs. A supervisor login
//! with no employment record — a machine account, a login issued before HR got
//! round to the paperwork — reaches nothing until somebody posts them
//! somewhere, and that is the safe reading of an unanswered question.

use super::ids::PlaceId;
use crate::cloud::domain::Role;

/// What kind of place a posting names — `org_place.kind`.
///
/// Not `SiteKind`, which has only `Dc` and `Store`: every row of `site` is a
/// node that syncs, and head office is not one. The two vocabularies stay
/// separate for the same reason the two tables do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaceKind {
    HeadOffice,
    DistributionCentre,
    Store,
}

impl PlaceKind {
    /// The stored code, as `org_place.kind`'s check constraint spells it.
    pub const fn code(self) -> &'static str {
        match self {
            Self::HeadOffice => "HO",
            Self::DistributionCentre => "DC",
            Self::Store => "STORE",
        }
    }

    /// `None` for a code this build has not been taught, which a caller must
    /// treat as "not head office" rather than as an error. A place kind added
    /// to the table by a later migration must not silently widen anybody's
    /// reach in an older binary still serving traffic during a deploy.
    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "HO" => Some(Self::HeadOffice),
            "DC" => Some(Self::DistributionCentre),
            "STORE" => Some(Self::Store),
            _ => None,
        }
    }
}

/// A caller's own open posting: the place, and what kind of place it is.
///
/// The kind travels with the id because the head-office rule turns on it, and
/// resolving `ho` against a hardcoded string here would be a second place that
/// has to be edited if the company ever opens a second head office.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Posting {
    place_id: PlaceId,
    kind: PlaceKind,
}

impl Posting {
    pub fn new(place_id: PlaceId, kind: PlaceKind) -> Self {
        Self { place_id, kind }
    }

    pub fn place_id(&self) -> &PlaceId {
        &self.place_id
    }

    pub fn kind(&self) -> PlaceKind {
        self.kind
    }
}

/// The places one caller may act in, on one request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reach {
    /// Every place, including ones created after this request was resolved.
    Everywhere,
    /// Exactly one — the caller's own posting.
    Only(PlaceId),
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
            // next rule may want it; it no longer decides this one.
            Some(posting) => Self::Only(posting.place_id.clone()),
        }
    }

    /// May the caller act on something that belongs to this place?
    ///
    /// `None` means the thing belongs to no place — an employment record
    /// nobody has posted anywhere yet. [`Reach::Everywhere`] covers it, because
    /// somebody has to be able to see a person before they can post them; a
    /// bounded reach does not, because a record in no place is not in *this*
    /// place, and a store manager finding unposted strangers in their team list
    /// is the same leak this bound exists to close.
    pub fn covers(&self, place_id: Option<&str>) -> bool {
        match self {
            Self::Everywhere => true,
            Self::Nowhere => false,
            Self::Only(mine) => place_id.is_some_and(|place| place == mine.as_str()),
        }
    }

    /// The single place this reach is bounded to, when it is bounded to one.
    ///
    /// What a list query filters by. `None` for both of the other answers, and
    /// they are not interchangeable — see [`Reach::is_nowhere`] — so a caller
    /// that filters on this must check which it is holding first.
    pub fn sole_place(&self) -> Option<&PlaceId> {
        match self {
            Self::Only(place) => Some(place),
            _ => None,
        }
    }

    /// Nothing at all, as distinct from "no filter needed".
    ///
    /// The distinction is the whole reason this is an enum rather than an
    /// `Option<PlaceId>`: `None` there would have to mean both "everywhere" and
    /// "nowhere", and a list query written against it returns the entire
    /// workforce for exactly the caller who should see none of it.
    pub fn is_nowhere(&self) -> bool {
        matches!(self, Self::Nowhere)
    }

    /// How to say this on the wire and in a refusal.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Everywhere => "EVERYWHERE",
            Self::Only(_) => "ONE_PLACE",
            Self::Nowhere => "NOWHERE",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn posting(place: &str, kind: PlaceKind) -> Posting {
        Posting::new(
            PlaceId::try_new(place).unwrap_or_else(|error| panic!("place: {error}")),
            kind,
        )
    }

    /// The bound this whole module exists to impose: today any store
    /// supervisor can list every employee in the company.
    #[test]
    fn a_supervisor_posted_to_one_store_reaches_that_store_and_no_other() {
        let reach = Reach::resolve(
            Role::Supervisor,
            Some(&posting("store-07", PlaceKind::Store)),
        );
        assert_eq!(
            reach,
            Reach::Only(
                PlaceId::try_new("store-07").unwrap_or_else(|error| panic!("place: {error}"))
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
        assert_eq!(reach.sole_place(), None);
    }

    /// The rule this replaced granted `Everywhere` to any rung posted to a
    /// place of kind `HO`. Head office employs buyers, finance staff and
    /// merchandisers as well as HR, so that rule handed the whole workforce to
    /// whoever sat in the building. Reach follows the rung now; the kind of
    /// place somebody is posted to grants nothing by itself.
    #[test]
    fn head_office_is_a_place_not_a_pass_to_every_place() {
        let reach = Reach::resolve(
            Role::Supervisor,
            Some(&posting("ho", PlaceKind::HeadOffice)),
        );
        assert_eq!(reach, Reach::Only(PlaceId::try_new("ho").unwrap()));
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
        let reach = Reach::resolve(Role::Admin, Some(&posting("ho", PlaceKind::HeadOffice)));
        assert_eq!(reach, Reach::Everywhere);
        assert!(reach.covers(Some("store-03")));
        assert!(reach.covers(None));
    }

    /// Decision taken with the formulation: Admin is unbounded, whatever their
    /// posting says. An HR officer who happens to be posted to a shop still
    /// terminates contracts for the whole company.
    #[test]
    fn an_admin_is_unbounded_even_when_posted_to_one_shop() {
        let reach = Reach::resolve(Role::Admin, Some(&posting("store-07", PlaceKind::Store)));
        assert_eq!(reach, Reach::Everywhere);
        assert!(reach.covers(Some("store-03")));
        assert_eq!(Reach::resolve(Role::Admin, None), Reach::Everywhere);
    }

    /// A cashier posted to a shop reaches that shop, and the rung check refuses
    /// them separately. Reach answers where, never what.
    #[test]
    fn reach_says_where_and_never_what() {
        let reach = Reach::resolve(Role::Cashier, Some(&posting("store-07", PlaceKind::Store)));
        assert_eq!(
            reach,
            Reach::Only(
                PlaceId::try_new("store-07").unwrap_or_else(|error| panic!("place: {error}"))
            )
        );
    }

    /// A kind a later migration adds must not widen anybody's reach in a binary
    /// that predates it.
    #[test]
    fn an_unknown_place_kind_is_not_head_office() {
        assert_eq!(PlaceKind::parse("REGION"), None);
        assert_eq!(PlaceKind::parse("ho"), None, "the code is upper case");
        assert_eq!(PlaceKind::parse("HO"), Some(PlaceKind::HeadOffice));
        assert_eq!(PlaceKind::HeadOffice.code(), "HO");
        assert_eq!(PlaceKind::DistributionCentre.code(), "DC");
        assert_eq!(PlaceKind::Store.code(), "STORE");
    }
}
