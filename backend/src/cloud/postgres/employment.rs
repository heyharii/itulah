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
    ContractTimeline, Employee, EmployeeCode, EmployeeId, EmploymentStatus, EmploymentTransition,
    FullName, Grade, Nik, Position, Profile, UnitId,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
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
    /// `unit_id` → the place's name, for every place this person has been
    /// posted to.
    ///
    /// Beside the timeline rather than inside it: `AssignmentSpan` is a domain
    /// type and a display name is not part of what makes a posting valid. But a
    /// screen showing `ho` where it means "Head Office" is an id that has
    /// escaped into the interface, so the names travel with the record.
    pub unit_names: std::collections::HashMap<String, String>,
    pub profile: Option<Profile>,
    pub contracts: ContractTimeline,
    /// The login bound to this record, when there is one. Loaded with the
    /// record rather than fetched by whoever wants it, so no caller can serve
    /// an employee whose account it forgot to ask about.
    pub account: Option<AccountBinding>,
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
    pub unit_id: Option<String>,
    pub unit_name: Option<String>,
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
    pub unit_id: Option<String>,
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

type Assignments = (
    AssignmentTimeline,
    std::collections::HashMap<String, String>,
);

async fn load_assignments(pool: &PgPool, employee_id: &str) -> Result<Assignments, AppError> {
    let rows = sqlx::query(
        "SELECT a.unit_id, a.valid_from, a.valid_to, a.authorized, unit.name AS unit_name
           FROM employee_assignment a
           LEFT JOIN unit unit ON unit.id = a.unit_id
          WHERE a.employee_id = $1
          ORDER BY a.valid_from, a.id",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;

    let mut timeline = AssignmentTimeline::new();
    let mut names = std::collections::HashMap::new();
    for row in &rows {
        let unit_id: String = row.try_get("unit_id")?;
        if let Some(name) = row.try_get::<Option<String>, _>("unit_name")? {
            names.insert(unit_id.clone(), name);
        }
        let authorized: serde_json::Value = row.try_get("authorized")?;
        let span = AssignmentSpan::try_new(
            UnitId::try_new(&unit_id).map_err(|error| corrupt("unit id", error.to_string()))?,
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
    Ok((timeline, names))
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

    let (assignments, unit_names) = load_assignments(pool, employee_id).await?;
    Ok(Some(EmployeeRecord {
        employee: decode_employee(&row)?,
        assignments,
        unit_names,
        profile: load_profile(pool, employee_id).await?,
        contracts: load_contracts(pool, employee_id).await?,
        account: load_account(pool, employee_id).await?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    }))
}

// ── the workforce list ───────────────────────────────────────────────────
//
// Brought up to the shape `money_overview` set in `postgres::statements`: a
// scope struct assembled by the handler, a keyset cursor over the sort order,
// and an envelope carrying the page beside the size and the shape of the whole
// matched set. The convention is copied deliberately rather than reinvented —
// two list endpoints that page differently are two things to learn and two
// things to get wrong.

/// How many rows the workforce list returns when the caller does not say.
///
/// Here rather than in the handler, beside the only clamp that enforces it. It
/// was in both once, which is one spelling too many for a number that decides
/// how much of the company a screen can see.
const DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
///
/// A thousand, not `money_overview`'s two hundred, because this list has
/// callers that legitimately want the whole workforce in one read — the roster
/// and payroll pickers hold every active employee — and clamping them to a page
/// would silently drop people out of a dropdown. The envelope is what makes
/// that safe now: `total` says how many there really are, so a caller that hits
/// the ceiling can see that it did.
const MAX_LIMIT: i64 = 1000;

/// What a caller is asking the workforce list for.
///
/// Two fields here name a place, and the difference between them is the whole
/// reach model — see [`EmployeeScope::reach_place`].
#[derive(Clone, Debug, Default)]
pub struct EmployeeScope {
    /// The bound the caller's OWN POSTING puts on this answer, never anything
    /// they sent. `None` means unbounded — `Reach::Everywhere` — and never
    /// "nowhere", which the handler refuses long before it reaches here.
    ///
    /// Deliberately separate from `unit_id`, and both are applied. `unit_id`
    /// is a filter somebody chose and may change at will; this is a fence they
    /// cannot. Folding the two into one column works exactly as long as the
    /// handler keeps reconciling them correctly, and the day that
    /// reconciliation is edited by somebody who does not know it is
    /// load-bearing is the day a store manager is served another store's staff.
    /// Two fields cost one redundant predicate and make that edit harmless.
    pub reach_unit: Option<String>,
    /// Free text, tried against the employee number and the person's name.
    ///
    /// Those two and nothing else. A workforce list must not become a way to
    /// search the personal data it deliberately does not carry: matching on NIK
    /// or address would let a caller confirm a national identity number they
    /// already hold without ever being granted `people.profile.read` — see
    /// `domain::employment::audit`.
    pub needle: Option<String>,
    /// `CANDIDATE`, `ACTIVE`, `SUSPENDED` or `TERMINATED`, and one of them.
    ///
    /// Single-valued where `MoneyScope` takes a set, because a status is what
    /// somebody picks one of rather than a set they tick, and because this
    /// parameter already existed on this route with exactly this meaning. An
    /// unknown value narrows to nothing rather than being dropped: it is a
    /// column comparison, not a vocabulary this build has to recognise.
    pub status: Option<String>,
    /// The place the caller asked for, AFTER the handler has reconciled it
    /// against their reach. Never a raw query parameter.
    pub unit_id: Option<String>,
    /// `PKWT`, `PKWTT`, or `NONE` for somebody with no contract on file — the
    /// kind of the LATEST contract, which is the one the row shows.
    ///
    /// The directory filtered this in the browser over a thousand-row fetch;
    /// here so the filter survives paging.
    pub contract_kind: Option<String>,
    /// The latest contract's position, compared whole. One of the values the
    /// `positions` facet offered, not free text.
    pub position: Option<String>,
    /// `1` for somebody with a bound login, `0` for somebody without. A
    /// string rather than a flag because it arrives from a filter chip that
    /// names the facet value it was offered, and anything else narrows to
    /// nothing, as an unknown status does.
    pub login: Option<String>,
    /// `code`, `name`, `contract_end` or `place` — the closed set this server
    /// names, and nothing else is a sort.
    ///
    /// Anything unrecognised falls back to `code` rather than refusing, for the
    /// reason `MoneyScope::sort` gives: a sort arrives from a URL somebody may
    /// have kept from an older build, and a 400 for a stale bookmark is a worse
    /// answer than the rows in the house order.
    ///
    /// There is no `status` sort on purpose. Sorting four state names
    /// alphabetically groups nothing anybody asked for — "show me the suspended
    /// ones" is a filter, and the facet counts are how it is asked.
    pub sort: Option<String>,
    /// `true` for descending. Read for every key, the default included:
    /// unlike the money list's house order, employee number reversed is a
    /// direction somebody can mean.
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_LIMIT`], not "everything".
    ///
    /// Where `money_overview` treats an absent limit as unpaged, this route has
    /// always truncated — at two hundred, in silence, with no way for a caller
    /// to tell a short list from a full company. Keeping the default and
    /// answering with `total` beside it turns that silent truncation into a
    /// visible one, which is the whole point of the envelope.
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many rows would still be there.
///
/// `MoneyFacet`'s shape and `MoneyFacet`'s reasoning: a value that would leave
/// nothing is a value nobody should have to click to find out about. Counted
/// over everything the search and the caller's REACH leave, deliberately
/// ignoring which filters are currently applied — so the number reads as "how
/// many of these there are", which is the question somebody has while choosing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeFacet {
    /// What to send back as the filter — a status code, a place id. Never a
    /// display string.
    pub value: String,
    /// What to draw, when it differs from the value.
    ///
    /// Absent for a status, whose words belong to the screen ("Working here"
    /// is the hub's phrasing of `ACTIVE`, not the server's). Present for a
    /// place, because `store-01` is an id this system files it under and the
    /// list beside the filter shows `Store 01`.
    pub label: Option<String>,
    pub count: i64,
}

/// What this list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeFacets {
    pub statuses: Vec<EmployeeFacet>,
    /// **Empty for a caller bounded to one place**, and that is not the same as
    /// "no places matched". A filter offering a single value is a control that
    /// cannot change the answer, and drawing one beside a store manager's list
    /// suggests there is somewhere else they might look.
    ///
    /// Also deliberately silent about people posted nowhere. They are countable
    /// — an unposted record is head office's to place — but the filter has no
    /// spelling for "nowhere", and a count nobody can click is worse than no
    /// count. Only an unbounded caller ever sees such a row at all:
    /// `Reach::covers(None)` is true for `Everywhere` alone.
    pub units: Vec<EmployeeFacet>,
    /// The latest contract's kind — `PKWT`, `PKWTT`, or `NONE` for somebody
    /// with no contract on file.
    pub contract_kinds: Vec<EmployeeFacet>,
    /// The latest contract's position. People with no contract have none and
    /// are not counted here.
    pub positions: Vec<EmployeeFacet>,
    /// `1` with a bound login, `0` without.
    pub logins: Vec<EmployeeFacet>,
}

/// A page of the workforce, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeList {
    /// The place this answer is actually about, echoed back.
    ///
    /// Not merely the parameter repeated: for a caller bounded to one posting
    /// who asked for no place in particular, the server applied theirs, and
    /// saying so is the difference between a screen that reads as "the
    /// workforce" and one that reads as "your shop's workforce". A list that
    /// silently shows eight people where the company has ninety reads as a
    /// company of eight.
    pub unit_id: Option<String>,
    pub rows: Vec<EmployeeSummary>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset. People are hired, transferred and
    /// terminated while somebody pages through them, and an offset would skip
    /// or repeat rows without anything saying so — on a list where a skipped
    /// row is a person nobody looked at.
    pub next_cursor: Option<String>,
    /// Every row the search, the filters and the caller's reach match — not
    /// just this page. Without it a screen can only say "200 employees", which
    /// is a statement about the page size rather than about the company.
    pub total: i64,
    pub facets: EmployeeFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// It carries the employee id and nothing else, whatever the list is sorted by,
/// exactly as `MoneyCursor` carries the account map's natural key. The seek
/// re-reads that row's own sort value in SQL, so one cursor shape serves every
/// order and a fifth sort cannot arrive without its cursor.
///
/// Hex-wrapped JSON rather than a bare id, for the same reason: it is opaque,
/// so a client cannot start constructing one from an employee id it happens to
/// hold, and the shape can gain a field without every stored URL becoming a
/// cursor this server has to keep understanding.
#[derive(Serialize, Deserialize)]
struct EmployeeCursor {
    employee_id: String,
}

impl EmployeeCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One workforce row, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole reason
/// it is a constant: the facets are only honest if they count exactly what the
/// page can show. Two copies would agree on every ordinary day and part company
/// the moment somebody changes what "the current contract" means.
///
/// One query rather than N+1: the open posting, the latest contract and the
/// bound login are all joined in, because a list that fetched them per row
/// would make a page of forty people forty-one round trips.
///
/// Binds: `$1` the caller's reach bound or NULL, `$2` the search pattern or
/// NULL.
///
/// It stops at the REACH and the SEARCH. The status and place filters are
/// applied outside it by each caller, which is what lets one definition answer
/// two different questions from the same rows: the page wants what the filters
/// leave, while the filter panel's counts want what the search alone leaves —
/// because "Active 41" has to mean "there are 41 active people", not "41 among
/// the ones you have already narrowed to active".
///
/// The three `*_key` columns are computed here rather than only in `ORDER BY`
/// because the keyset has to COMPARE the sort value in a `WHERE`, and a sort
/// expression that is not also a column is one a `WHERE` cannot see. They are
/// non-null for a reason that is easy to miss and expensive to find: a row
/// comparison against NULL is NULL rather than true, so one person with no name
/// enrolled — or one permanent contract, which is most of them — would end
/// paging at whatever row happened to carry it, silently, with the rest of the
/// company below the fold.
///
/// `9999-12-31` is that rule for contracts, and it is the sort the hub was
/// doing in the browser: a term that never ends sorts after every term that
/// does. As a sentinel VALUE rather than a `NULLS LAST` decoration, because
/// `NULLS LAST` orders a result and says nothing a keyset can seek against.
const WORKFORCE_ROWS: &str = "
    SELECT e.id, e.code, e.status,
           p.full_name,
           a.unit_id, unit.name AS unit_name,
           c.kind AS contract_kind, c.ends_on AS contract_ends_on, c.position,
           u.username,
           -- An unenrolled record sorts to the front of the alphabet rather
           -- than vanishing into a NULL the keyset cannot compare. That is
           -- also the more useful answer: a list of people whose paperwork is
           -- unfinished is exactly what somebody sorting by name should meet.
           COALESCE(p.full_name, '') AS name_key,
           COALESCE(unit.name, a.unit_id, '') AS unit_key,
           COALESCE(c.ends_on, DATE '9999-12-31') AS ends_at
      FROM employee e
      LEFT JOIN employee_profile p ON p.employee_id = e.id
      LEFT JOIN employee_assignment a
             ON a.employee_id = e.id AND a.valid_to IS NULL
      LEFT JOIN unit unit ON unit.id = a.unit_id
      LEFT JOIN LATERAL (
           SELECT kind, ends_on, position
             FROM employee_contract
            WHERE employee_id = e.id
            ORDER BY starts_on DESC, id DESC
            LIMIT 1
      ) c ON TRUE
      LEFT JOIN app_user u ON u.employee_id = e.id
     -- The fence. A bounded caller's own posting, applied here where no filter
     -- and no sort can reach around it; a NULL unit_id fails it, which is
     -- `Reach::covers(None)` spelled in SQL.
     WHERE ($1::text IS NULL OR a.unit_id = $1)
       -- The number off a badge and the name on it. Not the personal data this
       -- list does not carry.
       AND ($2::text IS NULL OR e.code ILIKE $2 OR p.full_name ILIKE $2)
";

/// The workforce list's filters, spelled once for the page and for the facets'
/// total.
///
/// Binds: `$3` status, `$4` unit, `$5` contract kind (`NONE` for no
/// contract), `$6` position, `$7` login (`1`/`0`). Every one is NULL for "not
/// narrowed".
const WORKFORCE_FILTERS: &str = "
     WHERE ($3::text IS NULL OR status = $3)
       AND ($4::text IS NULL OR unit_id = $4)
       AND ($5::text IS NULL OR COALESCE(contract_kind, 'NONE') = $5)
       AND ($6::text IS NULL OR position = $6)
       AND ($7::text IS NULL
            OR (CASE WHEN username IS NULL THEN '0' ELSE '1' END) = $7)
";

/// The workforce, one page at a time, beside how big the whole answer is.
///
/// `scope.reach_place` is the caller's own bound and `scope.unit_id` is the
/// filter they asked for; both are applied, and the handler has already refused
/// the combination where they disagree. See [`EmployeeScope::reach_place`].
pub async fn list_employees(pool: &PgPool, scope: EmployeeScope) -> Result<EmployeeList, AppError> {
    // A blank search is not a search. `Some("")` would compile to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));

    // The sort, and the tie-break that makes it total. Every order ends in the
    // employee id, which is the primary key, so no two rows can compare equal —
    // which is what stops a keyset from repeating or losing the rows that tie.
    // The code would nearly do, but it is a number the business reissues and
    // the id is the one thing about a record that never moves.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not. Writing
    // `(a ASC, b) > (…)` is a syntax error the compiler cannot catch, because
    // the whole clause is a string.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("name") => ("name_key", scope.desc),
        // The one the hub was doing in the browser over a thousand-row fetch:
        // whoever needs a renewal first, with the permanent contracts last.
        // Server-side, it survives paging — which the client-side version could
        // not, because the rows it sorted were only the rows it had.
        Some("contract_end") => ("ends_at", scope.desc),
        Some("unit") => ("unit_key", scope.desc),
        _ => ("code", scope.desc),
    };
    let cols = format!("{lead}, id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, id {dir}");
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(EmployeeCursor::decode)
        .transpose()?;
    let limit = scope.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor — see [`EmployeeCursor`].
    //
    // A cursor whose row the filters no longer keep — somebody terminated, or
    // transferred out of the place being listed, between one page and the next
    // — finds no row to compare against, so the comparison is NULL and the page
    // comes back empty. The list ends early rather than starting again, which
    // is the safer of the two wrong answers: a stale cursor stops, and stopping
    // is visible.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({WORKFORCE_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {WORKFORCE_FILTERS}
         )
         SELECT * FROM kept
          WHERE $8::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE id = $8)
          ORDER BY {order}
          LIMIT $9"
    );
    let rows = sqlx::query(&sql)
        .bind(&scope.reach_unit)
        .bind(&needle)
        .bind(&scope.status)
        .bind(&scope.unit_id)
        .bind(&scope.contract_kind)
        .bind(&scope.position)
        .bind(&scope.login)
        .bind(cursor.as_ref().map(|c| c.employee_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether more
    // rows exist without asking costs a second count of the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            EmployeeCursor {
                employee_id: row.try_get("id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(summary_from(row)?);
    }

    let (total, facets) = workforce_facets(pool, &scope, needle.as_deref()).await?;
    Ok(EmployeeList {
        unit_id: scope.unit_id.clone(),
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// One row of [`WORKFORCE_ROWS`], as the type a screen reads.
fn summary_from(row: &sqlx::postgres::PgRow) -> Result<EmployeeSummary, AppError> {
    Ok(EmployeeSummary {
        employee_id: row.try_get("id")?,
        employee_code: row.try_get("code")?,
        status: row.try_get("status")?,
        full_name: row.try_get("full_name")?,
        unit_id: row.try_get("unit_id")?,
        unit_name: row.try_get("unit_name")?,
        contract_kind: row.try_get("contract_kind")?,
        contract_ends_on: row.try_get("contract_ends_on")?,
        position: row.try_get("position")?,
        username: row.try_get("username")?,
    })
}

/// How many rows there are, and how they split.
///
/// Counted from the SAME [`WORKFORCE_ROWS`] the page is drawn from, so the
/// reach bound applies to the counts as well. A facet panel counted over a
/// wider set than the list would tell a store manager how many people work at
/// head office, which is precisely the leak the bound exists to close.
///
/// The two scopes here are deliberate, and `money_facets` had them wrong once:
///
///   per-value counts read the SEARCHED set, ignoring what is filtered. The
///     number beside `ACTIVE` answers "how many active people are there", which
///     is the question somebody has while deciding whether to click it.
///     Counting the already-filtered set instead shows the chosen value its own
///     row count and every other one a zero.
///   the total reads the FILTERED set, because it describes the list on screen.
async fn workforce_facets(
    pool: &PgPool,
    scope: &EmployeeScope,
    needle: Option<&str>,
) -> Result<(i64, EmployeeFacets), AppError> {
    // Only counted when there is a choice to make — see `EmployeeFacets`. A
    // bounded caller reaches one place, so the clause is left out of the query
    // rather than computed and thrown away.
    let units = if scope.reach_unit.is_none() {
        "UNION ALL
         SELECT 'unit', unit_id, unit_name, COUNT(*)::bigint
           FROM searched WHERE unit_id IS NOT NULL
          GROUP BY unit_id, unit_name"
    } else {
        ""
    };
    let sql = format!(
        "WITH searched AS ({WORKFORCE_ROWS}), kept AS (
             SELECT * FROM searched {WORKFORCE_FILTERS}
         )
         SELECT 'status' AS kind, status AS value, NULL::text AS label,
                COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          {units}
          UNION ALL
         SELECT 'contract', COALESCE(contract_kind, 'NONE'), NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY COALESCE(contract_kind, 'NONE')
          UNION ALL
         SELECT 'position', position, NULL::text, COUNT(*)::bigint
           FROM searched WHERE position IS NOT NULL GROUP BY position
          UNION ALL
         SELECT 'login', CASE WHEN username IS NULL THEN '0' ELSE '1' END,
                NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY CASE WHEN username IS NULL THEN '0' ELSE '1' END
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(&scope.reach_unit)
        .bind(needle)
        .bind(&scope.status)
        .bind(&scope.unit_id)
        .bind(&scope.contract_kind)
        .bind(&scope.position)
        .bind(&scope.login)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut statuses = Vec::new();
    let mut units_out = Vec::new();
    let mut contract_kinds = Vec::new();
    let mut positions = Vec::new();
    let mut logins = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "status" => statuses.push(EmployeeFacet {
                value,
                label,
                count: n,
            }),
            "unit" => units_out.push(EmployeeFacet {
                value,
                label,
                count: n,
            }),
            "contract" => contract_kinds.push(EmployeeFacet {
                value,
                label,
                count: n,
            }),
            "position" => positions.push(EmployeeFacet {
                value,
                label,
                count: n,
            }),
            "login" => logins.push(EmployeeFacet {
                value,
                label,
                count: n,
            }),
            _ => total = n,
        }
    }
    // Biggest first, as the money list does: a filter list is read top-down and
    // the value somebody is most likely to want is the one with the most behind
    // it. Ties break on the value so the order is stable between calls — a list
    // that reshuffles under the cursor is a list nobody can click.
    for list in [
        &mut statuses,
        &mut units_out,
        &mut contract_kinds,
        &mut positions,
        &mut logins,
    ] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((
        total,
        EmployeeFacets {
            statuses,
            units: units_out,
            contract_kinds,
            positions,
            logins,
        },
    ))
}

/// Which fixed terms end on or before `before`.
///
/// `unit_id` bounds the answer to one place — a place manager's reach. `None`
/// means unbounded, which is head office's, and not "no place": a contract for
/// somebody nobody has posted anywhere is still a contract about to lapse, and
/// it is head office who has to renew it.
pub async fn expiring_contracts(
    pool: &PgPool,
    as_of: NaiveDate,
    before: NaiveDate,
    unit_id: Option<&str>,
) -> Result<Vec<ExpiringContract>, AppError> {
    let rows = sqlx::query(
        "SELECT e.id, e.code, p.full_name, c.position, c.ends_on, a.unit_id
           FROM employee_contract c
           JOIN employee e ON e.id = c.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = e.id
           LEFT JOIN employee_assignment a
                  ON a.employee_id = e.id AND a.valid_to IS NULL
          WHERE c.ends_on IS NOT NULL
            AND c.ends_on <= $1
            AND ($2::text IS NULL OR a.unit_id = $2)
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
    .bind(unit_id)
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
                unit_id: row.try_get("unit_id")?,
                ends_on,
                days_remaining: (ends_on - as_of).num_days(),
            })
        })
        .collect()
}

/// What one login is, as far as the employment module is concerned: whose
/// record it is, and where that person is posted.
///
/// One struct and one query rather than two, because every route that resolves
/// `me` also needs to know the caller's reach, and asking twice would mean two
/// round trips on every screen the employee app opens.
pub struct CallerRecord {
    /// The employment record bound to this login, when one is.
    pub employee_id: Option<String>,
    /// The caller's own open posting — the place, and its `unit.kind`.
    ///
    /// Open means `valid_to IS NULL`, which is what
    /// `AssignmentTimeline::current` means by "current" and what the unique
    /// partial index in 0060 permits at most one of. A posting with an end
    /// date is a posting somebody has already been moved out of, even when
    /// that date is in the future: the decision has been taken, and reach
    /// should not outlive it by the length of the notice period.
    pub posting: Option<(String, String)>,
    /// The unit's name, for saying `Head Office` where the id says `ho`.
    pub unit_name: Option<String>,
    /// Whether the caller is the PIC in force at the unit they are posted to
    /// (0602). Only ever true alongside a posting: a PIC must be posted where
    /// they are in charge, so an appointment at a unit they have since left
    /// counts for nothing here.
    pub in_charge: bool,
}

/// Who this login is and where they are posted — for resolving `me`, and for
/// resolving how far they may reach.
pub async fn caller_record(pool: &PgPool, username: &str) -> Result<CallerRecord, AppError> {
    let row = sqlx::query(
        "SELECT u.employee_id, a.unit_id, unit.kind, unit.name,
                EXISTS (SELECT 1 FROM unit_pic p
                          JOIN employee e ON e.id = p.employee_id AND e.status = 'ACTIVE'
                         WHERE p.unit_id = a.unit_id
                           AND p.employee_id = u.employee_id
                           AND p.valid_from <= $2
                           AND (p.valid_to IS NULL OR p.valid_to > $2)) AS in_charge
           FROM app_user u
           LEFT JOIN employee_assignment a
                  ON a.employee_id = u.employee_id AND a.valid_to IS NULL
           LEFT JOIN unit unit ON unit.id = a.unit_id
          WHERE u.username = $1",
    )
    .bind(username)
    .bind(chrono::Utc::now().date_naive())
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        // The session is valid and the account is gone — a race with a delete,
        // not something to guess about. No record, no posting, no reach.
        return Ok(CallerRecord {
            employee_id: None,
            posting: None,
            unit_name: None,
            in_charge: false,
        });
    };

    let unit_id: Option<String> = row.try_get("unit_id")?;
    let kind: Option<String> = row.try_get("kind")?;
    let posting = unit_id.zip(kind);
    let in_charge: bool = row.try_get("in_charge")?;
    Ok(CallerRecord {
        employee_id: row.try_get("employee_id")?,
        in_charge: in_charge && posting.is_some(),
        posting,
        unit_name: row.try_get("name")?,
    })
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
    register_employee_tx(&mut tx, employee).await?;
    tx.commit().await?;
    Ok(())
}

/// [`register_employee`] inside the caller's transaction — for a caller that
/// makes the record together with something that must not exist without it:
/// an invitation (0634), or a store opened with its manager.
pub async fn register_employee_tx(
    tx: &mut Transaction<'_, Postgres>,
    employee: &Employee,
) -> Result<(), AppError> {
    let taken: Option<String> = sqlx::query_scalar("SELECT id FROM employee WHERE code = $1")
        .bind(employee.code().as_str())
        .fetch_optional(&mut **tx)
        .await?;
    if let Some(taken) = taken {
        return Err(AppError::Conflict(format!(
            "employee code {} already belongs to {taken}",
            employee.code()
        )));
    }
    write_employee(tx, employee).await
}

/// Write an employee whose machine has moved, inside the caller's
/// transaction. For a HIRE recorded as part of something else — accepting an
/// invitation (0634). A departure goes through [`save_employee`], which opens
/// the exit interview with it.
pub async fn save_employee_tx(
    tx: &mut Transaction<'_, Postgres>,
    employee: &Employee,
) -> Result<(), AppError> {
    write_employee(tx, employee).await?;
    if employee.status() == EmploymentStatus::Terminated {
        enqueue_exit_interview(tx, employee).await?;
    }
    Ok(())
}

/// Persist an employee whose state machine has already moved.
///
/// The TERMINATE event carries its exit interview with it: the same
/// transaction that writes the terminated status opens the PENDING row the
/// Exits screen waits on. There is no "between" — a person recorded as gone
/// whose interview never appeared would be a gap somebody has to notice and
/// backfill, and the machine does not hand out gaps it can avoid.
pub async fn save_employee(pool: &PgPool, employee: &Employee) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    write_employee(&mut tx, employee).await?;
    if employee.status() == EmploymentStatus::Terminated {
        enqueue_exit_interview(&mut tx, employee).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// The PENDING exit interview a departure opens, in the terminator's
/// transaction.
///
/// # Who gets one, and where it sits
///
/// A departure — TERMINATE from ACTIVE or SUSPENDED, somebody who worked and
/// went. A withdrawn offer (TERMINATE from CANDIDATE) is not a departure:
/// nobody ever worked here, there is nothing for the person to have said at
/// the door, and a PENDING interview for somebody never hired would be an
/// appointment nobody can keep. Head office can still open one by hand for
/// the rare edge via the exit-interview route, which is where the decision
/// belongs.
///
/// The place is the person's own posting history — the open span, else the
/// latest span ever — read here rather than taken from the caller, because
/// the interview belongs to the place the person worked, not to the desk
/// that filed the paperwork. A person genuinely never posted has no place
/// and therefore no row; the backfill route refuses by name for the same
/// reason rather than guessing `ho`.
///
/// `ON CONFLICT DO NOTHING` because the guarantee is the fold's and this
/// table does not have to trust it: the employment machine cannot produce a
/// second TERMINATE (TERMINATED is terminal, and a rehired person is a new
/// record), so the conflict arm is the sound of the rule being stated a
/// second time, not of work being lost.
async fn enqueue_exit_interview(
    tx: &mut Transaction<'_, Postgres>,
    employee: &Employee,
) -> Result<(), AppError> {
    // Only a departure. The last TERMINATE event names where the person was
    // before it; coming from CANDIDATE it is a withdrawn offer, not a leaver.
    let departure = employee
        .history()
        .iter()
        .rev()
        .find(|event| event.transition() == EmploymentTransition::Terminate)
        .is_some_and(|event| event.from() != EmploymentStatus::Candidate);
    if !departure {
        return Ok(());
    }
    let inserted = sqlx::query(
        "INSERT INTO exit_interview (exit_id, employee_id, unit_id)
         SELECT $2::uuid, $1, a.unit_id
           FROM employee_assignment a
          WHERE a.employee_id = $1
          ORDER BY (a.valid_to IS NULL) DESC, a.valid_from DESC, a.id DESC
          LIMIT 1
         ON CONFLICT (employee_id) DO NOTHING",
    )
    .bind(employee.id().as_str())
    .bind(Uuid::new_v4())
    .execute(&mut **tx)
    .await?
    .rows_affected();
    let _ = inserted; // no unit to sit the interview in: the backfill route refuses by name
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
    replace_assignments_tx(&mut tx, employee_id, timeline).await?;
    tx.commit().await?;
    // Where somebody is posted decides which servers they sign in at (0635):
    // a transfer moves their store access with them, here, rather than
    // leaving it for somebody to remember in System > Access.
    let actor = timeline
        .spans()
        .last()
        .map(|span| span.authorization().actor().to_string())
        .unwrap_or_else(|| "system:posting".to_owned());
    super::follow_posting(pool, employee_id, &actor).await;
    Ok(())
}

/// [`replace_assignments`] inside the caller's transaction. The caller then
/// owns telling the servers (`reconcile_node_access_tx`).
pub async fn replace_assignments_tx(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    timeline: &AssignmentTimeline,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM employee_assignment WHERE employee_id = $1")
        .bind(employee_id)
        .execute(&mut **tx)
        .await?;
    for span in timeline.spans() {
        let authorized = serde_json::to_value(span.authorization())?;
        sqlx::query(
            "INSERT INTO employee_assignment
                (id, employee_id, unit_id, valid_from, valid_to, authorized)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(format!("asg_{}", Uuid::new_v4().simple()))
        .bind(employee_id)
        .bind(span.unit_id().as_str())
        .bind(span.from())
        .bind(span.to())
        .bind(&authorized)
        .execute(&mut **tx)
        .await?;
    }
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

/// The login bound to an employment record, and how it came to be bound.
///
/// The provenance is optional because 0097 deliberately did not backfill it: a
/// binding made before that migration has no recorded decision behind it, and
/// naming an actor who never typed a reason would put a fabricated statement in
/// the middle of the evidence. Absent means "made before this was kept", and
/// the screens say that rather than guessing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountBinding {
    pub username: String,
    pub display_name: String,
    /// Whether the credential still opens anything. False for somebody who has
    /// been walked out: the record stays and the door does not.
    pub active: bool,
    pub linked_by: Option<String>,
    pub linked_at: Option<DateTime<Utc>>,
    pub link_reason: Option<String>,
}

/// What the employment side needs to walk somebody out: which account, and
/// whether it is still open. Separate from [`AccountBinding`] because it is not
/// a view — nothing serialises it, and it carries the id that does the work.
pub struct BoundAccount {
    pub user_id: Uuid,
    pub username: String,
    pub active: bool,
}

/// The login bound to this record, for a screen.
pub async fn load_account(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Option<AccountBinding>, AppError> {
    let row = sqlx::query(
        "SELECT u.username, u.display_name, u.active,
                l.actor AS linked_by, l.at AS linked_at, l.reason AS link_reason
           FROM app_user u
           LEFT JOIN LATERAL (
                SELECT actor, at, reason
                  FROM employee_account_link
                 WHERE user_id = u.id AND employee_id = $1 AND act = 'LINK'
                 ORDER BY at DESC, id DESC
                 LIMIT 1
           ) l ON TRUE
          WHERE u.employee_id = $1",
    )
    .bind(employee_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some(AccountBinding {
        username: row.try_get("username")?,
        display_name: row.try_get("display_name")?,
        active: row.try_get("active")?,
        linked_by: row.try_get("linked_by")?,
        linked_at: row.try_get("linked_at")?,
        link_reason: row.try_get("link_reason")?,
    }))
}

/// The login bound to this record, for the code that closes it.
pub async fn bound_account(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Option<BoundAccount>, AppError> {
    let row = sqlx::query("SELECT id, username, active FROM app_user WHERE employee_id = $1")
        .bind(employee_id)
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some(BoundAccount {
        user_id: row.try_get("id")?,
        username: row.try_get("username")?,
        active: row.try_get("active")?,
    }))
}

/// Bind a login to an employment record.
///
/// Three refusals, and the middle one is the reason this function was rewritten.
///
///  * **The person has left.** A credential is not issued to somebody whose
///    employment is over; the whole of [`super::super::http::employment`] is
///    otherwise busy taking one away from them.
///  * **The login is already somebody else's.** The previous version was a bare
///    `UPDATE ... WHERE username = $1`, which quietly moved an account from one
///    employee to another — the earlier person losing their binding with no row
///    anywhere saying it had happened. Two people's identities silently swapped
///    is the worst outcome this table has, and it took one statement to reach.
///  * **This record already has a different login.** Already refused before, and
///    kept: one person, one credential, or "who is this" has two answers at the
///    moment somebody asks it in earnest.
///
/// Re-binding the same login to the same person changes nothing and records
/// nothing. It is not an error — an idempotent write from a retried request is
/// not a decision — and there is no new fact for the history to hold.
pub async fn link_account(
    pool: &PgPool,
    employee_id: &str,
    username: &str,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM employee WHERE id = $1 FOR UPDATE")
            .bind(employee_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(status) = status else {
        return Err(AppError::NotFound(format!("employee {employee_id}")));
    };
    if status == EmploymentStatus::Terminated.code() {
        return Err(AppError::Conflict(format!(
            "employee {employee_id} has left; a login is not bound to somebody \
             whose employment is over"
        )));
    }

    let held_by: Option<String> =
        sqlx::query_scalar("SELECT username FROM app_user WHERE employee_id = $1")
            .bind(employee_id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(held_by) = held_by {
        if held_by != username {
            return Err(AppError::Conflict(format!(
                "employee {employee_id} is already bound to {held_by}"
            )));
        }
        return Ok(());
    }

    let account =
        sqlx::query("SELECT id, employee_id FROM app_user WHERE username = $1 FOR UPDATE")
            .bind(username)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(account) = account else {
        return Err(AppError::NotFound(format!("user {username}")));
    };
    let user_id: Uuid = account.try_get("id")?;
    let bound_to: Option<String> = account.try_get("employee_id")?;
    if let Some(bound_to) = bound_to {
        return Err(AppError::Conflict(format!(
            "{username} is already the login of employee {bound_to}; release it there first"
        )));
    }

    sqlx::query("UPDATE app_user SET employee_id = $2, updated_at = now() WHERE id = $1")
        .bind(user_id)
        .bind(employee_id)
        .execute(&mut *tx)
        .await?;
    record_link(&mut tx, employee_id, user_id, "LINK", authorization).await?;
    tx.commit().await?;
    // Bound, the login now works where the record is posted (0635).
    super::follow_login(pool, user_id, &authorization.actor().to_string()).await;
    Ok(())
}

/// Unbind a login from an employment record, and say why.
///
/// The counterpart the first version lacked. Refusing to steal an account
/// without a way to give one back would turn a typo into a permanent one: the
/// login stays bound to the wrong person, and the right person can never be
/// given it.
///
/// It does **not** deactivate the account. A release says "this credential is
/// not this person's", which is often because it never was — and closing
/// somebody's login on the strength of a correction to a different record is
/// how a mistake becomes an outage. Walking somebody out is
/// [`super::super::http::employment::transition`]'s job and has its own key.
pub async fn release_account(
    pool: &PgPool,
    employee_id: &str,
    authorization: &Authorization,
) -> Result<String, AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query("SELECT id, username FROM app_user WHERE employee_id = $1 FOR UPDATE")
        .bind(employee_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(row) = row else {
        return Err(AppError::Conflict(format!(
            "no login is bound to employee {employee_id}"
        )));
    };
    let user_id: Uuid = row.try_get("id")?;
    let username: String = row.try_get("username")?;

    sqlx::query("UPDATE app_user SET employee_id = NULL, updated_at = now() WHERE id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    record_link(&mut tx, employee_id, user_id, "RELEASE", authorization).await?;
    tx.commit().await?;
    // Released, the login is posted nowhere, so the servers its posting
    // reached stop taking it (0635).
    super::follow_login(pool, user_id, &authorization.actor().to_string()).await;
    Ok(username)
}

/// One decision about a binding, written in the same transaction as the
/// binding itself. Separately committed evidence is evidence that can be
/// missing.
async fn record_link(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    user_id: Uuid,
    act: &str,
    authorization: &Authorization,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO employee_account_link (employee_id, user_id, act, actor, reason, at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(employee_id)
    .bind(user_id)
    .bind(act)
    .bind(authorization.actor().to_string())
    .bind(authorization.reason().to_string())
    .bind(authorization.at())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
