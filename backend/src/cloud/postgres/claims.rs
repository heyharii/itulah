//! Expense claims, as rows — and the two transactions that put them in the
//! books.
//!
//! # The one write that must not come apart
//!
//! [`decide_claim`] stores the sanction **and** posts `Dr employee_expense /
//! Cr employee_claim_payable` in one transaction, and [`pay_claim`] stores the
//! payout **and** posts `Dr employee_claim_payable / Cr petty_cash` in one.
//! Not two statements that usually run together: a crash between them leaves
//! an approved claim the books have never heard of, and nobody notices because
//! both halves look fine on their own. The poster's own
//! `(source_kind, source_id, purpose)` uniqueness is the second guard — a
//! resent decision or a double-clicked payout rolls back whole, refused by
//! `ux_journal_entry_source_purpose` rather than by a status check two racing
//! requests can both pass.
//!
//! # Why the transition is a conditional UPDATE
//!
//! Every state move here is `UPDATE ... WHERE state = '<from>'`, and a zero
//! row count is a conflict. The domain has already checked the same
//! condition, but read-decide-write on a row two requests can load at once is
//! exactly the guard the poster's comment warns about: the conditional UPDATE
//! is the one that cannot be passed twice. The loser's transaction — posting
//! included — rolls back whole.
//!
//! # Why the numbering is the imprest lane's counter
//!
//! A payout's `KKC-` document and a claim's `KLC-` number come from
//! `next_document_number`, the same gapless, month-scoped counter the store
//! expenses use, locked inside the caller's transaction. Two lanes minting
//! document numbers by two rules would produce two documents claiming one
//! position.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    actions, Authorization, ClaimError, ClaimEvent, ClaimId, ClaimLine, ClaimLineId, ClaimState,
    ClaimType, ClaimTypeCatalogue, ClaimTypeCode, EmployeeId, ExpenseClaim, ExpenseClaimWire,
    UnitId,
};
use crate::cloud::postgres::{next_document_number, poster, LineAccount, PostingIntent, PostingLine};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Validation(format!(
        "{what} is stored in a shape that cannot be true: {detail}"
    ))
}

/// Turn a domain refusal into the right HTTP answer. A withdrawn-only-from
/// style mismatch of state is a conflict, not a bad request: the payload is
/// fine and what is wrong is what already happened to the claim.
pub fn claim_error(error: ClaimError) -> AppError {
    match error {
        ClaimError::InvalidId { .. }
        | ClaimError::NotPositive { .. }
        | ClaimError::DescriptionRequired
        | ClaimError::NoLines
        | ClaimError::SanctionNothing
        | ClaimError::SanctionMissingLine { .. }
        | ClaimError::SanctionAboveClaim { .. } => AppError::Validation(error.to_string()),
        ClaimError::UnknownClaimType { .. } | ClaimError::ClaimTypeRetired { .. } => {
            AppError::Conflict(error.to_string())
        }
        ClaimError::DuplicateClaimType { .. } => AppError::Conflict(error.to_string()),
        ClaimError::ActionForbidsFiling { .. }
        | ClaimError::ActionForbidsDecision { .. }
        | ClaimError::ActionForbidsPayout { .. }
        | ClaimError::SubmissionNotByFiler
        | ClaimError::WithdrawalNotByFiler
        | ClaimError::SameActorFiledAndDecided { .. } => AppError::Forbidden(error.to_string()),
        _ => AppError::Conflict(error.to_string()),
    }
}

// ── the catalogue ────────────────────────────────────────────────────────

fn decode_type(row: &sqlx::postgres::PgRow) -> Result<ClaimType, AppError> {
    let code = ClaimTypeCode::try_new(&row.try_get::<String, _>("code")?)
        .map_err(|error| corrupt("claim type code", error.to_string()))?;
    let name = row.try_get::<String, _>("name")?;
    let retired_at = row.try_get::<Option<DateTime<Utc>>, _>("retired_at")?;
    let created_at = row.try_get::<DateTime<Utc>, _>("created_at")?;
    ClaimType::try_from_parts(code, name, retired_at, created_at)
        .map_err(|error| corrupt("claim type", error.to_string()))
}

/// Every type the company has defined, retired ones included.
pub async fn load_type_catalogue(pool: &PgPool) -> Result<ClaimTypeCatalogue, AppError> {
    let rows = sqlx::query(
        "SELECT code, name, retired_at, created_at
           FROM expense_claim_type
          ORDER BY code",
    )
    .fetch_all(pool)
    .await?;
    let mut types = Vec::with_capacity(rows.len());
    for row in &rows {
        types.push(decode_type(row)?);
    }
    ClaimTypeCatalogue::try_new(types)
        .map_err(|error| corrupt("claim catalogue", error.to_string()))
}

/// Define a type, filed under an expense category Finance keeps (0465).
/// Refuses a code that already exists rather than replacing it: redefining a
/// type changes what every claim already filed under it meant.
///
/// Where the type's postings land is the category's: its `expense` link for
/// the cost, and its `employee_claim_payable` link (or the company's) for what
/// is owed. Nothing is guessed from the code.
pub async fn define_claim_type(
    pool: &PgPool,
    claim_type: &ClaimType,
    expense_category: &str,
    actor: &str,
) -> Result<(), AppError> {
    let _ = actor;
    let category = expense_category.trim();
    let usable: Option<bool> = sqlx::query_scalar(
        "SELECT is_active AND for_claims FROM expense_category WHERE code = $1",
    )
    .bind(category)
    .fetch_optional(pool)
    .await?;
    match usable {
        None => {
            return Err(AppError::Validation(format!(
                "there is no expense category {category}; add it under Finance, Expense categories"
            )))
        }
        Some(false) => {
            return Err(AppError::Validation(format!(
                "expense category {category} is retired or not open to employee claims"
            )))
        }
        Some(true) => {}
    }
    let inserted = sqlx::query(
        "INSERT INTO expense_claim_type (code, name, created_at, expense_category_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO NOTHING",
    )
    .bind(claim_type.code().as_str())
    .bind(claim_type.name())
    .bind(claim_type.created_at())
    .bind(category)
    .execute(pool)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!(
            "{} is already a claim type",
            claim_type.code()
        )));
    }
    Ok(())
}

/// Retire, never delete: every claim filed under the code keeps resolving,
/// and no new line may name it.
pub async fn retire_claim_type(
    pool: &PgPool,
    code: &ClaimTypeCode,
    reason: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let affected = sqlx::query(
        "UPDATE expense_claim_type
            SET retired_at = $2, retired_reason = $3
          WHERE code = $1 AND retired_at IS NULL",
    )
    .bind(code.as_str())
    .bind(at)
    .bind(reason)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(format!(
            "{} is not an active claim type",
            code
        )));
    }
    Ok(())
}

// ── the claim rows ───────────────────────────────────────────────────────

const CLAIM_COLUMNS: &str = "c.claim_id, c.claim_number, c.unit_id, c.employee_id,
                             c.claimed_by, c.posted_on, c.sanctioned_minor, c.state,
                             c.decided_by, c.decided_at, c.decide_reason, c.paid_at,
                             c.paid_by, c.approved_entry_id, c.paid_entry_id,
                             c.history, c.created_at";

fn decode_event(value: serde_json::Value) -> Result<ClaimEvent, AppError> {
    // The domain's `ClaimEvent` borrows its action from the machine, so the
    // stored JSON decodes through an owned shadow and the action string is
    // matched back to its code. Anything else is a word the machine never
    // wrote, which is a corrupted trail and not an event.
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct StoredEvent {
        actor: String,
        action: String,
        #[serde(default)]
        reason: Option<String>,
        at: DateTime<Utc>,
        #[serde(default)]
        detail: Option<String>,
    }
    let stored: StoredEvent = serde_json::from_value(value)
        .map_err(|error| corrupt("claim history event", error.to_string()))?;
    let action = match stored.action.as_str() {
        "FILED" => "FILED",
        "SUBMITTED" => "SUBMITTED",
        "APPROVED" => "APPROVED",
        "REJECTED" => "REJECTED",
        "RETURNED" => "RETURNED",
        "WITHDRAWN" => "WITHDRAWN",
        "PAID" => "PAID",
        other => {
            return Err(corrupt(
                "claim history event",
                format!("{other:?} is not an action the machine writes"),
            ))
        }
    };
    Ok(ClaimEvent {
        actor: stored.actor,
        action,
        reason: stored.reason,
        at: stored.at,
        detail: stored.detail,
    })
}

/// A claim with the names a screen shows, folded through the domain so a row
/// no sequence of decisions could reach refuses to load rather than rendering.
pub struct ClaimRecord {
    pub claim: ExpenseClaim,
    pub history: Vec<ClaimEvent>,
    pub created_at: DateTime<Utc>,
    pub unit_name: Option<String>,
    pub employee_code: Option<String>,
    pub employee_name: Option<String>,
    pub approved_entry_id: Option<Uuid>,
}

async fn decode_claim(
    pool: &PgPool,
    row: &sqlx::postgres::PgRow,
    catalogue: &ClaimTypeCatalogue,
) -> Result<ClaimRecord, AppError> {
    let id: Uuid = row.try_get("claim_id")?;
    let state_code: String = row.try_get("state")?;
    let decided_by: Option<String> = row.try_get("decided_by")?;
    let decided_at: Option<DateTime<Utc>> = row.try_get("decided_at")?;
    let decide_reason: Option<String> = row.try_get("decide_reason")?;
    let sanctioned_minor: Option<i64> = row.try_get("sanctioned_minor")?;
    let approved_entry: Option<Uuid> = row.try_get("approved_entry_id")?;
    let paid_entry: Option<Uuid> = row.try_get("paid_entry_id")?;
    let paid_by: Option<String> = row.try_get("paid_by")?;
    let paid_at: Option<DateTime<Utc>> = row.try_get("paid_at")?;

    fn authorization(
        actor: Option<String>,
        at: Option<DateTime<Utc>>,
        reason: Option<String>,
    ) -> Result<Authorization, AppError> {
        let actor = actor.unwrap_or_default();
        let reason = reason.unwrap_or_default();
        Authorization::try_new(
            &actor,
            actions::CLAIM_DECIDE,
            at.unwrap_or(DateTime::<Utc>::MIN_UTC),
            &reason,
        )
        .map_err(|error| corrupt("claim decision", error.to_string()))
    }

    let history: Vec<ClaimEvent> = row
        .try_get::<serde_json::Value, _>("history")?
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(decode_event)
        .collect::<Result<_, _>>()?;

    // The inverse of what is written, pairing the state with its evidence.
    // Anything else is a row whose state and its columns disagree, which the
    // schema's CHECKs also refuse — this re-statement catches the rows a
    // CHECK amendment missed.
    let state = match state_code.as_str() {
        "DRAFT" => ClaimState::Draft,
        "SUBMITTED" => ClaimState::Submitted,
        "APPROVED" => ClaimState::Approved {
            decided: authorization(decided_by, decided_at, decide_reason)?,
            sanctioned_minor: sanctioned_minor.unwrap_or(0),
            approved_entry: approved_entry
                .ok_or_else(|| corrupt("approved claim", "no sanctioning entry".into()))?
                .to_string(),
        },
        "REJECTED" => ClaimState::Rejected {
            decided: authorization(decided_by, decided_at, decide_reason)?,
        },
        // A withdrawal is not a decision: the schema keeps `decided_by` empty
        // for it, so who withdrew, when and why live only in the trail.
        "WITHDRAWN" => ClaimState::Withdrawn {
            withdrawn: {
                let event = history
                    .iter()
                    .rev()
                    .find(|event| event.action == "WITHDRAWN")
                    .ok_or_else(|| corrupt("claim withdrawal", "no WITHDRAWN event".into()))?;
                Authorization::try_new(
                    &event.actor,
                    actions::CLAIM_REQUEST_OWN,
                    event.at,
                    event.reason.as_deref().unwrap_or_default(),
                )
                .map_err(|error| corrupt("claim withdrawal", error.to_string()))?
            },
        },
        "PAID" => ClaimState::Paid {
            decided: authorization(decided_by, decided_at, decide_reason)?,
            sanctioned_minor: sanctioned_minor.unwrap_or(0),
            approved_entry: approved_entry
                .ok_or_else(|| corrupt("paid claim", "no sanctioning entry".into()))?
                .to_string(),
            paid_by: paid_by.unwrap_or_default(),
            paid_at: paid_at.unwrap_or(DateTime::<Utc>::MIN_UTC),
            payout_entry: paid_entry
                .ok_or_else(|| corrupt("paid claim", "no payout entry".into()))?
                .to_string(),
        },
        other => {
            return Err(corrupt(
                "claim state",
                format!("{other:?} is not a state the machine reaches"),
            ))
        }
    };

    let lines = claim_lines(pool, id).await?;

    let claim = ExpenseClaim::try_new(
        ExpenseClaimWire {
            id: ClaimId::try_new(&id.to_string())
                .map_err(|error| corrupt("claim id", error.to_string()))?,
            unit: UnitId::try_new(&row.try_get::<String, _>("unit_id")?)
                .map_err(|error| corrupt("claim unit", error.to_string()))?,
            employee: EmployeeId::try_new(&row.try_get::<String, _>("employee_id")?)
                .map_err(|error| corrupt("claim employee", error.to_string()))?,
            claimed_by: row.try_get::<String, _>("claimed_by")?,
            posted_on: row.try_get::<NaiveDate, _>("posted_on")?,
            lines,
            state,
            history: history.clone(),
        },
        catalogue,
    )
    .map_err(claim_error)?;

    Ok(ClaimRecord {
        created_at: row.try_get("created_at")?,
        unit_name: row.try_get("unit_name")?,
        employee_code: row.try_get("employee_code")?,
        employee_name: row.try_get("employee_name")?,
        approved_entry_id: row.try_get("approved_entry_id")?,
        history,
        claim: claim.with_claim_number(row.try_get("claim_number")?),
    })
}

async fn claim_lines(pool: &PgPool, claim_id: Uuid) -> Result<Vec<ClaimLine>, AppError> {
    let rows = sqlx::query(
        "SELECT line_id, type_code, description, spent_on, claimed_minor,
                sanctioned_minor, line_number
           FROM expense_claim_line
          WHERE claim_id = $1
          ORDER BY line_number",
    )
    .bind(claim_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let line_id: Uuid = row.try_get("line_id")?;
            let type_code = ClaimTypeCode::try_new(&row.try_get::<String, _>("type_code")?)
                .map_err(|error| corrupt("claim line type", error.to_string()))?;
            let description: String = row.try_get("description")?;
            let spent_on: NaiveDate = row.try_get("spent_on")?;
            let claimed_minor: i64 = row.try_get("claimed_minor")?;
            let sanctioned_minor: Option<i64> = row.try_get("sanctioned_minor")?;
            let line_number: i32 = row.try_get("line_number")?;
            let mut line = ClaimLine::try_new(
                ClaimLineId::try_new(&line_id.to_string())
                    .map_err(|error| corrupt("claim line id", error.to_string()))?,
                type_code,
                description,
                spent_on,
                claimed_minor,
                line_number,
            )
            .map_err(claim_error)?;
            if let Some(sanctioned) = sanctioned_minor {
                line.sanction_for_storage(sanctioned).map_err(claim_error)?;
            }
            Ok(line)
        })
        .collect()
}

/// Store a filed claim: the header, its lines, and the history that says who
/// filed it. One transaction, because a claim with lines missing is not a
/// claim anybody can decide — and the `KLC-` number is minted inside it, so
/// a rolled-back claim takes its number back with it.
pub async fn insert_claim(pool: &PgPool, claim: &ExpenseClaim) -> Result<String, AppError> {
    let claim_id = Uuid::from_str(claim.id().as_str())
        .map_err(|error| corrupt("claim id", error.to_string()))?;
    let history = serde_json::to_value(claim.history())
        .map_err(|error| corrupt("claim history", error.to_string()))?;
    let mut tx = pool.begin().await?;
    // Counted under the unit's internal id, printed under its client code
    // (`KLC-C004-…`), never the id.
    let printed = super::unit_code(&mut *tx, claim.unit().as_str()).await?;
    let claim_number = next_document_number(
        &mut tx,
        &format!("KLC:{}", claim.unit().as_str()),
        &format!("KLC-{printed}"),
        claim.posted_on(),
    )
    .await?;
    sqlx::query(
        "INSERT INTO expense_claim
             (claim_id, claim_number, unit_id, employee_id, claimed_by, posted_on,
              state, history)
         VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', $7)",
    )
    .bind(claim_id)
    .bind(&claim_number)
    .bind(claim.unit().as_str())
    .bind(claim.employee().as_str())
    .bind(claim.claimed_by())
    .bind(claim.posted_on())
    .bind(history)
    .execute(&mut *tx)
    .await?;
    for line in claim.lines() {
        write_line(&mut tx, claim_id, line).await?;
    }
    tx.commit().await?;
    Ok(claim_number)
}

async fn write_line(
    tx: &mut Transaction<'_, Postgres>,
    claim_id: Uuid,
    line: &ClaimLine,
) -> Result<(), AppError> {
    let line_id = Uuid::from_str(line.id().as_str())
        .map_err(|error| corrupt("claim line id", error.to_string()))?;
    sqlx::query(
        "INSERT INTO expense_claim_line
             (line_id, claim_id, type_code, description, spent_on, claimed_minor,
              line_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(line_id)
    .bind(claim_id)
    .bind(line.type_code().as_str())
    .bind(line.description())
    .bind(line.spent_on())
    .bind(line.claimed_minor())
    .bind(line.line_number())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Decide a claim, and put the sanction in the books, in one transaction.
///
/// `Dr employee_expense [unit, qualifier = type code]` per sanctioned type,
/// `Cr employee_claim_payable [unit, for_employee]` for the total — one
/// journal, `('EXPENSE_CLAIM', claim_id, 'MAIN')` unique. A rejection posts
/// nothing and records the decision by itself.
///
/// The claim is the unit's and so are the books it lands in (0605): no
/// premises is looked up on the way.
pub async fn decide_claim(
    pool: &PgPool,
    claim: &mut ExpenseClaim,
    approve: bool,
    sanctions: &[(ClaimLineId, i64)],
    authorization: Authorization,
) -> Result<(), AppError> {
    // The domain produces the decision and the posting plan together, and
    // refuses the halfway shapes before any statement runs.
    let posting = claim
        .decide(approve, sanctions, authorization.clone())
        .map_err(claim_error)?;

    let claim_id = Uuid::from_str(claim.id().as_str())
        .map_err(|error| corrupt("claim id", error.to_string()))?;
    let history = serde_json::to_value(claim.history())
        .map_err(|error| corrupt("claim history", error.to_string()))?;

    let mut tx = pool.begin().await?;

    // Posted first, so the entry id can ride the same UPDATE that flips the
    // state: if anything below fails, the whole transaction — posting
    // included — rolls back, and there is no instant at which the books hold
    // a claim's sanction the claim does not.
    let posted = if let Some(posting) = &posting {
        let unit = claim.unit().as_str();
        let mut lines = Vec::with_capacity(posting.by_type.len() * 2);
        for (type_code, amount) in &posting.by_type {
            let category: Option<String> = sqlx::query_scalar(
                "SELECT expense_category_code FROM expense_claim_type WHERE code = $1",
            )
            .bind(type_code.as_str())
            .fetch_one(&mut *tx)
            .await?;
            let category = category.ok_or_else(|| {
                AppError::Validation(format!(
                    "claim type {type_code} is filed under no expense category; set one before \
                     approving"
                ))
            })?;
            lines.push(
                PostingLine::debit("expense", unit, *amount)
                    .from_source("EXPENSE_CATEGORY", &category),
            );
            // What is owed: the category's own payable when Finance linked one
            // (a medical category owes on 2020), the company's otherwise.
            let payable = PostingLine::credit("employee_claim_payable", unit, *amount)
                .for_employee(claim.employee().as_str());
            let own = super::ledger::resolve_linked(
                &mut *tx,
                "employee_claim_payable",
                unit,
                "EXPENSE_CATEGORY",
                &category,
            )
            .await?;
            lines.push(if own.is_some() {
                payable.from_source("EXPENSE_CATEGORY", &category)
            } else {
                payable
            });
        }
        Some(
            poster::post(
                &mut tx,
                &PostingIntent {
                    posting_date: claim.posted_on(),
                    source_kind: "EXPENSE_CLAIM".into(),
                    source_id: Some(claim_id.to_string()),
                    rule_version: "expense_claim/1".into(),
                    currency: "IDR".into(),
                    memo: Some(format!("{} — {}", claim.claim_number(), claim.employee())),
                    lines,
                },
                None,
                authorization.actor().as_str(),
            )
            .await?,
        )
    } else {
        None
    };

    // The transition, claimed by the conditional UPDATE. A zero row count
    // means another decision got here first: the loser's posting rolls back
    // with the transaction.
    let mut approved_entry_id = None;
    let affected = if approve {
        let entry_id = posted
            .as_ref()
            .map(|posted| posted.entry_id)
            .ok_or_else(|| corrupt("approved claim", "the domain produced no posting".into()))?;
        approved_entry_id = Some(entry_id);
        sqlx::query(
            "UPDATE expense_claim
                SET state = 'APPROVED', decided_by = $2, decided_at = $3,
                    decide_reason = $4, sanctioned_minor = $5,
                    approved_entry_id = $6, history = $7
              WHERE claim_id = $1 AND state = 'SUBMITTED'",
        )
        .bind(claim_id)
        .bind(authorization.actor().as_str())
        .bind(authorization.at())
        .bind(authorization.reason().as_str())
        .bind(claim.state().sanctioned_minor())
        .bind(entry_id)
        .bind(history)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE expense_claim
                SET state = 'REJECTED', decided_by = $2, decided_at = $3,
                    decide_reason = $4, history = $5
              WHERE claim_id = $1 AND state = 'SUBMITTED'",
        )
        .bind(claim_id)
        .bind(authorization.actor().as_str())
        .bind(authorization.at())
        .bind(authorization.reason().as_str())
        .bind(history)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    };
    if affected == 0 {
        return Err(AppError::Conflict(format!(
            "{} is no longer waiting for a decision",
            claim.claim_number()
        )));
    }

    // The decider's figures, per line, written with the decision.
    if approve {
        for line in claim.lines() {
            if let Some(sanctioned) = line.sanctioned_minor() {
                sqlx::query(
                    "UPDATE expense_claim_line SET sanctioned_minor = $2
                      WHERE line_id = $1",
                )
                .bind(Uuid::from_str(line.id().as_str()).ok())
                .bind(sanctioned)
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    // Only an approval has an entry to stamp; a rejection posted nothing.
    if let Some(entry_id) = approved_entry_id {
        claim
            .mark_approved(entry_id.to_string())
            .map_err(claim_error)?;
    }
    tx.commit().await?;
    Ok(())
}

/// Pay an approved claim from the unit's petty cash, in one transaction.
///
/// `Dr employee_claim_payable [unit, for_employee]` for what was sanctioned,
/// `Cr petty_cash [unit]` — the same meaning the imprest spends from, so the
/// payout is visible to the cash-position fold with no new table. The
/// document is the `KKC-` series of the paying unit, printed under the unit's
/// client code (`KKC-C004-…`), never its internal id.
pub async fn pay_claim(
    pool: &PgPool,
    claim: &mut ExpenseClaim,
    authorization: Authorization,
    paid_on: NaiveDate,
) -> Result<(String, String), AppError> {
    let claim_id = Uuid::from_str(claim.id().as_str())
        .map_err(|error| corrupt("claim id", error.to_string()))?;
    // Only an approved claim has a sanctioned figure to pay. Anything else is
    // the caller's mistake, said as one — not a corrupt row.
    let total = claim.state().sanctioned_minor().ok_or_else(|| {
        AppError::Conflict(format!(
            "claim {} is {}: only an approved claim can be paid out",
            claim.claim_number(),
            claim.state().code()
        ))
    })?;

    let mut tx = pool.begin().await?;
    let unit = claim.unit().as_str().to_string();
    // Counted under the internal id, printed under the unit's client code
    // (0600): the counter's scope is the unit whose petty cash pays.
    let printed = super::unit_code(&mut *tx, &unit).await?.to_uppercase();
    let document_number = next_document_number(
        &mut tx,
        &format!("KKC:{unit}"),
        &format!("KKC-{printed}"),
        paid_on,
    )
    .await?;

    // Paid out of exactly the liabilities the approval raised: every credit
    // the approval entry put on this employee in this unit's books is debited
    // back, account for account, so payment always mirrors approval.
    let owed = sqlx::query(
        "SELECT l.account_code, SUM(l.credit_minor - l.debit_minor)::bigint AS owed
           FROM journal_line l
           JOIN journal_entry e ON e.entry_id = l.entry_id
          WHERE e.source_kind = 'EXPENSE_CLAIM' AND e.source_id = $1
            AND l.unit_id = $2 AND l.party_type = 'EMPLOYEE'
          GROUP BY l.account_code
         HAVING SUM(l.credit_minor - l.debit_minor) > 0
          ORDER BY l.account_code",
    )
    .bind(claim_id.to_string())
    .bind(&unit)
    .fetch_all(&mut *tx)
    .await?;
    let mut lines = Vec::with_capacity(owed.len() + 1);
    let mut left = total;
    for row in &owed {
        let amount = row.try_get::<i64, _>("owed")?.min(left);
        if amount <= 0 {
            continue;
        }
        left -= amount;
        lines.push(
            PostingLine::debit(
                LineAccount::Account {
                    account_code: row.try_get("account_code")?,
                    category_code: None,
                },
                &unit,
                amount,
            )
            .for_employee(claim.employee().as_str()),
        );
    }
    if left != 0 {
        return Err(AppError::Conflict(format!(
            "the approval of {} owes {} less than the {} sanctioned; it cannot be paid as approved",
            claim.claim_number(),
            left,
            total
        )));
    }
    lines.push(PostingLine::credit("petty_cash", &unit, total));
    let payout_lines = lines;

    let posted = poster::post(
        &mut tx,
        &PostingIntent {
            posting_date: paid_on,
            source_kind: "EXPENSE_CLAIM_PAYOUT".into(),
            source_id: Some(claim_id.to_string()),
            rule_version: "expense_claim_payout/1".into(),
            currency: "IDR".into(),
            memo: Some(format!(
                "{} — klaim {} {}",
                document_number,
                claim.employee(),
                claim.claim_number()
            )),
            lines: payout_lines,
        },
        None,
        authorization.actor().as_str(),
    )
    .await?;

    // The domain appends its own PAID event — document and entry number in
    // the detail — and flips to PAID in memory; the UPDATE below stores both
    // in one statement, guarded by the state still being APPROVED.
    claim
        .pay(
            authorization.actor().as_str(),
            posted.entry_id.to_string(),
            &document_number,
            authorization.clone(),
        )
        .map_err(claim_error)?;
    let history = serde_json::to_value(claim.history())
        .map_err(|error| corrupt("claim history", error.to_string()))?;

    let affected = sqlx::query(
        "UPDATE expense_claim
            SET state = 'PAID', paid_at = $3, paid_by = $4,
                paid_entry_id = $5, history = $2
          WHERE claim_id = $1 AND state = 'APPROVED'",
    )
    .bind(claim_id)
    .bind(history)
    .bind(authorization.at())
    .bind(authorization.actor().as_str())
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(format!(
            "{} is not an approved claim waiting to be paid",
            claim.claim_number()
        )));
    }

    tx.commit().await?;
    Ok((document_number, posted.entry_number))
}

/// Submit or withdraw, as the caller asked. Both are the filer's acts from a
/// state the domain checks; the conditional UPDATE here is the guard the
/// second racing request cannot pass.
pub async fn record_submission(
    pool: &PgPool,
    claim: &mut ExpenseClaim,
    authorization: Authorization,
) -> Result<(), AppError> {
    claim.submit(authorization.clone()).map_err(claim_error)?;
    let affected = transition(pool, claim, "SUBMITTED", "WHERE state = 'DRAFT'").await?;
    if affected == 0 {
        return Err(AppError::Conflict(format!(
            "{} is not a draft waiting to be submitted",
            claim.claim_number()
        )));
    }
    Ok(())
}

pub async fn record_withdrawal(
    pool: &PgPool,
    claim: &mut ExpenseClaim,
    authorization: Authorization,
) -> Result<(), AppError> {
    claim.withdraw(authorization.clone()).map_err(claim_error)?;
    let affected = transition(
        pool,
        claim,
        "WITHDRAWN",
        "WHERE state IN ('DRAFT', 'SUBMITTED')",
    )
    .await?;
    if affected == 0 {
        return Err(AppError::Conflict(format!(
            "{} can no longer be withdrawn",
            claim.claim_number()
        )));
    }
    Ok(())
}

pub async fn record_returnal(
    pool: &PgPool,
    claim: &mut ExpenseClaim,
    authorization: Authorization,
) -> Result<(), AppError> {
    claim
        .return_to_draft(authorization.clone())
        .map_err(claim_error)?;
    let affected = transition(pool, claim, "DRAFT", "WHERE state = 'SUBMITTED'").await?;
    if affected == 0 {
        return Err(AppError::Conflict(format!(
            "{} is not waiting to be sent back",
            claim.claim_number()
        )));
    }
    Ok(())
}

/// One state move, by conditional UPDATE, with the history appended in the
/// same statement. None of these transitions decides anything — submission,
/// withdrawal and a send-back all leave `decided_*` exactly as they were,
/// which is empty; the decisions live in `decide_claim`.
async fn transition(
    pool: &PgPool,
    claim: &ExpenseClaim,
    to_state: &str,
    from: &str,
) -> Result<u64, AppError> {
    let claim_id = Uuid::from_str(claim.id().as_str())
        .map_err(|error| corrupt("claim id", error.to_string()))?;
    let history = serde_json::to_value(claim.history())
        .map_err(|error| corrupt("claim history", error.to_string()))?;
    let sql = format!(
        "UPDATE expense_claim SET state = '{to_state}', history = $2
         {from} AND claim_id = $1"
    );
    let affected = sqlx::query(&sql)
        .bind(claim_id)
        .bind(history)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(affected)
}

// ── reads ────────────────────────────────────────────────────────────────

/// One claim, folded.
pub async fn load_claim(
    pool: &PgPool,
    claim_id: Uuid,
    catalogue: &ClaimTypeCatalogue,
) -> Result<Option<ClaimRecord>, AppError> {
    let sql = format!(
        "SELECT {CLAIM_COLUMNS},
                COALESCE(p.name, p.id) AS unit_name,
                e.code AS employee_code,
                COALESCE(pr.full_name, e.id) AS employee_name
           FROM expense_claim c
           JOIN unit p ON p.id = c.unit_id
           JOIN employee e ON e.id = c.employee_id
      LEFT JOIN employee_profile pr ON pr.employee_id = e.id
          WHERE c.claim_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(claim_id)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(decode_claim(pool, &row, catalogue).await?)),
        None => Ok(None),
    }
}

/// The queue and the list: filters all optional, and `reach_place` the one
/// place a bounded caller may see (`None` for head office, which sees every
/// place's). The partial index in 0341 is the SUBMITTED queue's query.
pub async fn list_claims(
    pool: &PgPool,
    catalogue: &ClaimTypeCatalogue,
    unit: Option<&str>,
    state: Option<&str>,
    employee: Option<&str>,
    reach_unit: Option<&str>,
) -> Result<Vec<ClaimRecord>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {CLAIM_COLUMNS},
                COALESCE(p.name, p.id) AS unit_name,
                e.code AS employee_code,
                COALESCE(pr.full_name, e.id) AS employee_name
           FROM expense_claim c
           JOIN unit p ON p.id = c.unit_id
           JOIN employee e ON e.id = c.employee_id
      LEFT JOIN employee_profile pr ON pr.employee_id = e.id
          WHERE ($1::text IS NULL OR c.unit_id = $1)
            AND ($2::text IS NULL OR c.state = $2)
            AND ($3::text IS NULL OR c.employee_id = $3)
            AND ($4::text IS NULL OR c.unit_id = $4)
          ORDER BY c.posted_on DESC, c.claim_number DESC
          LIMIT 500"
    ))
    .bind(unit)
    .bind(state)
    .bind(employee)
    .bind(reach_unit)
    .fetch_all(pool)
    .await?;
    let mut records = Vec::with_capacity(rows.len());
    for row in &rows {
        records.push(decode_claim(pool, row, catalogue).await?);
    }
    Ok(records)
}

/// One claim, as the wire carries it: the names resolved, the lines embedded
/// (the decide sheet needs them, and the spec's table has no single-claim
/// read to hang them on), the history folded.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClaimLineView {
    pub line_id: Uuid,
    pub type_code: String,
    pub type_name: String,
    pub description: String,
    pub spent_on: NaiveDate,
    pub claimed_minor: i64,
    pub sanctioned_minor: Option<i64>,
    pub line_number: i32,
}

/// One event of the trail, owned. The domain's `ClaimEvent` borrows its
/// action from the machine; the wire carries it as the string it is.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClaimEventView {
    pub actor: String,
    pub action: String,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClaimView {
    pub claim_id: Uuid,
    pub claim_number: String,
    pub unit_id: String,
    pub unit_name: Option<String>,
    pub employee_id: String,
    pub employee_code: Option<String>,
    pub employee_name: Option<String>,
    pub posted_on: NaiveDate,
    pub claimed_by: String,
    /// What was asked, as one number.
    pub claimed_minor: i64,
    /// What was allowed — `null` while undecided, and on a rejected claim.
    pub sanctioned_minor: Option<i64>,
    pub state: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decide_reason: Option<String>,
    pub approved_entry_id: Option<Uuid>,
    pub paid_at: Option<DateTime<Utc>>,
    pub paid_by: Option<String>,
    pub paid_entry_id: Option<Uuid>,
    pub lines: Vec<ClaimLineView>,
    pub history: Vec<ClaimEventView>,
    pub created_at: DateTime<Utc>,
}

pub fn claim_view(
    record: &ClaimRecord,
    catalogue: &ClaimTypeCatalogue,
) -> Result<ClaimView, AppError> {
    let claim = &record.claim;
    let type_name = |code: &ClaimTypeCode| -> String {
        catalogue
            .require(code)
            .map(|t| t.name().to_owned())
            .unwrap_or_else(|_| code.to_string())
    };
    let parse = |what: &str, raw: &str| -> Result<Uuid, AppError> {
        Uuid::from_str(raw).map_err(|error| corrupt(what, error.to_string()))
    };
    let (decided_by, decided_at, decide_reason) = match claim.state().decision() {
        Some(decision) => (
            Some(decision.actor().to_string()),
            Some(decision.at()),
            Some(decision.reason().to_string()),
        ),
        None => (None, None, None),
    };
    let (paid_at, paid_by, paid_entry_id) = match claim.state() {
        ClaimState::Paid {
            paid_at,
            paid_by,
            payout_entry,
            ..
        } => (
            Some(*paid_at),
            Some(paid_by.clone()),
            Some(parse("payout entry", payout_entry)?),
        ),
        _ => (None, None, None),
    };
    Ok(ClaimView {
        claim_id: parse("claim id", claim.id().as_str())?,
        claim_number: claim.claim_number().to_owned(),
        unit_id: claim.unit().to_string(),
        unit_name: record.unit_name.clone(),
        employee_id: claim.employee().to_string(),
        employee_code: record.employee_code.clone(),
        employee_name: record.employee_name.clone(),
        posted_on: claim.posted_on(),
        claimed_by: claim.claimed_by().to_owned(),
        claimed_minor: claim.claimed_total_minor(),
        sanctioned_minor: claim.state().sanctioned_minor(),
        state: claim.state().code().to_owned(),
        decided_by,
        decided_at,
        decide_reason,
        approved_entry_id: record.approved_entry_id,
        paid_at,
        paid_by,
        paid_entry_id,
        lines: claim
            .lines()
            .iter()
            .map(|line| {
                Ok(ClaimLineView {
                    line_id: parse("claim line id", line.id().as_str())?,
                    type_code: line.type_code().to_string(),
                    type_name: type_name(line.type_code()),
                    description: line.description().to_owned(),
                    spent_on: line.spent_on(),
                    claimed_minor: line.claimed_minor(),
                    sanctioned_minor: line.sanctioned_minor(),
                    line_number: line.line_number(),
                })
            })
            .collect::<Result<_, AppError>>()?,
        history: record
            .history
            .iter()
            .map(|event| ClaimEventView {
                actor: event.actor.clone(),
                action: event.action.to_owned(),
                reason: event.reason.clone(),
                at: event.at,
                detail: event.detail.clone(),
            })
            .collect(),
        created_at: record.created_at,
    })
}

// ── the advance surface (read-only) ─────────────────────────────────────

/// One open advance the finance lane (0280) is holding for this person.
///
/// A read-only projection over the finance lane's own table — People does not
/// rebuild `advance`; the Directory sheet only needs to see who is holding
/// company money and how much.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeAdvanceView {
    pub advance_id: Uuid,
    pub advance_number: String,
    pub site_id: String,
    pub purpose: String,
    pub amount_minor: i64,
    pub settled_minor: i64,
    pub refunded_minor: i64,
    /// What the wage repaid — a settlement the payroll approval made (0347),
    /// beside the receipts and the change the finance lane books itself.
    pub recovered_minor: i64,
    pub outstanding_minor: i64,
    pub status: String,
    pub requested_at: DateTime<Utc>,
    pub paid_at: Option<DateTime<Utc>>,
}

/// The person's advances, open ones first. Finance keeps the authority over
/// every mutation; this is the mirror the HR sheet reads.
///
/// The settlement figures are a fold over `advance_settlement` (0280), not
/// columns — an advance's outstanding is the arithmetic of what came back, and
/// storing it beside the ledger would be the halfway state that crate exists
/// to make impossible. Three legs come back: receipts (`EXPENSE`), change
/// (`REFUND`), and the wage line a payroll approval booked (`PAYROLL`,
/// 0347). `party_type` and not `party_kind`: 0299 renamed the column when it
/// minted the registry.
pub async fn advances_of_employee(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<EmployeeAdvanceView>, AppError> {
    let rows = sqlx::query(
        "SELECT a.advance_id, a.advance_number, a.site_id, a.purpose,
                a.amount_minor, a.status, a.requested_at, a.paid_at,
                COALESCE(SUM(s.amount_minor) FILTER (WHERE s.kind = 'EXPENSE'), 0)::bigint AS settled_minor,
                COALESCE(SUM(s.amount_minor) FILTER (WHERE s.kind = 'REFUND'), 0)::bigint  AS refunded_minor,
                COALESCE(SUM(s.amount_minor) FILTER (WHERE s.kind = 'PAYROLL'), 0)::bigint AS recovered_minor
           FROM advance a
           LEFT JOIN advance_settlement s ON s.advance_id = a.advance_id
          WHERE a.party_type = 'EMPLOYEE' AND a.employee_id = $1
          GROUP BY a.advance_id
          ORDER BY a.paid_at IS NULL DESC, a.requested_at DESC
          LIMIT 100",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let amount: i64 = row.try_get("amount_minor")?;
            let settled: i64 = row.try_get("settled_minor")?;
            let refunded: i64 = row.try_get("refunded_minor")?;
            let recovered: i64 = row.try_get("recovered_minor")?;
            Ok(EmployeeAdvanceView {
                advance_id: row.try_get("advance_id")?,
                advance_number: row.try_get("advance_number")?,
                site_id: row.try_get("site_id")?,
                purpose: row.try_get("purpose")?,
                amount_minor: amount,
                settled_minor: settled,
                refunded_minor: refunded,
                recovered_minor: recovered,
                outstanding_minor: amount - settled - refunded - recovered,
                status: row.try_get("status")?,
                requested_at: row.try_get("requested_at")?,
                paid_at: row.try_get("paid_at")?,
            })
        })
        .collect()
}

/// One advance, as a payroll recovery against it needs it.
///
/// The filing refuses, while the filer is still looking at the form, what
/// there is nothing to repay — so it reads the advance and its outstanding in
/// one row. The outstanding half of the check repeats at approval, because
/// filings sit while months move; the rest is settled fact by then.
#[derive(Debug)]
pub struct AdvanceRecoveryRow {
    pub advance_id: Uuid,
    pub advance_number: String,
    pub party_type: String,
    pub employee_id: Option<String>,
    pub status: String,
    pub amount_minor: i64,
    pub outstanding_minor: i64,
}

pub async fn advance_for_recovery(
    pool: &PgPool,
    advance_id: Uuid,
) -> Result<Option<AdvanceRecoveryRow>, AppError> {
    let row = sqlx::query(
        "SELECT a.advance_id, a.advance_number, a.party_type, a.employee_id, a.status,
                a.amount_minor,
                (a.amount_minor - COALESCE(SUM(s.amount_minor), 0))::bigint AS outstanding_minor
           FROM advance a
           LEFT JOIN advance_settlement s ON s.advance_id = a.advance_id
          WHERE a.advance_id = $1
          GROUP BY a.advance_id",
    )
    .bind(advance_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some(AdvanceRecoveryRow {
        advance_id: row.try_get("advance_id")?,
        advance_number: row.try_get("advance_number")?,
        party_type: row.try_get("party_type")?,
        employee_id: row.try_get("employee_id")?,
        status: row.try_get("status")?,
        amount_minor: row.try_get("amount_minor")?,
        outstanding_minor: row.try_get("outstanding_minor")?,
    }))
}

