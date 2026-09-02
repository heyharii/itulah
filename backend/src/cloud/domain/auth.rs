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
    if path.starts_with("/api/v1/members") {
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
