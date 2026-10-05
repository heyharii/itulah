//! What was kept back from suppliers, and is owed to the tax office — the
//! working list behind the monthly PPh 23 / PPh 4(2) return (Jurnal's "Pajak
//! pemotongan", ERPNext's Tax Withholding Details).
//!
//! Read straight off `supplier_payment` (0133): the payment is where the tax was
//! decided and posted, and the template it names is the tax object. Nothing is
//! stored for the report.
//!
//! # The base, and why it is not divided back out of the tax
//!
//! The base (DPP) is the fee part of what this payment settled: each allocation
//! against a withheld bill, scaled by that bill's `subtotal / total` — the same
//! proportional rule `domain::withholding::taxable_base_paid` uses, so a bill
//! carrying VAT is taxed on the fee and not on the VAT. Dividing the tax by the
//! rate instead would make a floored rupiah reappear as a different base on
//! every row.

use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct WithholdingRow {
    pub payment_id: Uuid,
    pub payment_number: String,
    pub payment_date: NaiveDate,
    /// Whose books the tax is owed from (0605), resolved from the payment's site.
    pub unit_id: Option<String>,
    /// As the bills name the supplier. A payment settles one supplier's bills;
    /// should one ever settle two, the first is shown and `supplier_count`
    /// says so.
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    pub supplier_count: i64,
    /// The supplier's NPWP as printed, when the supplier master has one. Absent
    /// is worth seeing: a certificate cannot be issued without it.
    pub npwp: Option<String>,
    /// The tax template — `PPH23_SERVICE` and so on — with its name and rate.
    pub template_code: String,
    pub template_name: Option<String>,
    pub rate_bps: Option<i32>,
    /// Final (PPh 4(2)) or creditable (PPh 23).
    pub is_final: Option<bool>,
    /// The bills this payment withheld on, as `PLN-0901, PLN-0912`.
    pub invoices: String,
    pub base_minor: i64,
    pub withheld_minor: i64,
    pub entry_number: Option<String>,
}

/// Every posted, unreversed supplier payment that kept tax back in the window.
pub async fn withholding_report(
    pool: &PgPool,
    from: NaiveDate,
    to: NaiveDate,
    unit_id: Option<&str>,
    template_code: Option<&str>,
) -> Result<Vec<WithholdingRow>, AppError> {
    if from > to {
        return Err(AppError::Validation(
            "the window starts after it ends; `from` has to be on or before `to`".into(),
        ));
    }
    let rows = sqlx::query(
        "WITH paid AS (
             SELECT p.payment_id, p.payment_number, p.payment_date, p.withholding_key,
                    p.withholding_minor, p.unit_id AS unit_id,
                    e.entry_number
               FROM supplier_payment p
               LEFT JOIN journal_entry e ON e.entry_id = p.journal_entry_id
              WHERE p.status = 'POSTED'
                AND p.reversal_entry_id IS NULL
                AND p.withholding_minor > 0
                AND p.payment_date BETWEEN $1 AND $2
                AND ($4::text IS NULL OR p.withholding_key = $4)
         )
         SELECT paid.payment_id, paid.payment_number, paid.payment_date, paid.unit_id,
                paid.withholding_key, paid.withholding_minor, paid.entry_number,
                t.name AS template_name, t.rate_bps, t.is_final,
                MIN(i.supplier_id) AS supplier_id,
                MIN(COALESCE(s.name, i.supplier_name, i.supplier_id)) AS supplier_name,
                MIN(s.npwp) AS npwp,
                COUNT(DISTINCT i.supplier_id)::bigint AS supplier_count,
                COALESCE(string_agg(DISTINCT i.invoice_number, ', ')
                         FILTER (WHERE i.withholding_code IS NOT NULL), '') AS invoices,
                COALESCE(SUM(CASE WHEN i.withholding_code IS NOT NULL AND i.total_minor > 0
                                  THEN (al.amount_minor::numeric * i.subtotal_minor
                                        / i.total_minor)::bigint
                                  ELSE 0 END), 0)::bigint AS base_minor
           FROM paid
           JOIN supplier_payment_allocation al ON al.payment_id = paid.payment_id
           JOIN supplier_invoice i ON i.invoice_id = al.invoice_id
           -- One supplier per bill, never two: a bill names its supplier by id
           -- or by code, and a join on either could match two rows and count
           -- the bill's base twice.
           LEFT JOIN LATERAL (
                SELECT one.name, one.npwp FROM supplier one
                 WHERE one.supplier_id::text = i.supplier_id
                    OR one.supplier_code = i.supplier_id
                 ORDER BY (one.supplier_id::text = i.supplier_id) DESC
                 LIMIT 1
           ) s ON true
           LEFT JOIN tax_template t ON t.code = paid.withholding_key
          WHERE ($3::text IS NULL OR paid.unit_id = $3)
          GROUP BY paid.payment_id, paid.payment_number, paid.payment_date, paid.unit_id,
                   paid.withholding_key, paid.withholding_minor, paid.entry_number,
                   t.name, t.rate_bps, t.is_final
          ORDER BY paid.payment_date, paid.payment_number",
    )
    .bind(from)
    .bind(to)
    .bind(unit_id)
    .bind(template_code)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            Ok(WithholdingRow {
                payment_id: row.try_get("payment_id")?,
                payment_number: row.try_get("payment_number")?,
                payment_date: row.try_get("payment_date")?,
                unit_id: row.try_get("unit_id")?,
                supplier_id: row.try_get("supplier_id")?,
                supplier_name: row.try_get("supplier_name")?,
                supplier_count: row.try_get("supplier_count")?,
                npwp: row.try_get("npwp")?,
                template_code: row.try_get("withholding_key")?,
                template_name: row.try_get("template_name")?,
                rate_bps: row.try_get("rate_bps")?,
                is_final: row.try_get("is_final")?,
                invoices: row.try_get("invoices")?,
                base_minor: row.try_get("base_minor")?,
                withheld_minor: row.try_get("withholding_minor")?,
                entry_number: row.try_get("entry_number")?,
            })
        })
        .collect()
}
