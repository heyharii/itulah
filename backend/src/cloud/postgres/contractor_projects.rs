//! Assets › Contractor projects (migration 0720, owner 2026-10-01).
//!
//! Work paid ahead to a contractor and invoiced over months — a store's
//! renovation, a fit-out — then divided into the assets it built and the part
//! that was only an expense. Each step is an ordinary posting:
//!
//! * **advance** — `Dr advance (CONTRACTOR) / Cr bank`, in the project unit's
//!   books, for the contractor.
//! * **invoice** — a supplier bill whose one line is Contract in Progress, so
//!   it posts `Dr CIP / Cr payable` like every bill; then, for the part the
//!   advance still covers, `Dr payable / Cr advance`. What the advance does not
//!   cover stays in Accounts Payable and is paid by BKK.
//! * **close** — `Dr` each asset's cost account (or an expense) `/ Cr CIP` for
//!   the whole cost, and the assets are registered and capitalised.

use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractorProject {
    pub project_id: Uuid,
    pub project_number: String,
    pub name: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub unit_id: String,
    pub note: Option<String>,
    /// `OPEN` or `CLOSED`.
    pub status: String,
    pub opened_at: DateTime<Utc>,
    pub closed_on: Option<NaiveDate>,
    /// Paid to the contractor ahead of the work.
    pub advanced_minor: i64,
    /// Invoiced by the contractor: the cost of the work so far.
    pub invoiced_minor: i64,
    /// Of the invoices, what the advance covered.
    pub applied_minor: i64,
    /// Advance not yet used by an invoice.
    pub advance_left_minor: i64,
    /// Invoiced beyond the advance, still owed on the bills.
    pub owed_minor: i64,
    pub advance_count: i64,
    pub invoice_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractorAdvance {
    pub advance_id: Uuid,
    pub paid_on: NaiveDate,
    pub amount_minor: i64,
    pub account_key: String,
    pub account_qualifier: String,
    pub reference: Option<String>,
    pub entry_number: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractorInvoice {
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub invoice_date: NaiveDate,
    pub note: Option<String>,
    pub total_minor: i64,
    pub applied_minor: i64,
    /// What is still owed on the bill after the advance and any payment.
    pub outstanding_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractorSplitLine {
    pub line_number: i32,
    pub kind: String,
    pub name: String,
    pub class_code: Option<String>,
    pub account_code: String,
    pub useful_life_months: Option<i32>,
    pub amount_minor: i64,
    pub asset_id: Option<Uuid>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractorProjectDetail {
    pub project: ContractorProject,
    pub advances: Vec<ContractorAdvance>,
    pub invoices: Vec<ContractorInvoice>,
    pub split: Vec<ContractorSplitLine>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenProjectRequest {
    pub name: String,
    pub supplier_id: String,
    pub unit_id: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProjectAdvanceRequest {
    pub paid_on: NaiveDate,
    pub amount_minor: i64,
    /// `bank_giro`, `bank_savings`, `cash` or `petty_cash`.
    pub account_key: String,
    /// The bank, for a bank key: `BCA`.
    pub account_qualifier: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub reference: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProjectInvoiceRequest {
    pub invoice_number: String,
    pub invoice_date: NaiveDate,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub due_date: Option<NaiveDate>,
    pub amount_minor: i64,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProjectSplitLineRequest {
    /// `ASSET` or `EXPENSE`.
    pub kind: String,
    pub name: String,
    /// The asset class, for an `ASSET` line.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub class_code: Option<String>,
    /// The expense account, for an `EXPENSE` line.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub account_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub useful_life_months: Option<i32>,
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CloseProjectRequest {
    pub closed_on: NaiveDate,
    pub lines: Vec<ProjectSplitLineRequest>,
}

const PROJECTS: &str = "
    SELECT p.project_id, p.project_number, p.name, p.supplier_id, s.name AS supplier_name,
           p.unit_id, p.note, p.status, p.opened_at, p.closed_on,
           COALESCE(a.advanced, 0)::bigint AS advanced_minor,
           COALESCE(i.invoiced, 0)::bigint AS invoiced_minor,
           COALESCE(i.applied, 0)::bigint AS applied_minor,
           COALESCE(a.n, 0)::bigint AS advance_count,
           COALESCE(i.n, 0)::bigint AS invoice_count,
           COALESCE(i.owed, 0)::bigint AS owed_minor
      FROM contractor_project p
      LEFT JOIN supplier s ON s.supplier_code = p.supplier_id
      LEFT JOIN (SELECT project_id, SUM(amount_minor) advanced, COUNT(*) n
                   FROM contractor_project_advance GROUP BY project_id) a
             ON a.project_id = p.project_id
      LEFT JOIN (SELECT ci.project_id, SUM(b.total_minor) invoiced,
                        SUM(ci.applied_minor) applied, COUNT(*) n,
                        SUM(GREATEST(b.total_minor - ci.applied_minor
                            - COALESCE((SELECT SUM(al.amount_minor)
                                          FROM supplier_payment_allocation al
                                          JOIN supplier_payment sp USING (payment_id)
                                         WHERE al.invoice_id = b.invoice_id
                                           AND sp.status = 'POSTED'), 0), 0)) owed
                   FROM contractor_project_invoice ci
                   JOIN supplier_invoice b ON b.invoice_id = ci.invoice_id
                  GROUP BY ci.project_id) i
             ON i.project_id = p.project_id";

fn to_project(row: &sqlx::postgres::PgRow) -> Result<ContractorProject, AppError> {
    let advanced: i64 = row.try_get("advanced_minor")?;
    let applied: i64 = row.try_get("applied_minor")?;
    Ok(ContractorProject {
        project_id: row.try_get("project_id")?,
        project_number: row.try_get("project_number")?,
        name: row.try_get("name")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
        unit_id: row.try_get("unit_id")?,
        note: row.try_get("note")?,
        status: row.try_get("status")?,
        opened_at: row.try_get("opened_at")?,
        closed_on: row.try_get("closed_on")?,
        advanced_minor: advanced,
        invoiced_minor: row.try_get("invoiced_minor")?,
        applied_minor: applied,
        advance_left_minor: advanced - applied,
        owed_minor: row.try_get("owed_minor")?,
        advance_count: row.try_get("advance_count")?,
        invoice_count: row.try_get("invoice_count")?,
    })
}

/// Every project, open ones first, newest first.
pub async fn contractor_projects(pool: &PgPool) -> Result<Vec<ContractorProject>, AppError> {
    let rows = sqlx::query(&format!(
        "{PROJECTS} ORDER BY (p.status = 'OPEN') DESC, p.opened_at DESC"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_project).collect()
}

async fn project(pool: &PgPool, project_id: Uuid) -> Result<ContractorProject, AppError> {
    let row = sqlx::query(&format!("{PROJECTS} WHERE p.project_id = $1"))
        .bind(project_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("contractor project".into()))?;
    to_project(&row)
}

fn open_only(project: &ContractorProject) -> Result<(), AppError> {
    if project.status != "OPEN" {
        return Err(AppError::Conflict(format!(
            "{} is closed; its cost has already been split",
            project.project_number
        )));
    }
    Ok(())
}

pub async fn contractor_project(
    pool: &PgPool,
    project_id: Uuid,
) -> Result<ContractorProjectDetail, AppError> {
    let head = project(pool, project_id).await?;
    let advances = sqlx::query(
        "SELECT a.advance_id, a.paid_on, a.amount_minor, a.account_key, a.account_qualifier,
                a.reference, e.entry_number
           FROM contractor_project_advance a
           JOIN journal_entry e ON e.entry_id = a.entry_id
          WHERE a.project_id = $1 ORDER BY a.paid_on, a.paid_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(ContractorAdvance {
            advance_id: row.try_get("advance_id")?,
            paid_on: row.try_get("paid_on")?,
            amount_minor: row.try_get("amount_minor")?,
            account_key: row.try_get("account_key")?,
            account_qualifier: row.try_get("account_qualifier")?,
            reference: row.try_get("reference")?,
            entry_number: row.try_get("entry_number")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let invoices = sqlx::query(
        "SELECT b.invoice_id, b.invoice_number, b.invoice_date, b.note, b.total_minor,
                ci.applied_minor,
                GREATEST(b.total_minor - ci.applied_minor
                  - COALESCE((SELECT SUM(al.amount_minor)
                                FROM supplier_payment_allocation al
                                JOIN supplier_payment sp USING (payment_id)
                               WHERE al.invoice_id = b.invoice_id
                                 AND sp.status = 'POSTED'), 0), 0)::bigint AS outstanding_minor
           FROM contractor_project_invoice ci
           JOIN supplier_invoice b ON b.invoice_id = ci.invoice_id
          WHERE ci.project_id = $1 ORDER BY b.invoice_date, b.invoice_number",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(ContractorInvoice {
            invoice_id: row.try_get("invoice_id")?,
            invoice_number: row.try_get("invoice_number")?,
            invoice_date: row.try_get("invoice_date")?,
            note: row.try_get("note")?,
            total_minor: row.try_get("total_minor")?,
            applied_minor: row.try_get("applied_minor")?,
            outstanding_minor: row.try_get("outstanding_minor")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let split = sqlx::query(
        "SELECT line_number, kind, name, class_code, account_code, useful_life_months,
                amount_minor, asset_id
           FROM contractor_project_split WHERE project_id = $1 ORDER BY line_number",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(ContractorSplitLine {
            line_number: row.try_get("line_number")?,
            kind: row.try_get("kind")?,
            name: row.try_get("name")?,
            class_code: row.try_get("class_code")?,
            account_code: row.try_get("account_code")?,
            useful_life_months: row.try_get("useful_life_months")?,
            amount_minor: row.try_get("amount_minor")?,
            asset_id: row.try_get("asset_id")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    Ok(ContractorProjectDetail {
        project: head,
        advances,
        invoices,
        split,
    })
}

pub async fn open_contractor_project(
    pool: &PgPool,
    request: &OpenProjectRequest,
    actor: &str,
) -> Result<ContractorProject, AppError> {
    if request.name.trim().is_empty() {
        return Err(AppError::Validation("a project needs a name".into()));
    }
    let known: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM supplier WHERE supplier_code = $1)")
            .bind(&request.supplier_id)
            .fetch_one(pool)
            .await?;
    if !known {
        return Err(AppError::Validation(format!(
            "there is no supplier {} to be the contractor",
            request.supplier_id
        )));
    }
    let project_id = Uuid::new_v4();
    let year = Utc::now().year();
    let serial: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) + 1 FROM contractor_project WHERE project_number LIKE $1",
    )
    .bind(format!("PRJ-{year}-%"))
    .fetch_one(pool)
    .await?;
    sqlx::query(
        "INSERT INTO contractor_project (project_id, project_number, name, supplier_id, unit_id,
                                         note, opened_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(project_id)
    .bind(format!("PRJ-{year}-{serial:03}"))
    .bind(request.name.trim())
    .bind(&request.supplier_id)
    .bind(&request.unit_id)
    .bind(
        request
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty()),
    )
    .bind(actor)
    .execute(pool)
    .await?;
    project(pool, project_id).await
}

/// Pay the contractor ahead: `Dr advance (CONTRACTOR) / Cr bank`.
pub async fn pay_project_advance(
    pool: &PgPool,
    project_id: Uuid,
    request: &ProjectAdvanceRequest,
    actor: &str,
) -> Result<ContractorProjectDetail, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an advance is a positive amount".into(),
        ));
    }
    let head = project(pool, project_id).await?;
    open_only(&head)?;
    let advance_id = Uuid::new_v4();
    let intent = PostingIntent {
        posting_date: request.paid_on,
        source_kind: "ADVANCE".into(),
        source_id: Some(advance_id.to_string()),
        rule_version: "contractor_advance/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "{} advance to contractor · {}",
            head.project_number, head.name
        )),
        lines: vec![
            PostingLine::debit("advance", &head.unit_id, request.amount_minor)
                .with_qualifier("CONTRACTOR")
                .for_supplier(&head.supplier_id),
            PostingLine::credit(
                request.account_key.as_str(),
                &head.unit_id,
                request.amount_minor,
            )
            .with_qualifier(&request.account_qualifier),
        ],
    };
    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "INSERT INTO contractor_project_advance
            (advance_id, project_id, paid_on, amount_minor, account_key, account_qualifier,
             reference, entry_id, paid_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(advance_id)
    .bind(project_id)
    .bind(request.paid_on)
    .bind(request.amount_minor)
    .bind(&request.account_key)
    .bind(&request.account_qualifier)
    .bind(
        request
            .reference
            .as_deref()
            .filter(|r| !r.trim().is_empty()),
    )
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    contractor_project(pool, project_id).await
}

/// The account Contract in Progress resolves to in a unit's books.
async fn cip_account(pool: &PgPool, unit_id: &str) -> Result<String, AppError> {
    sqlx::query_scalar(
        "SELECT account_code FROM account_resolution
          WHERE role = 'fixed_asset' AND source_id = 'CONTRACT_IN_PROGRESS' AND unit_id = $1
          LIMIT 1",
    )
    .bind(unit_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::Validation(
            "no account is linked for Contract in Progress (fixed_asset · CONTRACT_IN_PROGRESS) \
             in this unit's books; set it on Account Links first"
                .into(),
        )
    })
}

/// Record the contractor's invoice as a bill on Contract in Progress, and set
/// what is left of the advance against it.
pub async fn add_project_invoice(
    pool: &PgPool,
    project_id: Uuid,
    request: &ProjectInvoiceRequest,
    actor: &str,
) -> Result<ContractorProjectDetail, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an invoice is a positive amount".into(),
        ));
    }
    let head = project(pool, project_id).await?;
    open_only(&head)?;
    let cip = cip_account(pool, &head.unit_id).await?;
    let site: String =
        sqlx::query_scalar("SELECT id FROM site WHERE unit_id = $1 ORDER BY id LIMIT 1")
            .bind(&head.unit_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::Validation(format!("unit {} keeps no site", head.unit_id)))?;
    let note = request
        .note
        .clone()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("{} · {}", head.project_number, head.name));

    // The ordinary bill: Dr CIP / Cr payable, posted on recording.
    let bill_request: super::RecordBillRequest = serde_json::from_value(json!({
        "invoice_number": request.invoice_number.trim(),
        "supplier_id": head.supplier_id,
        "supplier_name": null,
        "site_id": site,
        "invoice_date": request.invoice_date,
        "due_date": request.due_date.unwrap_or(request.invoice_date),
        "subtotal_minor": request.amount_minor,
        "tax_minor": 0,
        "discount_minor": 0,
        "note": note,
        "kind": "EXPENSE",
        "lines": [{
            "account_code": cip,
            "site_id": site,
            "amount_minor": request.amount_minor,
            "draws_reserve": false,
            "account_overridden": true,
            "memo": note,
        }],
    }))
    .map_err(|error| AppError::Validation(format!("invoice: {error}")))?;
    let bill = super::record_bill(pool, &bill_request, actor).await?;

    // What the advance still covers: Dr payable (head office) / Cr advance.
    let applied = head.advance_left_minor.min(request.amount_minor).max(0);
    let mut tx = pool.begin().await?;
    let mut applied_entry = None;
    if applied > 0 {
        let head_office = super::sites::head_office_unit_id(&mut *tx).await?;
        let intent = PostingIntent {
            posting_date: request.invoice_date,
            source_kind: "ADVANCE".into(),
            source_id: Some(bill.invoice_id.to_string()),
            rule_version: "contractor_advance_applied/1".into(),
            currency: "IDR".into(),
            memo: Some(format!(
                "{} advance set against {}",
                head.project_number, bill.invoice_number
            )),
            lines: vec![
                PostingLine::debit("non_merchandise_payable", &head_office, applied)
                    .for_supplier(&head.supplier_id),
                PostingLine::credit("advance", &head.unit_id, applied)
                    .with_qualifier("CONTRACTOR")
                    .for_supplier(&head.supplier_id),
            ],
        };
        let entry_id = post(&mut tx, &intent, Some("APPLIED"), actor)
            .await?
            .entry_id;
        // The bill is that much paid in the Payment Ledger too, as a supplier
        // advance set against a bill is (CONTROL_AP, 1 Oct).
        super::payables_flow::payable_settled(
            &mut tx,
            "non_merchandise_payable",
            &head_office,
            &head.supplier_id,
            bill.invoice_id,
            "ADVANCE",
            project_id,
            applied,
            request.invoice_date,
            entry_id,
            actor,
        )
        .await?;
        applied_entry = Some(entry_id);
    }
    sqlx::query(
        "INSERT INTO contractor_project_invoice (invoice_id, project_id, applied_minor, applied_entry_id)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(bill.invoice_id)
    .bind(project_id)
    .bind(applied)
    .bind(applied_entry)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    contractor_project(pool, project_id).await
}

/// Divide the whole cost into assets and expenses, and close the project.
pub async fn close_contractor_project(
    pool: &PgPool,
    project_id: Uuid,
    request: &CloseProjectRequest,
    actor: &str,
) -> Result<ContractorProjectDetail, AppError> {
    let head = project(pool, project_id).await?;
    // A close whose journal posted but whose register step failed part-way is
    // finished by closing again: the split stands, and only the assets that
    // are not in the register yet are put there.
    if head.status == "CLOSED" {
        register_split_assets(pool, project_id, actor).await?;
        return contractor_project(pool, project_id).await;
    }
    open_only(&head)?;
    if head.invoiced_minor <= 0 {
        return Err(AppError::Conflict(
            "nothing has been invoiced yet; there is no cost to split".into(),
        ));
    }
    if head.advance_left_minor > 0 {
        return Err(AppError::Conflict(format!(
            "Rp {} of the advance is not covered by an invoice yet; record the last invoice, \
             or have the contractor return it, before closing",
            head.advance_left_minor
        )));
    }
    if request.lines.is_empty() {
        return Err(AppError::Validation("say where the cost goes".into()));
    }
    let total: i64 = request.lines.iter().map(|line| line.amount_minor).sum();
    if total != head.invoiced_minor {
        return Err(AppError::Validation(format!(
            "the lines come to Rp {total}, the project cost Rp {}; every rupiah has to be placed",
            head.invoiced_minor
        )));
    }

    // Resolve every line's account before anything is written.
    let mut lines = Vec::new();
    for (index, line) in request.lines.iter().enumerate() {
        if line.amount_minor <= 0 || line.name.trim().is_empty() {
            return Err(AppError::Validation(format!(
                "line {} needs a name and a positive amount",
                index + 1
            )));
        }
        let account: String = match line.kind.as_str() {
            "ASSET" => {
                let class = line.class_code.as_deref().ok_or_else(|| {
                    AppError::Validation(format!("line {} needs an asset category", index + 1))
                })?;
                sqlx::query_scalar(
                    "SELECT account_code FROM account_resolution
                      WHERE role = 'fixed_asset' AND source_id = $1 AND unit_id = $2 LIMIT 1",
                )
                .bind(class)
                .bind(&head.unit_id)
                .fetch_optional(pool)
                .await?
                .ok_or_else(|| {
                    AppError::Validation(format!(
                        "no cost account is linked for asset category {class}"
                    ))
                })?
            }
            "EXPENSE" => line.account_code.clone().ok_or_else(|| {
                AppError::Validation(format!("line {} needs an expense account", index + 1))
            })?,
            other => {
                return Err(AppError::Validation(format!(
                    "a line is ASSET or EXPENSE, not {other}"
                )))
            }
        };
        lines.push((index as i32 + 1, line, account));
    }

    let cip = cip_account(pool, &head.unit_id).await?;
    let mut posting = vec![PostingLine::credit(
        LineAccount::Account {
            account_code: cip,
            category_code: None,
        },
        &head.unit_id,
        total,
    )];
    for (_, line, account) in &lines {
        posting.push(PostingLine::debit(
            LineAccount::Account {
                account_code: account.clone(),
                category_code: None,
            },
            &head.unit_id,
            line.amount_minor,
        ));
    }
    let intent = PostingIntent {
        posting_date: request.closed_on,
        source_kind: "ASSET_CAPITALIZATION".into(),
        source_id: Some(project_id.to_string()),
        rule_version: "contractor_project_close/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("{} closed · {}", head.project_number, head.name)),
        lines: posting,
    };
    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "UPDATE contractor_project
            SET status = 'CLOSED', closed_on = $2, closed_entry_id = $3, closed_by = $4
          WHERE project_id = $1",
    )
    .bind(project_id)
    .bind(request.closed_on)
    .bind(posted.entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    for (number, line, account) in &lines {
        sqlx::query(
            "INSERT INTO contractor_project_split
                (project_id, line_number, kind, name, class_code, account_code,
                 useful_life_months, amount_minor)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(project_id)
        .bind(number)
        .bind(&line.kind)
        .bind(line.name.trim())
        .bind(&line.class_code)
        .bind(account)
        .bind(line.useful_life_months)
        .bind(line.amount_minor)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    register_split_assets(pool, project_id, actor).await?;
    contractor_project(pool, project_id).await
}

/// Put a closed project's asset lines in the register, capitalised at their
/// share. The close's journal is what put the cost on their accounts; the
/// register only records the decision, as for every asset (see
/// `assess_asset`). Safe to run again: a line that already has its asset is
/// skipped, and one registered but never assessed is assessed, not doubled.
async fn register_split_assets(
    pool: &PgPool,
    project_id: Uuid,
    actor: &str,
) -> Result<(), AppError> {
    let head = project(pool, project_id).await?;
    let site: String =
        sqlx::query_scalar("SELECT id FROM site WHERE unit_id = $1 ORDER BY id LIMIT 1")
            .bind(&head.unit_id)
            .fetch_one(pool)
            .await?;
    let pending = sqlx::query(
        "SELECT s.line_number, s.name, s.class_code, s.useful_life_months, s.amount_minor,
                c.kind AS class_kind,
                COALESCE(c.default_method, 'STRAIGHT_LINE') AS method
           FROM contractor_project_split s
           LEFT JOIN asset_class c ON c.class_code = s.class_code
          WHERE s.project_id = $1 AND s.kind = 'ASSET' AND s.asset_id IS NULL
          ORDER BY s.line_number",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    for row in &pending {
        let number: i32 = row.try_get("line_number")?;
        let name: String = row.try_get("name")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let asset_number = format!("{}-{:02}", head.project_number, number);
        // The monthly charge follows the class: the client's operating
        // equipment builds a replacement reserve, intangibles and deferred
        // charges amortise, everything else depreciates.
        let charge_kind = match row.try_get::<Option<String>, _>("class_kind")?.as_deref() {
            Some("OE") => "REPLACEMENT_RESERVE",
            Some("INTANGIBLE" | "DEFERRED") => "AMORTISATION",
            _ => "DEPRECIATION",
        };
        let existing: Option<Uuid> =
            sqlx::query_scalar("SELECT asset_id FROM fixed_asset WHERE asset_number = $1")
                .bind(&asset_number)
                .fetch_optional(pool)
                .await?;
        let asset_id = match existing {
            Some(id) => id,
            None => {
                let register: super::RegisterAssetRequest = serde_json::from_value(json!({
                    "asset_number": asset_number,
                    "name": name,
                    "category_code": row.try_get::<Option<String>, _>("class_code")?,
                    "site_id": site,
                    "acquired_on": head.closed_on,
                    "serial_number": null,
                    "notes": format!("Built by {} ({})", head.project_number, head.name),
                    "acquired_via_line_id": null,
                }))
                .map_err(|error| AppError::Validation(format!("asset: {error}")))?;
                super::register_asset(pool, &register, actor)
                    .await?
                    .asset_id
            }
        };
        // Assessed already means it has a decision on file; the register's
        // status stays REGISTERED after one, so it cannot be the test.
        let assessed: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM asset_capitalization WHERE asset_id = $1)",
        )
        .bind(asset_id)
        .fetch_one(pool)
        .await?;
        if !assessed {
            let assess: super::AssessAssetRequest = serde_json::from_value(json!({
                "decision": "CAPITALIZE",
                "capitalized_cost_minor": amount,
                "salvage_value_minor": 0,
                "useful_life_months": row.try_get::<Option<i32>, _>("useful_life_months")?,
                "charge_kind": charge_kind,
                "method": row.try_get::<String, _>("method")?,
                "in_service_on": head.closed_on,
                "reason": format!("Cost of {} split at close", head.project_number),
            }))
            .map_err(|error| AppError::Validation(format!("asset: {error}")))?;
            super::assess_asset(pool, asset_id, &assess, actor).await?;
        }
        sqlx::query(
            "UPDATE contractor_project_split SET asset_id = $3
              WHERE project_id = $1 AND line_number = $2",
        )
        .bind(project_id)
        .bind(number)
        .bind(asset_id)
        .execute(pool)
        .await?;
    }
    Ok(())
}
