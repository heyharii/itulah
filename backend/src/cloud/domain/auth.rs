//! Role-based authorization rules, kept pure so they hold on any node and any
//! storage engine. The HTTP layer supplies (method, path) and the caller's
//! role; this module answers "is that allowed" without touching I/O.
//!
//! Roles form a strict ladder — CASHIER < SUPERVISOR < ADMIN — because a POS
//! floor has exactly these three trust levels: the person selling, the person
//! who can move or destroy stock and approve exceptions, and the person who
//! administers the node itself.

use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Role {
    Cashier,
    Supervisor,
    Admin,
}

impl Role {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cashier => "CASHIER",
            Self::Supervisor => "SUPERVISOR",
            Self::Admin => "ADMIN",
        }
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Role {
    type Err = AuthError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "CASHIER" => Ok(Self::Cashier),
            "SUPERVISOR" => Ok(Self::Supervisor),
            "ADMIN" => Ok(Self::Admin),
            _ => Err(AuthError::UnknownRole(value.to_owned())),
        }
    }
}

/// The minimum role required for a request, derived from method + path.
///
/// The rules, in precedence order:
/// - node administration (user management, control plane, replay/repost,
///   sync operator actions) is ADMIN;
/// - sale void and post-completion returns are SUPERVISOR — the classic POS
///   "manager key turn";
/// - any other mutation outside the sales flow (movements, counts, allotments,
///   commercial authoring, missing resolution) is SUPERVISOR;
/// - the sales flow itself and every read is CASHIER.
pub fn required_role(method: &str, path: &str) -> Role {
    let admin_prefixes = [
        "/api/v1/auth/users",
        "/api/v1/auth/edge-assignments",
        "/api/v1/auth/edge-policies",
        "/api/v1/auth/rfid-devices",
        "/api/v1/inventory/control",
        "/api/v1/inventory/replay",
        "/api/v1/inventory/repost",
        "/api/v1/sync/trigger",
        "/api/v1/sync/breaker",
        "/api/v1/sync/dead-letters",
        "/api/v1/sync/origins",
        "/api/v1/sync/commands",
    ];
    if admin_prefixes.iter().any(|p| path.starts_with(p)) {
        return Role::Admin;
    }
    // Finance, before the blanket GET rule below.
    //
    // That rule makes every read a CASHIER read, which is right for stock and
    // sales and quite wrong here: a till operator has no business reading the
    // general ledger, the supplier balances, or what the company owes. So the
    // whole surface is SUPERVISOR to read, and the acts that move money or seal
    // a month are ADMIN.
    //
    // Riding the existing three roles is a compromise and worth naming as one.
    // A real accountant wants their own role and a maker/checker split — the
    // `counted_by <> verified_by` constraint on `goods_receipt_line` is the
    // pattern — but `Role` is on the wire that Edge and Store speak, so
    // widening it is a change with a blast radius this does not need yet.
    if path.starts_with("/api/v1/finance") {
        if method.eq_ignore_ascii_case("GET") {
            return Role::Supervisor;
        }
        return Role::Admin;
    }
    if method.eq_ignore_ascii_case("GET") {
        return Role::Cashier;
    }
    if path.starts_with("/api/v1/auth/") {
        // login / change-password / me: any authenticated user.
        return Role::Cashier;
    }
    // Self-service. `me` is the caller's own record by definition — the
    // handler resolves it from the session and it can name nobody else — so a
    // write under it is somebody acting on themselves, which the fall-through
    // at the bottom would otherwise make Supervisor work. A cashier who could
    // not ask for her own holiday would have to ask her manager to ask.
    //
    // This widens the *path* gate and grants nothing: every handler under
    // `/employees/{id}/…` re-checks its own action key against the ladder, so
    // `POST /employees/me/employment` is still `people.employment.change` and
    // still ADMIN. What this removes is a second gate that could not tell
    // "changing your own address" from "ending your own employment", and
    // answered Supervisor to both.
    if path.starts_with("/api/v1/employees/me/") {
        return Role::Cashier;
    }
    // Talking is not an administrative act. Without this, the fall-through at
    // the bottom would make posting a message require Supervisor — a cashier
    // could read a conversation they are in and not answer it.
    if path.starts_with("/api/v1/chat")
        || path.starts_with("/api/v1/discussions")
        || path.starts_with("/api/v1/files")
    {
        return Role::Cashier;
    }
    // Enrolling a card and issuing its pairing code both happen at a till, with
    // the customer standing there. Without this they would fall through to
    // Supervisor at the bottom, and a cashier could hand somebody a card they
    // are then unable to activate.
    //
    // Segments are under the same prefix and are NOT that act: writing one is
    // deciding who the company talks to, and retiring one changes what a
    // campaign already sent was sent against. They fall through to Supervisor
    // with the rest of the marketing surface. The exclusion is written before
    // the arm rather than as a narrower prefix on it, because the acts a
    // cashier may perform are the two named above and a third added under
    // `/members/…` later should have to say so.
    if path.starts_with("/api/v1/members") && !path.starts_with("/api/v1/members/segments") {
        return Role::Cashier;
    }
    // Spending a voucher happens at a counter with a shopper standing there,
    // so it is the same rung as taking their cash. Issuing one and stopping one
    // are not: both move value on somebody's say-so and fall through to
    // Supervisor at the bottom with the rest of Commercial.
    if path.starts_with("/api/v1/commercial/vouchers") && path.ends_with("/redeem") {
        return Role::Cashier;
    }
    if path.starts_with("/api/v1/sales") {
        let supervisor_actions = ["/void", "/returns"];
        if supervisor_actions.iter().any(|s| path.ends_with(s)) {
            return Role::Supervisor;
        }
        return Role::Cashier;
    }
    Role::Supervisor
}

pub fn role_allows(required: Role, actual: Role) -> bool {
    actual >= required
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AuthError {
    #[error("unknown role: {0}")]
    UnknownRole(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_form_a_strict_ladder() {
        assert!(role_allows(Role::Cashier, Role::Cashier));
        assert!(role_allows(Role::Cashier, Role::Admin));
        assert!(!role_allows(Role::Supervisor, Role::Cashier));
        assert!(!role_allows(Role::Admin, Role::Supervisor));
    }

    #[test]
    fn sales_flow_is_cashier_but_void_and_returns_need_supervisor() {
        assert_eq!(required_role("POST", "/api/v1/sales"), Role::Cashier);
        assert_eq!(
            required_role("POST", "/api/v1/sales/abc/lines"),
            Role::Cashier
        );
        assert_eq!(
            required_role("POST", "/api/v1/sales/abc/payments"),
            Role::Cashier
        );
        assert_eq!(
            required_role("POST", "/api/v1/sales/abc/complete"),
            Role::Cashier
        );
        assert_eq!(
            required_role("POST", "/api/v1/sales/abc/void"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("POST", "/api/v1/sales/abc/returns"),
            Role::Supervisor
        );
    }

    #[test]
    fn reads_are_cashier_and_inventory_mutation_is_supervisor() {
        assert_eq!(
            required_role("GET", "/api/v1/inventory/movements"),
            Role::Cashier
        );
        assert_eq!(
            required_role("POST", "/api/v1/inventory/movements"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("POST", "/api/v1/commercial/publications"),
            Role::Supervisor
        );
    }

    /// A card is presented at a counter, so a cashier can spend one — and
    /// cannot issue one or stop one, because both are giving value away.
    #[test]
    fn a_cashier_may_spend_a_voucher_and_not_issue_one() {
        assert_eq!(
            required_role("POST", "/api/v1/commercial/vouchers/GIFT123456/redeem"),
            Role::Cashier
        );
        assert_eq!(
            required_role("POST", "/api/v1/commercial/vouchers"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("POST", "/api/v1/commercial/vouchers/GIFT123456/void"),
            Role::Supervisor
        );
    }

    /// A card is enrolled and activated with the shopper standing at the
    /// counter, so both are the same rung as taking their money.
    ///
    /// Worth pinning rather than leaving to the fall-through: without the
    /// `/api/v1/members` arm both land on Supervisor, and a cashier could hand
    /// somebody a card they are then unable to activate — a loyalty scheme
    /// whose sign-in needs a manager is a loyalty scheme nobody signs in to.
    ///
    /// The second half is the one that needed a test: segments live under the
    /// same prefix and are a different act. Writing one decides who the company
    /// talks to and retiring one changes what a campaign already sent was sent
    /// against, so both stay Supervisor. Reading is Cashier like every other
    /// read on this API.
    #[test]
    fn a_cashier_may_enrol_a_card_and_activate_it_but_not_write_a_segment() {
        assert_eq!(required_role("POST", "/api/v1/members"), Role::Cashier);
        assert_eq!(
            required_role("POST", "/api/v1/members/M-000123/pairing-code"),
            Role::Cashier
        );
        assert_eq!(required_role("GET", "/api/v1/members"), Role::Cashier);
        assert_eq!(
            required_role("POST", "/api/v1/members/segments/saved"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("POST", "/api/v1/members/segments/saved/abc/retire"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("POST", "/api/v1/members/segments/preview"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("GET", "/api/v1/members/segments"),
            Role::Cashier
        );
    }

    /// Everyone talks. A cashier who could read a conversation and not answer
    /// it would be worse than one who could not see it at all.
    #[test]
    fn talking_is_cashier_on_the_way_in_as_well_as_out() {
        assert_eq!(
            required_role("POST", "/api/v1/chat/conversations/abc/messages"),
            Role::Cashier
        );
        assert_eq!(
            required_role("POST", "/api/v1/discussions/abc/posts"),
            Role::Cashier
        );
        assert_eq!(required_role("POST", "/api/v1/files"), Role::Cashier);
    }

    /// A cashier who could not ask for her own holiday would have to ask her
    /// manager to ask. `me` is the caller's own record by definition, so a
    /// write under it is somebody acting on themselves.
    #[test]
    fn asking_about_yourself_is_cashier_work() {
        assert_eq!(
            required_role("POST", "/api/v1/employees/me/leave-requests"),
            Role::Cashier
        );
        assert_eq!(
            required_role("POST", "/api/v1/employees/me/leave-requests/LV-1/withdraw"),
            Role::Cashier
        );
        // Somebody *else's* record is not self-service, and falls through to
        // Supervisor with the rest of the write surface.
        assert_eq!(
            required_role("POST", "/api/v1/employees/emp_abc/leave-requests"),
            Role::Supervisor
        );
    }

    /// The carve-out above widens the path gate and grants nothing: every
    /// handler under `/employees/{id}/…` re-checks its own action key, so the
    /// acts that were ADMIN before it are ADMIN after it.
    ///
    /// Stated as a test because the path gate cannot express the difference
    /// between changing your own address and ending your own employment, and
    /// the reason that is safe lives in another module.
    #[test]
    fn self_service_does_not_let_anybody_end_their_own_employment() {
        use crate::cloud::domain::{actions, required_role_for_action};
        assert_eq!(
            required_role_for_action(actions::EMPLOYMENT_CHANGE),
            Role::Admin
        );
        assert_eq!(
            required_role_for_action(actions::PROFILE_CHANGE),
            Role::Admin
        );
        assert_eq!(required_role_for_action(actions::LEAVE_GRANT), Role::Admin);
        // And the one act the carve-out exists for really is cashier work.
        assert_eq!(
            required_role_for_action(actions::LEAVE_REQUEST_OWN),
            Role::Cashier
        );
    }

    #[test]
    fn node_administration_is_admin_even_for_reads() {
        assert_eq!(required_role("GET", "/api/v1/auth/users"), Role::Admin);
        // A cashier may read stock; a cashier may not read the books.
        assert_eq!(
            required_role("GET", "/api/v1/inventory/pools"),
            Role::Cashier
        );
        assert_eq!(
            required_role("GET", "/api/v1/finance/trial-balance"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("POST", "/api/v1/finance/journal"),
            Role::Admin
        );
        assert_eq!(
            required_role("POST", "/api/v1/finance/periods/close"),
            Role::Admin
        );
        assert_eq!(
            required_role("POST", "/api/v1/inventory/control/corrupt-projection"),
            Role::Admin
        );
        assert_eq!(
            required_role("POST", "/api/v1/inventory/replay"),
            Role::Admin
        );
        assert_eq!(required_role("POST", "/api/v1/sync/trigger"), Role::Admin);
        assert_eq!(required_role("GET", "/api/v1/sync/origins"), Role::Admin);
        assert_eq!(required_role("POST", "/api/v1/sync/commands"), Role::Admin);
    }
}
