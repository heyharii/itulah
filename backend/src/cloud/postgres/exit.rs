//! Exit interviews and Full & Final statements, as rows — and the one
//! transaction that settles a statement into the books.
//!
//! # The one write that must not come apart
//!
//! [`settle_full_and_final`] compares the frozen totals to the live sources,
//! posts the settlement journal, and flips the state **in one transaction**.
//! The comparison running inside the caller's transaction is what makes the
//! drift refusal honest: a claim approved by a racing decision either lands
//! before the settle (the totals move, the settle is refused by name) or
//! after it (it is later business, and the statement already said what the
//! leaver's books said at settlement). A settle that compared outside its
//! transaction would refuse nothing that mattered.
//!
//! The state move is a conditional UPDATE — `WHERE state = 'DRAFT'` — and a
//! zero row count rolls the posting back with the transaction, which is the
//! same guard the claims lane states: the loser of a race loses whole, and
//! the poster's `(source_kind, source_id, purpose)` uniqueness refuses the
//! resent settle at the database rather than at a status check.
//!
//! # Where the sources are read from
//!
//! The finance lane's `advance` (0280) and the claims lane's `expense_claim`
//! (0341) are read, never written, here. The outstanding arithmetic is the
//! advances lane's own — settlements are rows in `advance_settlement`, and
//! the balance is `amount − settled − refunded` over the PAID and
//! PARTIALLY_SETTLED rows, the same open set the lane's own partial index
//! names. An APPROVED claim is sanctioned and not yet paid; that is the
//! entire definition of the claim_payable column, and PAID rows drop out by
//! state.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    Authorization, EmployeeId, EmployeeStance, ExitError, ExitId, ExitInterview,
    ExitInterviewState, ExitInterviewWire, FnfEvent, FnfId, FullAndFinalState,
    FullAndFinalStatement, FullAndFinalWire, PlaceId,
};
use crate::cloud::postgres::{poster, PostingIntent};
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

/// Turn a domain refusal into the right HTTP answer.
pub fn exit_error(error: ExitError) -> AppError {
    match error {
        ExitError::InvalidId { .. }
        | ExitError::CancelReasonRequired
        | ExitError::ConductorRequired
        | ExitError::AssetNoteRequired => AppError::Validation(error.to_string()),
        ExitError::ActionForbidsCompletion { .. } | ExitError::ActionForbidsSettlement { .. } => {
            AppError::Forbidden(error.to_string())
        }
        ExitError::InterviewNotPending { .. }
        | ExitError::FnfNotDraft { .. }
        | ExitError::FnfNotCancellable { .. } => AppError::Conflict(error.to_string()),
        ExitError::AdvanceOutstandingMoved { .. }
        | ExitError::ClaimPayableMoved { .. }
        | ExitError::AssetTotalDisagrees { .. }
        | ExitError::NetIsZero { .. } => AppError::Conflict(error.to_string()),
        ExitError::SettlementWithoutPosting => {
            AppError::Validation("stored settlement does not hydrate".into())
        }
        _ => AppError::Conflict(error.to_string()),
    }
}

// ── exit interviews ──────────────────────────────────────────────────────

/// Store a PENDING interview: the row the TERMINATE path opens in its own
/// transaction, or head office's backfill for a termination that predates
/// the hook. `ON CONFLICT DO NOTHING` — the interview is one per person, and
/// a second attempt returns the row that is already there.
pub async fn insert_exit_interview(
    pool: &PgPool,
    interview: &ExitInterview,
) -> Result<bool, AppError> {
    let inserted = sqlx::query(
        "INSERT INTO exit_interview (exit_id, employee_id, place_id, state)
         VALUES ($1, $2, $3, 'PENDING')
         ON CONFLICT (employee_id) DO NOTHING",
    )
    .bind(
        Uuid::from_str(interview.id().as_str())
            .map_err(|error| corrupt("exit id", error.to_string()))?,
    )
    .bind(interview.employee().as_str())
    .bind(interview.place().as_str())
    .execute(pool)
    .await?
    .rows_affected();
    Ok(inserted == 1)
}

const EXIT_SELECT: &str = "SELECT x.exit_id, x.employee_id, x.place_id, x.state,
                x.employee_stance, x.interview_summary, x.conducted_by, x.completed_at,
                x.cancelled_by, x.cancel_reason, x.created_at,
                e.code AS employee_code,
                COALESCE(ep.full_name, e.id) AS employee_name,
                COALESCE(p.name, p.id) AS place_name
           FROM exit_interview x
           JOIN employee e ON e.id = x.employee_id
      LEFT JOIN employee_profile ep ON ep.employee_id = e.id
           JOIN org_place p ON p.id = x.place_id";

/// One interview, folded — the fold is light here (no authorization is
/// stored beside the completion; the columns are the record) but it still
/// refuses a state the machine cannot reach.
fn decode_interview(row: &sqlx::postgres::PgRow) -> Result<ExitInterview, AppError> {
    let id: Uuid = row.try_get("exit_id")?;
    let state_code: String = row.try_get("state")?;
    let stance: Option<String> = row.try_get("employee_stance")?;
    let summary: Option<String> = row.try_get("interview_summary")?;
    let conducted_by: Option<String> = row.try_get("conducted_by")?;
    let completed_at: Option<DateTime<Utc>> = row.try_get("completed_at")?;
    let cancelled_by: Option<String> = row.try_get("cancelled_by")?;
    let cancel_reason: Option<String> = row.try_get("cancel_reason")?;
    let state = match state_code.as_str() {
        "PENDING" => ExitInterviewState::Pending,
        "COMPLETED" => ExitInterviewState::Completed {
            stance: EmployeeStance::parse(
                stance
                    .as_deref()
                    .ok_or_else(|| corrupt("completed interview", "no stance".into()))?,
            )
            .ok_or_else(|| corrupt("completed interview", format!("{stance:?} is not a stance")))?,
            summary,
            conducted_by: conducted_by.unwrap_or_default(),
            completed_at: completed_at.unwrap_or(DateTime::<Utc>::MIN_UTC),
        },
        "CANCELLED" => ExitInterviewState::Cancelled {
            cancelled_by: cancelled_by.unwrap_or_default(),
            cancel_reason: cancel_reason.unwrap_or_default(),
        },
        other => {
            return Err(corrupt(
                "exit interview state",
                format!("{other:?} is not a state the machine reaches"),
            ))
        }
    };
    ExitInterview::try_new(ExitInterviewWire {
        id: ExitId::try_new(&id.to_string())
            .map_err(|error| corrupt("exit id", error.to_string()))?,
        employee: EmployeeId::try_new(&row.try_get::<String, _>("employee_id")?)
            .map_err(|error| corrupt("exit interview employee", error.to_string()))?,
        place: PlaceId::try_new(&row.try_get::<String, _>("place_id")?)
            .map_err(|error| corrupt("exit interview place", error.to_string()))?,
        state,
    })
    .map_err(exit_error)
}

async fn decode_interview_view(row: &sqlx::postgres::PgRow) -> Result<ExitInterviewView, AppError> {
    Ok(ExitInterviewView {
        exit_id: row.try_get("exit_id")?,
        employee_id: row.try_get("employee_id")?,
        employee_code: row.try_get("employee_code")?,
        employee_name: row.try_get("employee_name")?,
        place_id: row.try_get("place_id")?,
        place_name: row.try_get("place_name")?,
        state: row.try_get("state")?,
        employee_stance: row.try_get("employee_stance")?,
        interview_summary: row.try_get("interview_summary")?,
        conducted_by: row.try_get("conducted_by")?,
        completed_at: row.try_get("completed_at")?,
        cancelled_by: row.try_get("cancelled_by")?,
        cancel_reason: row.try_get("cancel_reason")?,
        created_at: row.try_get("created_at")?,
    })
}

pub async fn load_exit_interview(
    pool: &PgPool,
    exit_id: Uuid,
) -> Result<Option<ExitInterviewView>, AppError> {
    let row = sqlx::query(&format!("{EXIT_SELECT} WHERE x.exit_id = $1"))
        .bind(exit_id)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(decode_interview_view(&row).await?)),
        None => Ok(None),
    }
}

/// The Exits screen's interview list, bounded by the caller's reach the way
/// every person-attached read is: `reach_place` is the one place a bounded
/// caller may see, `None` for head office.
pub async fn list_exit_interviews(
    pool: &PgPool,
    state: Option<&str>,
    employee: Option<&str>,
    reach_place: Option<&str>,
) -> Result<Vec<ExitInterviewView>, AppError> {
    let rows = sqlx::query(&format!(
        "{EXIT_SELECT}
          WHERE ($1::text IS NULL OR x.state = $1)
            AND ($2::text IS NULL OR x.employee_id = $2)
            AND ($3::text IS NULL OR x.place_id = $3)
          ORDER BY x.created_at DESC
          LIMIT 500"
    ))
    .bind(state)
    .bind(employee)
    .bind(reach_place)
    .fetch_all(pool)
    .await?;
    let mut views = Vec::with_capacity(rows.len());
    for row in &rows {
        // The fold runs beside the view decode: a row no sequence of acts
        // could reach refuses to load rather than rendering.
        decode_interview(row)?;
        views.push(decode_interview_view(row).await?);
    }
    Ok(views)
}

/// Record the completion, guarded by the state still being PENDING. The
/// domain has already checked; the conditional UPDATE is the guard the
/// second racing completion cannot pass.
pub async fn record_completion(pool: &PgPool, interview: &ExitInterview) -> Result<(), AppError> {
    let ExitInterviewState::Completed {
        stance,
        summary,
        conducted_by,
        completed_at,
    } = interview.state()
    else {
        return Err(corrupt("exit interview", "not completed".into()));
    };
    let affected = sqlx::query(
        "UPDATE exit_interview
            SET state = 'COMPLETED', employee_stance = $2, interview_summary = $3,
                conducted_by = $4, completed_at = $5
          WHERE exit_id = $1 AND state = 'PENDING'",
    )
    .bind(
        Uuid::from_str(interview.id().as_str())
            .map_err(|error| corrupt("exit id", error.to_string()))?,
    )
    .bind(stance.code())
    .bind(summary)
    .bind(conducted_by)
    .bind(completed_at)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(
            "the interview is no longer pending".into(),
        ));
    }
    Ok(())
}

pub async fn record_interview_cancellation(
    pool: &PgPool,
    interview: &ExitInterview,
) -> Result<(), AppError> {
    let (cancelled_by, cancel_reason) = match interview.state() {
        ExitInterviewState::Cancelled {
            cancelled_by,
            cancel_reason,
        } => (cancelled_by, cancel_reason),
        other => {
            return Err(corrupt(
                "exit interview",
                format!("{} is not a cancellation", other.code()),
            ))
        }
    };
    let affected = sqlx::query(
        "UPDATE exit_interview
            SET state = 'CANCELLED', cancelled_by = $2, cancel_reason = $3
          WHERE exit_id = $1 AND state = 'PENDING'",
    )
    .bind(
        Uuid::from_str(interview.id().as_str())
            .map_err(|error| corrupt("exit id", error.to_string()))?,
    )
    .bind(cancelled_by)
    .bind(cancel_reason)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(
            "the interview is no longer pending".into(),
        ));
    }
    Ok(())
}

/// The leaver's place: the open posting, else the latest span ever. What the
/// automatic path reads and what the backfill falls back to — the interview
/// belongs to the place the person worked, never to the desk that filed the
/// paperwork.
pub async fn leaver_place(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT a.place_id
           FROM employee_assignment a
          WHERE a.employee_id = $1
          ORDER BY (a.valid_to IS NULL) DESC, a.valid_from DESC, a.id DESC
          LIMIT 1",
    )
    .bind(employee_id)
    .fetch_optional(&mut **tx)
    .await?)
}

/// The same read, outside a transaction — what the create paths use, which
/// resolve the place before their own transaction begins.
pub async fn leaver_place_of(pool: &PgPool, employee_id: &str) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT a.place_id
           FROM employee_assignment a
          WHERE a.employee_id = $1
          ORDER BY (a.valid_to IS NULL) DESC, a.valid_from DESC, a.id DESC
          LIMIT 1",
    )
    .bind(employee_id)
    .fetch_optional(pool)
    .await?)
}

/// One interview, folded — the shape the completion and cancellation
/// handlers act on.
pub async fn load_interview(
    pool: &PgPool,
    exit_id: Uuid,
) -> Result<Option<ExitInterview>, AppError> {
    let row = sqlx::query(&format!("{EXIT_SELECT} WHERE x.exit_id = $1"))
        .bind(exit_id)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(decode_interview(&row)?)),
        None => Ok(None),
    }
}

/// One statement, folded — the shape the settle and cancel handlers act on.
pub async fn load_statement(
    pool: &PgPool,
    fnf_id: Uuid,
) -> Result<Option<FullAndFinalStatement>, AppError> {
    Ok(load_full_and_final(pool, fnf_id)
        .await?
        .map(|record| record.statement))
}

// ── the Full & Final statement ───────────────────────────────────────────

/// The two live reads, outside any caller's transaction — what creation
/// freezes. One snapshot: the two reads share the transaction begun here,
/// so the statement's totals are one answer, not two.
pub async fn read_live_sources(pool: &PgPool, employee_id: &str) -> Result<(i64, i64), AppError> {
    let mut tx = pool.begin().await?;
    let totals = read_live_sources_tx(&mut tx, employee_id).await?;
    tx.commit().await?;
    Ok(totals)
}

/// The same reads inside the caller's transaction — what settle compares
/// against, so the drift refusal is measured against the same snapshot the
/// posting lands in.
pub(crate) async fn read_live_sources_tx(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
) -> Result<(i64, i64), AppError> {
    // The leaver still holds this much of the company's money: PAID and
    // PARTIALLY_SETTLED advances (the lane's own open set), minus what came
    // back through settlements. Money only requested is not money held.
    let advance_outstanding: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(a.amount_minor - COALESCE(t.expense_minor, 0)
                                            - COALESCE(t.refund_minor, 0)), 0)::bigint
           FROM advance a
      LEFT JOIN (
                SELECT advance_id,
                       SUM(amount_minor) FILTER (WHERE kind = 'EXPENSE') AS expense_minor,
                       SUM(amount_minor) FILTER (WHERE kind = 'REFUND')  AS refund_minor
                  FROM advance_settlement
              GROUP BY advance_id
            ) t ON t.advance_id = a.advance_id
          WHERE a.party_type = 'EMPLOYEE'
            AND a.employee_id = $1
            AND a.status IN ('PAID', 'PARTIALLY_SETTLED')",
    )
    .bind(employee_id)
    .fetch_one(&mut **tx)
    .await?;
    // Sanctioned and never paid: APPROVED is the claim state that owes, and
    // a PAID claim drops out by its state. There is no "partially paid" for
    // a claim — the petty-cash payout settles the whole sanction.
    let claim_payable: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(sanctioned_minor), 0)::bigint
           FROM expense_claim
          WHERE employee_id = $1 AND state = 'APPROVED'",
    )
    .bind(employee_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok((advance_outstanding, claim_payable))
}

/// Draft the statement: the header, its asset rows, and the frozen reads, in
/// one transaction. `next_document_number` is not involved — the statement
/// carries no series of its own, because it is not a document that moves
/// money; its journal does, and the journal has the poster's idempotency.
pub async fn insert_full_and_final(
    pool: &PgPool,
    statement: &FullAndFinalStatement,
) -> Result<(), AppError> {
    let fnf_id = Uuid::from_str(statement.id().as_str())
        .map_err(|error| corrupt("fnf id", error.to_string()))?;
    let history = serde_json::to_value(statement.history())
        .map_err(|error| corrupt("fnf history", error.to_string()))?;
    let mut tx = pool.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO full_and_final_statement
             (fnf_id, employee_id, place_id, transaction_on, state,
              advance_outstanding_minor, claim_payable_minor, asset_recovery_minor,
              final_pay_minor, history, created_by)
         VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, $10)
         ON CONFLICT (employee_id, transaction_on) DO NOTHING",
    )
    .bind(fnf_id)
    .bind(statement.employee().as_str())
    .bind(statement.place().as_str())
    .bind(statement.transaction_on())
    .bind(statement.advance_outstanding_minor())
    .bind(statement.claim_payable_minor())
    .bind(statement.asset_recovery_minor())
    .bind(statement.final_pay_minor())
    .bind(history)
    .bind(statement.created_by())
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!(
            "{} already has a statement dated {}; one statement per person per day",
            statement.employee(),
            statement.transaction_on()
        )));
    }
    for row in statement.assets() {
        sqlx::query(
            "INSERT INTO full_and_final_asset (row_id, fnf_id, asset_id, note, recovery_minor)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(
            Uuid::from_str(&row.row_id)
                .map_err(|error| corrupt("fnf asset row", error.to_string()))?,
        )
        .bind(fnf_id)
        .bind(row.asset_id)
        .bind(&row.note)
        .bind(row.recovery_minor)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

const FNF_SELECT: &str = "SELECT f.fnf_id, f.employee_id, f.place_id, f.transaction_on,
                f.state, f.advance_outstanding_minor, f.claim_payable_minor,
                f.asset_recovery_minor, f.final_pay_minor, f.settled_entry_id,
                f.settled_by, f.settled_at, f.cancelled_by, f.cancel_reason,
                f.history, f.created_by, f.created_at,
                e.code AS employee_code,
                COALESCE(ep.full_name, e.id) AS employee_name,
                COALESCE(p.name, p.id) AS place_name
           FROM full_and_final_statement f
           JOIN employee e ON e.id = f.employee_id
      LEFT JOIN employee_profile ep ON ep.employee_id = e.id
           JOIN org_place p ON p.id = f.place_id";

async fn asset_rows(pool: &PgPool, fnf_id: Uuid) -> Result<Vec<FnfAssetRowView>, AppError> {
    let rows = sqlx::query(
        "SELECT row_id, asset_id, note, recovery_minor
           FROM full_and_final_asset
          WHERE fnf_id = $1
          ORDER BY row_id",
    )
    .bind(fnf_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(FnfAssetRowView {
                row_id: row.try_get("row_id")?,
                asset_id: row.try_get("asset_id")?,
                note: row.try_get("note")?,
                recovery_minor: row.try_get("recovery_minor")?,
            })
        })
        .collect()
}

/// One statement, folded: the totals re-checked against the asset rows on
/// the way in, so a hand-edited total refuses to load rather than settling.
pub async fn load_full_and_final(
    pool: &PgPool,
    fnf_id: Uuid,
) -> Result<Option<FullAndFinalRecord>, AppError> {
    let row = sqlx::query(&format!("{FNF_SELECT} WHERE f.fnf_id = $1"))
        .bind(fnf_id)
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let id: Uuid = row.try_get("fnf_id")?;
    let state_code: String = row.try_get("state")?;
    let settled_entry: Option<Uuid> = row.try_get("settled_entry_id")?;
    let settled_by: Option<String> = row.try_get("settled_by")?;
    let settled_at: Option<DateTime<Utc>> = row.try_get("settled_at")?;
    let cancelled_by: Option<String> = row.try_get("cancelled_by")?;
    let cancel_reason: Option<String> = row.try_get("cancel_reason")?;
    let state = match state_code.as_str() {
        "DRAFT" => FullAndFinalState::Draft,
        "SETTLED" => FullAndFinalState::Settled {
            settled_by: settled_by.unwrap_or_default(),
            settled_at: settled_at.unwrap_or(DateTime::<Utc>::MIN_UTC),
            settled_entry: settled_entry
                .ok_or_else(|| corrupt("settled statement", "no settling entry".into()))?
                .to_string(),
        },
        "CANCELLED" => FullAndFinalState::Cancelled {
            cancelled_by: cancelled_by.unwrap_or_default(),
            cancel_reason: cancel_reason.unwrap_or_default(),
        },
        other => {
            return Err(corrupt(
                "fnf state",
                format!("{other:?} is not a state the machine reaches"),
            ))
        }
    };
    let history: Vec<FnfEvent> = row
        .try_get::<serde_json::Value, _>("history")?
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|value| {
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
                .map_err(|error| corrupt("fnf history event", error.to_string()))?;
            let action = match stored.action.as_str() {
                "CREATED" => "CREATED",
                "SETTLED" => "SETTLED",
                "CANCELLED" => "CANCELLED",
                other => {
                    return Err(corrupt(
                        "fnf history event",
                        format!("{other:?} is not an action the machine writes"),
                    ))
                }
            };
            Ok(FnfEvent {
                actor: stored.actor,
                action,
                reason: stored.reason,
                at: stored.at,
                detail: stored.detail,
            })
        })
        .collect::<Result<_, _>>()?;

    let statement = FullAndFinalStatement::try_new(FullAndFinalWire {
        id: FnfId::try_new(&id.to_string())
            .map_err(|error| corrupt("fnf id", error.to_string()))?,
        employee: EmployeeId::try_new(&row.try_get::<String, _>("employee_id")?)
            .map_err(|error| corrupt("fnf employee", error.to_string()))?,
        place: PlaceId::try_new(&row.try_get::<String, _>("place_id")?)
            .map_err(|error| corrupt("fnf place", error.to_string()))?,
        transaction_on: row.try_get("transaction_on")?,
        advance_outstanding_minor: row.try_get("advance_outstanding_minor")?,
        claim_payable_minor: row.try_get("claim_payable_minor")?,
        asset_recovery_minor: row.try_get("asset_recovery_minor")?,
        final_pay_minor: row.try_get("final_pay_minor")?,
        assets: Vec::new(),
        state,
        history: history.clone(),
        created_by: row.try_get("created_by")?,
    })
    .map_err(exit_error)?;

    Ok(Some(FullAndFinalRecord {
        created_at: row.try_get("created_at")?,
        employee_code: row.try_get("employee_code")?,
        employee_name: row.try_get("employee_name")?,
        place_name: row.try_get("place_name")?,
        settled_entry_id: settled_entry,
        history,
        assets: asset_rows(pool, id).await?,
        statement,
    }))
}

pub async fn list_full_and_final(
    pool: &PgPool,
    employee: Option<&str>,
) -> Result<Vec<FullAndFinalRecord>, AppError> {
    let rows = sqlx::query(&format!(
        "{FNF_SELECT}
          WHERE ($1::text IS NULL OR f.employee_id = $1)
          ORDER BY f.created_at DESC
          LIMIT 500"
    ))
    .bind(employee)
    .fetch_all(pool)
    .await?;
    let mut records = Vec::with_capacity(rows.len());
    for row in &rows {
        let id: Uuid = row.try_get("fnf_id")?;
        records.push(
            load_full_and_final(pool, id)
                .await?
                .ok_or_else(|| corrupt("fnf statement", format!("{id} vanished mid-list")))?,
        );
    }
    Ok(records)
}

/// Settle the statement, in one transaction.
///
/// The live reads, the drift refusal, the journal and the state move share
/// one transaction, in that order: a source that moved is named and nothing
/// posts, and a state move that loses its race takes the posting back with
/// it. The journal is `('FULL_AND_FINAL', fnf_id, 'MAIN')`; the person-side
/// line posts at the leaver's place, the cash side at head office, and the
/// poster adds whatever affiliate legs the two sites need — see
/// `domain::exit`'s module doc for the placement and why.
///
/// The cash side is `petty_cash` at head office (found by its kind) — the same
/// operator-mapped meaning the imprest spends from, and the cash family is
/// mapped through the Account Map, never by a migration. Until Finance has
/// pointed HO's petty cash somewhere, settle refuses by name naming the
/// meaning and the site, which is the machinery's refusal working and not a
/// gap in this rule.
pub async fn settle_full_and_final(
    pool: &PgPool,
    statement: &mut FullAndFinalStatement,
    authorization: Authorization,
) -> Result<(Uuid, String), AppError> {
    let fnf_id = Uuid::from_str(statement.id().as_str())
        .map_err(|error| corrupt("fnf id", error.to_string()))?;

    let mut tx = pool.begin().await?;

    // The reads first, inside the transaction, so the drift comparison is
    // against the same snapshot the posting lands in.
    let (live_advance, live_claim) =
        read_live_sources_tx(&mut tx, statement.employee().as_str()).await?;
    let posting = statement
        .settle(live_advance, live_claim, authorization.clone())
        .map_err(exit_error)?;

    let head_office = crate::cloud::postgres::sites::head_office_site_id(&mut *tx).await?;
    let site = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(p.site_id, $2) FROM org_place p WHERE p.id = $1",
    )
    .bind(statement.place().as_str())
    .bind(&head_office)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no place {}", statement.place())))?;

    // The person-side line and the cash side. Positive net: the company
    // still pays the leaver, so the payable is credited at the leaver's
    // place and head office's cash is debited. Negative: the leaver owes,
    // and the mirror posts it.
    let net = posting.net_minor;
    let (payable_line, cash_line) = if net > 0 {
        (
            poster::PostingLine::credit("employee_claim_payable", &site, net)
                .for_employee(statement.employee().as_str()),
            poster::PostingLine::debit("petty_cash", &head_office, net),
        )
    } else {
        (
            poster::PostingLine::debit("employee_claim_payable", &site, -net)
                .for_employee(statement.employee().as_str()),
            poster::PostingLine::credit("petty_cash", &head_office, -net),
        )
    };
    let posted = poster::post(
        &mut tx,
        &PostingIntent {
            posting_date: statement.transaction_on(),
            source_kind: "FULL_AND_FINAL".into(),
            source_id: Some(fnf_id.to_string()),
            rule_version: "full_and_final/1".into(),
            currency: "IDR".into(),
            memo: Some(format!("full & final — {}", statement.employee())),
            lines: vec![payable_line, cash_line],
        },
        None,
        authorization.actor().as_str(),
    )
    .await?;

    statement
        .mark_settled(posted.entry_id.to_string(), &posted.entry_number)
        .map_err(exit_error)?;
    let history = serde_json::to_value(statement.history())
        .map_err(|error| corrupt("fnf history", error.to_string()))?;
    let FullAndFinalState::Settled {
        settled_by,
        settled_at,
        ..
    } = statement.state()
    else {
        return Err(corrupt("settled statement", "not settled".into()));
    };
    let affected = sqlx::query(
        "UPDATE full_and_final_statement
            SET state = 'SETTLED', settled_entry_id = $2, settled_by = $3, settled_at = $4,
                history = $5
          WHERE fnf_id = $1 AND state = 'DRAFT'",
    )
    .bind(fnf_id)
    .bind(posted.entry_id)
    .bind(settled_by)
    .bind(settled_at)
    .bind(history)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(
            "the statement is no longer a draft waiting to be settled".into(),
        ));
    }

    tx.commit().await?;
    Ok((posted.entry_id, posted.entry_number))
}

/// Cancel a draft. Nothing posts; the trail keeps the reason.
pub async fn cancel_full_and_final(
    pool: &PgPool,
    statement: &mut FullAndFinalStatement,
    authorization: Authorization,
) -> Result<(), AppError> {
    statement
        .cancel(authorization.reason().as_str(), authorization.clone())
        .map_err(exit_error)?;
    let history = serde_json::to_value(statement.history())
        .map_err(|error| corrupt("fnf history", error.to_string()))?;
    let FullAndFinalState::Cancelled {
        cancelled_by,
        cancel_reason,
    } = statement.state()
    else {
        return Err(corrupt("cancelled statement", "not cancelled".into()));
    };
    let affected = sqlx::query(
        "UPDATE full_and_final_statement
            SET state = 'CANCELLED', cancelled_by = $2, cancel_reason = $3, history = $4
          WHERE fnf_id = $1 AND state = 'DRAFT'",
    )
    .bind(
        Uuid::from_str(statement.id().as_str())
            .map_err(|error| corrupt("fnf id", error.to_string()))?,
    )
    .bind(cancelled_by)
    .bind(cancel_reason)
    .bind(history)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(
            "the statement is no longer a draft".into(),
        ));
    }
    Ok(())
}

// ── the views ────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExitInterviewView {
    pub exit_id: Uuid,
    pub employee_id: String,
    pub employee_code: Option<String>,
    pub employee_name: Option<String>,
    pub place_id: String,
    pub place_name: Option<String>,
    pub state: String,
    pub employee_stance: Option<String>,
    pub interview_summary: Option<String>,
    pub conducted_by: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cancelled_by: Option<String>,
    pub cancel_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FnfAssetRowView {
    pub row_id: Uuid,
    pub asset_id: Uuid,
    pub note: String,
    pub recovery_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FnfEventView {
    pub actor: String,
    pub action: String,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
    pub detail: Option<String>,
}

pub struct FullAndFinalRecord {
    pub statement: FullAndFinalStatement,
    pub history: Vec<FnfEvent>,
    pub assets: Vec<FnfAssetRowView>,
    pub created_at: DateTime<Utc>,
    pub employee_code: Option<String>,
    pub employee_name: Option<String>,
    pub place_name: Option<String>,
    pub settled_entry_id: Option<Uuid>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FnfView {
    pub fnf_id: Uuid,
    pub employee_id: String,
    pub employee_code: Option<String>,
    pub employee_name: Option<String>,
    pub place_id: String,
    pub place_name: Option<String>,
    pub transaction_on: NaiveDate,
    pub state: String,
    pub advance_outstanding_minor: i64,
    pub claim_payable_minor: i64,
    pub asset_recovery_minor: i64,
    pub final_pay_minor: i64,
    /// The net the settlement posts: claims and final pay, less advances
    /// and assets. Negative means the leaver owes.
    pub net_payable_minor: i64,
    pub settled_entry_id: Option<Uuid>,
    pub settled_by: Option<String>,
    pub settled_at: Option<DateTime<Utc>>,
    pub cancelled_by: Option<String>,
    pub cancel_reason: Option<String>,
    pub created_by: String,
    pub assets: Vec<FnfAssetRowView>,
    pub history: Vec<FnfEventView>,
    pub created_at: DateTime<Utc>,
}

pub fn fnf_view(record: &FullAndFinalRecord) -> Result<FnfView, AppError> {
    let statement = &record.statement;
    let (settled_by, settled_at) = match statement.state() {
        FullAndFinalState::Settled {
            settled_by,
            settled_at,
            ..
        } => (Some(settled_by.clone()), Some(*settled_at)),
        _ => (None, None),
    };
    let parse = |what: &str, raw: &str| -> Result<Uuid, AppError> {
        Uuid::from_str(raw).map_err(|error| corrupt(what, error.to_string()))
    };
    Ok(FnfView {
        fnf_id: parse("fnf id", statement.id().as_str())?,
        employee_id: statement.employee().to_string(),
        employee_code: record.employee_code.clone(),
        employee_name: record.employee_name.clone(),
        place_id: statement.place().to_string(),
        place_name: record.place_name.clone(),
        transaction_on: statement.transaction_on(),
        state: statement.state().code().to_owned(),
        advance_outstanding_minor: statement.advance_outstanding_minor(),
        claim_payable_minor: statement.claim_payable_minor(),
        asset_recovery_minor: statement.asset_recovery_minor(),
        final_pay_minor: statement.final_pay_minor(),
        net_payable_minor: statement.net_payable_minor(),
        settled_entry_id: record.settled_entry_id,
        settled_by,
        settled_at,
        cancelled_by: match statement.state() {
            FullAndFinalState::Cancelled { cancelled_by, .. } => Some(cancelled_by.clone()),
            _ => None,
        },
        cancel_reason: match statement.state() {
            FullAndFinalState::Cancelled { cancel_reason, .. } => Some(cancel_reason.clone()),
            _ => None,
        },
        created_by: statement.created_by().to_owned(),
        assets: record.assets.clone(),
        history: record
            .history
            .iter()
            .map(|event| FnfEventView {
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
