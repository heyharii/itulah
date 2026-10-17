//! Inviting somebody by a link (0634), and the link being accepted.
//!
//! # Inviting
//!
//! Head office names a person, their job role and their unit. In one
//! transaction per request this registers the employment record (a
//! CANDIDATE, through the same code as People › Directory), posts it to the
//! unit from today, and writes the invitation — storing only the SHA-256 of
//! the token. The token itself goes back once, to be copied into a link; it
//! cannot be read back from here, which is why renewing makes a new one.
//!
//! # Accepting
//!
//! The person opens the link, chooses a username and a password, and in ONE
//! transaction: the login is created with the invitation's role and bound to
//! the record, the record is hired from today (they have joined), the
//! invitation is marked accepted, the servers their role and unit reach are
//! derived (0635), and a session is opened exactly as signing in opens one.
//! After it commits, the servers are told, and a store manager joining a
//! store that nobody is in charge of is made its PIC through the PIC path.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    actions, job_role::JobGrant, AssignmentSpan, AssignmentTimeline, Authorization, Employee,
    EmploymentStatus, EmploymentTransition, Role, UnitId,
};
use crate::security;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use super::IssuedSession;

/// How long a link works.
pub const INVITATION_TTL_HOURS: i64 = 72;

/// The role a store's person in charge joins as (0633).
pub const STORE_MANAGER: &str = "STORE_MANAGER";

/// One person to invite.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct InvitePerson {
    pub name: String,
    pub role_code: String,
    pub unit_id: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub position: Option<String>,
    /// An employment record that already exists — the candidate an approved
    /// hire proposal opened (owner, 2026-10-16: the store asks, head office
    /// approves, the person gets an account). The link then binds to that
    /// record instead of minting a new one; it must still be a candidate with
    /// no login and no open invitation.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub employee_id: Option<String>,
}

/// `POST /api/v1/invitations`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct InviteRequest {
    pub people: Vec<InvitePerson>,
}

/// An invitation as it is handed over: the one time its link exists.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IssuedInvitation {
    pub invitation_id: Uuid,
    pub employee_id: String,
    pub name: String,
    pub role_code: String,
    pub unit_id: String,
    /// `{origin}/join/{token}`. Shown once; only the token's hash is kept.
    pub link: String,
    pub expires_at: DateTime<Utc>,
}

/// `{items}` of [`IssuedInvitation`].
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IssuedInvitationList {
    pub items: Vec<IssuedInvitation>,
}

/// An invitation as the list shows it. Never the token.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InvitationRow {
    pub invitation_id: Uuid,
    pub employee_id: String,
    pub name: String,
    pub role_code: String,
    pub role_name: String,
    pub unit_id: String,
    pub unit_name: String,
    pub position: Option<String>,
    /// `PENDING`, `ACCEPTED`, `EXPIRED` or `REVOKED`, read from the row.
    pub status: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    /// The username the person chose, once they have.
    pub username: Option<String>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revoked_by: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InvitationList {
    pub items: Vec<InvitationRow>,
}

/// `GET /api/v1/invitations?status=&unit_id=`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InvitationScope {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub unit_id: Option<String>,
}

/// What the join page shows before the person commits to anything.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InvitationPreview {
    pub name: String,
    pub role_name: String,
    pub unit_name: String,
    pub company_name: String,
    pub suggested_username: String,
    pub expires_at: DateTime<Utc>,
}

/// `POST /api/v1/invitations/accept/{token}`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct AcceptInvitationRequest {
    pub username: String,
    pub password: String,
}

/// A token minted for an invitation, before the caller turns it into a link.
#[derive(Clone, Debug)]
pub struct MintedInvitation {
    pub invitation_id: Uuid,
    pub employee_id: String,
    pub name: String,
    pub role_code: String,
    pub unit_id: String,
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

impl MintedInvitation {
    /// `origin` is what `http::invitations::link_origin` answered: an origin,
    /// followed on a sandbox server by `?business=…`, which goes after the
    /// token.
    pub fn issued(self, origin: &str) -> IssuedInvitation {
        let (origin, query) = match origin.split_once('?') {
            Some((origin, query)) => (origin, format!("?{query}")),
            None => (origin, String::new()),
        };
        IssuedInvitation {
            link: format!(
                "{}/join/{}{query}",
                origin.trim_end_matches('/'),
                self.token
            ),
            invitation_id: self.invitation_id,
            employee_id: self.employee_id,
            name: self.name,
            role_code: self.role_code,
            unit_id: self.unit_id,
            expires_at: self.expires_at,
        }
    }
}

/// What accepting produced: the session to set as cookies, and `me`.
#[derive(Clone, Debug)]
pub struct AcceptedInvitation {
    pub session: IssuedSession,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub job: JobGrant,
}

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

fn trimmed(value: &str, what: &str, max: usize) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(AppError::Validation(format!(
            "{what} is 1-{max} characters"
        )));
    }
    Ok(value.to_owned())
}

/// A username to offer, from the person's name: `Siti Rahayu` → `siti.rahayu`,
/// with a number after it when that one is taken. Only a suggestion — the
/// person types what they want, and that is checked when they accept.
async fn suggest_username(
    tx: &mut Transaction<'_, Postgres>,
    name: &str,
) -> Result<String, AppError> {
    let words: Vec<String> = name
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(char::is_ascii_alphanumeric)
                .map(|c| c.to_ascii_lowercase())
                .collect::<String>()
        })
        .filter(|word| !word.is_empty())
        .collect();
    let mut base: String = match words.as_slice() {
        [] => "staff".to_owned(),
        [only] => only.clone(),
        [first, .., last] => format!("{first}.{last}"),
    };
    base = base.chars().take(28).collect();
    while base.len() < 3 {
        base.push('0');
    }
    for attempt in 1..100 {
        let candidate = if attempt == 1 {
            base.clone()
        } else {
            format!("{base}{attempt}")
        };
        let taken: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM app_user WHERE username = $1)
                 OR EXISTS (SELECT 1 FROM user_invitation
                             WHERE suggested_username = $1
                               AND accepted_at IS NULL AND revoked_at IS NULL)",
        )
        .bind(&candidate)
        .fetch_one(&mut **tx)
        .await?;
        if !taken {
            return Ok(candidate);
        }
    }
    let tail: String = Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(4)
        .collect();
    Ok(format!("{base}{tail}"))
}

/// The unit's own today, by its site's clock (0603).
async fn today_at_unit(
    tx: &mut Transaction<'_, Postgres>,
    unit_id: &str,
) -> Result<NaiveDate, AppError> {
    let offset = super::sites::unit_utc_offset_minutes(&mut **tx, unit_id, Utc::now()).await?;
    Ok(crate::reporting::local_today_at(offset))
}

/// Invite one person inside the caller's transaction: their employment
/// record, their posting and the invitation. The caller turns the token into
/// a link, and commits.
///
/// Shared by `POST /api/v1/invitations` and by opening a store, which invites
/// its manager in the same transaction as the unit (`postgres::setup`).
pub async fn invite_tx(
    tx: &mut Transaction<'_, Postgres>,
    person: &InvitePerson,
    actor: &str,
) -> Result<MintedInvitation, AppError> {
    let name = trimmed(&person.name, "a name", 128)?;
    let role_code = person.role_code.trim().to_ascii_uppercase();
    let role_name: Option<String> = sqlx::query_scalar("SELECT name FROM job_role WHERE code = $1")
        .bind(&role_code)
        .fetch_optional(&mut **tx)
        .await?;
    let Some(role_name) = role_name else {
        return Err(AppError::Validation(format!(
            "there is no job role {role_code}"
        )));
    };
    let unit_id = person.unit_id.trim().to_owned();
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM unit WHERE id = $1")
        .bind(&unit_id)
        .fetch_optional(&mut **tx)
        .await?;
    match status.as_deref() {
        None => {
            return Err(AppError::Validation(format!("there is no unit {unit_id}")));
        }
        Some("ACTIVE") => {}
        Some(other) => {
            return Err(AppError::Conflict(format!(
                "unit {unit_id} is {other}; nobody can be invited to work there"
            )));
        }
    }
    let position = person
        .position
        .as_deref()
        .map(str::trim)
        .filter(|position| !position.is_empty())
        .map(|position| trimmed(position, "a position", 128))
        .transpose()?;

    let now = Utc::now();
    let today = today_at_unit(tx, &unit_id).await?;
    let because = format!("invited as {role_name}");

    let employee_id = match person
        .employee_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(existing) => {
            existing_candidate_tx(tx, existing).await?;
            existing.to_owned()
        }
        None => {
            // The employment record, minted here like every other: an id nobody
            // chose, and a badge number in the house series HR may correct later.
            let simple = Uuid::new_v4().simple().to_string();
            let employee_id = format!("emp_{simple}");
            let code = format!(
                "ITL-{}",
                simple
                    .chars()
                    .take(8)
                    .collect::<String>()
                    .to_ascii_uppercase()
            );
            let employee = Employee::try_register(&employee_id, &code).map_err(invalid)?;
            super::register_employee_tx(tx, &employee).await?;

            let mut postings = AssignmentTimeline::new();
            postings
                .push(
                    AssignmentSpan::try_new(
                        UnitId::try_new(&unit_id).map_err(invalid)?,
                        today,
                        None,
                        Authorization::try_new(actor, actions::ASSIGNMENT_MANAGE, now, &because)
                            .map_err(invalid)?,
                    )
                    .map_err(invalid)?,
                )
                .map_err(|error| AppError::Conflict(error.to_string()))?;
            super::replace_assignments_tx(tx, &employee_id, &postings).await?;
            employee_id
        }
    };

    let suggested = suggest_username(tx, &name).await?;
    let token = security::random_url_token();
    let invitation_id = Uuid::new_v4();
    let expires_at = now + Duration::hours(INVITATION_TTL_HOURS);
    sqlx::query(
        "INSERT INTO user_invitation
            (id, token_sha256, employee_id, name, role_code, unit_id, position,
             suggested_username, created_by, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(invitation_id)
    .bind(security::sha256_hex(&token))
    .bind(&employee_id)
    .bind(&name)
    .bind(&role_code)
    .bind(&unit_id)
    .bind(position.as_deref())
    .bind(&suggested)
    .bind(actor)
    .bind(now)
    .bind(expires_at)
    .execute(&mut **tx)
    .await?;

    Ok(MintedInvitation {
        invitation_id,
        employee_id,
        name,
        role_code,
        unit_id,
        token,
        expires_at,
    })
}

/// An employment record an invitation may bind to: it exists, is still a
/// candidate, has no login yet and no invitation still waiting.
async fn existing_candidate_tx(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
) -> Result<(), AppError> {
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM employee WHERE id = $1 FOR UPDATE")
            .bind(employee_id)
            .fetch_optional(&mut **tx)
            .await?;
    match status.as_deref() {
        None => return Err(AppError::NotFound(format!("employee {employee_id}"))),
        Some("CANDIDATE") => {}
        Some(other) => {
            return Err(AppError::Conflict(format!(
                "employee {employee_id} is {other}; only a candidate is invited this way"
            )))
        }
    }
    let login: Option<String> =
        sqlx::query_scalar("SELECT username FROM app_user WHERE employee_id = $1")
            .bind(employee_id)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(username) = login {
        return Err(AppError::Conflict(format!(
            "employee {employee_id} already signs in as {username}"
        )));
    }
    let waiting: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM user_invitation
                         WHERE employee_id = $1 AND accepted_at IS NULL
                           AND revoked_at IS NULL AND expires_at > now())",
    )
    .bind(employee_id)
    .fetch_one(&mut **tx)
    .await?;
    if waiting {
        return Err(AppError::Conflict(format!(
            "employee {employee_id} already has an invitation waiting; renew that one"
        )));
    }
    Ok(())
}

/// Invite everybody named, all or none.
pub async fn invite_people(
    pool: &PgPool,
    request: InviteRequest,
    actor: &str,
) -> Result<Vec<MintedInvitation>, AppError> {
    if request.people.is_empty() {
        return Err(AppError::Validation("name at least one person".into()));
    }
    if request.people.len() > 100 {
        return Err(AppError::Validation("at most 100 people at once".into()));
    }
    let mut tx = pool.begin().await?;
    let mut minted = Vec::with_capacity(request.people.len());
    for person in &request.people {
        minted.push(invite_tx(&mut tx, person, actor).await?);
    }
    tx.commit().await?;
    Ok(minted)
}

const INVITATION_ROWS: &str = "
    SELECT i.id, i.employee_id, i.name, i.role_code, r.name AS role_name,
           i.unit_id, u.name AS unit_name, i.position, i.created_by, i.created_at,
           i.expires_at, i.accepted_at, i.username, i.revoked_at, i.revoked_by,
           CASE WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'
                WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
                WHEN i.expires_at <= now() THEN 'EXPIRED'
                ELSE 'PENDING' END AS status
      FROM user_invitation i
      JOIN job_role r ON r.code = i.role_code
      JOIN unit u ON u.id = i.unit_id";

fn to_row(row: &sqlx::postgres::PgRow) -> Result<InvitationRow, AppError> {
    Ok(InvitationRow {
        invitation_id: row.try_get("id")?,
        employee_id: row.try_get("employee_id")?,
        name: row.try_get("name")?,
        role_code: row.try_get("role_code")?,
        role_name: row.try_get("role_name")?,
        unit_id: row.try_get("unit_id")?,
        unit_name: row.try_get("unit_name")?,
        position: row.try_get("position")?,
        status: row.try_get("status")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        expires_at: row.try_get("expires_at")?,
        accepted_at: row.try_get("accepted_at")?,
        username: row.try_get("username")?,
        revoked_at: row.try_get("revoked_at")?,
        revoked_by: row.try_get("revoked_by")?,
    })
}

/// Every invitation, newest first, narrowed by state and unit. The store
/// opening checklist asks `?unit_id=` to show a manager who has not joined.
pub async fn list_invitations(
    pool: &PgPool,
    scope: InvitationScope,
) -> Result<InvitationList, AppError> {
    let status = scope
        .status
        .as_deref()
        .map(str::trim)
        .filter(|status| !status.is_empty())
        .map(str::to_ascii_uppercase);
    if let Some(status) = &status {
        if !["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"].contains(&status.as_str()) {
            return Err(AppError::Validation(
                "status is PENDING, ACCEPTED, EXPIRED or REVOKED".into(),
            ));
        }
    }
    let rows = sqlx::query(&format!(
        "SELECT * FROM ({INVITATION_ROWS}) i
          WHERE ($1::text IS NULL OR i.status = $1)
            AND ($2::text IS NULL OR i.unit_id = $2)
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT 1000"
    ))
    .bind(status)
    .bind(
        scope
            .unit_id
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty()),
    )
    .fetch_all(pool)
    .await?;
    Ok(InvitationList {
        items: rows.iter().map(to_row).collect::<Result<_, _>>()?,
    })
}

async fn load_row(pool: &PgPool, id: Uuid) -> Result<InvitationRow, AppError> {
    let row = sqlx::query(&format!("{INVITATION_ROWS} WHERE i.id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invitation {id}")))?;
    to_row(&row)
}

/// Withdraw a link. The employment record it made stays: withdrawing an
/// invitation is not ending somebody's employment, and HR decides that.
pub async fn revoke_invitation(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
) -> Result<InvitationRow, AppError> {
    let current = load_row(pool, id).await?;
    match current.status.as_str() {
        "ACCEPTED" => {
            return Err(AppError::Conflict(format!(
                "{} has already joined as {}; suspend the account instead",
                current.name,
                current.username.as_deref().unwrap_or("their username")
            )));
        }
        "REVOKED" => return Ok(current),
        _ => {}
    }
    sqlx::query(
        "UPDATE user_invitation SET revoked_at = now(), revoked_by = $2
          WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(actor)
    .execute(pool)
    .await?;
    load_row(pool, id).await
}

/// A new link for an invitation not yet accepted, inside the caller's
/// transaction. The old token stops working at once: its hash is replaced.
/// A withdrawn invitation is reopened by this — renewing it is inviting the
/// same person again, to the same record.
pub async fn renew_invitation_tx(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    actor: &str,
) -> Result<MintedInvitation, AppError> {
    let row = sqlx::query(
        "SELECT employee_id, name, role_code, unit_id, accepted_at, username
           FROM user_invitation WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("invitation {id}")))?;
    let name: String = row.try_get("name")?;
    if row
        .try_get::<Option<DateTime<Utc>>, _>("accepted_at")?
        .is_some()
    {
        let username: Option<String> = row.try_get("username")?;
        return Err(AppError::Conflict(format!(
            "{name} has already joined as {}; there is nothing to renew",
            username.as_deref().unwrap_or("their username")
        )));
    }
    let token = security::random_url_token();
    let expires_at = Utc::now() + Duration::hours(INVITATION_TTL_HOURS);
    sqlx::query(
        "UPDATE user_invitation
            SET token_sha256 = $2, expires_at = $3, renewed_at = now(), renewed_by = $4,
                revoked_at = NULL, revoked_by = NULL
          WHERE id = $1",
    )
    .bind(id)
    .bind(security::sha256_hex(&token))
    .bind(expires_at)
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    Ok(MintedInvitation {
        invitation_id: id,
        employee_id: row.try_get("employee_id")?,
        name,
        role_code: row.try_get("role_code")?,
        unit_id: row.try_get("unit_id")?,
        token,
        expires_at,
    })
}

pub async fn renew_invitation(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
) -> Result<MintedInvitation, AppError> {
    let mut tx = pool.begin().await?;
    let minted = renew_invitation_tx(&mut tx, id, actor).await?;
    tx.commit().await?;
    Ok(minted)
}

/// The one refusal an unknown token gets. It says nothing about whether a
/// token like it exists: the same sentence for a typo and for a guess.
fn not_a_link() -> AppError {
    AppError::NotFound("this invitation link is not valid; ask head office for a new one".into())
}

/// An invitation by its token, refused unless it can still be accepted.
struct Open {
    id: Uuid,
    employee_id: String,
    name: String,
    role_code: String,
    unit_id: String,
    created_by: String,
    suggested_username: String,
    expires_at: DateTime<Utc>,
}

fn still_open(row: &sqlx::postgres::PgRow) -> Result<Open, AppError> {
    if row
        .try_get::<Option<DateTime<Utc>>, _>("accepted_at")?
        .is_some()
    {
        return Err(AppError::Conflict(
            "this invitation has already been used; sign in with the username you chose".into(),
        ));
    }
    if row
        .try_get::<Option<DateTime<Utc>>, _>("revoked_at")?
        .is_some()
    {
        return Err(AppError::Conflict(
            "this invitation was withdrawn; ask head office for a new link".into(),
        ));
    }
    let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
    if expires_at <= Utc::now() {
        return Err(AppError::Conflict(format!(
            "this invitation expired on {}; ask head office for a new link",
            expires_at.format("%-d %b %Y")
        )));
    }
    Ok(Open {
        id: row.try_get("id")?,
        employee_id: row.try_get("employee_id")?,
        name: row.try_get("name")?,
        role_code: row.try_get("role_code")?,
        unit_id: row.try_get("unit_id")?,
        created_by: row.try_get("created_by")?,
        suggested_username: row.try_get("suggested_username")?,
        expires_at,
    })
}

const BY_TOKEN: &str = "SELECT id, employee_id, name, role_code, unit_id, created_by,
                               suggested_username, expires_at, accepted_at, revoked_at
                          FROM user_invitation WHERE token_sha256 = $1";

/// What the join page shows. `None` from the caller's limiter comes first;
/// this only answers for a token.
pub async fn preview_invitation(pool: &PgPool, token: &str) -> Result<InvitationPreview, AppError> {
    let row = sqlx::query(BY_TOKEN)
        .bind(security::sha256_hex(token.trim()))
        .fetch_optional(pool)
        .await?
        .ok_or_else(not_a_link)?;
    let open = still_open(&row)?;
    let names = sqlx::query(
        "SELECT r.name AS role_name, u.name AS unit_name,
                COALESCE((SELECT name FROM company_profile LIMIT 1),
                         (SELECT name FROM unit WHERE kind = 'HO' LIMIT 1), '') AS company_name
           FROM job_role r, unit u
          WHERE r.code = $1 AND u.id = $2",
    )
    .bind(&open.role_code)
    .bind(&open.unit_id)
    .fetch_one(pool)
    .await?;
    Ok(InvitationPreview {
        name: open.name,
        role_name: names.try_get("role_name")?,
        unit_name: names.try_get("unit_name")?,
        company_name: names.try_get("company_name")?,
        suggested_username: open.suggested_username,
        expires_at: open.expires_at,
    })
}

/// Whether a token names an invitation at all, for the limiter: a miss is
/// what a guesser produces.
pub async fn token_exists(pool: &PgPool, token: &str) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM user_invitation WHERE token_sha256 = $1)")
            .bind(security::sha256_hex(token.trim()))
            .fetch_one(pool)
            .await?,
    )
}

/// Accept: the login, the binding, the hire, the servers and the session,
/// in one transaction. See the module doc.
pub async fn accept_invitation(
    pool: &PgPool,
    token: &str,
    request: AcceptInvitationRequest,
    session_ttl_minutes: i64,
) -> Result<AcceptedInvitation, AppError> {
    let token_hash = security::sha256_hex(token.trim());
    // Refused before a password is hashed: argon2 is slow on purpose, and a
    // dead link should not cost it.
    let first = sqlx::query(BY_TOKEN)
        .bind(&token_hash)
        .fetch_optional(pool)
        .await?
        .ok_or_else(not_a_link)?;
    let open = still_open(&first)?;
    let username = security::normalize_username(&request.username).map_err(AppError::Validation)?;
    let password_hash = super::hash_new_password(&request.password).await?;
    let employee = super::load_employee(pool, &open.employee_id)
        .await?
        .ok_or_else(|| AppError::Configuration(format!("employee {} is gone", open.employee_id)))?;

    let mut tx = pool.begin().await?;
    // Again, under a lock: two tabs accepting one link must not both win.
    let row = sqlx::query(&format!("{BY_TOKEN} FOR UPDATE"))
        .bind(&token_hash)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(not_a_link)?;
    let open = still_open(&row)?;
    let now = Utc::now();
    let because = format!("joined by invitation {}", open.id);

    let user_id = Uuid::new_v4();
    let created = sqlx::query(
        "INSERT INTO app_user
            (id, username, display_name, password_hash, role, role_code, created_by)
         SELECT $1, $2, $3, $4, r.rung, r.code, $6
           FROM job_role r WHERE r.code = $5
         ON CONFLICT (username) DO NOTHING
         RETURNING auth_version",
    )
    .bind(user_id)
    .bind(&username)
    .bind(&open.name)
    .bind(&password_hash)
    .bind(&open.role_code)
    .bind(&open.created_by)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(created) = created else {
        return Err(AppError::Conflict(format!(
            "the username {username} is taken; choose another"
        )));
    };
    let auth_version: i64 = created.try_get("auth_version")?;

    let linked =
        Authorization::try_new(&open.created_by, actions::ACCOUNT_PROVISION, now, &because)
            .map_err(invalid)?;
    super::bind_new_account(&mut tx, &open.employee_id, user_id, &linked).await?;

    // They have joined: a candidate is hired from today. Somebody HR already
    // hired keeps the day HR recorded.
    let today = today_at_unit(&mut tx, &open.unit_id).await?;
    if employee.employee.status() == EmploymentStatus::Candidate {
        let mut hired = employee.employee.clone();
        hired
            .apply(
                EmploymentTransition::Hire,
                today,
                Authorization::try_new(&open.created_by, actions::EMPLOYMENT_CHANGE, now, &because)
                    .map_err(invalid)?,
            )
            .map_err(|error| AppError::Conflict(error.to_string()))?;
        super::save_employee_tx(&mut tx, &hired).await?;
    }

    sqlx::query(
        "UPDATE user_invitation SET accepted_at = $2, user_id = $3, username = $4 WHERE id = $1",
    )
    .bind(open.id)
    .bind(now)
    .bind(user_id)
    .bind(&username)
    .execute(&mut *tx)
    .await?;

    // The servers their role and unit reach (0635), with the account.
    let origins = super::reconcile_node_access_tx(&mut tx, Some(user_id), &open.created_by).await?;
    let session =
        super::create_session_tx(&mut tx, user_id, auth_version, session_ttl_minutes).await?;
    let me = sqlx::query(
        "SELECT u.role, u.role_code, r.name AS role_name, r.flow_roles, r.sections, r.read_only,
                r.unit_reach
           FROM app_user u LEFT JOIN job_role r ON r.code = u.role_code
          WHERE u.id = $1",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    let role: Role = me.try_get::<String, _>("role")?.parse().map_err(
        |error: crate::cloud::domain::AuthError| AppError::Configuration(error.to_string()),
    )?;
    let job = super::job_grant_of(&me)?;
    tx.commit().await?;

    super::publish_node_access(pool, &origins, &open.created_by).await;
    if open.role_code == STORE_MANAGER {
        take_charge_if_nobody_is(pool, &open, today).await;
    }

    Ok(AcceptedInvitation {
        session,
        user_id,
        username,
        display_name: open.name,
        role,
        job,
    })
}

/// A store manager joining a store nobody is in charge of becomes its PIC
/// from today, through the PIC path and its checks (0602). A store that
/// already has one keeps it: taking charge is head office's decision then.
/// Never fails the acceptance — the person has joined either way.
async fn take_charge_if_nobody_is(pool: &PgPool, open: &Open, today: NaiveDate) {
    let result = async {
        let in_charge: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                 SELECT 1 FROM unit_pic p
                   JOIN employee e ON e.id = p.employee_id AND e.status = 'ACTIVE'
                  WHERE p.unit_id = $1
                    AND p.valid_from <= $2
                    AND (p.valid_to IS NULL OR p.valid_to > $2))",
        )
        .bind(&open.unit_id)
        .bind(today)
        .fetch_one(pool)
        .await?;
        if in_charge {
            return Ok(());
        }
        let unit = UnitId::try_new(&open.unit_id).map_err(invalid)?;
        super::appoint_unit_pic(
            pool,
            &unit,
            &open.employee_id,
            today,
            &open.created_by,
            "the store manager head office invited has joined",
        )
        .await
    }
    .await;
    if let Err(error) = result {
        tracing::warn!(
            unit_id = open.unit_id.as_str(),
            employee_id = open.employee_id.as_str(),
            %error,
            "a store manager joined but could not be put in charge of the store"
        );
    }
}
