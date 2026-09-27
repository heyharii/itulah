//! Grievances, as rows — the confidential queue and its catalogue.
//!
//! The state moves here are conditional UPDATEs in the claims lane's mould:
//! `UPDATE ... WHERE state = '<from>'`, and a zero row count is a conflict
//! the caller reports as one. The domain has already checked the same
//! condition, but read-decide-write on a row two investigators can load at
//! once is exactly the race the conditional UPDATE closes — the loser's
//! transaction rolls back whole.
//!
//! The catalogue is not a posting vocabulary: a grievance kind names no
//! account and seeds no map rows. Defining one is one INSERT, and that is
//! the whole weight of it — the weight the claim catalogue carried was the
//! qualifier its postings carry, and this catalogue has none.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    actions, Authorization, EmployeeGrievance, EmployeeGrievanceWire, EmployeeId, GrievanceError,
    GrievanceEvent, GrievanceId, GrievanceState, GrievanceType, GrievanceTypeCatalogue,
    GrievanceTypeCode, PlaceId,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Validation(format!(
        "{what} is stored in a shape that cannot be true: {detail}"
    ))
}

/// Turn a domain refusal into the right HTTP answer. A state mismatch is a
/// conflict, not a bad request: the payload is fine and what is wrong is
/// what already happened to the grievance.
pub fn grievance_error(error: GrievanceError) -> AppError {
    match error {
        GrievanceError::InvalidId { .. }
        | GrievanceError::SubjectRequired
        | GrievanceError::DescriptionRequired => AppError::Validation(error.to_string()),
        GrievanceError::UnknownGrievanceType { .. }
        | GrievanceError::GrievanceTypeRetired { .. }
        | GrievanceError::DuplicateGrievanceType { .. } => AppError::Conflict(error.to_string()),
        GrievanceError::ActionForbidsFiling { .. }
        | GrievanceError::ActionForbidsInvestigation { .. }
        | GrievanceError::ActionForbidsResolution { .. }
        | GrievanceError::WithdrawalNotByFiler
        | GrievanceError::SameActorFiledAndInvestigated { .. }
        | GrievanceError::SameActorFiledAndResolved { .. } => {
            AppError::Forbidden(error.to_string())
        }
        GrievanceError::GrievanceNotOpen { .. }
        | GrievanceError::GrievanceNotInvestigated { .. }
        | GrievanceError::GrievanceNotWithdrawable { .. } => AppError::Conflict(error.to_string()),
        _ => AppError::Conflict(error.to_string()),
    }
}

// ── the catalogue ────────────────────────────────────────────────────────

fn decode_type(row: &sqlx::postgres::PgRow) -> Result<GrievanceType, AppError> {
    let code = GrievanceTypeCode::try_new(&row.try_get::<String, _>("code")?)
        .map_err(|error| corrupt("grievance type code", error.to_string()))?;
    let name = row.try_get::<String, _>("name")?;
    let retired_at = row.try_get::<Option<DateTime<Utc>>, _>("retired_at")?;
    let created_at = row.try_get::<DateTime<Utc>, _>("created_at")?;
    GrievanceType::try_from_parts(code, name, retired_at, created_at)
        .map_err(|error| corrupt("grievance type", error.to_string()))
}

/// Every kind the company has defined, retired ones included.
pub async fn load_grievance_type_catalogue(
    pool: &PgPool,
) -> Result<GrievanceTypeCatalogue, AppError> {
    let rows = sqlx::query(
        "SELECT code, name, retired_at, created_at
           FROM grievance_type
          ORDER BY code",
    )
    .fetch_all(pool)
    .await?;
    let mut types = Vec::with_capacity(rows.len());
    for row in &rows {
        types.push(decode_type(row)?);
    }
    GrievanceTypeCatalogue::try_new(types)
        .map_err(|error| corrupt("grievance catalogue", error.to_string()))
}

/// Define a kind. Refuses a code that already exists rather than replacing
/// it: redefining a kind changes what every grievance already filed under it
/// meant, and the code is stored on every one of those rows.
pub async fn define_grievance_type(
    pool: &PgPool,
    grievance_type: &GrievanceType,
) -> Result<(), AppError> {
    let inserted = sqlx::query(
        "INSERT INTO grievance_type (code, name, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING",
    )
    .bind(grievance_type.code().as_str())
    .bind(grievance_type.name())
    .bind(grievance_type.created_at())
    .execute(pool)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(format!(
            "{} is already a grievance kind",
            grievance_type.code()
        )));
    }
    Ok(())
}

/// Retire, never delete: every grievance filed under the code keeps
/// resolving, and no new grievance may name it.
pub async fn retire_grievance_type(
    pool: &PgPool,
    code: &GrievanceTypeCode,
    reason: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let affected = sqlx::query(
        "UPDATE grievance_type
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
            "{} is not an active grievance kind",
            code
        )));
    }
    Ok(())
}

// ── the grievance rows ───────────────────────────────────────────────────

fn decode_event(value: serde_json::Value) -> Result<GrievanceEvent, AppError> {
    // The domain's `GrievanceEvent` borrows its action from the machine, so
    // the stored JSON decodes through an owned shadow and the action string
    // is matched back to its code. Anything else is a word the machine never
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
        .map_err(|error| corrupt("grievance history event", error.to_string()))?;
    let action = match stored.action.as_str() {
        "FILED" => "FILED",
        "INVESTIGATED" => "INVESTIGATED",
        "RESOLVED" => "RESOLVED",
        "INVALID" => "INVALID",
        "WITHDRAWN" => "WITHDRAWN",
        other => {
            return Err(corrupt(
                "grievance history event",
                format!("{other:?} is not an action the machine writes"),
            ))
        }
    };
    Ok(GrievanceEvent {
        actor: stored.actor,
        action,
        reason: stored.reason,
        at: stored.at,
        detail: stored.detail,
    })
}

/// A grievance with the names a screen shows, folded through the domain so a
/// row no sequence of decisions could reach refuses to load rather than
/// rendering.
pub struct GrievanceRecord {
    pub grievance: EmployeeGrievance,
    pub history: Vec<GrievanceEvent>,
    pub created_at: DateTime<Utc>,
    pub place_name: Option<String>,
    pub type_name: Option<String>,
    pub raised_by_code: Option<String>,
    pub raised_by_name: Option<String>,
    pub against_name: Option<String>,
}

async fn decode_grievance(
    row: &sqlx::postgres::PgRow,
    catalogue: &GrievanceTypeCatalogue,
) -> Result<GrievanceRecord, AppError> {
    let id: Uuid = row.try_get("grievance_id")?;
    let state_code: String = row.try_get("state")?;
    let investigated_by: Option<String> = row.try_get("investigated_by")?;
    let investigated_at: Option<DateTime<Utc>> = row.try_get("investigated_at")?;
    let investigation_note: Option<String> = row.try_get("investigation_note")?;
    let resolved_by: Option<String> = row.try_get("resolved_by")?;
    let resolved_at: Option<DateTime<Utc>> = row.try_get("resolved_at")?;
    let resolution_detail: Option<String> = row.try_get("resolution_detail")?;
    let resolved_on: Option<NaiveDate> = row.try_get("resolved_on")?;
    let withdrawn_at: Option<DateTime<Utc>> = row.try_get("withdrawn_at")?;

    // The inverse of what is written, pairing the state with its evidence.
    // The note and the detail are the reason of the act that carried them —
    // the same one record, not two.
    fn authorization(
        actor: Option<String>,
        at: Option<DateTime<Utc>>,
        reason: Option<String>,
        action_key: &'static str,
    ) -> Result<Authorization, AppError> {
        Authorization::try_new(
            &actor.unwrap_or_default(),
            action_key,
            at.unwrap_or(DateTime::<Utc>::MIN_UTC),
            &reason.unwrap_or_default(),
        )
        .map_err(|error| corrupt("grievance act", error.to_string()))
    }

    let investigation = || {
        authorization(
            investigated_by.clone(),
            investigated_at,
            investigation_note.clone(),
            actions::GRIEVANCE_INVESTIGATE,
        )
    };
    let resolution = || {
        authorization(
            resolved_by.clone(),
            resolved_at,
            resolution_detail.clone(),
            actions::GRIEVANCE_DECIDE,
        )
    };

    let state = match state_code.as_str() {
        "OPEN" => GrievanceState::Open,
        "INVESTIGATED" => GrievanceState::Investigated {
            investigated: investigation()?,
        },
        "RESOLVED" => GrievanceState::Resolved {
            investigated: investigation()?,
            decided: resolution()?,
            resolved_on: resolved_on
                .ok_or_else(|| corrupt("resolved grievance", "no resolution date".into()))?,
        },
        "INVALID" => GrievanceState::Invalid {
            investigated: investigation()?,
            decided: resolution()?,
        },
        "WITHDRAWN" => GrievanceState::Withdrawn {
            withdrawn: {
                let actor = row.try_get::<Option<String>, _>("withdrawn_by")?;
                Authorization::try_new(
                    &actor.unwrap_or_default(),
                    actions::GRIEVANCE_REQUEST_OWN,
                    withdrawn_at.unwrap_or(DateTime::<Utc>::MIN_UTC),
                    &row.try_get::<Option<String>, _>("withdrawn_reason")?
                        .unwrap_or_default(),
                )
                .map_err(|error| corrupt("grievance withdrawal", error.to_string()))?
            },
        },
        other => {
            return Err(corrupt(
                "grievance state",
                format!("{other:?} is not a state the machine reaches"),
            ))
        }
    };

    let history: Vec<GrievanceEvent> = row
        .try_get::<serde_json::Value, _>("history")?
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(decode_event)
        .collect::<Result<_, _>>()?;

    let grievance = EmployeeGrievance::try_new(
        EmployeeGrievanceWire {
            id: GrievanceId::try_new(&id.to_string())
                .map_err(|error| corrupt("grievance id", error.to_string()))?,
            place: PlaceId::try_new(&row.try_get::<String, _>("place_id")?)
                .map_err(|error| corrupt("grievance place", error.to_string()))?,
            type_code: GrievanceTypeCode::try_new(&row.try_get::<String, _>("type_code")?)
                .map_err(|error| corrupt("grievance type", error.to_string()))?,
            raised_by: EmployeeId::try_new(&row.try_get::<String, _>("raised_by")?)
                .map_err(|error| corrupt("grievance raiser", error.to_string()))?,
            filed_by: row.try_get::<String, _>("filed_by")?,
            against: row
                .try_get::<Option<String>, _>("against_employee")?
                .map(|raw| {
                    EmployeeId::try_new(&raw)
                        .map_err(|error| corrupt("grievance subject", error.to_string()))
                })
                .transpose()?,
            subject: row.try_get::<String, _>("subject")?,
            description: row.try_get::<String, _>("description")?,
            cause: row.try_get::<Option<String>, _>("cause")?,
            state,
            history: history.clone(),
        },
        catalogue,
    )
    .map_err(grievance_error)?;

    Ok(GrievanceRecord {
        created_at: row.try_get("created_at")?,
        place_name: row.try_get("place_name")?,
        type_name: row.try_get("type_name")?,
        raised_by_code: row.try_get("raised_by_code")?,
        raised_by_name: row.try_get("raised_by_name")?,
        against_name: row.try_get("against_name")?,
        history,
        grievance,
    })
}

/// The stored grievance, folded. One read, used by every handler, so the
/// names a screen shows and the rules the domain enforces arrive together.
const GRIEVANCE_SELECT: &str = "SELECT g.grievance_id, g.place_id, g.type_code, g.raised_by,
                g.filed_by, g.against_employee, g.subject, g.description, g.cause,
                g.state, g.investigated_by, g.investigated_at, g.investigation_note,
                g.resolved_by, g.resolved_at, g.resolution_detail, g.resolved_on,
                g.withdrawn_by, g.withdrawn_reason, g.withdrawn_at, g.history, g.created_at,
                COALESCE(p.name, p.id) AS place_name,
                gt.name AS type_name,
                re.code AS raised_by_code,
                COALESCE(rep.full_name, re.id) AS raised_by_name,
                COALESCE(agp.full_name, ag.code) AS against_name
           FROM employee_grievance g
           JOIN org_place p ON p.id = g.place_id
           JOIN grievance_type gt ON gt.code = g.type_code
           JOIN employee re ON re.id = g.raised_by
      LEFT JOIN employee_profile rep ON rep.employee_id = re.id
      LEFT JOIN employee ag ON ag.id = g.against_employee
      LEFT JOIN employee_profile agp ON agp.employee_id = g.against_employee";

/// One grievance, folded.
pub async fn load_grievance(
    pool: &PgPool,
    grievance_id: Uuid,
    catalogue: &GrievanceTypeCatalogue,
) -> Result<Option<GrievanceRecord>, AppError> {
    let row = sqlx::query(&format!("{GRIEVANCE_SELECT} WHERE g.grievance_id = $1"))
        .bind(grievance_id)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(decode_grievance(&row, catalogue).await?)),
        None => Ok(None),
    }
}

/// The queue and the own-filing list, in one query.
///
/// The HO queue reads `state` and sees every place — that is what makes the
/// channel HO's. The bounded caller's own view reads `filed_by` and sees
/// nothing else, because a list of who else complained about whom would end
/// the channel the first day somebody worked that out.
pub async fn list_grievances(
    pool: &PgPool,
    catalogue: &GrievanceTypeCatalogue,
    state: Option<&str>,
    filed_by: Option<&str>,
) -> Result<Vec<GrievanceRecord>, AppError> {
    let rows = sqlx::query(&format!(
        "{GRIEVANCE_SELECT}
          WHERE ($1::text IS NULL OR g.state = $1)
            AND ($2::text IS NULL OR g.filed_by = $2)
          ORDER BY g.created_at DESC
          LIMIT 500"
    ))
    .bind(state)
    .bind(filed_by)
    .fetch_all(pool)
    .await?;
    let mut records = Vec::with_capacity(rows.len());
    for row in &rows {
        records.push(decode_grievance(row, catalogue).await?);
    }
    Ok(records)
}

/// Store a filed grievance: the row and the history that says who filed it.
pub async fn insert_grievance(
    pool: &PgPool,
    grievance: &EmployeeGrievance,
) -> Result<(), AppError> {
    let grievance_id = Uuid::from_str(grievance.id().as_str())
        .map_err(|error| corrupt("grievance id", error.to_string()))?;
    let history = serde_json::to_value(grievance.history())
        .map_err(|error| corrupt("grievance history", error.to_string()))?;
    sqlx::query(
        "INSERT INTO employee_grievance
             (grievance_id, place_id, type_code, raised_by, filed_by, against_employee,
              subject, description, cause, state, history)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN', $10)",
    )
    .bind(grievance_id)
    .bind(grievance.place().as_str())
    .bind(grievance.type_code().as_str())
    .bind(grievance.raised_by().as_str())
    .bind(grievance.filed_by())
    .bind(grievance.against().map(|employee| employee.as_str()))
    .bind(grievance.subject())
    .bind(grievance.description())
    .bind(grievance.cause())
    .bind(history)
    .execute(pool)
    .await?;
    Ok(())
}

/// Take it up for investigation: the note rides the same UPDATE as the
/// state, so the row never says INVESTIGATED with no note beside it.
pub async fn record_investigation(
    pool: &PgPool,
    grievance: &mut EmployeeGrievance,
    authorization: Authorization,
) -> Result<(), AppError> {
    grievance
        .investigate(authorization.clone())
        .map_err(grievance_error)?;
    let history = serde_json::to_value(grievance.history())
        .map_err(|error| corrupt("grievance history", error.to_string()))?;
    let affected = sqlx::query(
        "UPDATE employee_grievance
            SET state = 'INVESTIGATED', investigated_by = $2, investigated_at = $3,
                investigation_note = $4, history = $5
          WHERE grievance_id = $1 AND state = 'OPEN'",
    )
    .bind(
        Uuid::from_str(grievance.id().as_str())
            .map_err(|error| corrupt("grievance id", error.to_string()))?,
    )
    .bind(authorization.actor().as_str())
    .bind(authorization.at())
    .bind(authorization.reason().as_str())
    .bind(history)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(
            "the grievance is no longer open for investigation".into(),
        ));
    }
    Ok(())
}

/// Resolve it — upheld or invalid — with the detail and the day of the
/// decision riding the UPDATE that moves the state. `valid` is the caller's
/// answer; the domain produces the state and this records it.
pub async fn record_resolution(
    pool: &PgPool,
    grievance: &mut EmployeeGrievance,
    valid: bool,
    authorization: Authorization,
) -> Result<(), AppError> {
    grievance
        .decide(valid, authorization.clone())
        .map_err(grievance_error)?;
    let resolved_on = grievance.state().resolved_on();
    let history = serde_json::to_value(grievance.history())
        .map_err(|error| corrupt("grievance history", error.to_string()))?;
    let affected = if valid {
        sqlx::query(
            "UPDATE employee_grievance
                SET state = 'RESOLVED', resolved_by = $2, resolved_at = $3,
                    resolution_detail = $4, resolved_on = $5, history = $6
              WHERE grievance_id = $1 AND state = 'INVESTIGATED'",
        )
        .bind(
            Uuid::from_str(grievance.id().as_str())
                .map_err(|error| corrupt("grievance id", error.to_string()))?,
        )
        .bind(authorization.actor().as_str())
        .bind(authorization.at())
        .bind(authorization.reason().as_str())
        .bind(resolved_on)
        .bind(history)
        .execute(pool)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE employee_grievance
                SET state = 'INVALID', resolved_by = $2, resolved_at = $3,
                    resolution_detail = $4, history = $5
              WHERE grievance_id = $1 AND state = 'INVESTIGATED'",
        )
        .bind(
            Uuid::from_str(grievance.id().as_str())
                .map_err(|error| corrupt("grievance id", error.to_string()))?,
        )
        .bind(authorization.actor().as_str())
        .bind(authorization.at())
        .bind(authorization.reason().as_str())
        .bind(history)
        .execute(pool)
        .await?
        .rows_affected()
    };
    if affected == 0 {
        return Err(AppError::Conflict(
            "the grievance is no longer waiting for a resolution".into(),
        ));
    }
    Ok(())
}

/// Take it back. The filer's, from OPEN or INVESTIGATED; the domain has
/// already checked the actor, and the conditional UPDATE is the guard the
/// second racing request cannot pass.
pub async fn record_grievance_withdrawal(
    pool: &PgPool,
    grievance: &mut EmployeeGrievance,
    authorization: Authorization,
) -> Result<(), AppError> {
    grievance
        .withdraw(authorization.clone())
        .map_err(grievance_error)?;
    let history = serde_json::to_value(grievance.history())
        .map_err(|error| corrupt("grievance history", error.to_string()))?;
    let affected = sqlx::query(
        "UPDATE employee_grievance
            SET state = 'WITHDRAWN', withdrawn_by = $2, withdrawn_reason = $3,
                withdrawn_at = $4, history = $5
          WHERE grievance_id = $1 AND state IN ('OPEN', 'INVESTIGATED')",
    )
    .bind(
        Uuid::from_str(grievance.id().as_str())
            .map_err(|error| corrupt("grievance id", error.to_string()))?,
    )
    .bind(authorization.actor().as_str())
    .bind(authorization.reason().as_str())
    .bind(authorization.at())
    .bind(history)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(
            "the grievance can no longer be withdrawn".into(),
        ));
    }
    Ok(())
}

// ── the views ────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GrievanceTypeView {
    pub code: String,
    pub name: String,
    pub retired_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

pub fn grievance_type_view(grievance_type: &GrievanceType) -> GrievanceTypeView {
    GrievanceTypeView {
        code: grievance_type.code().to_string(),
        name: grievance_type.name().to_owned(),
        retired_at: grievance_type.retired_at(),
        created_at: grievance_type.created_at(),
    }
}

/// One event of the trail, owned. The domain's `GrievanceEvent` borrows its
/// action from the machine; the wire carries it as the string it is.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GrievanceEventView {
    pub actor: String,
    pub action: String,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GrievanceView {
    pub grievance_id: Uuid,
    pub place_id: String,
    pub place_name: Option<String>,
    pub type_code: String,
    pub type_name: Option<String>,
    pub raised_by: String,
    pub raised_by_code: Option<String>,
    pub raised_by_name: Option<String>,
    pub filed_by: String,
    pub against_employee: Option<String>,
    pub against_name: Option<String>,
    pub subject: String,
    pub description: String,
    pub cause: Option<String>,
    pub state: String,
    pub investigated_by: Option<String>,
    pub investigated_at: Option<DateTime<Utc>>,
    pub investigation_note: Option<String>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolution_detail: Option<String>,
    pub resolved_on: Option<NaiveDate>,
    pub withdrawn_at: Option<DateTime<Utc>>,
    pub history: Vec<GrievanceEventView>,
    pub created_at: DateTime<Utc>,
}

pub fn grievance_view(record: &GrievanceRecord) -> Result<GrievanceView, AppError> {
    let grievance = &record.grievance;
    let parse = |what: &str, raw: &str| -> Result<Uuid, AppError> {
        Uuid::from_str(raw).map_err(|error| corrupt(what, error.to_string()))
    };
    let (investigated_by, investigated_at, investigation_note) =
        match grievance.state().investigation() {
            Some(investigated) => (
                Some(investigated.actor().to_string()),
                Some(investigated.at()),
                Some(investigated.reason().to_string()),
            ),
            None => (None, None, None),
        };
    let (resolved_by, resolved_at, resolution_detail) = match grievance.state().resolution() {
        Some(decided) => (
            Some(decided.actor().to_string()),
            Some(decided.at()),
            Some(decided.reason().to_string()),
        ),
        None => (None, None, None),
    };
    let withdrawn_at = match grievance.state() {
        GrievanceState::Withdrawn { withdrawn } => Some(withdrawn.at()),
        _ => None,
    };
    Ok(GrievanceView {
        grievance_id: parse("grievance id", grievance.id().as_str())?,
        place_id: grievance.place().to_string(),
        place_name: record.place_name.clone(),
        type_code: grievance.type_code().to_string(),
        type_name: record.type_name.clone(),
        raised_by: grievance.raised_by().to_string(),
        raised_by_code: record.raised_by_code.clone(),
        raised_by_name: record.raised_by_name.clone(),
        filed_by: grievance.filed_by().to_owned(),
        against_employee: grievance.against().map(|employee| employee.to_string()),
        against_name: record.against_name.clone(),
        subject: grievance.subject().to_owned(),
        description: grievance.description().to_owned(),
        cause: grievance.cause().map(|cause| cause.to_owned()),
        state: grievance.state().code().to_owned(),
        investigated_by,
        investigated_at,
        investigation_note,
        resolved_by,
        resolved_at,
        resolution_detail,
        resolved_on: grievance.state().resolved_on(),
        withdrawn_at,
        history: record
            .history
            .iter()
            .map(|event| GrievanceEventView {
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
