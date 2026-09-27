//! Role-based authorization rules, kept pure so they hold on any node and any
//! storage engine. The HTTP layer supplies (method, path) and the caller's
//! role; this module answers "is that allowed" without touching I/O.
//!
//! Roles form a strict ladder — CASHIER < SUPERVISOR < ADMIN — because a POS
//! floor has exactly these three trust levels: the person selling, the person
//! who can move or destroy stock and approve exceptions, and the person who
//! administers the node itself.

use super::record::RecordKind;
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
    // Exchange the signed-in Cloud identity for a DC session. Whether the
    // caller is assigned to the destination is checked by the handler; this
    // path itself is a self-service sign-in action, so even a cashier may use
    // it.
    if method == "POST" && path == "/api/v1/auth/edge-sso-ticket" {
        return Role::Cashier;
    }
    // Opening a join link and accepting it (0634). Public — `is_public` lets
    // them through before this is asked, like `/auth/login` — so the answer
    // here is the one the route catalogue prints, not a gate anybody meets.
    if path.starts_with("/api/v1/invitations/accept/") {
        return Role::Cashier;
    }
    // Job roles (0633): reading the list is everybody's — a screen names a
    // colleague's role — and changing one is the administrator's, because a
    // role decides what everybody holding it may do.
    if path.starts_with("/api/v1/roles") && !method.eq_ignore_ascii_case("GET") {
        return Role::Admin;
    }
    let admin_prefixes = [
        // Inviting people, and the links head office has handed out (0634).
        "/api/v1/invitations",
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
        "/api/v1/sync/enrollments",
        "/api/v1/sync/nodes",
        // The device registry, and switching a shop's till off from here.
        "/api/v1/sync/devices",
        // Asking a till or a printer for a test page from head office.
        "/api/v1/devices",
        "/api/v1/sync/commands",
        // Both lanes of the sync plus the request-log failure counts and the
        // open exposures: the operator's view, not a till's. Its siblings
        // `/sync/fleet` and `/sync/status` stay Cashier.
        "/api/v1/sync/health",
        // Setting the company up: describing it, opening stores, starting
        // the books. The read as well — it is what decides whether the
        // wizard stands in front of the app, and it is only the owner's
        // question (`http/setup.rs`).
        "/api/v1/setup",
    ];
    if admin_prefixes.iter().any(|p| path.starts_with(p)) {
        return Role::Admin;
    }
    // The generic record surface, before everything else, because it is the
    // one family of routes whose answer is not a property of the path.
    //
    // `/api/v1/records/{kind}/{id}/…` serves fifty-seven kinds through one
    // shape, so a single role here would be one answer for all of them — and
    // the only role that would not lock somebody out is the lowest, which
    // would put a payroll run's comments in front of a cashier. Instead the
    // kind names itself in the path, and the gate is the gate on the read that
    // already serves that record.
    //
    // The READ gate, for writes as well. Leaving a note on a bill is not
    // posting a bill and filing it under "chase this" is not paying it: a
    // person who may see a record may say something about it. Making every
    // comment a Supervisor act would mean the people who most need to leave a
    // note are the ones who cannot.
    //
    // An unreadable kind gets ADMIN rather than a guess. It is also what the
    // route catalogue sees when it asks about the pattern rather than a
    // request, which is why that column prints `PerRecord` for these and not a
    // role that would be wrong for fifty-six of them.
    if let Some(rest) = path.strip_prefix("/api/v1/records/") {
        let kind = rest.split('/').next().unwrap_or_default();
        return match RecordKind::parse(kind) {
            // Never recursive: no `read_path` is under `/api/v1/records/`, and
            // `every_read_path_is_answerable` holds it that way.
            Some(kind) => required_role("GET", kind.read_path()),
            None => Role::Admin,
        };
    }
    // A comment is edited by its own id, so the record is not in the path and
    // this cannot delegate. Any signed-in operator may reach it, and the
    // statement that changes the row carries the real rule: `author = $2`, so
    // the only comment anybody can edit or remove is their own.
    if path.starts_with("/api/v1/comments/") {
        return Role::Cashier;
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
        // Clearing an item off the attention queue is the one write on this
        // surface that is not an accounting act. It posts nothing: it says "I
        // have dealt with this" and records who and why. A shop manager whose
        // shift or count is in the queue is exactly the person who deals with
        // it, and requiring ADMIN would mean every such item waited for head
        // office — which is how a queue nobody can clear becomes a queue
        // nobody reads.
        //
        // Deliberately only `/resolve`. Starting a run stays ADMIN with the
        // rest of the surface.
        if path.starts_with("/api/v1/finance/attention/") && path.ends_with("/resolve") {
            return Role::Supervisor;
        }
        return Role::Admin;
    }
    // General Affairs, before the blanket GET rule below, and for the same
    // reason finance sits above it: that rule makes every read a CASHIER read,
    // which is right for stock and sales and wrong here. A supplier's bank
    // account, a shop's lease and what a repair is expected to cost are the
    // department's own papers, and holding a till token is not a reason to read
    // them.
    //
    // One rung for reads and writes alike, which is unusual on this ladder and
    // deliberate. GA is the department that FILES the fact — a door is broken,
    // a laptop moved, the lease ends in sixty days — and every one of those is
    // a shop manager's or a GA officer's ordinary act. Requiring ADMIN for them
    // would mean a repair waited for head office, and requiring SUPERVISOR only
    // for writes would hide from a shop manager the register they are asked to
    // walk the floor with.
    //
    // The two acts that do need two people have it in the domain instead:
    // approving a repair's budget, a replacement or a disposal is refused when
    // the approver raised it — the `counted_by <> verified_by` pattern. Nothing
    // here posts to the ledger, and nothing here chooses an account.
    if path.starts_with("/api/v1/ga") {
        return Role::Supervisor;
    }
    // Purchasing, before the blanket GET rule below, and for the same reason
    // finance sits above it.
    //
    // That rule makes every read a CASHIER read, which is right for stock and
    // sales and wrong here: what a supplier charges, what an order is worth,
    // the terms a buyer negotiated and the price queries a warehouse has
    // raised are commercial information, and holding a till token is not a
    // reason to see any of it. A cashier who could read the order book could
    // read every supplier price the company has agreed.
    //
    // The whole surface is SUPERVISOR, reads included; the acts that commit
    // money — raising an order, closing a line short, answering a price query
    // — were already SUPERVISOR by the fall-through at the bottom. Nothing a
    // DC needs to receive goods is here: the warehouse works against its own
    // node, whose checker list deliberately carries neither quantities nor
    // prices.
    if path.starts_with("/api/v1/purchase-")
        || path.starts_with("/api/v1/suppliers")
        || path.starts_with("/api/v1/supplier-items")
        || path.starts_with("/api/v1/sourcing-basket")
    {
        return Role::Supervisor;
    }
    // Hiring requests, before the blanket GET rule below, and for the reason
    // finance and purchasing sit above it: that rule makes every read a CASHIER
    // read, which is right for stock and quite wrong here. A hire proposal
    // names a candidate and the base pay a shop is asking to offer, and holding
    // a till token is not a reason to see either.
    //
    // It matters twice. The route itself re-checks `people.hire_proposal.read`
    // in the handler, so this gate grants nothing there — but
    // `/api/v1/records/{kind}/{id}/…` derives its rung by delegating to this
    // function for the record's read path, and without this arm a cashier could
    // read a proposal's comments and history through that surface.
    //
    // Only the reads are named here. The writes fall through to SUPERVISOR at
    // the bottom, which is right: filing a proposal is a place manager's act,
    // and the one write that is head office's — the decision — is held there by
    // its own action key rather than by the path.
    if path.starts_with("/api/v1/hire-proposals") && method.eq_ignore_ascii_case("GET") {
        return Role::Supervisor;
    }
    // Flow templates (0615): which stages a movement of goods runs and who
    // does each. Reading one is everybody's — the blanket GET rule below; a
    // picker is asked to follow it — but writing one is head office's
    // administrator's, because a template decides who may send goods where.
    if path.starts_with("/api/v1/flow-templates") && !method.eq_ignore_ascii_case("GET") {
        return Role::Admin;
    }
    // Opening a store and issuing its server's install code are head
    // office's Admin's (`http/stores.rs`). Reading the stores is head office's
    // — an Admin or anybody posted there — which the handler checks, so the
    // read keeps the blanket rule below.
    if (path == "/api/v1/stores" || path.starts_with("/api/v1/stores/"))
        && !method.eq_ignore_ascii_case("GET")
    {
        return Role::Admin;
    }
    if method.eq_ignore_ascii_case("GET") {
        return Role::Cashier;
    }
    // Flow documents (0616-0617). Who may start one or act on a stage is the
    // template's to say — its starter and performer roles, checked against
    // the caller's rung by `domain::flow` — so the path lets every signed-in
    // operator through rather than answering Supervisor for a receipt that a
    // store's staff are the ones to confirm.
    if path == "/api/v1/flows" || path.starts_with("/api/v1/flows/") {
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
    // Three more self-service writes whose subject is the caller, spelled on
    // paths that do not carry `me` because the record is born from the call:
    // a swap of one's own roster day, one's own expense claim, and one's own
    // grievance. The handlers re-check the action key each act needs —
    // `request_own` when the subject is the caller, the place's filing key
    // when a manager files for a colleague — so this widens the door without
    // granting anything; a cashier filing for a colleague still trips the
    // supervisor key and is refused there.
    if path == "/api/v1/roster-swaps"
        || path == "/api/v1/expense-claims"
        || path == "/api/v1/grievances"
    {
        return Role::Cashier;
    }
    // What happens to those filings afterwards, by the person who filed them:
    // sending a drafted claim up, and taking back a claim, a swap, a
    // correction or a grievance. Without this they fell through to Supervisor,
    // so a cashier could file a claim from the phone and never send it. Each
    // handler binds the act to its *actor* — the filer, compared by name or by
    // employment record — and re-checks the filing key when it is anyone
    // else, so this opens the door to the filer and to nobody new.
    if let Some(rest) = path.strip_prefix("/api/v1/") {
        let filer_acts = [
            ("expense-claims/", "/submission"),
            ("expense-claims/", "/withdrawal"),
            ("roster-swaps/", "/withdrawal"),
            ("attendance-corrections/", "/withdrawal"),
            ("grievances/", "/withdrawal"),
        ];
        if filer_acts.iter().any(|(collection, act)| {
            rest.strip_prefix(collection)
                .and_then(|tail| tail.strip_suffix(act))
                .is_some_and(|id| !id.is_empty() && !id.contains('/'))
        }) {
            return Role::Cashier;
        }
    }
    // A notification is one person's own queue: reading it is marking your own
    // row, and the handler takes the reader from the session, never the path.
    if path.starts_with("/api/v1/notifications/")
        && (path.ends_with("/read") || path == "/api/v1/notifications/read-all")
    {
        return Role::Cashier;
    }
    // Saying yes or no to being woken on this browser is the same: the
    // handler files the subscription under the session's own username, and
    // removes only the caller's own. Without this, a cashier could read their
    // notifications and not be told about them.
    if path == "/api/v1/push/subscriptions" {
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

    /// The delegation must terminate, and it terminates because no read path
    /// is itself on the records surface. If one ever were, every request to it
    /// would recurse until the stack ran out — which is a crash, not a 500.
    #[test]
    fn every_read_path_is_answerable_without_recursion() {
        for kind in RecordKind::ALL {
            let path = kind.read_path();
            assert!(
                !path.starts_with("/api/v1/records/") && !path.starts_with("/api/v1/comments/"),
                "{kind} delegates its permission to {path}, which delegates back"
            );
            // And the delegate answers, rather than falling through to a rule
            // that happens to be the same for everything.
            let _ = required_role("GET", path);
        }
    }

    #[test]
    fn inviting_and_editing_roles_is_the_administrators() {
        assert_eq!(required_role("POST", "/api/v1/invitations"), Role::Admin);
        assert_eq!(required_role("GET", "/api/v1/invitations"), Role::Admin);
        assert_eq!(
            required_role("POST", "/api/v1/invitations/abc/renew"),
            Role::Admin
        );
        assert_eq!(required_role("GET", "/api/v1/roles"), Role::Cashier);
        assert_eq!(required_role("PUT", "/api/v1/roles/FINANCE"), Role::Admin);
        assert_eq!(required_role("DELETE", "/api/v1/roles/X"), Role::Admin);
        // The join link itself is public; the catalogue's answer for it is the
        // lowest rung, not Admin by the prefix above it.
        assert_eq!(
            required_role("POST", "/api/v1/invitations/accept/tok"),
            Role::Cashier
        );
    }

    #[test]
    fn edge_sso_ticket_issuance_is_available_to_any_signed_in_role() {
        assert_eq!(
            required_role("POST", "/api/v1/auth/edge-sso-ticket"),
            Role::Cashier
        );
    }

    /// The point of delegating: a bill's comments are gated like a bill, and a
    /// count's like a count. One route, fifty-seven answers.
    #[test]
    fn the_records_surface_borrows_the_gate_of_the_record_it_names() {
        assert_eq!(
            required_role("GET", "/api/v1/records/bill/abc/info"),
            Role::Supervisor,
            "a till operator has no business reading what the company owes"
        );
        assert_eq!(
            required_role("GET", "/api/v1/records/purchase_order/abc/info"),
            Role::Supervisor,
        );
        assert_eq!(
            required_role("GET", "/api/v1/records/sale/abc/info"),
            Role::Cashier,
        );
        // Writing on a record is gated like reading it: the cashier who served
        // the sale may say what happened.
        assert_eq!(
            required_role("POST", "/api/v1/records/sale/abc/comments"),
            Role::Cashier,
        );
        assert_eq!(
            required_role("PUT", "/api/v1/records/bill/abc/tags/CHASE"),
            Role::Supervisor,
        );
        // A word that is not a record is not a way in.
        assert_eq!(
            required_role("GET", "/api/v1/records/general/abc/info"),
            Role::Admin,
        );
    }

    /// Without this arm the fall-through makes deleting your own comment a
    /// Supervisor act, and a cashier cannot take back their own sentence.
    #[test]
    fn a_comment_is_edited_by_whoever_wrote_it() {
        assert_eq!(
            required_role("PATCH", "/api/v1/comments/abc"),
            Role::Cashier
        );
        assert_eq!(
            required_role("DELETE", "/api/v1/comments/abc"),
            Role::Cashier
        );
    }

    /// The filer's own follow-up acts reach the handler, which binds them to
    /// the filer; deciding the same filings still does not.
    #[test]
    fn a_filer_may_send_up_and_take_back_their_own_filing() {
        for path in [
            "/api/v1/expense-claims/5b9e/submission",
            "/api/v1/expense-claims/5b9e/withdrawal",
            "/api/v1/roster-swaps/SW-1/withdrawal",
            "/api/v1/attendance-corrections/C-1/withdrawal",
            "/api/v1/grievances/5b9e/withdrawal",
            "/api/v1/notifications/5b9e/read",
            "/api/v1/notifications/read-all",
        ] {
            assert_eq!(required_role("POST", path), Role::Cashier, "{path}");
        }
        for method in ["POST", "DELETE"] {
            assert_eq!(
                required_role(method, "/api/v1/push/subscriptions"),
                Role::Cashier
            );
        }
        for path in [
            "/api/v1/expense-claims/5b9e/decision",
            "/api/v1/roster-swaps/SW-1/decision",
            "/api/v1/attendance-corrections/C-1/decision",
            "/api/v1/grievances/5b9e/resolution",
            "/api/v1/expense-claims//withdrawal",
            "/api/v1/expense-claims/a/b/withdrawal",
        ] {
            assert_eq!(required_role("POST", path), Role::Supervisor, "{path}");
        }
    }

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

    /// GA is the department that FILES a fact, so its reads and its writes are
    /// the same rung — and that rung is not the blanket GET's.
    ///
    /// Both halves are worth pinning. Without the arm, a read falls to Cashier,
    /// which would put a supplier's bank account and a shop's lease in front of
    /// anybody holding a till token. And without it the WRITE would still be
    /// Supervisor by the fall-through, so the half that looks like it needs no
    /// test is the half that would silently be wrong.
    ///
    /// `/api/v1/ga` must stay ahead of `/api/v1/finance`'s siblings for the
    /// same reason finance is ahead of the blanket rule: first match wins, and
    /// the blanket rule is last.
    #[test]
    fn ga_is_a_supervisors_surface_to_read_and_to_write() {
        assert_eq!(required_role("GET", "/api/v1/ga/overview"), Role::Supervisor);
        assert_eq!(
            required_role("POST", "/api/v1/ga/contracts"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("PATCH", "/api/v1/ga/assets/9f0f5f0e-0000-0000-0000-000000000000"),
            Role::Supervisor
        );
        // And the arm is on the prefix, not on a path somebody has to remember
        // to add to it: a new GA route is covered the day it is written.
        assert_eq!(
            required_role("DELETE", "/api/v1/ga/supply-requests/abc"),
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
        // Commercial information is not a cashier read. The order book carries
        // every price the company has agreed with every supplier, and the till
        // has no business in it.
        assert_eq!(
            required_role("GET", "/api/v1/purchase-orders"),
            Role::Supervisor
        );
        assert_eq!(
            required_role("GET", "/api/v1/purchase-price-amendments"),
            Role::Supervisor
        );
        assert_eq!(required_role("GET", "/api/v1/suppliers"), Role::Supervisor);
        assert_eq!(
            required_role("GET", "/api/v1/supplier-items"),
            Role::Supervisor
        );
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
