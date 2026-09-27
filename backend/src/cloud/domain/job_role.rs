//! Job roles and the hub sections they open (0633), kept pure like
//! [`super::auth::required_role`]: the HTTP layer supplies the method, the
//! path and the caller's job role, and this answers "may they" without I/O.
//!
//! # Two gates, one after the other
//!
//! The rung gate (`required_role`) says how senior an act is: a cashier does
//! not post a journal. It cannot say which DEPARTMENT an act belongs to — a
//! buyer and a finance officer are both supervisors — so until job roles
//! every supervisor could read and write every supervisor's surface. The
//! section gate is the second question: does this person's job include the
//! part of the hub the path belongs to?
//!
//! Both must say yes. The section gate never widens the rung gate: a Finance
//! supervisor holds `finance`, and still may not post a journal, which is
//! ADMIN.
//!
//! # The table, and what is deliberately not in it
//!
//! [`SECTION_RULES`] maps path prefixes to sections — one table, the only
//! place a path is given a department. A path it does not name stays open to
//! every signed-in person: signing in and out and `me`, notifications, chat
//! and discussions, files, the assistant, setup, comments, flow documents
//! (whose stages the job role's flow roles decide, in `domain::flow`), and
//! everyone's own HR self-service (`/employees/me/…`, leave, attendance,
//! claims, swaps, grievances). The employee app reaches those with a cloud
//! session for every employee, cashiers included, and each handler already
//! binds them by action key and reach.
//!
//! A rule can leave reads open (`Reads::Open`) and take its section only for
//! writes. That is for reference data every screen draws from — article
//! names, colours, units, payment terms — where refusing the read would
//! break a Finance screen for want of a colour name without protecting
//! anything.
//!
//! # What the gate does not see
//!
//! A call a store node relays for its signed-in manager (`domain::relay`) is
//! not a hub call and is not gated here: the relay's allowlist is its own
//! narrower door, bounded to the node's own place.

use super::flow::FlowRole;
use super::record::RecordKind;

/// The OWNER role's code. Holds every section and every flow role.
pub const OWNER: &str = "OWNER";
/// The ADMIN role's code. Holds every section and every flow role.
pub const ADMIN: &str = "ADMIN";

/// Every hub section, as `job_role.sections` spells them (0633).
pub const SECTIONS: [&str; 12] = [
    "finance",
    "merchandise",
    "procurement",
    "operations",
    "inventory",
    "stores",
    "sales",
    "marketing",
    "people",
    "ga",
    "system",
    "reports",
];

/// A section as a sentence names it.
pub fn section_label(code: &str) -> &'static str {
    match code {
        "finance" => "Finance",
        "merchandise" => "Merchandise",
        "procurement" => "Procurement",
        "operations" => "Operations",
        "inventory" => "Inventory",
        "stores" => "Stores",
        "sales" => "Sales",
        "marketing" => "Marketing",
        "people" => "People",
        "ga" => "GA",
        "system" => "System",
        "reports" => "Reports",
        _ => "that section",
    }
}

/// Which servers a job role signs in at (0635).
pub const NODE_REACH: [&str; 3] = ["NONE", "UNIT", "EVERY"];

/// What a session knows of the caller's job role.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct JobGrant {
    pub code: String,
    pub name: String,
    pub flow_roles: Vec<FlowRole>,
    pub sections: Vec<String>,
    pub read_only: bool,
}

impl JobGrant {
    /// Everything, for a caller who is the owner by construction: the
    /// development principal of a node running with sign-in switched off.
    pub fn everything() -> Self {
        Self {
            code: OWNER.to_owned(),
            name: "Owner".to_owned(),
            flow_roles: FlowRole::ALL.to_vec(),
            sections: SECTIONS.iter().map(|s| (*s).to_owned()).collect(),
            read_only: false,
        }
    }

    /// Read from stored codes. A flow role this build does not know is
    /// dropped rather than guessed at — it grants nothing.
    pub fn from_stored(
        code: String,
        name: String,
        flow_roles: &[String],
        sections: Vec<String>,
        read_only: bool,
    ) -> Self {
        Self {
            code,
            name,
            flow_roles: flow_roles
                .iter()
                .filter_map(|role| FlowRole::parse(role))
                .collect(),
            sections,
            read_only,
        }
    }

    /// OWNER and ADMIN: every section and every flow stage, whatever their
    /// row says.
    pub fn holds_everything(&self) -> bool {
        self.code == OWNER || self.code == ADMIN
    }

    pub fn holds_section(&self, section: &str) -> bool {
        self.holds_everything() || self.sections.iter().any(|held| held == section)
    }

    /// The flow roles this job may act as.
    pub fn flow_roles_held(&self) -> Vec<FlowRole> {
        if self.holds_everything() {
            FlowRole::ALL.to_vec()
        } else {
            self.flow_roles.clone()
        }
    }

    /// The sections this job may use, for `me`: all of them for OWNER and
    /// ADMIN, in the vocabulary's order either way.
    pub fn sections_held(&self) -> Vec<String> {
        SECTIONS
            .iter()
            .filter(|section| self.holds_section(section))
            .map(|section| (*section).to_owned())
            .collect()
    }
}

/// Who may read a sectioned path.
#[derive(Clone, Copy, Debug)]
pub enum Reads {
    /// Only the sections that may write it.
    Same,
    /// Those, and these as well.
    Also(&'static [&'static str]),
    /// Anybody signed in: reference data every screen draws from.
    Open,
}

/// One row of the table: a path prefix, the sections that may write under
/// it, and who may read it.
#[derive(Clone, Copy, Debug)]
pub struct SectionRule {
    pub prefix: &'static str,
    pub writes: &'static [&'static str],
    pub reads: Reads,
}

const fn rule(
    prefix: &'static str,
    writes: &'static [&'static str],
    reads: Reads,
) -> SectionRule {
    SectionRule {
        prefix,
        writes,
        reads,
    }
}

/// The one table. The most specific prefix wins, and a prefix matches whole
/// path segments only (`/api/v1/sales` is not `/api/v1/sales-postings`).
pub const SECTION_RULES: &[SectionRule] = &[
    // ── finance ────────────────────────────────────────────────────────
    rule("/api/v1/finance", &["finance"], Reads::Same),
    // A shop manager clears their own shift's or count's item off the
    // attention queue (`required_role` says why this is not an accounting act).
    rule("/api/v1/finance/attention", &["finance", "stores"], Reads::Same),
    rule("/api/v1/payment-terms", &["finance"], Reads::Open),
    rule("/api/v1/store-money", &["finance", "stores"], Reads::Same),
    // ── stores: a store's own page and opening checklist ───────────────
    rule("/api/v1/stores", &["stores"], Reads::Same),
    // ── procurement ────────────────────────────────────────────────────
    rule(
        "/api/v1/purchase-orders",
        &["procurement"],
        Reads::Also(&["finance", "inventory", "operations"]),
    ),
    rule(
        "/api/v1/purchase-order-lines",
        &["procurement"],
        Reads::Also(&["finance", "inventory", "operations"]),
    ),
    rule(
        "/api/v1/purchase-price-amendments",
        &["procurement"],
        Reads::Also(&["finance"]),
    ),
    rule("/api/v1/purchase-destinations", &["procurement"], Reads::Open),
    rule(
        "/api/v1/suppliers",
        &["procurement", "finance"],
        Reads::Also(&["merchandise"]),
    ),
    rule(
        "/api/v1/supplier-items",
        &["procurement"],
        Reads::Also(&["merchandise"]),
    ),
    rule("/api/v1/sourcing-basket", &["procurement"], Reads::Same),
    // ── merchandise ────────────────────────────────────────────────────
    rule("/api/v1/articles", &["merchandise"], Reads::Open),
    rule("/api/v1/article-codes", &["merchandise"], Reads::Open),
    rule(
        "/api/v1/article-setups",
        &["merchandise", "procurement"],
        Reads::Also(&["inventory"]),
    ),
    rule("/api/v1/catalogue", &["merchandise"], Reads::Open),
    rule("/api/v1/colours", &["merchandise"], Reads::Open),
    rule(
        "/api/v1/unit-conversions",
        &["merchandise", "procurement"],
        Reads::Open,
    ),
    // Units of measure (a dozen is twelve), not organisational units.
    rule("/api/v1/units", &["merchandise", "procurement"], Reads::Open),
    rule(
        "/api/v1/inventory/allotments",
        &["merchandise"],
        Reads::Also(&["inventory", "operations", "stores"]),
    ),
    // ── marketing, and the prices merchandise owns inside Commercial ───
    rule(
        "/api/v1/commercial",
        &["marketing"],
        Reads::Also(&["merchandise", "sales"]),
    ),
    rule(
        "/api/v1/commercial/article-prices",
        &["merchandise"],
        Reads::Also(&["marketing", "sales"]),
    ),
    rule(
        "/api/v1/commercial/price-changes",
        &["merchandise"],
        Reads::Also(&["marketing", "sales"]),
    ),
    rule(
        "/api/v1/commercial/price-events",
        &["merchandise"],
        Reads::Also(&["marketing", "sales"]),
    ),
    rule(
        "/api/v1/commercial/price-history",
        &["merchandise"],
        Reads::Also(&["marketing", "sales"]),
    ),
    rule(
        "/api/v1/commercial/products",
        &["merchandise"],
        Reads::Also(&["marketing", "sales"]),
    ),
    rule(
        "/api/v1/commercial/allocations",
        &["merchandise"],
        Reads::Also(&["marketing", "sales"]),
    ),
    rule("/api/v1/members", &["marketing"], Reads::Also(&["sales"])),
    rule("/api/v1/customers", &["marketing", "sales"], Reads::Same),
    // `/api/v1/customer/{card}/…` is deliberately absent: it is the
    // counter's lookup of the card in front of it (see `COUNTER_ACTS`).
    // ── sales ──────────────────────────────────────────────────────────
    rule("/api/v1/sales", &["sales"], Reads::Also(&["finance", "stores"])),
    rule(
        "/api/v1/shop-sales",
        &["sales"],
        Reads::Also(&["finance", "stores"]),
    ),
    rule("/api/v1/returns", &["sales", "stores"], Reads::Also(&["finance"])),
    rule(
        "/api/v1/checkout-exceptions",
        &["sales", "stores"],
        Reads::Also(&["finance"]),
    ),
    // ── inventory ──────────────────────────────────────────────────────
    rule(
        "/api/v1/inventory",
        &["inventory"],
        Reads::Also(&["operations", "stores", "merchandise"]),
    ),
    // ── people ─────────────────────────────────────────────────────────
    // Head office's HR administration is `people`. The HR a store manager does
    // for their own store — closing the month, filing a hire, a change or a
    // one-off figure, its payroll run, the checklist, interviews — is `stores`
    // as well: the handlers bound it to their own unit by reach, and head
    // office's decisions on it (approving a run, deciding a hire) stay behind
    // their own action keys. Everyone's own self-service is not in the table
    // at all (see the module doc).
    rule("/api/v1/payroll", &["people", "stores"], Reads::Also(&["finance"])),
    rule("/api/v1/payroll/components", &["people"], Reads::Open),
    rule("/api/v1/hr-scheduler", &["people"], Reads::Same),
    rule("/api/v1/recruitment", &["people", "stores"], Reads::Same),
    rule("/api/v1/hire-proposals", &["people", "stores"], Reads::Same),
    rule("/api/v1/change-proposals", &["people", "stores"], Reads::Same),
    rule("/api/v1/exit-interviews", &["people"], Reads::Same),
    rule("/api/v1/full-and-final-statements", &["people"], Reads::Also(&["finance"])),
    rule("/api/v1/performance", &["people", "stores"], Reads::Same),
    rule("/api/v1/training-programs", &["people"], Reads::Also(&["stores"])),
    rule("/api/v1/attendance-policy", &["people"], Reads::Open),
    rule("/api/v1/leave-policy", &["people"], Reads::Open),
    rule("/api/v1/overtime-policy", &["people"], Reads::Open),
    rule("/api/v1/people-policy", &["people"], Reads::Open),
    rule("/api/v1/attendance-periods", &["people", "stores"], Reads::Same),
    rule("/api/v1/attendance-terminals", &["people", "system"], Reads::Same),
    rule("/api/v1/org", &["people"], Reads::Open),
    rule("/api/v1/lifecycle", &["people", "stores"], Reads::Same),
    // ── general affairs ────────────────────────────────────────────────
    // GA is the department that FILES a fact — a door is broken, the lease
    // ends in sixty days — and a shop manager files them for their shop
    // (`required_role` says why reads and writes are one rung here).
    rule("/api/v1/ga", &["ga", "stores"], Reads::Same),
    rule("/api/v1/letters", &["ga", "people"], Reads::Same),
    // ── system ─────────────────────────────────────────────────────────
    rule("/api/v1/auth/users", &["system"], Reads::Same),
    rule("/api/v1/auth/edge-assignments", &["system"], Reads::Same),
    rule("/api/v1/auth/edge-policies", &["system"], Reads::Same),
    rule("/api/v1/auth/rfid-devices", &["system"], Reads::Same),
    rule("/api/v1/roles", &["system"], Reads::Open),
    rule("/api/v1/invitations", &["system"], Reads::Same),
    rule("/api/v1/audit", &["system"], Reads::Also(&["finance"])),
    rule("/api/v1/sync", &["system"], Reads::Open),
    // The fleet status page, sync freshness and alerts (0637-0640) are IT's.
    rule("/api/v1/fleet", &["system"], Reads::Same),
    rule("/api/v1/organisation", &["system", "people"], Reads::Open),
    rule("/api/v1/vocabulary", &["system", "merchandise"], Reads::Open),
    // ── reports ────────────────────────────────────────────────────────
    rule("/api/v1/reports", &["reports"], Reads::Same),
    rule(
        "/api/v1/reports/sales",
        &["reports"],
        Reads::Also(&["sales", "stores"]),
    ),
];

/// The writes a read-only job may still make: acts on the caller's own
/// session and queue, not on the company's records.
const SELF_SERVICE_WRITES: &[&str] = &[
    "/api/v1/auth/logout",
    "/api/v1/auth/change-password",
    "/api/v1/auth/edge-sso-ticket",
    "/api/v1/notifications",
    "/api/v1/push/subscriptions",
];

/// Acts a till performs with a shopper standing at the counter — the ones
/// `required_role` gives to the Cashier rung on purpose: enrolling a card,
/// issuing its pairing code, spending a voucher. They are the counter's, not
/// a hub section's, so every signed-in person keeps them (a read-only job
/// still writes nothing).
fn is_counter_act(method: &str, path: &str) -> bool {
    if !method.eq_ignore_ascii_case("POST") {
        return false;
    }
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    match segments.as_slice() {
        ["api", "v1", "members"] => true,
        ["api", "v1", "members", card, "pairing-code"] => *card != "segments",
        ["api", "v1", "commercial", "vouchers", _, "redeem"] => true,
        _ => false,
    }
}

/// Whether `path` is `prefix` or lies under it, by whole segments.
fn under(path: &str, prefix: &str) -> bool {
    path.strip_prefix(prefix)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

fn is_read(method: &str) -> bool {
    matches!(method.to_ascii_uppercase().as_str(), "GET" | "HEAD" | "OPTIONS")
}

/// The rule governing a path, when one does.
///
/// The records surface names its kind in the path and borrows the rule of
/// the read that already serves that record — the same delegation
/// `required_role` makes, for the same reason.
pub fn section_rule(path: &str) -> Option<&'static SectionRule> {
    if let Some(rest) = path.strip_prefix("/api/v1/records/") {
        let kind = rest.split('/').next().unwrap_or_default();
        return RecordKind::parse(kind).and_then(|kind| section_rule(kind.read_path()));
    }
    SECTION_RULES
        .iter()
        .filter(|rule| under(path, rule.prefix))
        .max_by_key(|rule| rule.prefix.len())
}

/// The sections that would let `method` through on `path`; `None` when the
/// path is open to every signed-in person.
pub fn sections_for(method: &str, path: &str) -> Option<Vec<&'static str>> {
    // Writes on the records surface are gated as reads of the record, like
    // the rung (see `required_role`).
    let method = if path.starts_with("/api/v1/records/") {
        "GET"
    } else {
        method
    };
    let rule = section_rule(path)?;
    if !is_read(method) {
        return Some(rule.writes.to_vec());
    }
    match rule.reads {
        Reads::Open => None,
        Reads::Same => Some(rule.writes.to_vec()),
        Reads::Also(more) => {
            let mut sections = rule.writes.to_vec();
            sections.extend(more.iter().copied());
            Some(sections)
        }
    }
}

/// The section gate: may this job make this request? The refusal is a
/// sentence the person can take to an administrator.
pub fn section_gate(method: &str, path: &str, job: &JobGrant) -> Result<(), String> {
    if job.holds_everything() {
        return Ok(());
    }
    if job.read_only
        && !is_read(method)
        && !SELF_SERVICE_WRITES.iter().any(|open| under(path, open))
    {
        return Err(format!(
            "your role ({}) can only read; it cannot change anything",
            job.name
        ));
    }
    if is_counter_act(method, path) {
        return Ok(());
    }
    let Some(sections) = sections_for(method, path) else {
        return Ok(());
    };
    if sections.iter().any(|section| job.holds_section(section)) {
        return Ok(());
    }
    let named = sections
        .first()
        .map(|section| section_label(section))
        .unwrap_or("that section");
    Err(format!(
        "your role ({}) does not include {named}; ask an administrator if your job needs it",
        job.name
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(code: &str, sections: &[&str], read_only: bool) -> JobGrant {
        JobGrant {
            code: code.to_owned(),
            name: code.to_owned(),
            flow_roles: Vec::new(),
            sections: sections.iter().map(|s| (*s).to_owned()).collect(),
            read_only,
        }
    }

    #[test]
    fn every_rule_names_known_sections() {
        for rule in SECTION_RULES {
            let reads: &[&str] = match rule.reads {
                Reads::Also(more) => more,
                Reads::Same | Reads::Open => &[],
            };
            for section in rule.writes.iter().chain(reads) {
                assert!(SECTIONS.contains(section), "{} names {section}", rule.prefix);
            }
        }
    }

    #[test]
    fn owner_and_admin_hold_every_section_whatever_their_row_says() {
        let owner = job(OWNER, &[], false);
        assert!(section_gate("POST", "/api/v1/finance/journal", &owner).is_ok());
        assert!(section_gate("POST", "/api/v1/ga/assets", &job(ADMIN, &[], false)).is_ok());
    }

    #[test]
    fn a_department_is_refused_another_departments_surface() {
        let finance = job("FINANCE", &["finance", "reports"], false);
        assert!(section_gate("GET", "/api/v1/finance/trial-balance", &finance).is_ok());
        assert!(section_gate("POST", "/api/v1/purchase-orders", &finance).is_err());
        // Reading the order book is Finance's too, for matching bills.
        assert!(section_gate("GET", "/api/v1/purchase-orders", &finance).is_ok());
        assert!(section_gate("GET", "/api/v1/ga/overview", &finance).is_err());
    }

    #[test]
    fn reference_reads_stay_open_and_their_writes_do_not() {
        let hr = job("HR", &["people", "reports"], false);
        assert!(section_gate("GET", "/api/v1/colours", &hr).is_ok());
        assert!(section_gate("POST", "/api/v1/colours", &hr).is_err());
    }

    #[test]
    fn unsectioned_paths_stay_open_to_everyone() {
        let cashier = job("CASHIER", &[], false);
        for (method, path) in [
            ("GET", "/api/v1/auth/me"),
            ("POST", "/api/v1/employees/me/leave-requests"),
            ("GET", "/api/v1/notifications"),
            ("POST", "/api/v1/chat/conversations/abc/messages"),
            ("POST", "/api/v1/flows/abc/confirm"),
            ("GET", "/api/v1/setup"),
        ] {
            assert!(section_gate(method, path, &cashier).is_ok(), "{method} {path}");
        }
        assert!(section_gate("GET", "/api/v1/finance/bills", &cashier).is_err());
    }

    #[test]
    fn a_prefix_matches_whole_segments() {
        assert!(sections_for("GET", "/api/v1/sales-postings").is_none());
        assert!(sections_for("GET", "/api/v1/sales/abc").is_some());
    }

    #[test]
    fn the_most_specific_rule_wins() {
        let stores = job("STORE_MANAGER", &["stores", "sales", "inventory"], false);
        assert!(section_gate("POST", "/api/v1/finance/attention/abc/resolve", &stores).is_ok());
        assert!(section_gate("POST", "/api/v1/finance/journal", &stores).is_err());
        let merchandise = job("MERCHANDISE", &["merchandise", "sales", "reports"], false);
        assert!(section_gate("POST", "/api/v1/inventory/allotments", &merchandise).is_ok());
        assert!(section_gate("POST", "/api/v1/inventory/movements", &merchandise).is_err());
    }

    #[test]
    fn a_read_only_job_reads_its_sections_and_writes_nothing() {
        let auditor = job("AUDITOR", &["finance", "reports", "sales", "inventory"], true);
        assert!(section_gate("GET", "/api/v1/finance/trial-balance", &auditor).is_ok());
        assert!(section_gate("GET", "/api/v1/ga/overview", &auditor).is_err());
        assert!(section_gate("POST", "/api/v1/finance/attention/a/resolve", &auditor).is_err());
        assert!(section_gate("POST", "/api/v1/chat/conversations/a/messages", &auditor).is_err());
        assert!(section_gate("POST", "/api/v1/auth/logout", &auditor).is_ok());
        assert!(section_gate("POST", "/api/v1/notifications/a/read", &auditor).is_ok());
    }

    #[test]
    fn the_counter_keeps_its_own_acts() {
        let cashier = job("CASHIER", &[], false);
        assert!(section_gate("POST", "/api/v1/members", &cashier).is_ok());
        assert!(section_gate("POST", "/api/v1/members/M-1/pairing-code", &cashier).is_ok());
        assert!(section_gate("POST", "/api/v1/commercial/vouchers/G1/redeem", &cashier).is_ok());
        assert!(section_gate("GET", "/api/v1/customer/M-1/summary", &cashier).is_ok());
        // Deciding who the company talks to is not a counter act.
        assert!(section_gate("POST", "/api/v1/members/segments/saved", &cashier).is_err());
        assert!(section_gate("GET", "/api/v1/members", &cashier).is_err());
        assert!(section_gate("POST", "/api/v1/commercial/vouchers", &cashier).is_err());
    }

    #[test]
    fn the_records_surface_borrows_the_section_of_the_record() {
        let marketing = job("MARKETING", &["marketing", "sales", "reports"], false);
        assert!(section_gate("GET", "/api/v1/records/bill/abc/info", &marketing).is_err());
        assert!(section_gate("POST", "/api/v1/records/sale/abc/comments", &marketing).is_ok());
    }
}
