//! Hire proposals, as rows.
//!
//! # The guard is on the way out, as it is for employment
//!
//! `hire_proposal.state` is written beside `history` and the two cannot
//! disagree, because the only thing that produces a row here is a
//! [`HireProposal`], and one of those cannot exist with a state its history
//! does not fold to. Coming back, every read decodes through
//! [`HireProposal::try_new`] — so a row edited by hand in `psql` fails to
//! hydrate rather than quietly becoming the answer. The rule that matters most
//! is the owner's: an approval signed by the person who proposed it does not
//! load.
//!
//! # Why the versions are read as a set and checked here
//!
//! The loaded domain type carries the version number as a *position* rather
//! than a field, so the two cannot drift. That only holds if the rows really
//! are 1..n, which is a fact about a `SELECT` and not about the type — so
//! [`decode_versions`] checks it. A hand-deleted version 2 shifts every later
//! row's meaning, and shifted meanings are how "this was approved at 3.2
//! million" becomes a sentence about the wrong figure.
//!
//! # One write path, and it is idempotent about versions
//!
//! Every save rewrites the state and the history and offers every version row
//! with `ON CONFLICT DO NOTHING`. A proposal holds one or two versions in
//! practice, so the cost is nothing, and the alternative — "insert only the
//! newest one" — is a second thing the caller has to get right, on the write
//! whose whole job is to not lose what was asked for before.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    CandidateName, ContractKind, HireError, HireProposal, HireProposalEvent, HireProposalId,
    HireProposalState, HireProposalWire, HiringNeed, PlaceId, Position, ProposedTerms,
};
use chrono::{DateTime, NaiveDate, Utc};
use pricing_engine::Money;
use sqlx::{postgres::PgRow, PgPool, Postgres, Row, Transaction};
use std::collections::BTreeMap;

/// A stored row that cannot be true. See `postgres::employment` for why this
/// is a configuration error rather than a validation one: nothing the caller
/// sent is wrong, and the database is holding a record no sequence of legal
/// operations could have produced.
fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The row disagrees with the rules it encodes."
    ))
}

/// Turn a domain refusal into the right HTTP answer.
pub fn hire_error(error: HireError) -> AppError {
    if error.is_forbidden() {
        AppError::Forbidden(error.to_string())
    } else if error.is_conflict() {
        AppError::Conflict(error.to_string())
    } else {
        AppError::Validation(error.to_string())
    }
}

/// One proposal, with the two timestamps a screen shows.
pub struct HireProposalRecord {
    pub proposal: HireProposal,
    /// The unit's own name.
    ///
    /// Beside the proposal rather than inside it, for the reason
    /// `EmployeeRecord::place_names` gives: a display name is not part of what
    /// makes a proposal valid, and a screen showing `ho` where it means "Head
    /// Office" is an identifier that has escaped into the interface.
    pub place_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

const PROPOSAL_COLUMNS: &str = "proposal.id, proposal.place_id, proposal.state, \
                                proposal.history, proposal.created_at, proposal.updated_at, \
                                unit.name AS place_name";

/// Every read joins the unit, so no caller can serve a proposal whose shop it
/// forgot to name.
const PROPOSAL_FROM: &str = "FROM hire_proposal proposal \
                             LEFT JOIN org_place unit ON unit.id = proposal.place_id";
const VERSION_COLUMNS: &str = "proposal_id, version, position, headcount, need, candidate_name, \
                               start_on, contract_kind, contract_ends_on, base_pay_minor";

/// What a caller may see, and what they asked for.
///
/// `reach_place` is the fence and `place_id` is the filter, the pair
/// `EmployeeScope` established: they are the same value for a bounded caller
/// today, and the query applies both, so the day somebody edits the
/// reconciliation in the handler without reading it the answer narrows rather
/// than widens.
pub struct HireProposalScope {
    /// The one place a bounded caller may see, or `None` for head office.
    pub reach_place: Option<String>,
    /// The place the caller asked about, already reconciled against their
    /// reach.
    pub place_id: Option<String>,
    /// `PROPOSED`, `RETURNED`, `APPROVED`, `REJECTED` or `FILLED`.
    pub state: Option<String>,
    pub limit: Option<i64>,
}

/// How many proposals one request may see.
///
/// Clamped here rather than in the handler, so there is one spelling of it. A
/// unit files a handful of these a year, so this is a guard against a caller
/// asking for everything rather than a paging strategy — and the day a shop has
/// more than this outstanding, the list is not the problem.
const MAX_ROWS: i64 = 200;

// ── reading ──────────────────────────────────────────────────────────────

fn decode_terms(row: &PgRow) -> Result<(u32, ProposedTerms), AppError> {
    let version: i32 = row.try_get("version")?;
    let headcount: i32 = row.try_get("headcount")?;
    let kind: String = row.try_get("contract_kind")?;
    let ends_on: Option<NaiveDate> = row.try_get("contract_ends_on")?;
    // The pairing the `hire_proposal_version_term_matches_kind` constraint also
    // enforces, restated where the decoding happens: a fixed term names the day
    // it ends and a permanent contract has nowhere to put one. A row satisfying
    // neither shape is refused rather than resolved to the nearest kind.
    let contract = match (kind.as_str(), ends_on) {
        ("PKWT", Some(ends_on)) => ContractKind::Pkwt { ends_on },
        ("PKWTT", None) => ContractKind::Pkwtt,
        (kind, _) => {
            return Err(corrupt(
                "proposed contract kind",
                format!("{kind} does not match the end date beside it"),
            ))
        }
    };
    let terms = ProposedTerms::try_new(
        Position::try_new(&row.try_get::<String, _>("position")?)
            .map_err(|error| corrupt("proposed position", error.to_string()))?,
        u32::try_from(headcount)
            .map_err(|_| corrupt("headcount", format!("{headcount} is not a count")))?,
        HiringNeed::parse(&row.try_get::<String, _>("need")?)
            .ok_or_else(|| corrupt("hiring need", "expected REPLACEMENT or ADDITION".to_owned()))?,
        CandidateName::try_new(&row.try_get::<String, _>("candidate_name")?)
            .map_err(|error| corrupt("candidate name", error.to_string()))?,
        row.try_get("start_on")?,
        contract,
        Money::new(row.try_get::<i64, _>("base_pay_minor")?),
    )
    .map_err(|error| corrupt("proposed terms", error.to_string()))?;
    let version = u32::try_from(version)
        .map_err(|_| corrupt("version", format!("{version} is not a version number")))?;
    Ok((version, terms))
}

/// The versions of one proposal, checked to be exactly 1..n.
///
/// The rows arrive ordered; what this adds is the assertion that no number is
/// missing. Without it a deleted version 2 would silently renumber version 3,
/// and every decision recorded against "version 3" would be reporting the
/// wrong terms.
fn decode_versions(rows: &[PgRow]) -> Result<Vec<ProposedTerms>, AppError> {
    let mut versions = Vec::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        let (version, terms) = decode_terms(row)?;
        let expected = u32::try_from(index + 1).unwrap_or(u32::MAX);
        if version != expected {
            return Err(corrupt(
                "hire proposal versions",
                format!("version {version} is stored where {expected} should be"),
            ));
        }
        versions.push(terms);
    }
    Ok(versions)
}

fn decode(row: &PgRow, versions: Vec<ProposedTerms>) -> Result<HireProposalRecord, AppError> {
    let state_raw: String = row.try_get("state")?;
    let state = HireProposalState::parse(&state_raw)
        .ok_or_else(|| corrupt("hire proposal state", state_raw.clone()))?;
    let history: serde_json::Value = row.try_get("history")?;
    let history: Vec<HireProposalEvent> = serde_json::from_value(history)
        .map_err(|error| corrupt("hire proposal history", error.to_string()))?;

    // This call is the whole point of the module: it re-runs the machine over
    // `history`, refuses a state the steps do not produce, and refuses an
    // approval signed by the actor who proposed it.
    let proposal = HireProposal::try_new(HireProposalWire {
        id: HireProposalId::try_new(&row.try_get::<String, _>("id")?)
            .map_err(|error| corrupt("hire proposal id", error.to_string()))?,
        place: PlaceId::try_new(&row.try_get::<String, _>("place_id")?)
            .map_err(|error| corrupt("hire proposal place", error.to_string()))?,
        state,
        versions,
        history,
    })
    .map_err(|error| corrupt("hire proposal", error.to_string()))?;

    Ok(HireProposalRecord {
        proposal,
        place_name: row.try_get("place_name")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn versions_of(pool: &PgPool, ids: &[String]) -> Result<Vec<PgRow>, AppError> {
    Ok(sqlx::query(&format!(
        "SELECT {VERSION_COLUMNS} FROM hire_proposal_version
          WHERE proposal_id = ANY($1) ORDER BY proposal_id, version"
    ))
    // Owned rather than borrowed: `Vec<T>` is the array binding every other
    // `= ANY($1)` in this estate uses, and a slice is one inference away from
    // being encoded as something else.
    .bind(ids.to_vec())
    .fetch_all(pool)
    .await?)
}

pub async fn load_hire_proposal(
    pool: &PgPool,
    id: &str,
) -> Result<Option<HireProposalRecord>, AppError> {
    let Some(row) = sqlx::query(&format!(
        "SELECT {PROPOSAL_COLUMNS} {PROPOSAL_FROM} WHERE proposal.id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let versions = decode_versions(&versions_of(pool, &[id.to_owned()]).await?)?;
    decode(&row, versions).map(Some)
}

/// The proposals a caller may see, newest first.
///
/// Two queries rather than a join, because a join would return one row per
/// version and the assembly would have to undo it. The second query is keyed
/// on the ids the first returned, so the fence has already been applied when it
/// runs.
pub async fn list_hire_proposals(
    pool: &PgPool,
    scope: HireProposalScope,
) -> Result<Vec<HireProposalRecord>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {PROPOSAL_COLUMNS} {PROPOSAL_FROM}
          WHERE ($1::text IS NULL OR proposal.place_id = $1)
            AND ($2::text IS NULL OR proposal.place_id = $2)
            AND ($3::text IS NULL OR proposal.state = $3)
          ORDER BY proposal.created_at DESC, proposal.id
          LIMIT $4"
    ))
    .bind(&scope.reach_place)
    .bind(&scope.place_id)
    .bind(&scope.state)
    .bind(scope.limit.unwrap_or(MAX_ROWS).clamp(1, MAX_ROWS))
    .fetch_all(pool)
    .await?;

    let ids: Vec<String> = rows
        .iter()
        .map(|row| row.try_get::<String, _>("id"))
        .collect::<Result<_, _>>()?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // Grouped rather than filtered per proposal: a `PgRow` is not `Clone`, and
    // the query already returns them ordered by proposal and then by version,
    // so pushing into a map keeps that order without copying anything.
    let mut grouped: BTreeMap<String, Vec<PgRow>> = BTreeMap::new();
    for version in versions_of(pool, &ids).await? {
        let owner: String = version.try_get("proposal_id")?;
        grouped.entry(owner).or_default().push(version);
    }

    let mut records = Vec::with_capacity(rows.len());
    for row in &rows {
        let id: String = row.try_get("id")?;
        // A proposal with no versions is a request that says nothing, and the
        // domain refuses it by name rather than serving a row with no terms.
        let mine = grouped.remove(&id).unwrap_or_default();
        records.push(decode(row, decode_versions(&mine)?)?);
    }
    Ok(records)
}

/// The unit a proposal may name, and its name.
///
/// `None` for a unit `org_place` does not hold, which the handler answers as a
/// refusal the caller can read rather than letting the foreign key answer it
/// with a 500. After 0230 the units are head office plus Store 01 to Store 13.
pub async fn hire_proposal_unit(pool: &PgPool, place_id: &str) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT name FROM org_place WHERE id = $1")
            .bind(place_id)
            .fetch_optional(pool)
            .await?,
    )
}

/// Whether an employee code is already somebody's.
///
/// A read, and deliberately a pre-flight one. `register_employee` holds the
/// authoritative check inside its own transaction and that is the one that
/// decides — but by the time it runs, `http::hire::open_employment` has already
/// recorded the step that says an employment record was opened. A duplicate
/// badge number is the most ordinary mistake anybody will make on that form,
/// and without this it would leave a FILLED proposal naming a record that was
/// never written. Asking first turns a typo back into a 409.
pub async fn employee_code_taken_by(pool: &PgPool, code: &str) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM employee WHERE code = $1")
            .bind(code)
            .fetch_optional(pool)
            .await?,
    )
}

// ── writing ──────────────────────────────────────────────────────────────

/// Offer every version row. Existing ones are left exactly as they are — this
/// table is append-only, and an `UPDATE` here would be the in-place edit a
/// revision exists to avoid.
async fn write_versions(
    tx: &mut Transaction<'_, Postgres>,
    proposal: &HireProposal,
) -> Result<(), AppError> {
    for (index, terms) in proposal.versions().enumerate() {
        let version = i32::try_from(index + 1).unwrap_or(i32::MAX);
        sqlx::query(
            "INSERT INTO hire_proposal_version
                 (proposal_id, version, position, headcount, need, candidate_name,
                  start_on, contract_kind, contract_ends_on, base_pay_minor)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (proposal_id, version) DO NOTHING",
        )
        .bind(proposal.id().as_str())
        .bind(version)
        .bind(terms.position().as_str())
        .bind(i32::try_from(terms.headcount()).unwrap_or(i32::MAX))
        .bind(terms.need().code())
        .bind(terms.candidate().as_str())
        .bind(terms.start_on())
        .bind(terms.contract().code())
        .bind(terms.contract().ends_on())
        .bind(terms.base_pay().minor)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// File a proposal and its first version, in one transaction.
///
/// One without the other is the shape to avoid: a proposal with no version is a
/// request that says nothing, and a version with no proposal is terms nobody
/// asked for.
pub async fn insert_hire_proposal(pool: &PgPool, proposal: &HireProposal) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO hire_proposal (id, place_id, state, history)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(proposal.id().as_str())
    .bind(proposal.place().as_str())
    .bind(proposal.state().code())
    .bind(serde_json::to_value(proposal.history())?)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "a hire proposal {} already exists",
            proposal.id()
        )));
    }
    write_versions(&mut tx, proposal).await?;
    tx.commit().await?;
    Ok(())
}

/// Record a decision, a revision, or an employment record opened against a
/// proposal.
///
/// `from` is the state the caller read, and the `WHERE` clause makes the update
/// a no-op against a row somebody else has since moved — which the caller reads
/// back as a conflict. Two people approving the same proposal at once is not
/// hypothetical: it is the queue's whole shape, several officers working one
/// list.
///
/// `place_id` is not in the statement. Which unit a proposal is for is
/// write-once: a revision may change the pay or the start date, and a proposal
/// that changed shops would be a different proposal.
pub async fn save_hire_proposal(
    pool: &PgPool,
    proposal: &HireProposal,
    from: HireProposalState,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let updated = sqlx::query(
        "UPDATE hire_proposal
            SET state = $2, history = $3, updated_at = now()
          WHERE id = $1 AND state = $4",
    )
    .bind(proposal.id().as_str())
    .bind(proposal.state().code())
    .bind(serde_json::to_value(proposal.history())?)
    .bind(from.code())
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "hire proposal {} is no longer {}; somebody else has answered it",
            proposal.id(),
            from.code()
        )));
    }
    write_versions(&mut tx, proposal).await?;
    tx.commit().await?;
    Ok(())
}
