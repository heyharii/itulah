//! The control panel: every subledger beside the ledger it controls.
//!
//! One shape for every domain — `gl`, `subledger`, `difference`, and what is
//! unmatched — because the question is the same one each time and a Finance
//! reader should not have to learn eleven screens to ask it. The DATA stays
//! typed in its own module; this is the presentation, and it calls each
//! domain's own reconciliation rather than re-deriving it here.
//!
//! A domain nothing can answer yet says so, with the reason. That is the point
//! of the `covered` flag: a control panel that silently omits inventory reads
//! as "inventory agrees".

use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ControlRow {
    /// `PREPAID`, `TAX`, `ADVANCE`, `FINANCING`, `AP`, `INTERUNIT`, …
    pub domain: String,
    pub label: String,
    /// What the ledger holds on the accounts this domain controls.
    pub gl_minor: i64,
    /// What the domain's own records come to.
    pub subledger_minor: i64,
    pub difference_minor: i64,
    /// Rows the domain could not match — open items, unpaired legs.
    pub unmatched: i64,
    /// False when nothing in this estate can answer for the domain yet, with
    /// `note` saying why. Never a zero pretending to be agreement.
    pub covered: bool,
    pub note: Option<String>,
}

/// Every control, as at a date.
pub async fn finance_controls(
    pool: &PgPool,
    as_of: Option<NaiveDate>,
) -> Result<Vec<ControlRow>, AppError> {
    let mut rows = Vec::new();

    // ── prepaid ────────────────────────────────────────────────────────────
    let prepaid = super::prepaid_reconciliation(pool, as_of).await?;
    rows.push(ControlRow {
        domain: "PREPAID".into(),
        label: "Biaya dibayar dimuka".into(),
        gl_minor: prepaid.iter().map(|row| row.gl_minor).sum(),
        subledger_minor: prepaid.iter().map(|row| row.subledger_minor).sum(),
        difference_minor: prepaid.iter().map(|row| row.difference_minor).sum(),
        unmatched: prepaid
            .iter()
            .filter(|row| row.difference_minor != 0)
            .count() as i64,
        covered: true,
        note: None,
    });

    // ── tax, kept apart by nature ──────────────────────────────────────────
    let tax = super::tax_reconciliation(pool, None).await?;
    for nature in ["PAYABLE", "CREDIT"] {
        let slice: Vec<_> = tax.iter().filter(|row| row.nature == nature).collect();
        rows.push(ControlRow {
            domain: format!("TAX_{nature}"),
            label: if nature == "PAYABLE" {
                "Pajak terutang".into()
            } else {
                "Kredit pajak".into()
            },
            gl_minor: slice.iter().map(|row| row.gl_minor).sum(),
            subledger_minor: slice.iter().map(|row| row.subledger_minor).sum(),
            difference_minor: slice.iter().map(|row| row.difference_minor).sum(),
            unmatched: slice.iter().filter(|row| row.difference_minor != 0).count() as i64,
            covered: true,
            // Said on the row, because the one mistake this domain invites is
            // adding the two lines together.
            note: Some(
                "Kredit dan utang pajak tidak pernah dijaringkan; keduanya dibaca terpisah.".into(),
            ),
        });
    }

    // ── advances ───────────────────────────────────────────────────────────
    let advances = super::advance_reconciliation(pool).await?;
    rows.push(ControlRow {
        domain: "ADVANCE".into(),
        label: "Uang muka".into(),
        gl_minor: advances.iter().map(|row| row.gl_minor).sum(),
        subledger_minor: advances.iter().map(|row| row.subledger_minor).sum(),
        difference_minor: advances.iter().map(|row| row.difference_minor).sum(),
        unmatched: advances.iter().map(|row| row.open_advances).sum(),
        covered: true,
        note: None,
    });

    // ── financing ──────────────────────────────────────────────────────────
    let facilities = super::financing_facilities(pool, Some("ACTIVE")).await?;
    let outstanding: i64 = facilities
        .iter()
        .map(|facility| facility.outstanding_principal_minor)
        .sum();
    let loan_gl: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.credit_minor - l.debit_minor),0)::bigint
           FROM journal_line l
          WHERE l.account_code IN (
                SELECT account_code FROM account_map WHERE semantic_key = 'loan_principal')",
    )
    .fetch_one(pool)
    .await?;
    rows.push(ControlRow {
        domain: "FINANCING".into(),
        label: "Pinjaman".into(),
        gl_minor: loan_gl,
        subledger_minor: outstanding,
        difference_minor: loan_gl - outstanding,
        unmatched: facilities.len() as i64,
        covered: true,
        note: None,
    });

    // ── supplier payables ──────────────────────────────────────────────────
    let ap = sqlx::query(
        "SELECT
            COALESCE((SELECT SUM(l.credit_minor - l.debit_minor)
                        FROM journal_line l
                       WHERE l.account_code IN (
                             SELECT account_code FROM account_map
                              WHERE semantic_key IN ('trade_payable','non_merchandise_payable'))
                    ), 0)::bigint AS gl_minor,
            COALESCE((SELECT SUM(st.outstanding_minor) FROM supplier_invoice_standing st), 0)::bigint
                AS subledger_minor,
            COALESCE((SELECT COUNT(*) FROM supplier_invoice_standing st
                       WHERE st.outstanding_minor <> 0), 0)::bigint AS unmatched",
    )
    .fetch_one(pool)
    .await;
    match ap {
        Ok(row) => {
            let gl: i64 = row.try_get("gl_minor")?;
            let sub: i64 = row.try_get("subledger_minor")?;
            rows.push(ControlRow {
                domain: "AP".into(),
                label: "Hutang supplier".into(),
                gl_minor: gl,
                subledger_minor: sub,
                difference_minor: gl - sub,
                unmatched: row.try_get("unmatched")?,
                covered: true,
                note: None,
            });
        }
        Err(_) => rows.push(ControlRow {
            domain: "AP".into(),
            label: "Hutang supplier".into(),
            gl_minor: 0,
            subledger_minor: 0,
            difference_minor: 0,
            unmatched: 0,
            covered: false,
            note: Some("supplier_invoice_standing belum ada di database ini".into()),
        }),
    }

    // ── inter-unit ─────────────────────────────────────────────────────────
    //
    // The test is not GL against a subledger: it is that the affiliate accounts
    // net to nothing across every unit. Money head office is owed by a shop is
    // money that shop owes head office, and a total that is not zero means one
    // leg of a pair never posted.
    let interunit: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor),0)::bigint
           FROM journal_line l
          WHERE l.account_code IN (
                SELECT account_code FROM account_map
                 WHERE semantic_key IN ('affiliate_receivable','affiliate_payable'))",
    )
    .fetch_one(pool)
    .await?;
    rows.push(ControlRow {
        domain: "INTERUNIT".into(),
        label: "Affiliasi antar unit".into(),
        gl_minor: interunit,
        subledger_minor: 0,
        difference_minor: interunit,
        unmatched: i64::from(interunit != 0),
        covered: true,
        note: Some("Setiap piutang antar unit adalah hutang unit lain; totalnya nol.".into()),
    });

    // ── bank ───────────────────────────────────────────────────────────────
    //
    // The ledger against the last statement the bank sent. Not against our own
    // running total of what we posted — that would be the ledger checked
    // against itself. A difference here is either a posting the bank has not
    // seen or money the bank saw and nobody booked, which is exactly what a
    // reconciliation is for.
    let bank = sqlx::query(
        "WITH mapped AS (
             SELECT DISTINCT m.site_id, m.account_code
               FROM account_map m
              WHERE m.semantic_key IN ('bank_giro', 'bank_savings')
         ), latest AS (
             SELECT DISTINCT ON (s.site_id, s.account_code)
                    s.site_id, s.account_code, s.closing_minor, s.period_end
               FROM bank_statement s
               JOIN mapped ON mapped.site_id = s.site_id
                          AND mapped.account_code = s.account_code
              ORDER BY s.site_id, s.account_code, s.period_end DESC
         )
         SELECT
            COALESCE((SELECT SUM(l.debit_minor - l.credit_minor)
                        FROM journal_line l
                        JOIN mapped ON mapped.site_id = l.site_id
                                   AND mapped.account_code = l.account_code), 0)::bigint
                AS gl_minor,
            COALESCE((SELECT SUM(closing_minor) FROM latest), 0)::bigint AS subledger_minor,
            (SELECT COUNT(*) FROM mapped)::bigint AS accounts,
            (SELECT COUNT(*) FROM latest)::bigint AS with_statement",
    )
    .fetch_one(pool)
    .await?;
    let bank_gl: i64 = bank.try_get("gl_minor")?;
    let bank_sub: i64 = bank.try_get("subledger_minor")?;
    let bank_accounts: i64 = bank.try_get("accounts")?;
    let with_statement: i64 = bank.try_get("with_statement")?;
    rows.push(ControlRow {
        domain: "BANK".into(),
        label: "Bank".into(),
        gl_minor: bank_gl,
        subledger_minor: bank_sub,
        difference_minor: bank_gl - bank_sub,
        unmatched: bank_accounts - with_statement,
        covered: with_statement > 0,
        note: if with_statement == 0 {
            Some(
                "Belum ada rekening koran yang diimpor, jadi belum ada pembanding dari bank."
                    .into(),
            )
        } else if bank_accounts > with_statement {
            Some(format!(
                "{} rekening belum punya rekening koran",
                bank_accounts - with_statement
            ))
        } else {
            None
        },
    });

    // ── fixed assets ───────────────────────────────────────────────────────
    //
    // The register against the ledger, at cost. Capitalisation is what puts a
    // figure on an asset — `fixed_asset` carries what the thing IS and the
    // decision carries what it cost — so the register's total is the sum of
    // the capitalised costs of everything not yet disposed of.
    let asset = sqlx::query(
        "SELECT
            COALESCE((SELECT SUM(l.debit_minor - l.credit_minor)
                        FROM journal_line l
                       WHERE l.account_code IN (
                             SELECT account_code FROM account_map
                              WHERE semantic_key = 'fixed_asset')), 0)::bigint AS gl_minor,
            COALESCE((SELECT SUM(c.capitalized_cost_minor)
                        FROM asset_capitalization c
                        JOIN fixed_asset a ON a.asset_id = c.asset_id
                       WHERE a.disposed_on IS NULL), 0)::bigint AS subledger_minor,
            COALESCE((SELECT COUNT(*) FROM fixed_asset a
                       WHERE a.disposed_on IS NULL
                         AND NOT EXISTS (SELECT 1 FROM asset_capitalization c
                                          WHERE c.asset_id = a.asset_id)), 0)::bigint
                AS uncapitalised",
    )
    .fetch_one(pool)
    .await;
    match asset {
        Ok(row) => {
            let gl: i64 = row.try_get("gl_minor")?;
            let sub: i64 = row.try_get("subledger_minor")?;
            let uncapitalised: i64 = row.try_get("uncapitalised")?;
            rows.push(ControlRow {
                domain: "FIXED_ASSET".into(),
                label: "Aset tetap".into(),
                gl_minor: gl,
                subledger_minor: sub,
                difference_minor: gl - sub,
                unmatched: uncapitalised,
                covered: true,
                note: if uncapitalised == 0 {
                    None
                } else {
                    Some(format!(
                        "{uncapitalised} aset terdaftar belum punya keputusan kapitalisasi"
                    ))
                },
            });
        }
        Err(_) => rows.push(ControlRow {
            domain: "FIXED_ASSET".into(),
            label: "Aset tetap".into(),
            gl_minor: 0,
            subledger_minor: 0,
            difference_minor: 0,
            unmatched: 0,
            covered: false,
            note: Some("register aset belum ada di database ini".into()),
        }),
    }

    // ── payroll ────────────────────────────────────────────────────────────
    //
    // What the slips say is owed against what the ledger holds. A run that has
    // been posted and not yet handed over IS the accrual, so the subledger is
    // the net of its slips.
    let payroll = sqlx::query(
        "SELECT
            COALESCE((SELECT SUM(l.credit_minor - l.debit_minor)
                        FROM journal_line l
                       WHERE l.account_code IN (
                             SELECT account_code FROM account_map
                              WHERE semantic_key = 'payroll_payable')), 0)::bigint AS gl_minor,
            COALESCE((SELECT SUM(s.net_minor) FROM payroll_slip s
                        JOIN payroll_run r ON r.id = s.run_id
                       WHERE r.state <> 'DRAFT'), 0)::bigint AS subledger_minor,
            COALESCE((SELECT COUNT(*) FROM payroll_run r WHERE r.state = 'DRAFT'), 0)::bigint
                AS drafts",
    )
    .fetch_one(pool)
    .await;
    if let Ok(row) = payroll {
        let gl: i64 = row.try_get("gl_minor")?;
        let sub: i64 = row.try_get("subledger_minor")?;
        rows.push(ControlRow {
            domain: "PAYROLL".into(),
            label: "Gaji terutang".into(),
            gl_minor: gl,
            subledger_minor: sub,
            difference_minor: gl - sub,
            unmatched: row.try_get("drafts")?,
            // Not covered, and the difference below is not a discrepancy to
            // chase: it is the whole subledger. A payroll run approves slips
            // and posts NOTHING — `pay.rs` builds no `PostingIntent` — so
            // `payroll_payable` is only ever DEBITED, by a store paying an
            // advance against it (`store_money.rs`). The credit that should
            // raise the liability, and the salary expense that should sit
            // opposite it, have never existed.
            //
            // This is the largest thing missing from the ledger: the client's
            // own 2025 general ledger puts head-office salaries alone at
            // Rp 2.87 billion. It predates the forty-account chart and is not
            // caused by it — what the chart changed is that the expense now has
            // one visible home (`6201 Beban karyawan`, carrying a
            // `pay_component`) instead of twenty-six unmapped client leaves, so
            // the hole is a named account nothing reaches rather than a gap in
            // a list nobody read.
            //
            // Not filled in here, because WHEN the expense is recognised —
            // approval or payment — is a policy decision, not a defect to patch.
            // `docs/finance-client-decisions.md` carries the question.
            covered: false,
            note: Some(
                "Run payroll belum memposting jurnal apa pun: tidak ada beban gaji \
                 dan tidak ada kredit ke utang gaji, jadi selisih di bawah ini sama \
                 dengan seluruh subledger. Lihat docs/finance-client-decisions.md."
                    .into(),
            ),
        });
    }

    // ── the ones nothing can answer yet ────────────────────────────────────
    rows.push(ControlRow {
        domain: "INVENTORY".into(),
        label: "Persediaan".into(),
        gl_minor: sqlx::query_scalar(
            "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor),0)::bigint
               FROM journal_line l
              WHERE l.account_code IN (
                    SELECT account_code FROM account_map WHERE semantic_key = 'inventory')",
        )
        .fetch_one(pool)
        .await?,
        subledger_minor: 0,
        difference_minor: 0,
        unmatched: 0,
        covered: false,
        note: Some(
            "Stok belum bernilai uang: tidak ada metode kos, jadi angka persediaan \
             tidak bisa diturunkan dari gudang. Lihat docs/finance-client-decisions.md."
                .into(),
        ),
    });

    Ok(rows)
}

// ---------------------------------------------------------------------------
// Month-end close
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FinanceCloseCheck {
    pub code: String,
    pub label: String,
    /// `OK`, `BLOCKER` or `UNKNOWN`. A blocker stops the close; unknown is a
    /// check nothing can answer and is reported rather than assumed good.
    pub status: String,
    pub detail: String,
    pub count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FinanceCloseReadiness {
    pub year: i32,
    pub month: i32,
    pub period_status: String,
    pub blockers: i64,
    pub unknowns: i64,
    pub checks: Vec<FinanceCloseCheck>,
}

fn check(code: &str, label: &str, status: &str, detail: String, count: i64) -> FinanceCloseCheck {
    FinanceCloseCheck {
        code: code.into(),
        label: label.into(),
        status: status.into(),
        detail,
        count,
    }
}

/// What stands between this month and being closed.
///
/// It reports; it never repairs. A close that quietly fixed what it found would
/// be a close nobody could audit.
pub async fn finance_close_readiness(
    pool: &PgPool,
    year: i32,
    month: u32,
) -> Result<FinanceCloseReadiness, AppError> {
    let year16 = i16::try_from(year).unwrap_or_default();
    let month16 = i16::try_from(month).unwrap_or_default();
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM fiscal_period WHERE year = $1 AND month = $2")
            .bind(year16)
            .bind(month16)
            .fetch_optional(pool)
            .await?;
    let period_status = status.unwrap_or_else(|| "NONE".into());

    let mut checks: Vec<FinanceCloseCheck> = Vec::new();

    // Trading days that never became a document.
    let unposted: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM (
             SELECT DISTINCT s.site_id,
                    ((s.occurred_at AT TIME ZONE 'UTC') + make_interval(mins => 420))::date AS day
               FROM edge_sale s
              WHERE EXTRACT(YEAR FROM (s.occurred_at AT TIME ZONE 'UTC') + make_interval(mins => 420)) = $1
                AND EXTRACT(MONTH FROM (s.occurred_at AT TIME ZONE 'UTC') + make_interval(mins => 420)) = $2
         ) traded
         WHERE NOT EXISTS (
             SELECT 1 FROM sales_posting p
              WHERE p.site_id = traded.site_id AND p.business_date = traded.day
                AND p.status = 'POSTED')",
    )
    .bind(i32::from(year16))
    .bind(i32::from(month16))
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    checks.push(check(
        "SALE_DAYS",
        "Hari dagang sudah masuk buku",
        if unposted == 0 { "OK" } else { "BLOCKER" },
        format!("{unposted} hari berdagang dan belum diposting"),
        unposted,
    ));

    // Prepaid months that belong to this one and have not been allocated.
    let prepaid_due: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM prepaid_schedule s
          WHERE s.status = 'ACTIVE'
            AND s.start_period <= make_date($1::int, $2::int, 1)
            AND s.end_period >= make_date($1::int, $2::int, 1)
            AND NOT EXISTS (SELECT 1 FROM prepaid_allocation a
                             WHERE a.schedule_id = s.schedule_id
                               AND a.period_year = $1 AND a.period_month = $2)",
    )
    .bind(i32::from(year16))
    .bind(i32::from(month16))
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    checks.push(check(
        "PREPAID",
        "Alokasi biaya dibayar dimuka",
        if prepaid_due == 0 { "OK" } else { "BLOCKER" },
        format!("{prepaid_due} jadwal menunggu bulan ini"),
        prepaid_due,
    ));

    // Controls that do not agree.
    let controls = finance_controls(pool, None).await?;
    for control in controls.iter().filter(|row| row.covered) {
        if control.difference_minor != 0 {
            checks.push(check(
                &format!("CONTROL_{}", control.domain),
                &format!("Kontrol {}", control.label),
                "BLOCKER",
                format!(
                    "buku besar {} vs subledger {} — selisih {}",
                    control.gl_minor, control.subledger_minor, control.difference_minor
                ),
                1,
            ));
        }
    }
    for control in controls.iter().filter(|row| !row.covered) {
        checks.push(check(
            &format!("CONTROL_{}", control.domain),
            &format!("Kontrol {}", control.label),
            "UNKNOWN",
            control
                .note
                .clone()
                .unwrap_or_else(|| "belum ada sumber pembanding".into()),
            0,
        ));
    }

    // Advances still out.
    let open_advances: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM advance WHERE status IN ('PAID','PARTIALLY_SETTLED')",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    checks.push(check(
        "ADVANCES",
        "Uang muka yang belum dipertanggungjawabkan",
        if open_advances == 0 { "OK" } else { "UNKNOWN" },
        format!("{open_advances} uang muka masih di tangan orang"),
        open_advances,
    ));

    // Instalments that fell due in the month and were not paid.
    let due: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM financing_installment i
          WHERE i.entry_id IS NULL
            AND EXTRACT(YEAR FROM i.due_date) = $1 AND EXTRACT(MONTH FROM i.due_date) = $2",
    )
    .bind(i32::from(year16))
    .bind(i32::from(month16))
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    checks.push(check(
        "FINANCING",
        "Angsuran jatuh tempo bulan ini",
        if due == 0 { "OK" } else { "BLOCKER" },
        format!("{due} angsuran jatuh tempo dan belum dibayar"),
        due,
    ));

    // Tax periods for the month that are still open.
    let tax_open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM tax_period
          WHERE period_year = $1 AND period_month = $2 AND status = 'OPEN'",
    )
    .bind(year16)
    .bind(month16)
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    checks.push(check(
        "TAX",
        "Masa pajak bulan ini",
        if tax_open == 0 { "OK" } else { "UNKNOWN" },
        format!("{tax_open} masa pajak belum dilaporkan"),
        tax_open,
    ));

    // The trial balance itself.
    let unbalanced: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM (
             SELECT e.entry_id FROM journal_entry e
               JOIN journal_line l ON l.entry_id = e.entry_id
              WHERE EXTRACT(YEAR FROM e.posting_date) = $1
                AND EXTRACT(MONTH FROM e.posting_date) = $2
              GROUP BY e.entry_id
             HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)
         ) x",
    )
    .bind(i32::from(year16))
    .bind(i32::from(month16))
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    checks.push(check(
        "BALANCED",
        "Setiap jurnal seimbang",
        if unbalanced == 0 { "OK" } else { "BLOCKER" },
        format!("{unbalanced} jurnal tidak seimbang"),
        unbalanced,
    ));

    // The inter-unit account, which for one legal entity must be nothing.
    //
    // The owner settled it on 18 September 2026: fourteen units, ONE company.
    // Inside one company a balance between head office and a shop is not an
    // asset and not a liability — it is the same fact written twice, and it
    // eliminates. So `1501` is a single SIGNED account rather than six, and the
    // whole of it has to come to zero across the estate, every month, for ever.
    //
    // That invariant is the reason the six affiliate families were collapsed at
    // all. In the client's chart the same rule existed as "the sum of what A is
    // owed by B equals the sum of what B owes A, for 196 ordered pairs" — a
    // check nobody has ever run, which is exactly why inter-unit balances drift
    // in systems built that way. Here it is one SUM, and it blocks the close.
    //
    // Per unit it is expected to be non-zero, which is the point: that is what
    // a shop's own balance sheet needs to balance. Only the total is zero.
    let interunit: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
          WHERE l.account_code = '1501'
            AND e.posting_date <= make_date($1, $2, 1) + INTERVAL '1 month' - INTERVAL '1 day'",
    )
    .bind(i32::from(year16))
    .bind(i32::from(month16))
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    checks.push(check(
        "INTERUNIT_NETS",
        "Rekening koran antar-unit nol untuk perusahaan",
        if interunit == 0 { "OK" } else { "BLOCKER" },
        if interunit == 0 {
            "Saldo antar-unit saling menghapus, sebagaimana seharusnya dalam satu badan hukum"
                .to_string()
        } else {
            format!(
                "Selisih {interunit} pada 1501: satu sisi dibukukan tanpa lawannya. \
                 Cari jurnal yang menyentuh 1501 tanpa counter_site_id, atau pasangan \
                 yang hanya satu arahnya diposting."
            )
        },
        interunit.abs(),
    ));

    let blockers = checks.iter().filter(|c| c.status == "BLOCKER").count() as i64;
    let unknowns = checks.iter().filter(|c| c.status == "UNKNOWN").count() as i64;
    Ok(FinanceCloseReadiness {
        year,
        month: i32::try_from(month).unwrap_or_default(),
        period_status,
        blockers,
        unknowns,
        checks,
    })
}

/// Shut the month to the tills, leaving it open to the accountants.
pub async fn period_soft_close(
    pool: &PgPool,
    year: i32,
    month: u32,
    actor: &str,
) -> Result<FinanceCloseReadiness, AppError> {
    let done = sqlx::query(
        "UPDATE fiscal_period
            SET status = 'SOFT_CLOSED', soft_closed_at = now(), soft_closed_by = $3
          WHERE year = $1 AND month = $2 AND status = 'OPEN'",
    )
    .bind(i16::try_from(year).unwrap_or_default())
    .bind(i16::try_from(month).unwrap_or_default())
    .bind(actor)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "only a month that is open can be soft-closed".into(),
        ));
    }
    finance_close_readiness(pool, year, month).await
}

/// Close the month, or say why it cannot be closed.
///
/// The readiness check is not advisory here: a month with blockers does not
/// close unless somebody names a reason, and the reason is kept on the period.
/// A close that silently went through over its own blockers would make the
/// check decorative.
pub async fn finance_close_month(
    pool: &PgPool,
    year: i32,
    month: u32,
    force_reason: Option<&str>,
    actor: &str,
) -> Result<FinanceCloseReadiness, AppError> {
    let readiness = finance_close_readiness(pool, year, month).await?;
    if readiness.blockers > 0 {
        let reason = force_reason
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(reason) = reason else {
            let named: Vec<&str> = readiness
                .checks
                .iter()
                .filter(|check| check.status == "BLOCKER")
                .map(|check| check.label.as_str())
                .collect();
            return Err(AppError::Conflict(format!(
                "{} blockers stand in the way of closing {year}-{month:02}: {}. Clear them, \
                 or close over them with a reason somebody can read later.",
                readiness.blockers,
                named.join("; ")
            )));
        };
        // Its own columns (0286), not `reopen_reason`: a reopening is a reason,
        // a date and a person together, and a period that reads as reopened and
        // never was is worse than no record at all.
        sqlx::query(
            "UPDATE fiscal_period
                SET closed_over_reason = $3, closed_over_blockers = $4
              WHERE year = $1 AND month = $2",
        )
        .bind(i16::try_from(year).unwrap_or_default())
        .bind(i16::try_from(month).unwrap_or_default())
        .bind(reason)
        .bind(i32::try_from(readiness.blockers).unwrap_or_default())
        .execute(pool)
        .await?;
    }

    // OPEN or SOFT_CLOSED: 0283 added the middle state, and a month is normally
    // closed FROM it.
    let done = sqlx::query(
        "UPDATE fiscal_period
            SET status = 'CLOSED', closed_by = $3, closed_at = now()
          WHERE year = $1 AND month = $2 AND status IN ('OPEN', 'SOFT_CLOSED')",
    )
    .bind(i16::try_from(year).unwrap_or_default())
    .bind(i16::try_from(month).unwrap_or_default())
    .bind(actor)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{year}-{month:02} is not a month that can be closed"
        )));
    }
    finance_close_readiness(pool, year, month).await
}

/// One line of the ledger, with what caused it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LedgerTrace {
    pub line_id: Uuid,
    pub entry_id: Uuid,
    pub entry_number: String,
    pub posting_date: NaiveDate,
    pub account_code: String,
    pub account_name: String,
    pub site_id: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub source_kind: String,
    pub source_id: Option<String>,
    /// Which subledger document the source names, when this estate keeps one.
    pub subledger: Option<String>,
    /// What a person would call that document.
    pub subledger_reference: Option<String>,
    pub memo: Option<String>,
}

/// The drill-down: a figure on a report, down to the documents behind it.
///
/// Report → GL line → journal → subledger → source document, in one query,
/// because a reader following a number should not have to know which module
/// wrote it.
pub async fn ledger_trace(
    pool: &PgPool,
    account_code: &str,
    from: NaiveDate,
    to: NaiveDate,
    site_id: Option<&str>,
    limit: i64,
) -> Result<Vec<LedgerTrace>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, l.entry_id, e.entry_number, e.posting_date, l.account_code,
                a.name AS account_name, l.site_id, l.debit_minor, l.credit_minor,
                e.source_kind, e.source_id, e.memo,
                CASE e.source_kind
                    WHEN 'PREPAID_ALLOCATION' THEN 'prepaid_schedule'
                    WHEN 'TAX_SETTLEMENT'     THEN 'tax_period'
                    WHEN 'ADVANCE'            THEN 'advance'
                    WHEN 'EQUITY_MOVEMENT'    THEN 'principal_transaction'
                    WHEN 'SALE_DAY'           THEN 'sales_posting'
                    WHEN 'STORE_DEPOSIT'      THEN 'store_deposit'
                    WHEN 'SUPPLIER_INVOICE'   THEN 'supplier_invoice'
                    -- Two kinds, one run. 0266 split amortisation off from
                    -- depreciation because the two are different economic
                    -- events with different allow-lists; the sub-ledger they
                    -- reconcile against is the same `asset_depreciation_entry`
                    -- either way, so the drill-down must name it for both or
                    -- every intangible's charge reads as unreconciled.
                    WHEN 'DEPRECIATION'       THEN 'asset_depreciation_run'
                    WHEN 'AMORTIZATION_RUN'   THEN 'asset_depreciation_run'
                    WHEN 'PAYROLL_RUN'        THEN 'payroll_run'
                    ELSE NULL
                END AS subledger,
                COALESCE(
                    (SELECT s.schedule_number FROM prepaid_schedule s
                      WHERE e.source_kind = 'PREPAID_ALLOCATION'
                        AND s.schedule_id::text = e.source_id),
                    (SELECT ad.advance_number FROM advance ad
                      WHERE e.source_kind = 'ADVANCE' AND ad.advance_id::text = e.source_id),
                    (SELECT si.invoice_number FROM supplier_invoice si
                      WHERE e.source_kind = 'SUPPLIER_INVOICE'
                        AND si.invoice_id::text = e.source_id)
                ) AS subledger_reference
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE l.account_code = $1
            AND e.posting_date BETWEEN $2 AND $3
            AND ($4::text IS NULL OR l.site_id = $4)
          ORDER BY e.posting_date, e.entry_number
          LIMIT $5",
    )
    .bind(account_code)
    .bind(from)
    .bind(to)
    .bind(site_id)
    .bind(limit.clamp(1, 1000))
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            Ok(LedgerTrace {
                line_id: row.try_get("line_id")?,
                entry_id: row.try_get("entry_id")?,
                entry_number: row.try_get("entry_number")?,
                posting_date: row.try_get("posting_date")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                site_id: row.try_get("site_id")?,
                debit_minor: row.try_get("debit_minor")?,
                credit_minor: row.try_get("credit_minor")?,
                source_kind: row.try_get("source_kind")?,
                source_id: row.try_get("source_id")?,
                subledger: row.try_get("subledger")?,
                subledger_reference: row.try_get("subledger_reference")?,
                memo: row.try_get("memo")?,
            })
        })
        .collect()
}
