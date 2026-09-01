//! Row-level persistence for employment.
//!
//! # The guard is on the way in, not on the way out
//!
//! `employee.status` is written beside `history` and the two cannot disagree,
//! because the only thing that produces a row here is an [`Employee`], and an
//! `Employee` cannot exist with a status its history does not fold to. Coming
//! back, every read decodes through `Employee::try_new` — so a row edited by
//! hand in `psql` fails to hydrate rather than quietly becoming the answer.
//!
//! The same holds for [`Profile`] over its amendments and [`ContractTimeline`]
//! over its ordering.
//!
//! # Why a timeline is rewritten rather than appended to
//!
//! Assignments and contracts are validated as a *whole*: a span may not overlap
//! any other, and a contract may not follow a permanent one. The domain type is
//! what enforces that, so a write loads the timeline, pushes into it — which is
//! where the refusal happens — and writes the result back inside one
//! transaction. Inserting a single row and hoping would move the rule into the
//! database's constraints, which can express "one open span" but not "no
//! contract after a PKWTT".
//!
//! Adapted from the reference backend's `cloud-employee::relational`, minus its
//! in-memory store: that one loads every employee at boot and writes the whole
//! set back on change, which is not how anything else here talks to Postgres.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    Address, AssignmentSpan, AssignmentTimeline, Authorization, Contact, Contract, ContractKind,
    ContractTimeline, Employee, EmployeeCode, EmployeeId, EmploymentStatus, FullName, Grade, Nik,
    PlaceId, Position, Profile,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// A stored row that cannot be true.
///
/// Deliberately not a validation error: nothing the caller sent is wrong. The
/// database is holding a record no sequence of legal operations could have
/// produced, and the only honest thing to do is refuse to serve it.
fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The row disagrees with its own history."
    ))
}

/// One employee, as fully as the database holds them.
pub struct EmployeeRecord {
    pub employee: Employee,
    pub assignments: AssignmentTimeline,
    pub profile: Option<Profile>,
    pub contracts: ContractTimeline,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A row of the workforce list.
///
/// Deliberately not an [`EmployeeRecord`]: the list is read far more often than
/// any one person is opened, and it must not carry personal data. "Who works
/// here" and "what is this person's NIK" are different questions with different
/// audiences — see `domain::employment::audit`.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeSummary {
    pub employee_id: String,
    pub employee_code: String,
    pub status: String,
    /// Present only when a profile has been enrolled. The list shows a name
    /// because a list of codes is unusable; it shows nothing else from the
    /// profile.
    pub full_name: Option<String>,
    /// The open posting, if there is one.
    pub place_id: Option<String>,
    pub place_name: Option<String>,
    /// The most recent contract, whether or not it is still in force.
    pub contract_kind: Option<String>,
    pub contract_ends_on: Option<NaiveDate>,
    pub position: Option<String>,
    /// The login this record is bound to, when one is.
    pub username: Option<String>,
}

/// A fixed term running out, for the report that made contracts a table.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExpiringContract {
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub position: String,
    pub place_id: Option<String>,
    pub ends_on: NaiveDate,
    /// Days from the date asked about to the last day of the term. Negative
    /// means it has already ended and nobody noticed, which is exactly the row
    /// this report exists to surface.
    pub days_remaining: i64,
}

// ── reading ──────────────────────────────────────────────────────────────

fn decode_employee(row: &sqlx::postgres::PgRow) -> Result<Employee, AppError> {
    let id: String = row.try_get("id")?;
    let code: String = row.try_get("code")?;
    let status_raw: String = row.try_get("status")?;
    let history: serde_json::Value = row.try_get("history")?;
    let code_history: serde_json::Value = row.try_get("code_history")?;

    let status = EmploymentStatus::parse(&status_raw)
        .ok_or_else(|| corrupt("employment status", status_raw.clone()))?;

    // This call is the whole point of the module: it re-runs the state machine
    // over `history` and refuses a status the events do not produce.
    Employee::try_new(
        EmployeeId::try_new(&id).map_err(|error| corrupt("employee id", error.to_string()))?,
        EmployeeCode::try_new(&code)
            .map_err(|error| corrupt("employee code", error.to_string()))?,
        status,
        serde_json::from_value(history)
            .map_err(|error| corrupt("employment history", error.to_string()))?,
        serde_json::from_value(code_history)
            .map_err(|error| corrupt("code history", error.to_string()))?,
    )
    .map_err(|error| corrupt("employee", error.to_string()))
}

async fn load_assignments(
    pool: &PgPool,
    employee_id: &str,
) -> Result<AssignmentTimeline, AppError> {
    let rows = sqlx::query(
        "SELECT place_id, valid_from, valid_to, authorized
           FROM employee_assignment
          WHERE employee_id = $1
          ORDER BY valid_from, id",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;

    let mut timeline = AssignmentTimeline::new();
    for row in &rows {
        let place_id: String = row.try_get("place_id")?;
        let authorized: serde_json::Value = row.try_get("authorized")?;
        let span = AssignmentSpan::try_new(
            PlaceId::try_new(&place_id).map_err(|error| corrupt("place id", error.to_string()))?,
            row.try_get::<NaiveDate, _>("valid_from")?,
            row.try_get::<Option<NaiveDate>, _>("valid_to")?,
            serde_json::from_value::<Authorization>(authorized)
                .map_err(|error| corrupt("assignment authorization", error.to_string()))?,
        )
        .map_err(|error| corrupt("assignment", error.to_string()))?;
        timeline
            .push(span)
            .map_err(|error| corrupt("assignment timeline", error.to_string()))?;
    }
    Ok(timeline)
}

async fn load_profile(pool: &PgPool, employee_id: &str) -> Result<Option<Profile>, AppError> {
    let Some(row) = sqlx::query(
        "SELECT full_name, nik, birth_date, address, phone, email, amendments
           FROM employee_profile WHERE employee_id = $1",
    )
    .bind(employee_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };

    let phone: Option<String> = row.try_get("phone")?;
    let email: Option<String> = row.try_get("email")?;
    let contact = |raw: String, what: &'static str| -> Result<Contact, AppError> {
        Contact::try_new(&raw).map_err(|error| corrupt(what, error.to_string()))
    };
    let amendments: serde_json::Value = row.try_get("amendments")?;

    // Replays the amendment chain and re-checks the authority gate on every
    // entry: a value edited in place, or an amendment nobody held the grant to
    // make, fails here rather than becoming the record.
    let profile = Profile::try_new(
        FullName::try_new(&row.try_get::<String, _>("full_name")?)
            .map_err(|error| corrupt("name", error.to_string()))?,
        Nik::try_new(&row.try_get::<String, _>("nik")?)
            .map_err(|error| corrupt("nik", error.to_string()))?,
        row.try_get::<NaiveDate, _>("birth_date")?,
        Address::try_new(&row.try_get::<String, _>("address")?)
            .map_err(|error| corrupt("address", error.to_string()))?,
        phone.map(|value| contact(value, "phone")).transpose()?,
        email.map(|value| contact(value, "email")).transpose()?,
        serde_json::from_value(amendments)
            .map_err(|error| corrupt("profile amendments", error.to_string()))?,
    )
    .map_err(|error| corrupt("profile", error.to_string()))?;
    Ok(Some(profile))
}

/// Rebuild the contract kind from the two columns that carry it.
///
/// The pairing the CHECK constraint also enforces. Both, because a constraint
/// added later cannot fix rows written before it.
fn decode_contract_kind(kind: &str, ends_on: Option<NaiveDate>) -> Result<ContractKind, AppError> {
    match (kind, ends_on) {
        ("PKWT", Some(ends_on)) => Ok(ContractKind::Pkwt { ends_on }),
        ("PKWTT", None) => Ok(ContractKind::Pkwtt),
        (kind, _) => Err(corrupt(
            "contract kind",
            format!("{kind} does not match its end date"),
        )),
    }
}

async fn load_contracts(pool: &PgPool, employee_id: &str) -> Result<ContractTimeline, AppError> {
    let rows = sqlx::query(
        "SELECT kind, starts_on, ends_on, position, grade, authorized
           FROM employee_contract
          WHERE employee_id = $1
          ORDER BY starts_on, id",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;

    let mut timeline = ContractTimeline::new();
    for row in &rows {
        let kind_raw: String = row.try_get("kind")?;
        let ends_on: Option<NaiveDate> = row.try_get("ends_on")?;
        let authorized: serde_json::Value = row.try_get("authorized")?;
        let contract = Contract::try_new(
            decode_contract_kind(&kind_raw, ends_on)?,
            row.try_get::<NaiveDate, _>("starts_on")?,
            Position::try_new(&row.try_get::<String, _>("position")?)
                .map_err(|error| corrupt("position", error.to_string()))?,
            Grade::try_new(&row.try_get::<String, _>("grade")?)
                .map_err(|error| corrupt("grade", error.to_string()))?,
            serde_json::from_value(authorized)
                .map_err(|error| corrupt("contract authorization", error.to_string()))?,
        )
        .map_err(|error| corrupt("contract", error.to_string()))?;
        // Appending replays the ordering and overlap rules, so a stored pair
        // that overlaps — or a term following a permanent contract — fails to
        // hydrate rather than being loaded and believed.
        timeline
            .append(contract)
            .map_err(|error| corrupt("contract timeline", error.to_string()))?;
    }
    Ok(timeline)
}

/// One employee and everything hanging off them.
pub async fn load_employee(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Option<EmployeeRecord>, AppError> {
    let Some(row) = sqlx::query(
        "SELECT id, code, status, history, code_history, created_at, updated_at
           FROM employee WHERE id = $1",
    )
    .bind(employee_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };

    Ok(Some(EmployeeRecord {
        employee: decode_employee(&row)?,
        assignments: load_assignments(pool, employee_id).await?,
        profile: load_profile(pool, employee_id).await?,
        contracts: load_contracts(pool, employee_id).await?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    }))
}

/// The workforce list.
///
/// One query rather than N+1: the open posting, the latest contract and the
/// bound login are all joined in, because a list that fetched them per row
/// would make a page of forty people forty-one round trips.
pub async fn list_employees(
    pool: &PgPool,
    status: Option<&str>,
    place_id: Option<&str>,
    limit: i64,
) -> Result<Vec<EmployeeSummary>, AppError> {
    let rows = sqlx::query(
        "SELECT e.id, e.code, e.status,
                p.full_name,
                a.place_id, place.name AS place_name,
                c.kind AS contract_kind, c.ends_on AS contract_ends_on, c.position,
                u.username
           FROM employee e
           LEFT JOIN employee_profile p ON p.employee_id = e.id
           LEFT JOIN employee_assignment a
                  ON a.employee_id = e.id AND a.valid_to IS NULL
           LEFT JOIN org_place place ON place.id = a.place_id
           LEFT JOIN LATERAL (
                SELECT kind, ends_on, position
                  FROM employee_contract
                 WHERE employee_id = e.id
                 ORDER BY starts_on DESC, id DESC
                 LIMIT 1
           ) c ON TRUE
           LEFT JOIN app_user u ON u.employee_id = e.id
          WHERE ($1::text IS NULL OR e.status = $1)
            AND ($2::text IS NULL OR a.place_id = $2)
          ORDER BY e.code
          LIMIT $3",
    )
    .bind(status)
    .bind(place_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            Ok(EmployeeSummary {
                employee_id: row.try_get("id")?,
                employee_code: row.try_get("code")?,
                status: row.try_get("status")?,
                full_name: row.try_get("full_name")?,
                place_id: row.try_get("place_id")?,
                place_name: row.try_get("place_name")?,
                contract_kind: row.try_get("contract_kind")?,
                contract_ends_on: row.try_get("contract_ends_on")?,
                position: row.try_get("position")?,
                username: row.try_get("username")?,
            })
        })
        .collect()
}

/// Which fixed terms end on or before `before`.
pub async fn expiring_contracts(
    pool: &PgPool,
    as_of: NaiveDate,
    before: NaiveDate,
) -> Result<Vec<ExpiringContract>, AppError> {
    let rows = sqlx::query(
        "SELECT e.id, e.code, p.full_name, c.position, c.ends_on, a.place_id
           FROM employee_contract c
           JOIN employee e ON e.id = c.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = e.id
           LEFT JOIN employee_assignment a
                  ON a.employee_id = e.id AND a.valid_to IS NULL
          WHERE c.ends_on IS NOT NULL
            AND c.ends_on <= $1
            -- Somebody already gone is not a contract to renew.
            AND e.status <> 'TERMINATED'
            -- Only the latest term counts: an earlier one that expired on its
            -- own schedule and was renewed is not news.
            AND c.id = (SELECT id FROM employee_contract
                         WHERE employee_id = e.id
                         ORDER BY starts_on DESC, id DESC LIMIT 1)
          ORDER BY c.ends_on, e.code",
    )
    .bind(before)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let ends_on: NaiveDate = row.try_get("ends_on")?;
            Ok(ExpiringContract {
                employee_id: row.try_get("id")?,
                employee_code: row.try_get("code")?,
                full_name: row.try_get("full_name")?,
                position: row.try_get("position")?,
                place_id: row.try_get("place_id")?,
                ends_on,
                days_remaining: (ends_on - as_of).num_days(),
            })
        })
        .collect()
}

/// The display name of a place, for the employment profile.
///
/// A separate small query rather than a join in `load_employee`: the name is
/// wanted on one screen, and every other caller of that function would pay for
/// it.
pub async fn place_name(pool: &PgPool, place_id: &str) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT name FROM org_place WHERE id = $1")
            .bind(place_id)
            .fetch_optional(pool)
            .await?,
    )
}

/// The employment record bound to a login, for resolving `me`.
pub async fn employee_id_for_username(
    pool: &PgPool,
    username: &str,
) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT employee_id FROM app_user WHERE username = $1")
            .bind(username)
            .fetch_optional(pool)
            .await?
            .flatten(),
    )
}

// ── writing ──────────────────────────────────────────────────────────────

/// Write the employee row. The only place `status` is set, and it comes from a
/// value that has already folded its own history.
async fn write_employee(
    tx: &mut Transaction<'_, Postgres>,
    employee: &Employee,
) -> Result<(), AppError> {
    let history = serde_json::to_value(employee.history())?;
    let code_history = serde_json::to_value(employee.code_history())?;
    sqlx::query(
        "INSERT INTO employee (id, code, status, history, code_history, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (id) DO UPDATE SET
            code = EXCLUDED.code,
            status = EXCLUDED.status,
            history = EXCLUDED.history,
            code_history = EXCLUDED.code_history,
            updated_at = now()",
    )
    .bind(employee.id().as_str())
    .bind(employee.code().as_str())
    .bind(employee.status().code())
    .bind(&history)
    .bind(&code_history)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Register a new employment record as a candidate.
pub async fn register_employee(pool: &PgPool, employee: &Employee) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let taken: Option<String> = sqlx::query_scalar("SELECT id FROM employee WHERE code = $1")
        .bind(employee.code().as_str())
        .fetch_optional(&mut *tx)
        .await?;
    if let Some(taken) = taken {
        return Err(AppError::Conflict(format!(
            "employee code {} already belongs to {taken}",
            employee.code()
        )));
    }
    write_employee(&mut tx, employee).await?;
    tx.commit().await?;
    Ok(())
}

/// Persist an employee whose state machine has already moved.
pub async fn save_employee(pool: &PgPool, employee: &Employee) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    write_employee(&mut tx, employee).await?;
    tx.commit().await?;
    Ok(())
}

/// Replace the whole posting timeline.
///
/// Rewritten rather than appended to: the timeline is validated as a whole, and
/// an insert keyed on a synthetic id cannot express a correction that removes a
/// span. See the module docs.
pub async fn replace_assignments(
    pool: &PgPool,
    employee_id: &str,
    timeline: &AssignmentTimeline,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM employee_assignment WHERE employee_id = $1")
        .bind(employee_id)
        .execute(&mut *tx)
        .await?;
    for span in timeline.spans() {
        let authorized = serde_json::to_value(span.authorization())?;
        sqlx::query(
            "INSERT INTO employee_assignment
                (id, employee_id, place_id, valid_from, valid_to, authorized)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(format!("asg_{}", Uuid::new_v4().simple()))
        .bind(employee_id)
        .bind(span.place_id().as_str())
        .bind(span.from())
        .bind(span.to())
        .bind(&authorized)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// One row per employee: current values plus the chain that produced them.
pub async fn upsert_profile(
    pool: &PgPool,
    employee_id: &str,
    profile: &Profile,
) -> Result<(), AppError> {
    let amendments = serde_json::to_value(profile.amendments())?;
    sqlx::query(
        "INSERT INTO employee_profile
            (employee_id, full_name, nik, birth_date, address, phone, email,
             amendments, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
         ON CONFLICT (employee_id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            nik = EXCLUDED.nik,
            birth_date = EXCLUDED.birth_date,
            address = EXCLUDED.address,
            phone = EXCLUDED.phone,
            email = EXCLUDED.email,
            amendments = EXCLUDED.amendments,
            updated_at = now()",
    )
    .bind(employee_id)
    .bind(profile.name().as_str())
    .bind(profile.nik().as_str())
    .bind(profile.birth_date())
    .bind(profile.address().as_str())
    .bind(profile.phone().map(|contact| contact.as_str()))
    .bind(profile.email().map(|contact| contact.as_str()))
    .bind(&amendments)
    .execute(pool)
    .await?;
    Ok(())
}

/// Replace the whole contract timeline, for the same reason assignments are.
pub async fn replace_contracts(
    pool: &PgPool,
    employee_id: &str,
    timeline: &ContractTimeline,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM employee_contract WHERE employee_id = $1")
        .bind(employee_id)
        .execute(&mut *tx)
        .await?;
    for contract in timeline.contracts() {
        let authorized = serde_json::to_value(contract.authorization())?;
        sqlx::query(
            "INSERT INTO employee_contract
                (id, employee_id, kind, starts_on, ends_on, position, grade, authorized)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(format!("ctr_{}", Uuid::new_v4().simple()))
        .bind(employee_id)
        .bind(contract.kind().code())
        .bind(contract.starts_on())
        .bind(contract.ends_on())
        .bind(contract.position().as_str())
        .bind(contract.grade().as_str())
        .bind(&authorized)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Bind an employment record to a login.
///
/// The unique partial index refuses a second account for one employee; this
/// turns that into an answer rather than a 500.
pub async fn link_account(
    pool: &PgPool,
    employee_id: &str,
    username: &str,
) -> Result<(), AppError> {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM employee WHERE id = $1")
        .bind(employee_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("employee {employee_id}")));
    }

    let held_by: Option<String> =
        sqlx::query_scalar("SELECT username FROM app_user WHERE employee_id = $1")
            .bind(employee_id)
            .fetch_optional(pool)
            .await?;
    if let Some(held_by) = held_by {
        if held_by != username {
            return Err(AppError::Conflict(format!(
                "employee {employee_id} is already bound to {held_by}"
            )));
        }
        return Ok(());
    }

    let updated = sqlx::query("UPDATE app_user SET employee_id = $2 WHERE username = $1")
        .bind(username)
        .bind(employee_id)
        .execute(pool)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("user {username}")));
    }
    Ok(())
}
