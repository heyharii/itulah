//! Punches and corrections, as rows.
//!
//! # Reads go back through the kernel, never around it
//!
//! Every punch read here is offered to `Punch::rehydrate`, which re-checks that
//! the terminal it names is still a registered terminal, at the place the punch
//! claims, performing the method it claims. A row somebody inserted by hand
//! therefore fails to load rather than quietly becoming attendance — which is
//! the whole reason the punch type has no `Deserialize`.
//!
//! The terminals are fetched once per read and reused, so a day with twelve
//! punches from one station is one terminal load rather than twelve.
//!
//! # Nothing here writes an outcome
//!
//! There is no `status` column in `0234` and no statement here that would set
//! one. `LATE`, `ABSENT` and the rest are `domain::attendance::evaluate_day`'s,
//! recomputed on every read from the plan, the punches, the policy version, the
//! approvals and the effective correction.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    AttendanceMonth, AttendanceTerminal, Authorization, ClockQuality, Correction, CorrectionChain,
    CorrectionEffect, CorrectionId, CorrectionState, DayOffset, EmployeeId, IdentificationMethod,
    MinuteOfDay, PersistedPunch, PlaceId, Punch, PunchDirection, PunchId, PunchProvenance,
    PunchSource, PunchTime, TerminalId,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use std::collections::HashMap;

fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The rows disagree with the rules they encode."
    ))
}

const PUNCH_COLUMNS: &str = "id, employee_id, place_id, source, terminal_id, method, direction, \
                             business_date, day_offset, minute, recorded_at, clock_quality";

// ── punches ──────────────────────────────────────────────────────────────

fn decode_persisted(row: &sqlx::postgres::PgRow) -> Result<PersistedPunch, AppError> {
    let id: String = row.try_get("id")?;
    let employee: String = row.try_get("employee_id")?;
    let place: String = row.try_get("place_id")?;
    let source: String = row.try_get("source")?;
    let terminal: Option<String> = row.try_get("terminal_id")?;
    let method: Option<String> = row.try_get("method")?;
    let direction: String = row.try_get("direction")?;
    let business_date: NaiveDate = row.try_get("business_date")?;
    let day_offset: i16 = row.try_get("day_offset")?;
    let minute: i16 = row.try_get("minute")?;
    let clock_quality: String = row.try_get("clock_quality")?;

    let at = PunchTime::new(
        business_date,
        DayOffset::try_new(u8::try_from(day_offset).unwrap_or(u8::MAX))
            .map_err(|error| corrupt("punch day offset", error.to_string()))?,
        MinuteOfDay::try_new(u16::try_from(minute).unwrap_or(u16::MAX))
            .map_err(|error| corrupt("punch minute", error.to_string()))?,
    );
    // The source and its evidence are reassembled together, so a row saying
    // EMPLOYEE_APP with a station named beside it cannot become a fingerprint
    // reading — and a row saying TERMINAL with no station cannot quietly become
    // a phone tap. `0239`'s `punch_provenance_matches_source` says the same
    // thing; this is the second copy, in the register the kernel reads.
    let provenance = match (
        PunchSource::parse(&source).map_err(|error| corrupt("punch source", error.to_string()))?,
        terminal,
        method,
    ) {
        (PunchSource::Terminal, Some(terminal), Some(method)) => PunchProvenance::Terminal {
            terminal: TerminalId::try_new(&terminal)
                .map_err(|error| corrupt("punch terminal", error.to_string()))?,
            method: IdentificationMethod::parse(&method)
                .map_err(|error| corrupt("punch method", error.to_string()))?,
        },
        (PunchSource::EmployeeApp, None, None) => PunchProvenance::EmployeeApp,
        (source, _, _) => {
            return Err(corrupt(
                "punch provenance",
                format!("`{source}` does not match the station recorded beside it"),
            ))
        }
    };

    Ok(PersistedPunch {
        id: PunchId::try_new(&id).map_err(|error| corrupt("punch id", error.to_string()))?,
        employee: EmployeeId::try_new(&employee)
            .map_err(|error| corrupt("punch employee", error.to_string()))?,
        place: PlaceId::try_new(&place)
            .map_err(|error| corrupt("punch place", error.to_string()))?,
        provenance,
        direction: PunchDirection::parse(&direction)
            .map_err(|error| corrupt("punch direction", error.to_string()))?,
        at,
        recorded_at: row.try_get("recorded_at")?,
        clock_quality: ClockQuality::parse(&clock_quality)
            .map_err(|error| corrupt("punch clock quality", error.to_string()))?,
    })
}

/// Store a punch, idempotently on its identity.
///
/// `Ok(false)` when this punch was already recorded, which is the **normal**
/// case rather than an error. It is what makes both sources safe to retry: a
/// node that lost its uplink mid-cycle redelivers its whole batch under the ids
/// it minted at the edge, and a phone punch carries an id the centre *derived*
/// from the person, the minute and the direction — so a double tap collides
/// here rather than becoming two arrivals. One mechanism, two sources; see
/// `SelfPunchClaim::punch_id`.
///
/// The terminal's `punched_at` moves in the same transaction as the row, so a
/// Devices screen saying "last punch an hour ago" cannot be reporting a punch
/// that rolled back. A phone punch touches no station, because there is none to
/// touch — a shop whose reader has not reported since Monday must keep saying
/// so however many people clocked in on their phones.
pub async fn insert_punch(pool: &PgPool, punch: &Punch) -> Result<bool, AppError> {
    let record = punch.to_persisted();
    let terminal = record.provenance.terminal().map(TerminalId::as_str);
    let mut tx = pool.begin().await?;
    let affected = sqlx::query(
        "INSERT INTO attendance_punch
            (id, employee_id, place_id, source, terminal_id, method, direction,
             business_date, day_offset, minute, recorded_at, clock_quality)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(record.id.as_str())
    .bind(record.employee.as_str())
    .bind(record.place.as_str())
    .bind(record.provenance.source().code())
    .bind(terminal)
    .bind(record.provenance.method().map(IdentificationMethod::code))
    .bind(record.direction.code())
    .bind(record.at.business_date())
    .bind(i16::from(record.at.day_offset().days()))
    .bind(i16::try_from(record.at.minute().minutes()).unwrap_or(i16::MAX))
    .bind(record.recorded_at)
    .bind(record.clock_quality.code())
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if let (true, Some(terminal)) = (affected > 0, terminal) {
        super::enrolment::touch_terminal_punch(&mut tx, terminal).await?;
    }
    tx.commit().await?;
    Ok(affected > 0)
}

/// The terminals a set of punches names, by id.
///
/// One query for the whole read. A punch whose terminal is missing entirely is
/// not silently dropped: the caller gets no entry for it and
/// `Punch::rehydrate` is never reached, so the refusal is explicit at the call
/// site rather than an absence nobody notices.
async fn terminals_for(
    pool: &PgPool,
    records: &[PersistedPunch],
) -> Result<HashMap<String, AttendanceTerminal>, AppError> {
    let mut wanted: Vec<String> = records
        .iter()
        .filter_map(|record| record.provenance.terminal())
        .map(|terminal| terminal.as_str().to_owned())
        .collect();
    wanted.sort();
    wanted.dedup();
    let mut terminals = HashMap::with_capacity(wanted.len());
    for id in wanted {
        if let Some(terminal) = super::enrolment::load_attendance_terminal(pool, &id).await? {
            terminals.insert(id, terminal);
        }
    }
    Ok(terminals)
}

/// Rehydrate raw rows into punches, refusing any whose provenance no longer
/// holds.
///
/// `employee_of` is a lookup rather than a map so the single-employee reads can
/// hand over one borrowed record and the place-wide read can hand over a map it
/// filled as it went, without either having to clone an `EmployeeRecord`.
async fn rehydrate_all<'a>(
    pool: &PgPool,
    records: Vec<PersistedPunch>,
    employee_of: impl Fn(&str) -> Option<&'a super::EmployeeRecord>,
) -> Result<Vec<Punch>, AppError> {
    let terminals = terminals_for(pool, &records).await?;
    let mut punches = Vec::with_capacity(records.len());
    for record in records {
        // The two lookup keys are taken before the record is consumed, so the
        // refusal messages can still name what was missing.
        let terminal_id = record
            .provenance
            .terminal()
            .map(|terminal| terminal.as_str().to_owned());
        let employee_id = record.employee.as_str().to_owned();
        // `None` here means the row names no station, which is a whole answer
        // for a phone punch and not a lookup that failed. A row that DOES name
        // one and cannot be explained by it is still refused, loudly.
        let terminal = match &terminal_id {
            Some(terminal_id) => Some(terminals.get(terminal_id).ok_or_else(|| {
                corrupt(
                    "punch",
                    format!("it names terminal {terminal_id}, which is not registered"),
                )
            })?),
            None => None,
        };
        let employee = employee_of(&employee_id).ok_or_else(|| {
            corrupt(
                "punch",
                format!("it names employee {employee_id}, who has no record"),
            )
        })?;
        punches.push(
            Punch::rehydrate(record, terminal, &employee.employee, &employee.assignments)
                .map_err(|error| corrupt("punch", error.to_string()))?,
        );
    }
    Ok(punches)
}

/// One person's punches on one business date, oldest first.
pub async fn punches_on(
    pool: &PgPool,
    employee: &super::EmployeeRecord,
    date: NaiveDate,
) -> Result<Vec<Punch>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {PUNCH_COLUMNS} FROM attendance_punch
          WHERE employee_id = $1 AND business_date = $2
          ORDER BY day_offset, minute, recorded_at, id"
    ))
    .bind(employee.employee.id().as_str())
    .bind(date)
    .fetch_all(pool)
    .await?;
    let records = rows
        .iter()
        .map(decode_persisted)
        .collect::<Result<Vec<_>, AppError>>()?;
    let mine = employee.employee.id().as_str().to_owned();
    rehydrate_all(pool, records, |id| (id == mine).then_some(employee)).await
}

/// One person's punches across a date range, oldest first. What a month's
/// derivation reads, in one query rather than thirty.
pub async fn punches_between(
    pool: &PgPool,
    employee: &super::EmployeeRecord,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<Punch>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {PUNCH_COLUMNS} FROM attendance_punch
          WHERE employee_id = $1 AND business_date >= $2 AND business_date <= $3
          ORDER BY business_date, day_offset, minute, recorded_at, id"
    ))
    .bind(employee.employee.id().as_str())
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    let records = rows
        .iter()
        .map(decode_persisted)
        .collect::<Result<Vec<_>, AppError>>()?;
    let mine = employee.employee.id().as_str().to_owned();
    rehydrate_all(pool, records, |id| (id == mine).then_some(employee)).await
}

/// One raw punch row as a screen sees it.
///
/// Flat, and carrying the two instants and the clock quality, because the gap
/// between "the device thought it was 08:03" and "it reached us at 17:40" is
/// exactly what an auditor asks about a day a unit was offline.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PunchRow {
    pub id: String,
    pub employee_id: String,
    pub place_id: String,
    /// `TERMINAL` or `EMPLOYEE_APP`. **Sent explicitly rather than inferred
    /// from `terminal_id` being absent**, because a screen that inferred it
    /// would be one refactor away from presenting a phone tap as a reading —
    /// and the whole reason migration `0239` adds a column is that the two must
    /// stay distinguishable without anybody guessing.
    pub source: String,
    /// The station that took it. `null` for a punch no station took, which is
    /// every punch from the employee app.
    pub terminal_id: Option<String>,
    pub direction: String,
    pub business_date: NaiveDate,
    /// `HH:MM`, and `+1` when the reading falls after midnight on the same
    /// shift — a rota is read off a wall, not divided.
    pub at: String,
    pub recorded_at: DateTime<Utc>,
    pub received_at: DateTime<Utc>,
    pub clock_quality: String,
}

fn punch_row(punch: &Punch, received_at: DateTime<Utc>) -> PunchRow {
    PunchRow {
        id: punch.id().to_string(),
        employee_id: punch.employee().to_string(),
        place_id: punch.place().to_string(),
        source: punch.source().code().to_owned(),
        terminal_id: punch.terminal().map(ToString::to_string),
        direction: punch.direction().code().to_owned(),
        business_date: punch.business_date(),
        at: punch.at().to_string(),
        recorded_at: punch.recorded_at(),
        received_at,
        clock_quality: punch.clock_quality().code().to_owned(),
    }
}

/// Every punch at one place on one business date, with the person's name.
///
/// The **Today** screen's read. Deliberately returns the raw observations
/// rather than outcomes: the outcomes need the plan and the policy, and a
/// screen that wants them asks for the derivation.
pub async fn punches_at_place_on(
    pool: &PgPool,
    place: &PlaceId,
    date: NaiveDate,
) -> Result<Vec<PunchRow>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {PUNCH_COLUMNS}, received_at FROM attendance_punch
          WHERE place_id = $1 AND business_date = $2
          ORDER BY day_offset, minute, recorded_at, id"
    ))
    .bind(place.as_str())
    .bind(date)
    .fetch_all(pool)
    .await?;

    // The records first, then their people, then the rehydration — rather than
    // one pass doing all three — because `rehydrate_all` borrows the map and a
    // loop that also inserted into it could not hold both.
    let mut records = Vec::with_capacity(rows.len());
    let mut received = Vec::with_capacity(rows.len());
    for row in &rows {
        records.push(decode_persisted(row)?);
        received.push(row.try_get::<DateTime<Utc>, _>("received_at")?);
    }
    let mut employees: HashMap<String, super::EmployeeRecord> = HashMap::new();
    for record in &records {
        let employee_id = record.employee.as_str();
        if employees.contains_key(employee_id) {
            continue;
        }
        let loaded = super::load_employee(pool, employee_id)
            .await?
            .ok_or_else(|| {
                corrupt(
                    "punch",
                    format!("it names employee {employee_id}, who has no record"),
                )
            })?;
        employees.insert(employee_id.to_owned(), loaded);
    }
    let punches = rehydrate_all(pool, records, |id| employees.get(id)).await?;
    Ok(punches
        .iter()
        .zip(received)
        .map(|(punch, received_at)| punch_row(punch, received_at))
        .collect())
}

/// The `org_place` a syncing node *is*.
///
/// # Why this is a join and not a string comparison
///
/// `sync_origin_credential.origin_id` and `org_place.id` are different
/// vocabularies, and in this deployment they are known to disagree: the cloud
/// spells the warehouse `dc` while the edge node is `dc-01`. Comparing them
/// would refuse every DC punch here, and — worse, somewhere else — could match
/// the wrong unit. So the route is `origin → site_id → org_place.site_id`,
/// which is the relationship that actually exists.
///
/// `None` for an origin that is registered but bound to no site. That is a real
/// state — a node provisioned before anybody said which shop it is in — and it
/// must be a named refusal rather than a punch filed against nowhere.
pub async fn place_of_origin(pool: &PgPool, origin_id: &str) -> Result<Option<PlaceId>, AppError> {
    let place: Option<String> = sqlx::query_scalar(
        "SELECT p.id
           FROM sync_origin_credential o
           JOIN org_place p ON p.site_id = o.site_id
          WHERE o.origin_id = $1",
    )
    .bind(origin_id)
    .fetch_optional(pool)
    .await?
    .flatten();
    place
        .as_deref()
        .map(PlaceId::try_new)
        .transpose()
        .map_err(|error| corrupt("origin place", error.to_string()))
}

// ── corrections ──────────────────────────────────────────────────────────

const CORRECTION_COLUMNS: &str =
    "id, employee_id, place_id, business_date, effect, supersedes, requested, state, \
     decision, chain_seq";

fn decode_correction(row: &sqlx::postgres::PgRow) -> Result<Correction, AppError> {
    let id: String = row.try_get("id")?;
    let employee: String = row.try_get("employee_id")?;
    let place: String = row.try_get("place_id")?;
    let date: NaiveDate = row.try_get("business_date")?;
    let effect: serde_json::Value = row.try_get("effect")?;
    let supersedes: Option<String> = row.try_get("supersedes")?;
    let requested: serde_json::Value = row.try_get("requested")?;
    let state: String = row.try_get("state")?;
    let decision: Option<serde_json::Value> = row.try_get("decision")?;

    let decision = decision
        .map(serde_json::from_value::<Authorization>)
        .transpose()
        .map_err(|error| corrupt("correction decision", error.to_string()))?;
    // The state and its evidence are reassembled together, so a row whose
    // `state` says APPROVED with no decision cannot become an approval. The
    // check constraint in `0234` says the same thing; this is the first copy.
    let state = match (state.as_str(), decision) {
        ("PENDING", None) => CorrectionState::Pending,
        ("APPROVED", Some(decision)) => CorrectionState::Approved { decision },
        ("REJECTED", Some(decision)) => CorrectionState::Rejected { decision },
        ("WITHDRAWN", Some(decision)) => CorrectionState::Withdrawn { decision },
        (state, _) => {
            return Err(corrupt(
                "correction state",
                format!("`{state}` does not match the decision recorded beside it"),
            ))
        }
    };

    Correction::try_new(
        CorrectionId::try_new(&id).map_err(|error| corrupt("correction id", error.to_string()))?,
        EmployeeId::try_new(&employee)
            .map_err(|error| corrupt("correction employee", error.to_string()))?,
        PlaceId::try_new(&place).map_err(|error| corrupt("correction place", error.to_string()))?,
        date,
        serde_json::from_value::<CorrectionEffect>(effect)
            .map_err(|error| corrupt("correction effect", error.to_string()))?,
        supersedes
            .as_deref()
            .map(CorrectionId::try_new)
            .transpose()
            .map_err(|error| corrupt("correction lineage", error.to_string()))?,
        serde_json::from_value::<Authorization>(requested)
            .map_err(|error| corrupt("correction request", error.to_string()))?,
        state,
    )
    .map_err(|error| corrupt("attendance correction", error.to_string()))
}

/// The whole chain for one `(employee, place, date)`, in submission order.
///
/// An empty chain is a real answer, not a 404: most days have no corrections
/// and asking about one is how a correction gets filed.
pub async fn load_correction_chain(
    pool: &PgPool,
    employee: &EmployeeId,
    place: &PlaceId,
    date: NaiveDate,
) -> Result<CorrectionChain, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {CORRECTION_COLUMNS} FROM attendance_correction
          WHERE employee_id = $1 AND place_id = $2 AND business_date = $3
          ORDER BY chain_seq"
    ))
    .bind(employee.as_str())
    .bind(place.as_str())
    .bind(date)
    .fetch_all(pool)
    .await?;
    let corrections = rows
        .iter()
        .map(decode_correction)
        .collect::<Result<Vec<_>, AppError>>()?;
    CorrectionChain::try_new(employee.clone(), place.clone(), date, corrections)
        .map_err(|error| corrupt("correction chain", error.to_string()))
}

/// Write a chain back: every correction, at its own sequence position.
///
/// The whole chain rather than one row, because the rules — at most one
/// pending, supersede the one in force — are statements about the chain and the
/// domain is what validated it. Writing one row would move the rule into a
/// statement that cannot express it.
pub async fn save_correction_chain(pool: &PgPool, chain: &CorrectionChain) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    for (index, correction) in chain.corrections().iter().enumerate() {
        let seq = i32::try_from(index + 1).unwrap_or(i32::MAX);
        sqlx::query(
            "INSERT INTO attendance_correction
                (id, employee_id, place_id, business_date, effect, supersedes,
                 requested, state, decision, chain_seq)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO UPDATE SET
                state = EXCLUDED.state,
                decision = EXCLUDED.decision,
                updated_at = now()",
        )
        .bind(correction.id().as_str())
        .bind(correction.employee().as_str())
        .bind(correction.place().as_str())
        .bind(correction.date())
        .bind(serde_json::to_value(correction.effect())?)
        .bind(correction.supersedes().map(CorrectionId::as_str))
        .bind(serde_json::to_value(correction.requested())?)
        .bind(correction.state().code())
        .bind(
            correction
                .state()
                .decision()
                .map(serde_json::to_value)
                .transpose()?,
        )
        .bind(seq)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// A correction as the Requests queue reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CorrectionRow {
    pub id: String,
    pub employee_id: String,
    pub employee_code: String,
    pub display_name: String,
    pub place_id: String,
    pub business_date: NaiveDate,
    /// `ARRIVAL`, `DEPARTURE`, `ARRIVAL_AND_DEPARTURE` or `APPROVED_LEAVE`.
    pub effect: String,
    pub corrected_arrival: Option<String>,
    pub corrected_departure: Option<String>,
    pub state: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    pub reason: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_reason: Option<String>,
    pub supersedes: Option<String>,
    pub chain_seq: i32,
}

fn correction_row(
    correction: &Correction,
    employee_code: String,
    display_name: String,
    chain_seq: i32,
) -> CorrectionRow {
    let decision = correction.state().decision();
    CorrectionRow {
        id: correction.id().to_string(),
        employee_id: correction.employee().to_string(),
        employee_code,
        display_name,
        place_id: correction.place().to_string(),
        business_date: correction.date(),
        effect: correction.effect().code().to_owned(),
        corrected_arrival: correction.effect().arrival().map(|at| at.to_string()),
        corrected_departure: correction.effect().departure().map(|at| at.to_string()),
        state: correction.state().code().to_owned(),
        requested_by: correction.requested().actor().to_string(),
        requested_at: correction.requested().at(),
        reason: correction.requested().reason().to_string(),
        decided_by: decision.map(|authority| authority.actor().to_string()),
        decided_at: decision.map(Authorization::at),
        decision_reason: decision.map(|authority| authority.reason().to_string()),
        supersedes: correction.supersedes().map(CorrectionId::to_string),
        chain_seq,
    }
}

/// Corrections at one or more places, optionally only the undecided ones.
///
/// The Requests queue's read, and the reason it takes a slice of places rather
/// than one: a head-office caller reaches everywhere and a place manager
/// reaches one, and the caller's `Reach` decides which — resolved at the
/// handler, so this function never has to know about rungs.
pub async fn corrections_at_places(
    pool: &PgPool,
    places: &[String],
    pending_only: bool,
) -> Result<Vec<CorrectionRow>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT c.{}, e.code AS employee_code,
                coalesce(p.full_name, e.code) AS display_name
           FROM attendance_correction c
           JOIN employee e ON e.id = c.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = c.employee_id
          WHERE ($1::text[] IS NULL OR c.place_id = ANY($1))
            AND ($2 = false OR c.state = 'PENDING')
          ORDER BY c.business_date DESC, c.chain_seq DESC",
        CORRECTION_COLUMNS.replace(", ", ", c.")
    ))
    .bind(if places.is_empty() {
        None
    } else {
        Some(places)
    })
    .bind(pending_only)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let correction = decode_correction(row)?;
            let chain_seq: i32 = row.try_get("chain_seq")?;
            Ok(correction_row(
                &correction,
                row.try_get("employee_code")?,
                row.try_get("display_name")?,
                chain_seq,
            ))
        })
        .collect()
}

/// The chain for one day, flattened for a screen.
pub async fn correction_rows_for_day(
    pool: &PgPool,
    employee: &EmployeeId,
    place: &PlaceId,
    date: NaiveDate,
    employee_code: &str,
    display_name: &str,
) -> Result<Vec<CorrectionRow>, AppError> {
    let chain = load_correction_chain(pool, employee, place, date).await?;
    Ok(chain
        .corrections()
        .iter()
        .enumerate()
        .map(|(index, correction)| {
            correction_row(
                correction,
                employee_code.to_owned(),
                display_name.to_owned(),
                i32::try_from(index + 1).unwrap_or(i32::MAX),
            )
        })
        .collect())
}

// ── the book a station runs on ───────────────────────────────────────────

/// How much roster travels with a book.
///
/// Yesterday, because an overnight shift's clock-out at 02:00 is filed against
/// the day the shift *started* and a station has to be able to show it. And a
/// fortnight ahead, which is the same span
/// `edge::attendance::BOOK_STALE_AFTER_DAYS` refuses a book after: a station
/// that has been offline for as long as its book covers has run out of plan at
/// the same moment it runs out of trust in it, which is the only arrangement
/// where neither number can quietly outlive the other.
pub const BOOK_ROSTER_BEHIND_DAYS: i64 = 1;
pub const BOOK_ROSTER_AHEAD_DAYS: i64 = 14;

/// Assemble the book for one unit.
///
/// # What goes in, and the one thing that does not
///
/// The people **posted here today** — through the open `employee_assignment`
/// span, not through "who ever worked here" — their roster for the window
/// above, and the unit's registered stations with their current trust.
///
/// No templates. Matching happens on the reader and the hardware agent holds
/// the loaded set, which it pulls from `/attendance/terminal-sync` over the
/// node's own credential. Putting them in the book as well would copy regulated
/// biometric data into thirteen shops' SQLite files for nothing the agent's own
/// loaded set does not already give.
///
/// Suspended and revoked stations travel too, with their status. A station the
/// book left out would be a station the edge treats as unregistered, which
/// produces the wrong refusal — "not registered here" rather than "suspended" —
/// and sends a manager looking for the wrong person.
pub async fn attendance_book_for_place(
    pool: &PgPool,
    place: &PlaceId,
    today: NaiveDate,
) -> Result<crate::cloud::domain::AttendanceBook, AppError> {
    use crate::cloud::domain::{AttendanceBook, BookEmployee, BookRosterDay, BookTerminal};

    let from = today - chrono::Duration::days(BOOK_ROSTER_BEHIND_DAYS);
    let to = today + chrono::Duration::days(BOOK_ROSTER_AHEAD_DAYS);

    let people = sqlx::query(
        "SELECT e.id, e.code, coalesce(p.full_name, e.code) AS display_name
           FROM employee e
           JOIN employee_assignment a ON a.employee_id = e.id AND a.valid_to IS NULL
           LEFT JOIN employee_profile p ON p.employee_id = e.id
          WHERE a.place_id = $1 AND e.status = 'ACTIVE'
          ORDER BY e.code",
    )
    .bind(place.as_str())
    .fetch_all(pool)
    .await?;
    let employees = people
        .iter()
        .map(|row| {
            Ok(BookEmployee {
                employee_id: row.try_get("id")?,
                code: row.try_get("code")?,
                display_name: row.try_get("display_name")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    // The plan in force, which is the *last* revision rather than the first:
    // `planned` is what the day was originally, and a station showing that
    // would show a shift somebody has since moved.
    let days = super::roster_at_place(pool, place.as_str(), from, to).await?;
    let roster = days
        .iter()
        .map(|day| {
            let plan = day.plan();
            let shift = plan.shift();
            BookRosterDay {
                employee_id: day.employee().to_string(),
                on_date: day.date(),
                plan: plan.code().to_owned(),
                shift_id: shift.map(|shift| shift.id().to_string()),
                shift_name: shift.map(|shift| shift.name().to_owned()),
                start_minute: shift.map(|shift| shift.start().minutes()),
                end_minute: shift.map(|shift| shift.end().minutes()),
                end_day_offset: shift.map(|shift| shift.end_day_offset().days()),
                unpaid_break_min: shift.map(|shift| shift.unpaid_break().get()),
            }
        })
        .collect();

    let stations = super::list_attendance_terminals(pool, Some(place.as_str())).await?;
    let terminals = stations
        .into_iter()
        .map(|row| BookTerminal {
            terminal_id: row.id,
            name: row.name,
            status: row.status,
        })
        .collect();

    Ok(AttendanceBook {
        place_id: place.as_str().to_owned(),
        // Stamped here, because "when the centre published it" is what lets a
        // station say the book is from Tuesday. A receive time stamped at the
        // edge would read as freshness the data does not have.
        published_at: Utc::now(),
        employees,
        roster,
        terminals,
    })
}

/// The origins bound to one place's site.
///
/// Usually one. Zero for head office, which has no node — and that is a named
/// refusal rather than a silent no-op, because "we published the book" and
/// "there was nowhere to publish it to" must not look the same on a screen.
pub async fn origins_of_place(pool: &PgPool, place: &PlaceId) -> Result<Vec<String>, AppError> {
    let origins: Vec<String> = sqlx::query_scalar(
        "SELECT o.origin_id
           FROM sync_origin_credential o
           JOIN org_place p ON p.site_id = o.site_id
          WHERE p.id = $1
          ORDER BY o.origin_id",
    )
    .bind(place.as_str())
    .fetch_all(pool)
    .await?;
    Ok(origins)
}

/// Which day one correction is about.
///
/// The decision and withdrawal routes take a correction id and nothing else, so
/// they have to find its chain. Asking the caller to restate the employee, the
/// place and the date would make three fields a caller could get wrong — and one
/// of the wrong answers is "somebody else's day".
pub async fn correction_target(
    pool: &PgPool,
    id: &str,
) -> Result<Option<(String, String, NaiveDate)>, AppError> {
    let row = sqlx::query(
        "SELECT employee_id, place_id, business_date
           FROM attendance_correction WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some((
        row.try_get("employee_id")?,
        row.try_get("place_id")?,
        row.try_get("business_date")?,
    )))
}

/// Who has a plan at one place on one date.
///
/// The Today screen's outer loop, and it is deliberately the **roster** rather
/// than the punches: a day's outcome exists against a plan, so somebody nobody
/// scheduled is not on this screen at all — while somebody scheduled who never
/// arrived is, which is the row that matters.
pub async fn rostered_at_place_on(
    pool: &PgPool,
    place: &PlaceId,
    date: NaiveDate,
) -> Result<Vec<String>, AppError> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT employee_id FROM roster_day
          WHERE place_id = $1 AND on_date = $2
          ORDER BY employee_id",
    )
    .bind(place.as_str())
    .bind(date)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── the counts the close was waiting for ─────────────────────────────────

/// Corrections still awaiting a decision in one `(place, month)`.
///
/// **This is one of the two numbers `CloseReadiness` carried as `None`.** It
/// reported "not assessed" because there was no punch source and therefore no
/// corrections to be open. There is one now, so the count is real — and a
/// close taken today records that somebody looked.
pub async fn open_corrections_in(
    pool: &PgPool,
    place: &PlaceId,
    month: AttendanceMonth,
) -> Result<u32, AppError> {
    let first = month
        .first_day()
        .ok_or_else(|| corrupt("period", "no first day".to_owned()))?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM attendance_correction
          WHERE place_id = $1 AND state = 'PENDING'
            AND business_date >= $2::date
            AND business_date < ($2::date + interval '1 month')",
    )
    .bind(place.as_str())
    .bind(first)
    .fetch_one(pool)
    .await?;
    Ok(u32::try_from(count).unwrap_or(u32::MAX))
}

/// `(employee, business_date)` pairs with punches and no roster entry.
///
/// **The second number that was `None`.** It blocks the close, and it should:
/// a day somebody was observed working and nobody planned is either a roster
/// somebody forgot to write or a punch that should not exist, and closing over
/// it settles a month around a question nobody asked. Both fixes are cheap
/// while the month is open and expensive afterwards.
pub async fn unrostered_punch_days_in(
    pool: &PgPool,
    place: &PlaceId,
    month: AttendanceMonth,
) -> Result<u32, AppError> {
    let first = month
        .first_day()
        .ok_or_else(|| corrupt("period", "no first day".to_owned()))?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM (
            SELECT DISTINCT pu.employee_id, pu.business_date
              FROM attendance_punch pu
             WHERE pu.place_id = $1
               AND pu.business_date >= $2::date
               AND pu.business_date < ($2::date + interval '1 month')
               AND NOT EXISTS (
                   SELECT 1 FROM roster_day r
                    WHERE r.employee_id = pu.employee_id
                      AND r.on_date = pu.business_date
               )
         ) AS unplanned",
    )
    .bind(place.as_str())
    .bind(first)
    .fetch_one(pool)
    .await?;
    Ok(u32::try_from(count).unwrap_or(u32::MAX))
}

/// Whether this place has any punch source at all.
///
/// Read before a close so the readiness can distinguish the two honest
/// answers: "the punch checks were made and passed" from "this unit has no
/// terminal, so there was nothing to check". A unit with no registered
/// terminal still closes — it must, or its payroll could never run — and the
/// recorded evidence says the checks were **not assessed** rather than that
/// they were clean.
pub async fn place_has_terminal(pool: &PgPool, place: &PlaceId) -> Result<bool, AppError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM attendance_terminal
          WHERE place_id = $1 AND status <> 'REVOKED'",
    )
    .bind(place.as_str())
    .fetch_one(pool)
    .await?;
    Ok(count > 0)
}
