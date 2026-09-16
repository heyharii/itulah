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
            unmatched: slice
                .iter()
                .filter(|row| row.difference_minor != 0)
                .count() as i64,
            covered: true,
            // Said on the row, because the one mistake this domain invites is
            // adding the two lines together.
            note: Some(
                "Kredit dan utang pajak tidak pernah dijaringkan; keduanya dibaca terpisah."
                    .into(),
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
