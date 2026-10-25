//! Projects, Finance's half (0997): the cost a project gathered, and placing
//! it when the project is capitalised.
//!
//! # A cost is a line
//!
//! A bill line, a BKK line or an expense-claim line names the project in its
//! own `project_id`. Nothing about how those documents post changes: a line
//! Finance coded to Contract in Progress sits in CIP, any other sits in the
//! expense it was coded to. The project only reads them.
//!
//! # Capitalising
//!
//! Once GA has closed the project (`READY`; a contractor project of 0720's kind
//! needs no GA close), Finance says where each line goes:
//!
//! * `ASSET` — one of the assets GA registered for the project. The line moves
//!   onto that asset's cost account, and the asset is assessed at the sum of
//!   its lines, going into service on the day given.
//! * `PRE_OPENING` — the store's Pre-opening balance. All such lines become one
//!   asset of class `PRE_OPENING`, amortised over the months given, which the
//!   month-end run charges like any other deferred cost.
//! * `EXPENSE` — stays an expense. A line still in CIP needs an expense account
//!   named; a line already in an expense stays where it is.
//!
//! One entry moves every line out of the account it sits in (CIP, or the
//! expense the claim or bill went to) and onto its destination. A line whose
//! destination is the account it is already in posts nothing.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;

/// One cost line of a project.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProjectCost {
    /// `BILL_LINE`, `BKK_LINE` or `CLAIM_LINE`.
    pub source_kind: String,
    /// The line: a bill or claim line's id, or `document_id:line_no` for a BKK.
    pub source_id: String,
    pub dated: NaiveDate,
    /// The document's own number: the bill, the BKK, the claim.
    pub document: String,
    pub party: Option<String>,
    pub what: Option<String>,
    pub amount_minor: i64,
    pub unit_id: String,
    /// The account the line sits in now, when it names one.
    pub account_code: Option<String>,
    /// True when the line sits in Contract in Progress.
    pub in_cip: bool,
    /// Where capitalising sent it, once it has: `ASSET`, `PRE_OPENING` or
    /// `EXPENSE`.
    pub placed: Option<String>,
    pub placed_asset_id: Option<Uuid>,
}

/// Put a line into a project, or take it out.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct LinkProjectCostRequest {
    pub source_kind: String,
    pub source_id: String,
    #[serde(default)]
    pub unlink: Option<bool>,
}

/// Where one line goes.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct CapitaliseLineRequest {
    pub source_kind: String,
    pub source_id: String,
    /// `ASSET`, `PRE_OPENING` or `EXPENSE`.
    pub goes_to: String,
    /// The project's asset, for `ASSET`.
    #[serde(default)]
    pub asset_id: Option<Uuid>,
    /// The expense account, for an `EXPENSE` line still in CIP.
    #[serde(default)]
    pub account_code: Option<String>,
}

/// A life for one of the project's assets, when its class keeps none.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CapitaliseAssetLife {
    pub asset_id: Uuid,
    pub useful_life_months: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct CapitaliseProjectRequest {
    /// The day the assets go into service and the Pre-opening starts to
    /// amortise: the opening day.
    pub in_use_on: NaiveDate,
    /// Months the Pre-opening amortises over. Needed when a line goes there.
    #[serde(default)]
    pub pre_opening_months: Option<i32>,
    pub lines: Vec<CapitaliseLineRequest>,
    #[serde(default)]
    pub lives: Option<Vec<CapitaliseAssetLife>>,
}

/// Where one line was sent, as the split keeps it.
struct Split<'a> {
    kind: &'static str,
    name: String,
    class: Option<String>,
    account: String,
    life: Option<i32>,
    asset_id: Option<Uuid>,
    line: &'a CostLine,
}

/// One line with what posting needs to move it.
struct CostLine {
    cost: ProjectCost,
    category_code: Option<String>,
    semantic_key: Option<String>,
    qualifier: Option<String>,
    /// For a claim line: the expense category its posting resolved through.
    claim_category: Option<String>,
}

const COSTS: &str = "
    SELECT 'BILL_LINE' AS source_kind, l.line_id::text AS source_id, b.invoice_date AS dated,
           b.invoice_number AS document, COALESCE(s.name, b.supplier_name) AS party,
           l.memo AS what, l.amount_minor, unit_of_site(l.site_id) AS unit_id,
           l.account_code, l.category_code, NULL::text AS semantic_key, NULL::text AS qualifier,
           NULL::text AS claim_category, l.project_id
      FROM supplier_invoice_expense_line l
      JOIN supplier_invoice b ON b.invoice_id = l.invoice_id
      LEFT JOIN supplier s ON s.supplier_code = b.supplier_id
     WHERE b.journal_entry_id IS NOT NULL
    UNION ALL
    SELECT 'BKK_LINE', l.document_id::text || ':' || l.line_no, d.doc_date, d.number,
           d.party_name, COALESCE(l.note, d.memo), l.amount_minor,
           COALESCE(l.unit_id, d.from_unit), l.account_code, l.category_code,
           l.semantic_key, l.qualifier, NULL, l.project_id
      FROM cash_document_line l
      JOIN cash_document d ON d.document_id = l.document_id
     WHERE d.kind = 'PAY' AND d.journal_entry_id IS NOT NULL AND l.kind = 'OTHER'
    UNION ALL
    SELECT 'CLAIM_LINE', l.line_id::text, COALESCE(c.posted_on, l.spent_on), c.claim_number,
           e.code, l.description, COALESCE(l.sanctioned_minor, l.claimed_minor), c.unit_id,
           NULL, NULL, NULL, NULL, t.expense_category_code, l.project_id
      FROM expense_claim_line l
      JOIN expense_claim c ON c.claim_id = l.claim_id
      JOIN expense_claim_type t ON t.code = l.type_code
      LEFT JOIN employee e ON e.id = c.employee_id
     WHERE c.approved_entry_id IS NOT NULL";

async fn cip_of(pool: &PgPool, unit_id: &str) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT account_code FROM account_resolution
          WHERE role = 'fixed_asset' AND source_id = 'CONTRACT_IN_PROGRESS' AND unit_id = $1
          LIMIT 1",
    )
    .bind(unit_id)
    .fetch_optional(pool)
    .await?)
}

fn to_line(row: &sqlx::postgres::PgRow, cip: Option<&str>) -> Result<CostLine, AppError> {
    let account: Option<String> = row.try_get("account_code")?;
    let in_cip = matches!((account.as_deref(), cip), (Some(a), Some(c)) if a == c);
    Ok(CostLine {
        cost: ProjectCost {
            source_kind: row.try_get("source_kind")?,
            source_id: row.try_get("source_id")?,
            dated: row.try_get("dated")?,
            document: row.try_get("document")?,
            party: row.try_get("party")?,
            what: row.try_get("what")?,
            amount_minor: row.try_get("amount_minor")?,
            unit_id: row.try_get("unit_id")?,
            account_code: account,
            in_cip,
            placed: row.try_get::<Option<String>, _>("placed")?,
            placed_asset_id: row.try_get::<Option<Uuid>, _>("placed_asset_id")?,
        },
        category_code: row.try_get("category_code")?,
        semantic_key: row.try_get("semantic_key")?,
        qualifier: row.try_get("qualifier")?,
        claim_category: row.try_get("claim_category")?,
    })
}

async fn project_unit(pool: &PgPool, project_id: Uuid) -> Result<(String, String), AppError> {
    let row = sqlx::query("SELECT unit_id, status FROM contractor_project WHERE project_id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("project".into()))?;
    Ok((row.try_get("unit_id")?, row.try_get("status")?))
}

async fn cost_lines(pool: &PgPool, project_id: Uuid) -> Result<Vec<CostLine>, AppError> {
    let (unit, _) = project_unit(pool, project_id).await?;
    let cip = cip_of(pool, &unit).await?;
    let rows = sqlx::query(&format!(
        "SELECT c.*, x.kind AS placed, x.asset_id AS placed_asset_id
           FROM ({COSTS}) c
           LEFT JOIN contractor_project_split x
             ON x.project_id = c.project_id AND x.source_kind = c.source_kind
            AND x.source_id = c.source_id
          WHERE c.project_id = $1
          ORDER BY c.dated, c.document"
    ))
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| to_line(row, cip.as_deref()))
        .collect()
}

/// Every cost line of a project, by day.
pub async fn project_costs(pool: &PgPool, project_id: Uuid) -> Result<Vec<ProjectCost>, AppError> {
    Ok(cost_lines(pool, project_id)
        .await?
        .into_iter()
        .map(|line| line.cost)
        .collect())
}

/// Lines that could join: posted, in no project, of the last 180 days, in the
/// project's own books.
pub async fn project_cost_candidates(
    pool: &PgPool,
    project_id: Uuid,
) -> Result<Vec<ProjectCost>, AppError> {
    let (unit, _) = project_unit(pool, project_id).await?;
    let cip = cip_of(pool, &unit).await?;
    let rows = sqlx::query(&format!(
        "SELECT c.*, NULL::text AS placed, NULL::uuid AS placed_asset_id
           FROM ({COSTS}) c
          WHERE c.project_id IS NULL AND c.unit_id = $1
            AND c.dated >= CURRENT_DATE - 180
          ORDER BY c.dated DESC, c.document
          LIMIT 300"
    ))
    .bind(&unit)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| to_line(row, cip.as_deref()).map(|line| line.cost))
        .collect()
}

/// Put a line into the project or take it out. Only lines in the project's
/// own books: the capitalising entry moves cost within one unit.
pub async fn link_project_cost(
    pool: &PgPool,
    project_id: Uuid,
    request: &LinkProjectCostRequest,
) -> Result<Vec<ProjectCost>, AppError> {
    let (unit, status) = project_unit(pool, project_id).await?;
    if status == "CAPITALISED" {
        return Err(AppError::Conflict(
            "the project is capitalised; its cost is settled".into(),
        ));
    }
    let unlink = request.unlink.unwrap_or(false);
    let target = if unlink { None } else { Some(project_id) };
    let line_unit: Option<String> = sqlx::query_scalar(&format!(
        "SELECT c.unit_id FROM ({COSTS}) c WHERE c.source_kind = $1 AND c.source_id = $2"
    ))
    .bind(request.source_kind.trim())
    .bind(request.source_id.trim())
    .fetch_optional(pool)
    .await?;
    let line_unit =
        line_unit.ok_or_else(|| AppError::NotFound("a posted cost line by that id".into()))?;
    if !unlink && line_unit != unit {
        return Err(AppError::Validation(format!(
            "that line is in the books of {line_unit}, the project in {unit}; a project gathers \
             cost from its own books"
        )));
    }
    let affected = match request.source_kind.trim() {
        "BILL_LINE" | "CLAIM_LINE" => {
            let line_id = Uuid::parse_str(request.source_id.trim())
                .map_err(|_| AppError::Validation("that line id is not an id".into()))?;
            let table = if request.source_kind.trim() == "BILL_LINE" {
                "supplier_invoice_expense_line"
            } else {
                "expense_claim_line"
            };
            sqlx::query(&format!(
                "UPDATE {table} SET project_id = $2
                  WHERE line_id = $1 AND ($2::uuid IS NOT NULL OR project_id = $3)"
            ))
            .bind(line_id)
            .bind(target)
            .bind(project_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        "BKK_LINE" => {
            let (document, line_no) = request
                .source_id
                .trim()
                .split_once(':')
                .ok_or_else(|| AppError::Validation("a BKK line is document:line".into()))?;
            let document = Uuid::parse_str(document)
                .map_err(|_| AppError::Validation("that BKK is not an id".into()))?;
            let line_no: i32 = line_no
                .parse()
                .map_err(|_| AppError::Validation("that BKK line is not a number".into()))?;
            sqlx::query(
                "UPDATE cash_document_line SET project_id = $3
                  WHERE document_id = $1 AND line_no = $2
                    AND ($3::uuid IS NOT NULL OR project_id = $4)",
            )
            .bind(document)
            .bind(line_no)
            .bind(target)
            .bind(project_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        other => {
            return Err(AppError::Validation(format!(
                "a cost is a BILL_LINE, a BKK_LINE or a CLAIM_LINE, not {other}"
            )))
        }
    };
    if affected == 0 {
        return Err(AppError::NotFound("that line in this project".into()));
    }
    project_costs(pool, project_id).await
}

/// The account a line leaves when it is moved.
fn leg_out(line: &CostLine, amount: i64) -> Result<PostingLine, AppError> {
    let unit = line.cost.unit_id.as_str();
    if let Some(category) = line.claim_category.as_deref() {
        return Ok(
            PostingLine::credit("expense", unit, amount).from_source("EXPENSE_CATEGORY", category)
        );
    }
    if let Some(account) = line.cost.account_code.as_deref() {
        return Ok(PostingLine::credit(
            LineAccount::Account {
                account_code: account.to_owned(),
                category_code: line.category_code.clone(),
            },
            unit,
            amount,
        ));
    }
    match line.semantic_key.as_deref() {
        Some(key) => {
            let leg = PostingLine::credit(key, unit, amount);
            Ok(match line.qualifier.as_deref() {
                Some(qualifier) if !qualifier.is_empty() => leg.with_qualifier(qualifier),
                _ => leg,
            })
        }
        None => Err(AppError::Validation(format!(
            "{} names no account to move it out of",
            line.cost.document
        ))),
    }
}

async fn class_account(pool: &PgPool, class: &str, unit: &str) -> Result<String, AppError> {
    sqlx::query_scalar(
        "SELECT account_code FROM account_resolution
          WHERE role = 'fixed_asset' AND source_id = $1 AND unit_id = $2 LIMIT 1",
    )
    .bind(class)
    .bind(unit)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        AppError::Validation(format!(
            "no cost account is linked for asset class {class} in {unit}'s books; set it on \
             Account Links first"
        ))
    })
}

/// Place every cost line and capitalise the project.
pub async fn capitalise_project(
    pool: &PgPool,
    project_id: Uuid,
    request: &CapitaliseProjectRequest,
    actor: &str,
) -> Result<Vec<ProjectCost>, AppError> {
    let head = sqlx::query(
        "SELECT project_number, name, kind, status, unit_id, site_id FROM contractor_project
          WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("project".into()))?;
    let number: String = head.try_get("project_number")?;
    let title: String = head.try_get("name")?;
    let kind: String = head.try_get("kind")?;
    let status: String = head.try_get("status")?;
    let unit: String = head.try_get("unit_id")?;

    // A capitalising whose entry posted but whose assets were not all assessed
    // is finished by asking again.
    if status == "CAPITALISED" {
        finish_capitalising(pool, project_id, actor).await?;
        return project_costs(pool, project_id).await;
    }
    if kind != "CONTRACTOR" && status != "READY" {
        return Err(AppError::Conflict(
            "GA has not closed the project yet; capitalise it once the place is ready".into(),
        ));
    }

    let lines = cost_lines(pool, project_id).await?;
    if lines.is_empty() {
        return Err(AppError::Conflict(
            "the project has no cost lines yet; there is nothing to capitalise".into(),
        ));
    }
    let mut asked: BTreeMap<(String, String), &CapitaliseLineRequest> = BTreeMap::new();
    for line in &request.lines {
        let key = (
            line.source_kind.trim().to_owned(),
            line.source_id.trim().to_owned(),
        );
        if asked.insert(key, line).is_some() {
            return Err(AppError::Validation(
                "a line is placed once; it was sent twice".into(),
            ));
        }
    }
    if asked.len() != lines.len() {
        return Err(AppError::Validation(format!(
            "{} of the project's {} lines are placed; every line has to be",
            asked.len(),
            lines.len()
        )));
    }

    // The project's assets and their classes.
    let assets: BTreeMap<Uuid, String> =
        sqlx::query("SELECT asset_id, category_code FROM fixed_asset WHERE project_id = $1")
            .bind(project_id)
            .fetch_all(pool)
            .await?
            .iter()
            .map(|row| Ok((row.try_get("asset_id")?, row.try_get("category_code")?)))
            .collect::<Result<_, AppError>>()?;
    let lives: BTreeMap<Uuid, i32> = request
        .lives
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|life| (life.asset_id, life.useful_life_months))
        .collect();
    if lives.values().any(|months| *months <= 0) {
        return Err(AppError::Validation(
            "a useful life is at least one month".into(),
        ));
    }

    // Resolve every leg before anything is written.
    let mut posting = Vec::new();
    let mut splits = Vec::new();
    for line in &lines {
        let key = (line.cost.source_kind.clone(), line.cost.source_id.clone());
        let ask = asked
            .get(&key)
            .ok_or_else(|| AppError::Validation(format!("{} is not placed", line.cost.document)))?;
        let amount = line.cost.amount_minor;
        let name = line
            .cost
            .what
            .clone()
            .filter(|w| !w.trim().is_empty())
            .unwrap_or_else(|| line.cost.document.clone());
        let (split_kind, class, destination, asset_id, life) = match ask.goes_to.trim() {
            "ASSET" => {
                let asset_id = ask.asset_id.ok_or_else(|| {
                    AppError::Validation(format!("{}: say which asset", line.cost.document))
                })?;
                let class = assets.get(&asset_id).ok_or_else(|| {
                    AppError::Validation(format!(
                        "{}: that asset is not one of the project's",
                        line.cost.document
                    ))
                })?;
                let account = class_account(pool, class, &unit).await?;
                (
                    "ASSET",
                    Some(class.clone()),
                    Some(account),
                    Some(asset_id),
                    lives.get(&asset_id).copied(),
                )
            }
            "PRE_OPENING" => {
                let months = request
                    .pre_opening_months
                    .filter(|m| *m > 0)
                    .ok_or_else(|| {
                        AppError::Validation(
                            "say over how many months the Pre-opening is amortised".into(),
                        )
                    })?;
                let account = class_account(pool, "PRE_OPENING", &unit).await?;
                (
                    "PRE_OPENING",
                    Some("PRE_OPENING".into()),
                    Some(account),
                    None,
                    Some(months),
                )
            }
            "EXPENSE" => {
                let named = ask
                    .account_code
                    .as_deref()
                    .map(str::trim)
                    .filter(|a| !a.is_empty())
                    .map(str::to_owned);
                if line.cost.in_cip && named.is_none() {
                    return Err(AppError::Validation(format!(
                        "{} sits in Contract in Progress; name the expense it goes to",
                        line.cost.document
                    )));
                }
                ("EXPENSE", None::<String>, named, None::<Uuid>, None::<i32>)
            }
            other => {
                return Err(AppError::Validation(format!(
                    "a line goes to ASSET, PRE_OPENING or EXPENSE, not {other}"
                )))
            }
        };
        // A move only when the destination is another account.
        if let Some(account) = destination.as_deref() {
            if line.cost.account_code.as_deref() != Some(account) {
                posting.push(leg_out(line, amount)?);
                posting.push(PostingLine::debit(
                    LineAccount::Account {
                        account_code: account.to_owned(),
                        category_code: None,
                    },
                    &unit,
                    amount,
                ));
            }
        }
        let account_code = destination
            .clone()
            .or_else(|| line.cost.account_code.clone())
            .unwrap_or_default();
        splits.push(Split {
            kind: split_kind,
            name,
            class,
            account: account_code,
            life,
            asset_id,
            line,
        });
    }

    let mut tx = pool.begin().await?;
    let entry_id = if posting.is_empty() {
        None
    } else {
        let intent = PostingIntent {
            posting_date: request.in_use_on,
            source_kind: "ASSET_CAPITALIZATION".into(),
            source_id: Some(project_id.to_string()),
            rule_version: "project_capitalise/1".into(),
            currency: "IDR".into(),
            memo: Some(format!("{number} capitalised · {title}")),
            lines: posting,
        };
        Some(post(&mut tx, &intent, None, actor).await?.entry_id)
    };
    sqlx::query(
        "UPDATE contractor_project
            SET status = 'CAPITALISED', closed_on = $2, closed_entry_id = $3, closed_by = $4,
                version = version + 1
          WHERE project_id = $1",
    )
    .bind(project_id)
    .bind(request.in_use_on)
    .bind(entry_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    let first: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(line_number), 0) FROM contractor_project_split WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(&mut *tx)
    .await?;
    for (index, split) in splits.iter().enumerate() {
        let line = split.line;
        sqlx::query(
            "INSERT INTO contractor_project_split
                (project_id, line_number, kind, name, class_code, account_code,
                 useful_life_months, amount_minor, asset_id, source_kind, source_id, from_account)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        )
        .bind(project_id)
        .bind(first + index as i32 + 1)
        .bind(split.kind)
        .bind(&split.name)
        .bind(&split.class)
        .bind(&split.account)
        .bind(split.life)
        .bind(line.cost.amount_minor)
        .bind(split.asset_id)
        .bind(&line.cost.source_kind)
        .bind(&line.cost.source_id)
        .bind(
            line.cost
                .account_code
                .as_deref()
                .or(line.claim_category.as_deref()),
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    finish_capitalising(pool, project_id, actor).await?;
    project_costs(pool, project_id).await
}

/// Assess the project's assets at what was placed on them, and register the
/// Pre-opening. Safe to run again: what is assessed already is left alone.
async fn finish_capitalising(pool: &PgPool, project_id: Uuid, actor: &str) -> Result<(), AppError> {
    let head = sqlx::query(
        "SELECT p.project_number, p.name, p.closed_on, p.site_id, s.name AS site_name,
                (SELECT id FROM site WHERE unit_id = p.unit_id ORDER BY id LIMIT 1) AS unit_site
           FROM contractor_project p LEFT JOIN site s ON s.id = p.site_id
          WHERE p.project_id = $1",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await?;
    let number: String = head.try_get("project_number")?;
    let in_use: Option<NaiveDate> = head.try_get("closed_on")?;
    let in_use =
        in_use.ok_or_else(|| AppError::Conflict("the project is not capitalised".into()))?;
    let site: Option<String> = head.try_get("site_id")?;
    let site = match site {
        Some(site) => site,
        None => head
            .try_get::<Option<String>, _>("unit_site")?
            .ok_or_else(|| AppError::Validation("the project's books keep no site".into()))?,
    };
    let place: String = head
        .try_get::<Option<String>, _>("site_name")?
        .unwrap_or_else(|| site.clone());

    // The Pre-opening: one asset for every line that went there.
    let pre = sqlx::query(
        "SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total, MAX(useful_life_months) AS months,
                bool_or(asset_id IS NULL) AS unregistered
           FROM contractor_project_split WHERE project_id = $1 AND kind = 'PRE_OPENING'",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await?;
    let pre_total: i64 = pre.try_get("total")?;
    if pre_total > 0
        && pre
            .try_get::<Option<bool>, _>("unregistered")?
            .unwrap_or(false)
    {
        let asset_number = format!("{number}-PO");
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
                    "name": format!("Pre-opening · {place}"),
                    "category_code": "PRE_OPENING",
                    "site_id": site,
                    "acquired_on": in_use,
                    "serial_number": null,
                    "notes": format!("Pre-opening cost of {number}"),
                    "acquired_via_line_id": null,
                }))
                .map_err(|error| AppError::Validation(format!("pre-opening: {error}")))?;
                super::register_asset(pool, &register, actor)
                    .await?
                    .asset_id
            }
        };
        sqlx::query(
            "UPDATE contractor_project_split SET asset_id = $2
              WHERE project_id = $1 AND kind = 'PRE_OPENING'",
        )
        .bind(project_id)
        .bind(asset_id)
        .execute(pool)
        .await?;
        sqlx::query("UPDATE fixed_asset SET project_id = $2 WHERE asset_id = $1")
            .bind(asset_id)
            .bind(project_id)
            .execute(pool)
            .await?;
    }

    // Every asset with cost placed on it, assessed once at the sum.
    let placed = sqlx::query(
        "SELECT s.asset_id, SUM(s.amount_minor)::bigint AS cost, MAX(s.useful_life_months) AS life,
                c.kind AS class_kind, COALESCE(c.default_method, 'STRAIGHT_LINE') AS method
           FROM contractor_project_split s
           JOIN fixed_asset a ON a.asset_id = s.asset_id
           JOIN asset_class c ON c.class_code = a.category_code
          WHERE s.project_id = $1 AND s.kind IN ('ASSET', 'PRE_OPENING')
            AND NOT EXISTS (SELECT 1 FROM asset_capitalization x WHERE x.asset_id = s.asset_id)
          GROUP BY s.asset_id, c.kind, c.default_method",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    for row in &placed {
        let asset_id: Uuid = row.try_get("asset_id")?;
        let charge_kind = match row.try_get::<Option<String>, _>("class_kind")?.as_deref() {
            Some("OE") => "REPLACEMENT_RESERVE",
            Some("INTANGIBLE" | "DEFERRED") => "AMORTISATION",
            _ => "DEPRECIATION",
        };
        let assess: super::AssessAssetRequest = serde_json::from_value(json!({
            "decision": "CAPITALIZE",
            "capitalized_cost_minor": row.try_get::<i64, _>("cost")?,
            "salvage_value_minor": 0,
            "useful_life_months": row.try_get::<Option<i32>, _>("life")?,
            "charge_kind": charge_kind,
            "method": row.try_get::<String, _>("method")?,
            "in_service_on": in_use,
            "reason": format!("Cost of {number} placed at capitalising"),
        }))
        .map_err(|error| AppError::Validation(format!("asset: {error}")))?;
        super::assess_asset(pool, asset_id, &assess, actor).await?;
    }
    // In project no more: in use.
    sqlx::query(
        "UPDATE fixed_asset SET status = 'REGISTERED'
          WHERE project_id = $1 AND status = 'IN_PROGRESS'",
    )
    .bind(project_id)
    .execute(pool)
    .await?;
    Ok(())
}
