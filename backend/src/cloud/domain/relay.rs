//! Which HR calls a unit's own node may relay to the cloud on somebody's
//! behalf — the one list both ends enforce.
//!
//! # Why a relay at all
//!
//! The till speaks to exactly one server, its own store node, under exactly one
//! sign-in (Hari, 2026-09-25). People data does not live there and must not: a
//! roster, a leave balance, a fingerprint enrolment are head office's records
//! with a history behind every change, and a copy in thirteen shops' SQLite is
//! thirteen copies to leak and none to trust. So the store node carries the
//! manager's HR calls up to the cloud, the way it already carries a voucher
//! hold: signed with its own machine credential, naming the person who asked.
//!
//! # Why an allowlist, and why here
//!
//! The relay is a second way into the cloud's session space, and a second door
//! is only as narrow as the list of rooms it opens onto. Everything below is a
//! store manager's HR surface — the team, their leave, overtime, attendance,
//! roster, the month's close, claims, swaps, change proposals, the checklist,
//! the recruitment the shop runs, performance, training and benefits — plus
//! the person's own notifications and the shop's own General Affairs (its
//! place, its assets, its contracts, its repairs, its supply requests), and
//! nothing else: no payroll, no pay agreement, no fingerprint enrolment, no
//! grievance queue, no head-office rule-setting, no finance, no stock. Personal
//! data crosses only as a person's papers (1001, owner 2026-10-25): the store
//! reads its own people's file and keys in a new hire's dossier or a change,
//! which head office takes or refuses — the decision and the scans' bytes stay
//! on head office's side. A path missing from this list is refused by the store node before it
//! leaves the shop *and* by the cloud when it arrives, so a node that forgot to
//! check, or a caller holding a stolen node key, still meets the same wall.
//!
//! One list, in the cloud domain, because it is the cloud's decision what it
//! will answer through a node; the store node imports it rather than keeping a
//! copy, since two copies of a security list are two lists.
//!
//! # What this list does NOT decide
//!
//! It opens a door; it grants nothing. Behind it the cloud still applies the
//! path role gate (`required_role`), the per-action rung (`employment::audit`),
//! and — the property that matters most — a scope bounded to the relaying
//! node's own place, whatever the person's own reach would have been: HR's
//! `Reach` is cut to the node's place (`Reach::bounded_to`), and GA's `site` to
//! the node's site (`Principal::site_filter` and its siblings). See
//! `cloud::http::auth::relayed_principal`.

/// The node's machine credential — the same key `/sync/ingest` takes, proving
/// WHICH NODE is relaying.
pub const SYNC_KEY_HEADER: &str = "x-sync-key";

/// The relaying node's origin id. Proved against [`SYNC_KEY_HEADER`], never
/// believed on its own.
pub const RELAY_ORIGIN_HEADER: &str = "x-relay-origin";

/// The signed-in person the node is relaying for: the store node's own user id,
/// which for a CLOUD-projected account *is* the cloud `app_user.id`. Believed
/// only as far as an active `edge_identity_assignment` at the proved origin
/// says that person may sign in there.
pub const RELAY_USER_HEADER: &str = "x-relay-user";

/// Where the store node serves the relay. Everything after it is the cloud path
/// under `/api/v1/`.
pub const STORE_RELAY_PREFIX: &str = "/api/v1/store/central";

/// The one relayed call whose body is not a JSON form: a scan's bytes, on
/// their way to a person's papers (1001). The store node passes its body and
/// content type through as they came, up to [`RELAY_UPLOAD_MAX_BODY`].
pub const RELAY_UPLOAD_PATH: &str = "/api/v1/files";

/// The largest scan the relay carries — the centre's own attachment ceiling.
pub const RELAY_UPLOAD_MAX_BODY: usize = 8 * 1024 * 1024;

/// Every (method, path) a relayed call may take. `{}` is exactly one id-shaped
/// segment — see [`is_relayable`] for what that admits.
///
/// Exactly the calls the store till makes, and nothing more: a path the till
/// does not use is a door nobody is watching. Every act here is one the
/// Supervisor rung already holds, and every read or write that names a person
/// or a place is bounded — HR's by the caller's `Reach`, cut to the node's
/// place in `reach_from`; GA's by the node's site (see below). What remains
/// unbounded is reference data the whole company shares and that names nobody:
/// leave types, a year's holidays, shift patterns, the position list, the rule
/// numbers, the pay-component catalogue, performance templates and the
/// training calendar. Head office's own acts (deciding a hire or a change
/// proposal, reopening a closed month, paying a claim out, approving payroll)
/// are absent on purpose even where a relayed Admin could otherwise have
/// reached them.
pub const HR_RELAY_ALLOWLIST: &[(&str, &str)] = &[
    // ── the caller, their team, and the org's reference data ───────────
    ("GET", "/api/v1/employees/me/reach"),
    ("GET", "/api/v1/employees"),
    ("GET", "/api/v1/employees/{}"),
    ("GET", "/api/v1/employees/{}/profile"),
    // Who a person reports to, so the shop can draw its own chart (owner,
    // 30 Oct 2026). Read only: a new boss is a change proposal head office
    // decides, never a placement written from a shop.
    ("GET", "/api/v1/employees/{}/placements"),
    ("GET", "/api/v1/org/positions"),
    ("GET", "/api/v1/people-policy"),
    ("GET", "/api/v1/payroll/components"),
    ("GET", "/api/v1/notifications"),
    ("POST", "/api/v1/notifications/{}/read"),
    // ── Discuss: a shop's chat with head office (2 Oct 2026) ───────────
    // Text only: no files, search, typing or participant changes from a shop.
    ("GET", "/api/v1/chat/conversations"),
    ("POST", "/api/v1/chat/conversations"),
    ("GET", "/api/v1/chat/conversations/{}/messages"),
    ("POST", "/api/v1/chat/conversations/{}/messages"),
    ("POST", "/api/v1/chat/conversations/{}/read"),
    // Who a chat can be started with: names only, the discussion directory.
    ("GET", "/api/v1/discussions/people"),
    // ── roster and swaps ───────────────────────────────────────────────
    ("GET", "/api/v1/roster"),
    ("POST", "/api/v1/employees/{}/roster"),
    ("GET", "/api/v1/attendance-shifts"),
    ("GET", "/api/v1/roster-swaps/pending"),
    ("POST", "/api/v1/roster-swaps/{}/decision"),
    // ── attendance, corrections and the month's close ──────────────────
    ("GET", "/api/v1/attendance/today"),
    ("GET", "/api/v1/attendance/punch-readiness"),
    ("GET", "/api/v1/employees/{}/attendance"),
    ("GET", "/api/v1/attendance-corrections"),
    ("POST", "/api/v1/attendance-corrections/{}/decision"),
    ("POST", "/api/v1/employees/{}/attendance-corrections"),
    ("GET", "/api/v1/attendance-periods"),
    ("POST", "/api/v1/attendance-periods/{}/{}/closure"),
    // ── leave ──────────────────────────────────────────────────────────
    ("GET", "/api/v1/leave-types"),
    ("GET", "/api/v1/holiday-calendars/{}"),
    ("GET", "/api/v1/employees/{}/leave-balances"),
    ("GET", "/api/v1/employees/{}/leave-requests"),
    ("POST", "/api/v1/employees/{}/leave-requests"),
    // The shop head's queue. Its readers resolve `Reach`, which a relayed call
    // bounds to the relaying node's place, like every list here.
    ("GET", "/api/v1/leave-requests/pending"),
    // The three verbs spelled out rather than a `{}`: a fourth verb added to
    // the leave routes later must be a decision here, not an accident.
    ("POST", "/api/v1/employees/{}/leave-requests/{}/approve"),
    ("POST", "/api/v1/employees/{}/leave-requests/{}/reject"),
    ("POST", "/api/v1/employees/{}/leave-requests/{}/withdraw"),
    // ── overtime ───────────────────────────────────────────────────────
    ("GET", "/api/v1/employees/{}/overtime-orders"),
    ("POST", "/api/v1/employees/{}/overtime-orders"),
    ("POST", "/api/v1/employees/{}/overtime-orders/{}/withdrawal"),
    ("GET", "/api/v1/overtime-orders/awaiting"),
    // ── the shop's cash: its three boxes and their counts (2 Oct 2026) ──
    // Bound to the relaying node's own site by the handler, whatever the
    // query says (`http::finance::store_cash_site`).
    ("GET", "/api/v1/store-cash/boxes"),
    ("GET", "/api/v1/store-cash/counts"),
    ("POST", "/api/v1/store-cash/counts"),
    // ── expense claims, and the advances a person is holding ───────────
    ("GET", "/api/v1/expense-claim-types"),
    ("GET", "/api/v1/expense-claims"),
    ("POST", "/api/v1/expense-claims"),
    ("POST", "/api/v1/expense-claims/{}/decision"),
    ("POST", "/api/v1/expense-claims/{}/returnal"),
    ("POST", "/api/v1/expense-claims/{}/submission"),
    ("GET", "/api/v1/employees/{}/advances"),
    // ── employment change proposals ────────────────────────────────────
    ("GET", "/api/v1/change-proposals"),
    ("POST", "/api/v1/employees/{}/change-proposals"),
    // ── the place's one-off payroll figures (filed, never decided here) ─
    ("GET", "/api/v1/payroll/adjustments"),
    ("POST", "/api/v1/payroll/adjustments"),
    ("POST", "/api/v1/payroll/adjustments/{}/withdrawal"),
    // ── benefits and the onboarding / separation checklist ─────────────
    ("GET", "/api/v1/employees/{}/uniform-issuances"),
    ("POST", "/api/v1/employees/{}/uniform-issuances"),
    ("GET", "/api/v1/lifecycle/tasks"),
    ("POST", "/api/v1/lifecycle/tasks/{}/completion"),
    // ── recruitment the shop runs ──────────────────────────────────────
    ("GET", "/api/v1/recruitment/plans"),
    ("GET", "/api/v1/recruitment/applicants"),
    ("GET", "/api/v1/recruitment/applicants/{}/interviews"),
    ("POST", "/api/v1/recruitment/applicants/{}/interviews"),
    ("POST", "/api/v1/recruitment/interviews/{}/result"),
    ("GET", "/api/v1/hire-proposals"),
    ("POST", "/api/v1/hire-proposals"),
    // ── a person's papers, keyed in for head office to take (1001) ─────
    //
    // The file reads one place's people (`Reach` bounded to the node); the
    // two filings wait on head office. A scan goes up as a file first — the
    // one raw body the relay carries (`RELAY_UPLOAD_PATH`) — and is then
    // named in a filing. Taking a change, and the scans' bytes, are absent.
    ("GET", "/api/v1/employees/{}/dossier"),
    ("POST", "/api/v1/employees/{}/data-updates"),
    ("POST", "/api/v1/data-updates/{}/withdrawal"),
    ("GET", "/api/v1/hire-proposals/{}/dossier"),
    ("PUT", "/api/v1/hire-proposals/{}/dossier"),
    ("POST", "/api/v1/employee-documents/{}/removal"),
    ("POST", "/api/v1/files"),
    // ── performance and training ───────────────────────────────────────
    ("GET", "/api/v1/performance/templates"),
    ("GET", "/api/v1/performance/scores"),
    ("PUT", "/api/v1/employees/{}/performance/{}"),
    ("GET", "/api/v1/training-programs"),
    ("GET", "/api/v1/training-programs/{}/participants"),
    ("POST", "/api/v1/training-programs/{}/participants"),
    (
        "POST",
        "/api/v1/training-programs/{}/participants/{}/attendance",
    ),
    // ── General Affairs: the shop's own place, and the things in it ────
    //
    // GA does not resolve a `Reach`; its rows carry a `site_id` and its lists
    // take a `site` filter. So each GA handler narrows a relayed call to the
    // node's own site itself — a list's `site` is forced to it, a row read or
    // written by id is refused unless it is at that site (or, for a contract,
    // covers it), a body naming a site must name it, and facets counted across
    // the estate are cut to the node's own site
    // (`Principal::site_filter` / `may_touch_site` / `may_touch_coverage`).
    // `/ga/repairs` and `/ga/maintenance-tasks` take no site in their readers,
    // so a relayed call is narrowed in the handler, the way `/ga/locations`
    // already narrows a place's strips.
    //
    // Deliberately absent: `/ga/overview` (the estate's dashboard, with no site
    // to narrow by), the `/ga/contracts` list (the till reads its contracts,
    // company-wide ones included, through `/ga/locations/{its site}`), and
    // every head-office act: registering, correcting, transferring or
    // disposing of an asset, writing a contract, approving a budget, moving a
    // supply request up its ladder.
    ("GET", "/api/v1/ga/locations/{}"),
    ("GET", "/api/v1/ga/assets"),
    ("GET", "/api/v1/ga/assets/{}"),
    ("POST", "/api/v1/ga/assets/{}/notes"),
    ("GET", "/api/v1/ga/contract-types"),
    ("GET", "/api/v1/ga/contracts/{}"),
    ("GET", "/api/v1/ga/repair-objects"),
    ("GET", "/api/v1/ga/repairs"),
    ("POST", "/api/v1/ga/repairs"),
    ("GET", "/api/v1/ga/maintenance-tasks"),
    ("GET", "/api/v1/ga/supply-categories"),
    ("GET", "/api/v1/ga/supplies"),
    ("POST", "/api/v1/ga/supplies"),
    // ── Stock: the shop's own Send of its reject (23 Oct 2026) ─────────
    // The handler takes the site from the relay binding, never the body.
    ("POST", "/api/v1/inventory/store-returns/reject"),
];

/// The longest id a `{}` segment admits. Generous for a UUID, a period, a place
/// or an employee code; short enough that a segment cannot carry a payload.
const MAX_SEGMENT_LEN: usize = 128;

/// May a relayed call take this method and path?
///
/// `path` is the cloud path exactly as it will be routed — `/api/v1/...`, no
/// query string, not percent-decoded. Matched segment by segment against
/// [`HR_RELAY_ALLOWLIST`]: a literal must be equal, and `{}` admits one
/// segment of ASCII letters, digits, `-`, `_`, `.` and `:` that is neither `.`
/// nor `..`.
///
/// Strict on purpose. The store node builds a URL from this path, and a URL
/// library normalises `..` and may decode `%2F`; a segment that could change
/// meaning between the check and the request would let `employees/../auth/users`
/// pass as an employee id and arrive as something else. Nothing an HR id is
/// ever spelled with needs `%`, `/`, a space or a dot-segment, so none of them
/// get through, and an empty segment (`//`, a trailing `/`) is refused with
/// them.
pub fn is_relayable(method: &str, path: &str) -> bool {
    let Some(rest) = path.strip_prefix('/') else {
        return false;
    };
    let segments: Vec<&str> = rest.split('/').collect();
    HR_RELAY_ALLOWLIST.iter().any(|(allowed_method, pattern)| {
        if !allowed_method.eq_ignore_ascii_case(method) {
            return false;
        }
        let wanted: Vec<&str> = pattern.trim_start_matches('/').split('/').collect();
        wanted.len() == segments.len()
            && wanted
                .iter()
                .zip(&segments)
                .all(|(expected, actual)| match *expected {
                    "{}" => is_id_segment(actual),
                    literal => literal == *actual,
                })
    })
}

fn is_id_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= MAX_SEGMENT_LEN
        && segment != "."
        && segment != ".."
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

/// The lower of two rungs. What a relayed call acts with: the person's cloud
/// rung, capped by the rung their assignment at this node grants — a head-office
/// administrator signed in at a till as its supervisor is, at that till, its
/// supervisor.
pub fn relayed_role(cloud_role: super::Role, edge_role: super::Role) -> super::Role {
    cloud_role.min(edge_role)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::Role;

    #[test]
    fn the_store_managers_reads_and_acts_are_relayable() {
        assert!(is_relayable("GET", "/api/v1/employees/me/reach"));
        assert!(is_relayable("GET", "/api/v1/employees"));
        assert!(is_relayable("GET", "/api/v1/employees/EMP-0007"));
        assert!(is_relayable("GET", "/api/v1/payroll/adjustments"));
        assert!(is_relayable("GET", "/api/v1/employees/EMP-0007/dossier"));
        assert!(is_relayable(
            "POST",
            "/api/v1/employees/EMP-0007/data-updates"
        ));
        assert!(is_relayable("PUT", "/api/v1/hire-proposals/hp_1/dossier"));
        assert!(is_relayable("POST", "/api/v1/files"));
        assert!(!is_relayable("POST", "/api/v1/data-updates/edu_1/decision"));
        assert!(!is_relayable(
            "GET",
            "/api/v1/employee-documents/edoc_1/content"
        ));
        for verb in ["approve", "reject", "withdraw"] {
            assert!(is_relayable(
                "POST",
                &format!(
                    "/api/v1/employees/EMP-0007/leave-requests/6f1c2a4e-0000-4000-8000-000000000001/{verb}"
                )
            ));
        }
        // Only those three verbs, whatever the leave routes grow later.
        assert!(!is_relayable(
            "POST",
            "/api/v1/employees/EMP-0007/leave-requests/6f1c2a4e-0000-4000-8000-000000000001/cancel"
        ));
        assert!(is_relayable(
            "POST",
            "/api/v1/attendance-periods/store-07/2026-09/closure"
        ));
        assert!(is_relayable(
            "PUT",
            "/api/v1/employees/EMP-0007/performance/2026-09"
        ));
        assert!(is_relayable("GET", "/api/v1/notifications"));
        assert!(is_relayable(
            "POST",
            "/api/v1/notifications/6f1c2a4e-0000-4000-8000-000000000001/read"
        ));
    }

    #[test]
    fn the_shops_own_general_affairs_is_relayable() {
        assert!(is_relayable("GET", "/api/v1/ga/locations/store-07"));
        assert!(is_relayable("GET", "/api/v1/ga/assets"));
        assert!(is_relayable(
            "POST",
            "/api/v1/ga/assets/6f1c2a4e-0000-4000-8000-000000000001/notes"
        ));
        assert!(is_relayable("POST", "/api/v1/ga/repairs"));
        assert!(is_relayable("GET", "/api/v1/ga/repairs"));
        assert!(is_relayable("GET", "/api/v1/ga/maintenance-tasks"));
        assert!(is_relayable("POST", "/api/v1/ga/supplies"));
        for (method, path) in [
            // The estate's views, which a shop reads through its own place.
            ("GET", "/api/v1/ga/overview"),
            ("GET", "/api/v1/ga/contracts"),
            ("GET", "/api/v1/ga/locations"),
            (
                "GET",
                "/api/v1/ga/repairs/6f1c2a4e-0000-4000-8000-000000000001",
            ),
            // Head office's acts.
            ("POST", "/api/v1/ga/assets"),
            (
                "PATCH",
                "/api/v1/ga/assets/6f1c2a4e-0000-4000-8000-000000000001",
            ),
            (
                "POST",
                "/api/v1/ga/assets/6f1c2a4e-0000-4000-8000-000000000001/transfer",
            ),
            ("PATCH", "/api/v1/ga/locations/store-07"),
            (
                "POST",
                "/api/v1/ga/repairs/6f1c2a4e-0000-4000-8000-000000000001/approve-budget",
            ),
            (
                "POST",
                "/api/v1/ga/supplies/6f1c2a4e-0000-4000-8000-000000000001/move",
            ),
            ("POST", "/api/v1/ga/contracts"),
            ("POST", "/api/v1/ga/disposals"),
        ] {
            assert!(
                !is_relayable(method, path),
                "{method} {path} must not relay"
            );
        }
    }

    /// Head office's surface, payroll, personal data and everything outside HR
    /// stay on the far side of the wall, whatever the rung behind the call.
    #[test]
    fn everything_else_is_refused() {
        for (method, path) in [
            ("GET", "/api/v1/auth/users"),
            ("POST", "/api/v1/auth/users"),
            ("GET", "/api/v1/employees/EMP-0007/personal-data"),
            ("GET", "/api/v1/employees/EMP-0007/pay"),
            ("GET", "/api/v1/payroll/runs"),
            ("POST", "/api/v1/payroll/runs/RUN-1/approve"),
            ("POST", "/api/v1/payroll/components"),
            ("GET", "/api/v1/employees/me/colleagues"),
            ("POST", "/api/v1/employees/EMP-0007/employment"),
            ("POST", "/api/v1/hire-proposals/HP-1/decision"),
            ("POST", "/api/v1/change-proposals/CP-1/decision"),
            (
                "POST",
                "/api/v1/attendance-periods/store-07/2026-09/reopening",
            ),
            ("POST", "/api/v1/expense-claims/EC-1/payout"),
            ("GET", "/api/v1/grievances"),
            ("GET", "/api/v1/finance/journal"),
            ("POST", "/api/v1/leave-types"),
            ("GET", "/api/v1/inventory/pools"),
            // Right path, wrong method.
            ("DELETE", "/api/v1/employees/EMP-0007"),
            ("POST", "/api/v1/employees"),
        ] {
            assert!(
                !is_relayable(method, path),
                "{method} {path} must not relay"
            );
        }
    }

    /// A segment that could mean something else once a URL library has had it.
    #[test]
    fn a_segment_that_could_change_meaning_is_refused() {
        for path in [
            "/api/v1/employees/..",
            "/api/v1/employees/.",
            "/api/v1/employees/%2e%2e",
            "/api/v1/employees/a%2Fb",
            "/api/v1/employees/",
            "/api/v1//employees",
            "/api/v1/employees/me/reach/",
            "/api/v1/employees/a b",
            "api/v1/employees",
        ] {
            assert!(!is_relayable("GET", path), "{path} must not relay");
        }
        let long = format!("/api/v1/employees/{}", "x".repeat(MAX_SEGMENT_LEN + 1));
        assert!(!is_relayable("GET", &long));
    }

    #[test]
    fn a_relayed_call_acts_with_the_lower_rung() {
        assert_eq!(
            relayed_role(Role::Admin, Role::Supervisor),
            Role::Supervisor
        );
        assert_eq!(relayed_role(Role::Cashier, Role::Admin), Role::Cashier);
        assert_eq!(
            relayed_role(Role::Supervisor, Role::Supervisor),
            Role::Supervisor
        );
    }
}
