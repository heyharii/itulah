//! Only the files on the allowlist may read the wall clock directly.
//!
//! The virtual business clock (`src/clock.rs`, VIRTUAL-TIME-PLAN.md) works by
//! routing every *business* instant through `ClockHandle::now()`. That routing
//! is worth exactly as much as it is enforced: a single new `Utc::now()` in a
//! handler or a Postgres adapter is a window, a due-date, or a document date
//! that follows the wall clock while everything around it follows the virtual
//! calendar — the mixed-clock corruption plan §7.4 warns about, reintroduced
//! one call at a time and invisible until a compressed run disagrees with
//! itself.
//!
//! So: any file under `src/` whose *code* (comments stripped, exactly as
//! `kernel_purity.rs` does it) contains `Utc::now()` must appear in
//! [`ALLOWED`] with a reason. The list is the honest inventory of where the
//! audit stands (fase 0a-2 is still working through it: the security files at
//! the top are permanent; everything marked "audit pending" is business-adjacent
//! and is supposed to shrink onto the seam over time). Adding a file to this
//! list is a reviewed act, like adding to `RESERVED` in `migration_hygiene.rs`;
//! adding a *call* without adding to the list turns this test red.

use std::path::{Path, PathBuf};

/// Files that may read the wall clock, and why.
///
/// `src/clock.rs` is the seam itself — wrapping `Utc::now()` is its whole
/// job. The security set (sessions, lockout, leases, breakers, device skew)
/// is permanent: plan §1.1 puts security time on the wall clock forever. The
/// "audit pending" entries are the remaining business-adjacent readers; each
/// is supposed to move onto the clock (or onto an explicit parameter) in fase
/// 0a-2, and entries should be DELETED as that happens, not left to rot.
const ALLOWED: &[(&str, &str)] = &[
    // The seam itself.
    ("src/clock.rs", "the clock seam; wrapping the wall clock is its job"),
    // Security: permanent. Sessions, lockouts, leases, breakers, retention,
    // device-key skew — plan §1.1 keeps these on wall-clock time forever.
    ("src/cloud/postgres/users.rs", "security: sessions and lockouts"),
    ("src/cloud/postgres/auth_policy.rs", "security: edge auth policy expiry"),
    ("src/cloud/postgres/control.rs", "audit stamps on test-control writes"),
    ("src/edge/auth.rs", "security: edge sessions, pin, lockout"),
    ("src/edge/fingerprint.rs", "security: enrolment template stamps"),
    ("src/edge/pin.rs", "security: edge pin sessions"),
    ("src/sync/port.rs", "infra: sync breaker and cycle timing"),
    ("src/sync/inventory.rs", "infra: sync cycle stamps"),
    ("src/sync/rfid.rs", "infra: observation ingest stamps"),
    ("src/sync/transfer.rs", "infra: transfer sync stamps"),
    ("src/cloud/domain/sync.rs", "infra: command expiry against real now"),
    ("src/cloud/intake/imap.rs", "infra: mail fetch timing"),
    ("src/cloud/intake/mod.rs", "infra: intake envelope stamps"),
    // Audit pending (fase 0a-2): remaining business-adjacent wall-clock reads.
    // Each entry should end with the module that will absorb it onto the seam.
    ("src/bin/cloud.rs", "audit pending: background agents pick their month from now (plan §5 moves them onto the virtual calendar)"),
    ("src/cloud/domain/attendance/punch.rs", "audit pending: punch business-date default"),
    ("src/cloud/domain/movement.rs", "audit pending: movement stamps"),
    ("src/cloud/http/acquirer.rs", "audit pending: as-of defaults"),
    ("src/cloud/http/assets.rs", "audit pending: depreciation month pickers"),
    ("src/cloud/http/assistant.rs", "audit pending: assistant freshness"),
    ("src/cloud/http/attendance.rs", "audit pending: punch defaults"),
    ("src/cloud/http/components.rs", "audit pending: payroll period defaults"),
    ("src/cloud/http/employment.rs", "audit pending: employment date defaults"),
    ("src/cloud/http/finance.rs", "audit pending: reversal/posting date defaults"),
    ("src/cloud/http/finance_control.rs", "audit pending: close-readiness windows"),
    ("src/cloud/http/hire.rs", "audit pending: hire date defaults"),
    ("src/cloud/http/holiday.rs", "audit pending: holiday year defaults"),
    ("src/cloud/http/integrity.rs", "audit pending: integrity as-of"),
    ("src/cloud/http/leave.rs", "audit pending: leave year defaults"),
    ("src/cloud/http/mod.rs", "audit pending: handler-level stamps; the occurred_at clamp already reads the clock"),
    ("src/cloud/http/money.rs", "audit pending: cash document defaults"),
    ("src/cloud/http/overtime.rs", "audit pending: overtime period defaults"),
    ("src/cloud/http/pay.rs", "audit pending: payroll period defaults"),
    ("src/cloud/http/payment_ledger.rs", "audit pending: ageing as-of"),
    ("src/cloud/http/punch.rs", "audit pending: punch day defaults"),
    ("src/cloud/http/roster.rs", "audit pending: roster week defaults"),
    ("src/cloud/http/stock_ledger.rs", "audit pending: ledger as-of"),
    ("src/cloud/http/sync_health.rs", "infra: lane freshness against real now"),
    ("src/cloud/http/terminal.rs", "audit pending: terminal lease stamps"),
    ("src/cloud/postgres/advance.rs", "audit pending: advance stamps"),
    ("src/cloud/postgres/allotments.rs", "audit pending: allotment stamps"),
    ("src/cloud/postgres/campaigns.rs", "audit pending: campaign window defaults"),
    ("src/cloud/postgres/commercial.rs", "audit pending: publication stamps"),
    ("src/cloud/postgres/corrections.rs", "audit pending: correction document dates"),
    ("src/cloud/postgres/counts.rs", "audit pending: count stamps"),
    ("src/cloud/postgres/coupons.rs", "audit pending: coupon hold expiry"),
    ("src/cloud/postgres/discussion.rs", "audit pending: discussion stamps"),
    ("src/cloud/postgres/eligibility.rs", "audit pending: eligibility freeze"),
    ("src/cloud/postgres/ledger.rs", "audit pending: ledger as-of defaults"),
    ("src/cloud/postgres/letters.rs", "audit pending: letter month bucket (plan §4: align with doc_date)"),
    ("src/cloud/postgres/member.rs", "audit pending: pairing stamps"),
    ("src/cloud/postgres/notifications.rs", "audit pending: ageing sweep (must become single-source, plan §7.4)"),
    ("src/cloud/postgres/observations.rs", "audit pending: observation window"),
    ("src/cloud/postgres/payment_ledger.rs", "audit pending: payment ageing today"),
    ("src/cloud/postgres/performance.rs", "audit pending: performance windows"),
    ("src/cloud/postgres/price_changes.rs", "audit pending: price-change effective defaults"),
    ("src/cloud/postgres/price_history.rs", "audit pending: price history as-of"),
    ("src/cloud/postgres/punch.rs", "audit pending: punch apply stamps"),
    ("src/cloud/postgres/queries.rs", "audit pending: read-only report as-of"),
    ("src/cloud/postgres/returns.rs", "audit pending: return stamps"),
    ("src/cloud/postgres/sales.rs", "audit pending: sale day windows"),
    ("src/cloud/postgres/statements.rs", "audit pending: statement as-of (has caller-override precedent)"),
    ("src/cloud/postgres/sync.rs", "infra: outbox received/applied and retention stamps"),
    ("src/cloud/postgres/tagging.rs", "audit pending: tagging stamps"),
    ("src/cloud/postgres/time_machine.rs", "infra: report stamp only (time_machine.rs:613)"),
    ("src/cloud/postgres/vouchers.rs", "audit pending: voucher expiry gates (plan §7.2)"),
    ("src/reporting.rs", "business-day helper: becomes clock-driven in fase 0a-1"),
    ("src/edge/attendance.rs", "infra: roster received_at/age freshness only"),
    ("src/edge/http.rs", "audit pending: two as-of envelope stamps (pools, catalog page)"),
    ("src/edge/outbound.rs", "infra: outbound command stamps"),
    ("src/edge/printing.rs", "infra: print job stamps"),
    ("src/edge/rfid.rs", "security: device offline lease only — observation skew/future checks are on the clock"),
    ("src/edge/sqlite.rs", "infra: sync bootstrap/idempotency/projection stamps, pool snapshot, test seeds"),
    ("src/edge/sync.rs", "infra: sender/breaker/retention stamps"),
];

fn repository() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

/// Every `.rs` file under `src/`, relative to the crate root.
fn rust_sources(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_sources(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

/// The source with its comments taken out, exactly as `kernel_purity.rs` does
/// it: these files legitimately DISCUSS `Utc::now()` — this test's own subject
/// — and a scanner that read the discussions would fail on the explanation of
/// the rule it enforces.
fn code_only(source: &str) -> String {
    source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn only_allowlisted_files_read_the_wall_clock() {
    let root = repository().to_path_buf();
    let mut sources = Vec::new();
    rust_sources(&root.join("src"), &mut sources);
    assert!(
        sources.len() > 100,
        "the source walk found only {} files — the walk itself is broken",
        sources.len()
    );

    let mut violations = Vec::new();
    for path in &sources {
        let relative = path
            .strip_prefix(&root)
            .expect("source under crate root")
            .to_string_lossy()
            .replace('\\', "/");
        let source = std::fs::read_to_string(path).unwrap_or_default();
        if code_only(&source).contains("Utc::now()")
            && !ALLOWED.iter().any(|(file, _)| *file == relative)
        {
            violations.push(relative);
        }
    }

    assert!(
        violations.is_empty(),
        "these files read `Utc::now()` but are not on the allowlist in \
         tests/clock_authority.rs: {violations:?}\n\n\
         A wall-clock read outside the allowlist stamps business time from the \
         wrong calendar (VIRTUAL-TIME-PLAN.md §2, §7.4). Route it through \
         `ClockHandle` if it is a business instant, add it to the allowlist \
         with a reason if it is security or infra — never silence this test."
    );
}

#[test]
fn the_allowlist_still_points_at_real_files() {
    // An entry whose file is gone (or was renamed) is a lie future readers
    // inherit. Same spirit as `migration_hygiene.rs`'s RESERVED table.
    let root = repository();
    let stale: Vec<&str> = ALLOWED
        .iter()
        .filter(|(file, _)| !root.join(file).is_file())
        .map(|(file, _)| *file)
        .collect();
    assert!(
        stale.is_empty(),
        "allowlist entries name files that no longer exist: {stale:?} — delete them"
    );
}
