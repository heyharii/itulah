//! Leave, as rows.
//!
//! # The one write that must not come apart
//!
//! [`decide_request`] stores an approval and the ledger entry it deducted in
//! **one transaction**. Not two statements that usually run together: a crash
//! between them leaves a request saying APPROVED against a balance that never
//! moved, and nobody notices because both rows look fine on their own — the
//! employee takes the leave, the balance still shows it available, so they take
//! it again.
//!
//! The rule is held three times over. The domain will not produce an approval
//! without its entry, this transaction writes both or neither, and 0101's
//! `leave_request_deduction_only_when_approved` refuses the halfway row. The
//! third exists because the first two are code.
//!
//! # Why the catalogue is loaded before anything else
//!
//! Nothing else can be decoded without it. A ledger and a request are both
//! meaningless until you know whether the kind they name draws on a balance at
//! all — that is the pairing the request's constructor checks, and it needs the
//! [`LeaveType`] in hand to check it.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    Authorization, EmployeeId, LeaveBacking, LeaveDays, LeaveError, LeaveEvent, LeaveLedger,
    LeavePayment, LeavePolicy, LeaveRequest, LeaveRequestId, LeaveRequestState, LeaveRequestWire,
    LeaveType, LeaveTypeCatalogue, LeaveTypeCode, LedgerEntry, PolicyTimeline, UnitId,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};

/// A stored row that cannot be true. See `postgres::employment` for why this is
/// not a validation error.
fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The rows disagree with the rules they encode."
    ))
}

/// Turn a domain refusal into the right HTTP answer.
///
/// An insufficient balance is a **conflict**, not a bad request: the days asked
/// for are a well-formed number and the ledger simply does not have them.
/// Telling the caller to fix their request would send them editing a date that
/// is correct.
pub fn leave_error(error: LeaveError) -> AppError {
    if error.is_forbidden() {
        AppError::Forbidden(error.to_string())
    } else if error.is_conflict() {
        AppError::Conflict(error.to_string())
    } else {
        AppError::Validation(error.to_string())
    }
}

// ── the catalogue ────────────────────────────────────────────────────────

fn decode_type(row: &sqlx::postgres::PgRow) -> Result<LeaveType, AppError> {
    let code: String = row.try_get("code")?;
    let name: String = row.try_get("name")?;
    let backing_code: String = row.try_get("backing")?;
    let max_centidays: Option<i32> = row.try_get("max_centidays")?;
    let payment_code: String = row.try_get("payment")?;
    let requires_evidence: bool = row.try_get("requires_evidence")?;

    let backing = match (backing_code.as_str(), max_centidays) {
        ("BALANCE", None) => LeaveBacking::Balance,
        ("AS_CERTIFIED", None) => LeaveBacking::AsCertified,
        ("PER_OCCURRENCE", Some(centidays)) => LeaveBacking::PerOccurrence {
            max_days: LeaveDays::from_centidays(centidays)
                .map_err(|error| corrupt("leave allowance", error.to_string()))?,
        },
        // The schema refuses these pairings too; reaching one here means the
        // constraint was dropped or the row predates it.
        (kind, bound) => {
            return Err(corrupt(
                "leave backing",
                format!("{kind} with bound {bound:?}"),
            ));
        }
    };
    let payment = LeavePayment::parse(&payment_code)
        .ok_or_else(|| corrupt("leave payment", payment_code.clone()))?;

    LeaveType::try_new(
        LeaveTypeCode::try_new(&code)
            .map_err(|error| corrupt("leave type code", error.to_string()))?,
        &name,
        backing,
        payment,
        requires_evidence,
    )
    .map_err(|error| corrupt("leave type", error.to_string()))
}

/// Every kind the operator has defined.
pub async fn load_catalogue(pool: &PgPool) -> Result<LeaveTypeCatalogue, AppError> {
    let rows = sqlx::query(
        "SELECT code, name, backing, max_centidays, payment, requires_evidence
           FROM leave_type ORDER BY code",
    )
    .fetch_all(pool)
    .await?;
    let types = rows
        .iter()
        .map(decode_type)
        .collect::<Result<Vec<_>, AppError>>()?;
    LeaveTypeCatalogue::try_new(types)
        .map_err(|error| corrupt("leave catalogue", error.to_string()))
}

/// Ratify a kind of leave. Refuses a code that already exists rather than
/// replacing it: redefining a kind changes what every request already filed
/// against it meant.
pub async fn define_type(pool: &PgPool, leave_type: &LeaveType) -> Result<(), AppError> {
    let inserted = sqlx::query(
        "INSERT INTO leave_type
             (code, name, backing, max_centidays, payment, requires_evidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO NOTHING",
    )
    .bind(leave_type.code().as_str())
    .bind(leave_type.name())
    .bind(leave_type.backing().code())
    .bind(
        leave_type
            .max_days_per_occurrence()
            .map(LeaveDays::centidays),
    )
    .bind(leave_type.payment().code())
    .bind(leave_type.requires_evidence())
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{} is already defined",
            leave_type.code()
        )));
    }
    Ok(())
}

// ── the policy timeline ──────────────────────────────────────────────────

/// Every ratified generation, oldest first.
///
/// An empty timeline is a real answer and a refusable one: a balance folded
/// under no ratified policy is a number with no author, and the domain says so
/// rather than picking a default.
pub async fn load_policies(pool: &PgPool) -> Result<PolicyTimeline, AppError> {
    let rows = sqlx::query("SELECT policy FROM leave_policy ORDER BY effective_from")
        .fetch_all(pool)
        .await?;
    let mut timeline = PolicyTimeline::new();
    for row in &rows {
        let value: serde_json::Value = row.try_get("policy")?;
        let policy: LeavePolicy = serde_json::from_value(value)
            .map_err(|error| corrupt("leave policy", error.to_string()))?;
        timeline
            .install(policy)
            .map_err(|error| corrupt("leave policy timeline", error.to_string()))?;
    }
    Ok(timeline)
}

/// Install a generation.
pub async fn install_policy(pool: &PgPool, policy: &LeavePolicy) -> Result<(), AppError> {
    let value = serde_json::to_value(policy)?;
    sqlx::query(
        "INSERT INTO leave_policy (version, effective_from, annual_centidays, policy)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(i32::try_from(policy.version()).unwrap_or(i32::MAX))
    .bind(policy.effective_from())
    .bind(policy.annual_entitlement().centidays())
    .bind(&value)
    .execute(pool)
    .await
    .map_err(|error| {
        // The unique key on `effective_from` is the schema's copy of the rule
        // the domain states: two generations effective on one day would make
        // "which rules applied" depend on row order.
        if is_unique_violation(&error) {
            AppError::Conflict(format!(
                "a leave policy already starts on {}",
                policy.effective_from()
            ))
        } else {
            AppError::from(error)
        }
    })?;
    Ok(())
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(sqlx::error::DatabaseError::code)
        .is_some_and(|code| code == "23505")
}

// ── ledgers ──────────────────────────────────────────────────────────────

fn decode_entry(row: &sqlx::postgres::PgRow) -> Result<LedgerEntry, AppError> {
    let id: String = row.try_get("id")?;
    let on: NaiveDate = row.try_get("on_date")?;
    let event_code: String = row.try_get("event")?;
    let centidays: i32 = row.try_get("centidays")?;
    let by: String = row.try_get("by_actor")?;
    let expires_on: Option<NaiveDate> = row.try_get("expires_on")?;

    let event =
        LeaveEvent::parse(&event_code).ok_or_else(|| corrupt("leave event", event_code.clone()))?;
    let amount = LeaveDays::from_centidays(centidays)
        .map_err(|error| corrupt("leave amount", error.to_string()))?;
    let entry = LedgerEntry::try_new(id, on, event, amount, by)
        .map_err(|error| corrupt("leave ledger entry", error.to_string()))?;
    Ok(match expires_on {
        Some(date) => entry.expiring_on(date),
        None => entry,
    })
}

/// One person's ledger for one kind of leave.
///
/// Read in exactly the order the fold needs — the index in 0101 is that order —
/// so `LeaveLedger::append` sees the entries forward and its "never backwards"
/// rule holds on the way in without a sort.
pub async fn load_ledger(
    pool: &PgPool,
    employee_id: &str,
    leave_type: &LeaveTypeCode,
) -> Result<LeaveLedger, AppError> {
    let rows = sqlx::query(
        "SELECT id, on_date, event, centidays, by_actor, expires_on
           FROM leave_ledger_entry
          WHERE employee_id = $1 AND leave_type = $2
          ORDER BY on_date, id",
    )
    .bind(employee_id)
    .bind(leave_type.as_str())
    .fetch_all(pool)
    .await?;

    let mut ledger = LeaveLedger::new();
    for row in &rows {
        ledger
            .append(decode_entry(row)?)
            .map_err(|error| corrupt("leave ledger", error.to_string()))?;
    }
    Ok(ledger)
}

async fn write_entry(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    leave_type: &LeaveTypeCode,
    entry: &LedgerEntry,
) -> Result<(), AppError> {
    // Append-only: `DO NOTHING` rather than `DO UPDATE`, because nothing in this
    // module has a path that changes an entry, and a replayed write of the same
    // id is the same fact rather than a new one.
    sqlx::query(
        "INSERT INTO leave_ledger_entry
             (id, employee_id, leave_type, on_date, event, centidays, by_actor, expires_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(entry.id())
    .bind(employee_id)
    .bind(leave_type.as_str())
    .bind(entry.on())
    .bind(entry.event().code())
    .bind(entry.amount().centidays())
    .bind(entry.by())
    .bind(entry.expires_on())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Record a movement that no approval produced — an allocation, an accrual, a
/// named correction.
///
/// There is deliberately no route or function here that appends a `USAGE`
/// entry. The only way days leave a balance is an approval, which mints the
/// entry and stores it in the same transaction; a separate "adjust the balance"
/// path that could take days off without a request behind it would put the
/// halfway state back within reach of one careless caller.
pub async fn append_movement(
    pool: &PgPool,
    employee_id: &str,
    leave_type: &LeaveType,
    entry: &LedgerEntry,
) -> Result<(), AppError> {
    if entry.event() == LeaveEvent::Usage {
        return Err(AppError::Validation(
            "days leave a balance only through an approved request".to_owned(),
        ));
    }
    leave_type
        .require_balance_backed()
        .map_err(|error| leave_error(error))?;
    let mut tx = pool.begin().await?;
    write_entry(&mut tx, employee_id, leave_type.code(), entry).await?;
    tx.commit().await?;
    Ok(())
}

/// What one person has left, per kind, on a date.
///
/// Only balance-backed kinds appear. A kind that draws on nothing is absent
/// rather than reported as zero — see `domain::leave::kinds`.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LeaveBalanceRow {
    pub leave_type: String,
    pub name: String,
    /// Hundredths of a day, which is what the ledger holds. The browser divides
    /// for display; nothing rounds on the way out.
    pub centidays: i32,
    /// Days pending decision, which is not deducted yet and is the number
    /// somebody actually plans around.
    pub pending_centidays: i32,
}

pub async fn balances_of(
    pool: &PgPool,
    employee_id: &str,
    catalogue: &LeaveTypeCatalogue,
    on: NaiveDate,
) -> Result<Vec<LeaveBalanceRow>, AppError> {
    let mut rows = Vec::new();
    for leave_type in catalogue.balance_backed() {
        let ledger = load_ledger(pool, employee_id, leave_type.code()).await?;
        let balance = ledger
            .balance_on(on)
            .map_err(|error| corrupt("leave balance", error.to_string()))?;
        let pending: Option<i64> = sqlx::query_scalar(
            "SELECT sum(jsonb_array_length(chargeable))
               FROM leave_request
              WHERE employee_id = $1 AND leave_type = $2 AND state = 'PENDING'",
        )
        .bind(employee_id)
        .bind(leave_type.code().as_str())
        .fetch_one(pool)
        .await?;
        rows.push(LeaveBalanceRow {
            leave_type: leave_type.code().to_string(),
            name: leave_type.name().to_owned(),
            centidays: balance.centidays(),
            pending_centidays: i32::try_from(pending.unwrap_or(0).saturating_mul(100))
                .unwrap_or(i32::MAX),
        });
    }
    Ok(rows)
}

// ── requests ─────────────────────────────────────────────────────────────

/// One request, with the two timestamps a screen shows.
pub struct LeaveRequestRecord {
    pub request: LeaveRequest,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn decode_request(
    row: &sqlx::postgres::PgRow,
    catalogue: &LeaveTypeCatalogue,
) -> Result<LeaveRequestRecord, AppError> {
    let leave_type_code: String = row.try_get("leave_type")?;
    let code = LeaveTypeCode::try_new(&leave_type_code)
        .map_err(|error| corrupt("leave type code", error.to_string()))?;
    // The catalogue first: the pairing rule cannot be checked without knowing
    // whether the kind draws on a balance.
    let leave_type = catalogue
        .require(&code)
        .map_err(|error| corrupt("leave type", error.to_string()))?;

    let state_code: String = row.try_get("state")?;
    let decision: Option<serde_json::Value> = row.try_get("decision")?;
    let ledger_entry_id: Option<String> = row.try_get("ledger_entry_id")?;
    let decision = decision
        .map(serde_json::from_value::<Authorization>)
        .transpose()
        .map_err(|error| corrupt("leave decision", error.to_string()))?;

    // The inverse of what is written. Anything else is a row whose state and
    // its evidence disagree, which the schema also refuses.
    let state = match (state_code.as_str(), decision, ledger_entry_id) {
        ("PENDING", None, None) => LeaveRequestState::Pending,
        ("APPROVED", Some(decision), ledger_entry) => LeaveRequestState::Approved {
            decision,
            ledger_entry,
        },
        ("REJECTED", Some(decision), None) => LeaveRequestState::Rejected { decision },
        ("WITHDRAWN", Some(decision), None) => LeaveRequestState::Withdrawn { decision },
        (state, _, _) => {
            return Err(corrupt(
                "leave request state",
                format!("{state} does not match its decision and deduction columns"),
            ));
        }
    };

    let wire = LeaveRequestWire {
        id: LeaveRequestId::try_new(&row.try_get::<String, _>("id")?)
            .map_err(|error| corrupt("leave request id", error.to_string()))?,
        employee: EmployeeId::try_new(&row.try_get::<String, _>("employee_id")?)
            .map_err(|error| corrupt("employee id", error.to_string()))?,
        unit: UnitId::try_new(&row.try_get::<String, _>("unit_id")?)
            .map_err(|error| corrupt("unit id", error.to_string()))?,
        leave_type: code,
        period: serde_json::from_value(serde_json::json!({
            "from": row.try_get::<NaiveDate, _>("from_date")?,
            "to": row.try_get::<NaiveDate, _>("to_date")?,
        }))
        .map_err(|error| corrupt("leave period", error.to_string()))?,
        chargeable: serde_json::from_value(row.try_get::<serde_json::Value, _>("chargeable")?)
            .map_err(|error| corrupt("chargeable days", error.to_string()))?,
        evidence: row.try_get("evidence")?,
        requested: serde_json::from_value(row.try_get::<serde_json::Value, _>("requested")?)
            .map_err(|error| corrupt("leave authority", error.to_string()))?,
        state,
    };

    Ok(LeaveRequestRecord {
        // This is the line that keeps an approval with nothing deducted from
        // becoming leave somebody took twice.
        request: LeaveRequest::try_new(wire, leave_type)
            .map_err(|error| corrupt("leave request", error.to_string()))?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

const REQUEST_COLUMNS: &str = "id, employee_id, unit_id, leave_type, from_date, to_date, \
                               chargeable, evidence, requested, state, decision, \
                               ledger_entry_id, created_at, updated_at";

pub async fn load_request(
    pool: &PgPool,
    id: &str,
    catalogue: &LeaveTypeCatalogue,
) -> Result<Option<LeaveRequestRecord>, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {REQUEST_COLUMNS} FROM leave_request WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref()
        .map(|row| decode_request(row, catalogue))
        .transpose()
}

pub async fn requests_of(
    pool: &PgPool,
    employee_id: &str,
    catalogue: &LeaveTypeCatalogue,
) -> Result<Vec<LeaveRequestRecord>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {REQUEST_COLUMNS} FROM leave_request
          WHERE employee_id = $1 ORDER BY from_date DESC, id"
    ))
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| decode_request(row, catalogue))
        .collect()
}

/// The manager's queue: what is waiting on a decision.
///
/// `unit_id` is `None` for head office, which reads every place's. The partial
/// index in 0101 is exactly this query.
pub async fn pending_requests(
    pool: &PgPool,
    unit_id: Option<&str>,
    catalogue: &LeaveTypeCatalogue,
) -> Result<Vec<LeaveRequestRecord>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {REQUEST_COLUMNS} FROM leave_request
          WHERE state = 'PENDING' AND ($1::text IS NULL OR unit_id = $1)
          ORDER BY from_date, id"
    ))
    .bind(unit_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| decode_request(row, catalogue))
        .collect()
}

fn split_state(
    state: &LeaveRequestState,
) -> Result<(&'static str, Option<serde_json::Value>, Option<String>), AppError> {
    Ok(match state {
        LeaveRequestState::Pending => ("PENDING", None, None),
        LeaveRequestState::Approved {
            decision,
            ledger_entry,
        } => (
            "APPROVED",
            Some(serde_json::to_value(decision)?),
            ledger_entry.clone(),
        ),
        LeaveRequestState::Rejected { decision } => {
            ("REJECTED", Some(serde_json::to_value(decision)?), None)
        }
        LeaveRequestState::Withdrawn { decision } => {
            ("WITHDRAWN", Some(serde_json::to_value(decision)?), None)
        }
    })
}

/// File a pending request.
pub async fn file_request(pool: &PgPool, request: &LeaveRequest) -> Result<(), AppError> {
    let (state, decision, ledger_entry) = split_state(request.state())?;
    let inserted = sqlx::query(
        "INSERT INTO leave_request
             (id, employee_id, unit_id, leave_type, from_date, to_date, chargeable,
              evidence, requested, state, decision, ledger_entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(request.id().as_str())
    .bind(request.employee().as_str())
    .bind(request.unit().as_str())
    .bind(request.leave_type().as_str())
    .bind(request.period().from())
    .bind(request.period().to())
    .bind(serde_json::to_value(request.chargeable())?)
    .bind(request.evidence())
    .bind(serde_json::to_value(request.requested())?)
    .bind(state)
    .bind(&decision)
    .bind(&ledger_entry)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "a leave request {} already exists",
            request.id()
        )));
    }
    Ok(())
}

/// Store a decision, and the deduction it made, together.
///
/// **The transaction is the point.** The entry is written first and the request
/// second, inside one `BEGIN`, so there is no instant at which a request says
/// APPROVED and the ledger has not moved — and the foreign key from
/// `ledger_entry_id` means the database refuses the other order anyway.
pub async fn decide_request(
    pool: &PgPool,
    request: &LeaveRequest,
    entry: Option<&LedgerEntry>,
) -> Result<(), AppError> {
    let (state, decision, ledger_entry) = split_state(request.state())?;
    let mut tx = pool.begin().await?;
    if let Some(entry) = entry {
        write_entry(
            &mut tx,
            request.employee().as_str(),
            request.leave_type(),
            entry,
        )
        .await?;
    }
    sqlx::query(
        "UPDATE leave_request
            SET state = $2, decision = $3, ledger_entry_id = $4, updated_at = now()
          WHERE id = $1 AND state = 'PENDING'",
    )
    .bind(request.id().as_str())
    .bind(state)
    .bind(&decision)
    .bind(&ledger_entry)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}
