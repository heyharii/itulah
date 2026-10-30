//! A person's papers beyond the profile (1001): the detail set, the scans on
//! file, a new hire's dossier on their proposal, and a store's change to an
//! existing employee's data waiting on head office.

use crate::cloud::application::AppError;
use crate::cloud::domain::{Authorization, DocumentKind, EmployeeDetails, Profile};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// A stored set, read back through the same checks a save goes through. A set
/// edited by hand into something the form would refuse fails loudly here.
fn details_from(value: serde_json::Value) -> Result<EmployeeDetails, AppError> {
    let details: EmployeeDetails = serde_json::from_value(value)?;
    details.validated().map_err(|error| {
        AppError::Configuration(format!("a stored detail set does not read back: {error}"))
    })
}

// ── the detail set ─────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeDetailsView {
    pub details: EmployeeDetails,
    /// `K/2`, `TK/0` — what the family reads as. A hint: the PTKP payroll
    /// applies is head office's, on the payroll identity.
    pub ptkp_hint: String,
    pub revision: i32,
    pub saved_by: String,
    pub saved_at: DateTime<Utc>,
}

pub async fn employee_details(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Option<EmployeeDetailsView>, AppError> {
    let row = sqlx::query(
        "SELECT details, revision, saved->>'actor' AS saved_by,
                (saved->>'at')::timestamptz AS saved_at
           FROM employee_detail WHERE employee_id = $1",
    )
    .bind(employee_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let details = details_from(row.try_get("details")?)?;
    Ok(Some(EmployeeDetailsView {
        ptkp_hint: details.ptkp_hint(),
        details,
        revision: row.try_get("revision")?,
        saved_by: row
            .try_get::<Option<String>, _>("saved_by")?
            .unwrap_or_default(),
        saved_at: row.try_get("saved_at")?,
    }))
}

/// Write a new revision of the set. The revision before it stays readable in
/// `employee_detail_revision`, with its author and reason.
pub async fn save_employee_details(
    pool: &PgPool,
    employee_id: &str,
    details: &EmployeeDetails,
    saved: &Authorization,
) -> Result<i32, AppError> {
    let mut tx = pool.begin().await?;
    let revision = save_details_in(&mut tx, employee_id, details, saved).await?;
    tx.commit().await?;
    Ok(revision)
}

/// [`save_employee_details`] inside a caller's transaction.
pub async fn save_details_in(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    details: &EmployeeDetails,
    saved: &Authorization,
) -> Result<i32, AppError> {
    let last: Option<i32> = sqlx::query_scalar(
        "SELECT revision FROM employee_detail WHERE employee_id = $1 FOR UPDATE",
    )
    .bind(employee_id)
    .fetch_optional(&mut **tx)
    .await?;
    let revision = last.map_or(1, |last| last + 1);
    let details = serde_json::to_value(details)?;
    let saved = serde_json::to_value(saved)?;
    sqlx::query(
        "INSERT INTO employee_detail (employee_id, details, revision, saved)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id) DO UPDATE SET
            details = EXCLUDED.details, revision = EXCLUDED.revision, saved = EXCLUDED.saved",
    )
    .bind(employee_id)
    .bind(&details)
    .bind(revision)
    .bind(&saved)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO employee_detail_revision (employee_id, revision, details, saved)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(employee_id)
    .bind(revision)
    .bind(&details)
    .bind(&saved)
    .execute(&mut **tx)
    .await?;
    Ok(revision)
}

// ── papers ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeDocumentView {
    pub id: String,
    /// `PHOTO`, `KTP`, `KK`, `SKCK`, `CONTRACT`, `NPWP`, `BPJS` or `OTHER`.
    pub kind: String,
    /// `PENDING` while it waits on head office with a proposal or a change,
    /// `ACTIVE` once it is on the file.
    pub state: String,
    pub file_id: Uuid,
    pub file_name: String,
    pub content_type: String,
    pub byte_size: i64,
    pub filed_by: String,
    pub filed_at: DateTime<Utc>,
}

const DOCUMENT_SELECT: &str = "
    SELECT d.id, d.kind, d.state, d.file_id, f.file_name, f.content_type, f.byte_size,
           d.filed->>'actor' AS filed_by, d.created_at
      FROM employee_document d
      JOIN stored_file f ON f.file_id = d.file_id";

fn document(row: &sqlx::postgres::PgRow) -> Result<EmployeeDocumentView, AppError> {
    Ok(EmployeeDocumentView {
        id: row.try_get("id")?,
        kind: row.try_get("kind")?,
        state: row.try_get("state")?,
        file_id: row.try_get("file_id")?,
        file_name: row.try_get("file_name")?,
        content_type: row.try_get("content_type")?,
        byte_size: row.try_get("byte_size")?,
        filed_by: row
            .try_get::<Option<String>, _>("filed_by")?
            .unwrap_or_default(),
        filed_at: row.try_get("created_at")?,
    })
}

/// What is on a person's file now, and what waits with a change: everything
/// but the papers a newer one replaced.
pub async fn employee_documents_of(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<EmployeeDocumentView>, AppError> {
    let rows = sqlx::query(&format!(
        "{DOCUMENT_SELECT} WHERE d.employee_id = $1 AND d.state <> 'SUPERSEDED'
          ORDER BY d.kind, d.created_at DESC"
    ))
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(document).collect()
}

/// The papers a hire proposal carries for somebody not yet employed.
pub async fn proposal_documents(
    pool: &PgPool,
    proposal_id: &str,
) -> Result<Vec<EmployeeDocumentView>, AppError> {
    let rows = sqlx::query(&format!(
        "{DOCUMENT_SELECT} WHERE d.hire_proposal_id = $1 AND d.employee_id IS NULL
          ORDER BY d.kind, d.created_at DESC"
    ))
    .bind(proposal_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(document).collect()
}

/// The papers a store's change carries.
pub async fn update_documents(
    pool: &PgPool,
    update_id: &str,
) -> Result<Vec<EmployeeDocumentView>, AppError> {
    let rows = sqlx::query(&format!(
        "{DOCUMENT_SELECT} WHERE d.data_update_id = $1 ORDER BY d.kind, d.created_at DESC"
    ))
    .bind(update_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(document).collect()
}

/// Who uploaded a stored file, and as what, so a paper is only ever filed by
/// the person who uploaded its bytes.
pub async fn stored_file_origin(
    pool: &PgPool,
    file_id: Uuid,
) -> Result<Option<(String, String)>, AppError> {
    let row = sqlx::query("SELECT content_type, uploaded_by FROM stored_file WHERE file_id = $1")
        .bind(file_id)
        .fetch_optional(pool)
        .await?;
    row.map(|row| -> Result<(String, String), AppError> {
        Ok((row.try_get("content_type")?, row.try_get("uploaded_by")?))
    })
    .transpose()
}

/// Whose file a paper is filed on.
#[derive(Clone, Copy, Debug)]
pub enum DocumentOwner<'a> {
    /// Straight onto a person's file, by head office.
    Employee(&'a str),
    /// With a hire proposal, for somebody not yet employed.
    Proposal(&'a str),
    /// With a store's change to a person's data.
    Update {
        employee_id: &'a str,
        update_id: &'a str,
    },
}

/// File a paper. On a person's file it is in force at once and replaces the
/// last of its kind; with a proposal or a change it waits, and replaces any
/// earlier one of its kind that waits with it.
pub async fn file_employee_document(
    pool: &PgPool,
    owner: DocumentOwner<'_>,
    kind: DocumentKind,
    file_id: Uuid,
    filed: &Authorization,
) -> Result<String, AppError> {
    let id = format!("edoc_{}", Uuid::new_v4().simple());
    let filed = serde_json::to_value(filed)?;
    let mut tx = pool.begin().await?;
    let (employee_id, proposal_id, update_id, state) = match owner {
        DocumentOwner::Employee(employee_id) => (Some(employee_id), None, None, "ACTIVE"),
        DocumentOwner::Proposal(proposal_id) => (None, Some(proposal_id), None, "PENDING"),
        DocumentOwner::Update {
            employee_id,
            update_id,
        } => (Some(employee_id), None, Some(update_id), "PENDING"),
    };
    if kind.single() {
        let replaced: Vec<Uuid> = match owner {
            DocumentOwner::Employee(employee_id) => {
                sqlx::query(
                    "UPDATE employee_document SET state = 'SUPERSEDED'
                      WHERE employee_id = $1 AND kind = $2 AND state = 'ACTIVE'",
                )
                .bind(employee_id)
                .bind(kind.code())
                .execute(&mut *tx)
                .await?;
                Vec::new()
            }
            DocumentOwner::Proposal(proposal_id) => {
                sqlx::query_scalar(
                    "DELETE FROM employee_document
                      WHERE hire_proposal_id = $1 AND employee_id IS NULL AND kind = $2
                  RETURNING file_id",
                )
                .bind(proposal_id)
                .bind(kind.code())
                .fetch_all(&mut *tx)
                .await?
            }
            DocumentOwner::Update { update_id, .. } => {
                sqlx::query_scalar(
                    "DELETE FROM employee_document
                      WHERE data_update_id = $1 AND kind = $2 AND state = 'PENDING'
                  RETURNING file_id",
                )
                .bind(update_id)
                .bind(kind.code())
                .fetch_all(&mut *tx)
                .await?
            }
        };
        erase_files(&mut tx, &replaced).await?;
    }
    sqlx::query(
        "INSERT INTO employee_document
            (id, employee_id, hire_proposal_id, data_update_id, kind, file_id, state, filed, taken)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(&id)
    .bind(employee_id)
    .bind(proposal_id)
    .bind(update_id)
    .bind(kind.code())
    .bind(file_id)
    .bind(state)
    .bind(&filed)
    // In force at once means taken at once, by the same hand.
    .bind((state == "ACTIVE").then_some(&filed))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(id)
}

/// Where a paper sits, for the gate in front of its bytes.
#[derive(Clone, Debug)]
pub struct DocumentPlace {
    pub employee_id: Option<String>,
    pub hire_proposal_id: Option<String>,
    pub data_update_id: Option<String>,
    pub state: String,
    pub file_id: Uuid,
    pub filed_by: String,
}

pub async fn document_place(pool: &PgPool, id: &str) -> Result<Option<DocumentPlace>, AppError> {
    let row = sqlx::query(
        "SELECT employee_id, hire_proposal_id, data_update_id, state, file_id,
                filed->>'actor' AS filed_by
           FROM employee_document WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(|row| -> Result<DocumentPlace, AppError> {
        Ok(DocumentPlace {
            employee_id: row.try_get("employee_id")?,
            hire_proposal_id: row.try_get("hire_proposal_id")?,
            data_update_id: row.try_get("data_update_id")?,
            state: row.try_get("state")?,
            file_id: row.try_get("file_id")?,
            filed_by: row
                .try_get::<Option<String>, _>("filed_by")?
                .unwrap_or_default(),
        })
    })
    .transpose()
}

/// Take back a paper that is still waiting, bytes and all.
pub async fn remove_pending_document(pool: &PgPool, id: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let removed: Vec<Uuid> = sqlx::query_scalar(
        "DELETE FROM employee_document WHERE id = $1 AND state = 'PENDING' RETURNING file_id",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    if removed.is_empty() {
        return Err(AppError::Conflict(format!(
            "paper {id} is no longer waiting, so it is head office's to replace"
        )));
    }
    erase_files(&mut tx, &removed).await?;
    tx.commit().await?;
    Ok(())
}

/// Put the waiting papers `documents` (id, kind) onto the person's file, each
/// replacing the one of its kind in force.
async fn take_documents_in(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    documents: &[(String, String)],
    taken: &serde_json::Value,
) -> Result<(), AppError> {
    for (id, kind) in documents {
        let single = DocumentKind::parse(kind).is_some_and(DocumentKind::single);
        if single {
            sqlx::query(
                "UPDATE employee_document SET state = 'SUPERSEDED'
                  WHERE employee_id = $1 AND kind = $2 AND state = 'ACTIVE'",
            )
            .bind(employee_id)
            .bind(kind)
            .execute(&mut **tx)
            .await?;
        }
        sqlx::query(
            "UPDATE employee_document SET employee_id = $2, state = 'ACTIVE', taken = $3
              WHERE id = $1",
        )
        .bind(id)
        .bind(employee_id)
        .bind(taken)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Delete stored bytes nobody else holds. Inside a savepoint: a file some
/// other record also points at is kept rather than failing the decision that
/// is erasing it, and the log says so.
async fn erase_files(
    tx: &mut Transaction<'_, Postgres>,
    file_ids: &[Uuid],
) -> Result<(), AppError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    let mut savepoint = sqlx::Connection::begin(&mut **tx).await?;
    let erased = sqlx::query(
        "DELETE FROM stored_file f
          WHERE f.file_id = ANY($1)
            AND NOT EXISTS (SELECT 1 FROM employee_document d WHERE d.file_id = f.file_id)",
    )
    .bind(file_ids)
    .execute(&mut *savepoint)
    .await;
    match erased {
        Ok(_) => savepoint.commit().await?,
        Err(error) => {
            savepoint.rollback().await?;
            tracing::warn!(%error, files = file_ids.len(), "erased papers kept their bytes: another record holds them");
        }
    }
    Ok(())
}

// ── a new hire's dossier ───────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HireDossierPersonal {
    pub nik: String,
    pub birth_date: NaiveDate,
    pub address: String,
    pub phone: Option<String>,
    pub email: Option<String>,
}

#[derive(Clone, Debug)]
pub struct HireDossierRow {
    pub personal: HireDossierPersonal,
    pub details: EmployeeDetails,
    pub saved_by: String,
    pub saved_at: DateTime<Utc>,
}

pub async fn hire_dossier(
    pool: &PgPool,
    proposal_id: &str,
) -> Result<Option<HireDossierRow>, AppError> {
    let row = sqlx::query(
        "SELECT nik, birth_date, address, phone, email, details,
                saved->>'actor' AS saved_by, (saved->>'at')::timestamptz AS saved_at
           FROM hire_proposal_dossier WHERE hire_proposal_id = $1",
    )
    .bind(proposal_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    Ok(Some(HireDossierRow {
        personal: HireDossierPersonal {
            nik: row.try_get("nik")?,
            birth_date: row.try_get("birth_date")?,
            address: row.try_get("address")?,
            phone: row.try_get("phone")?,
            email: row.try_get("email")?,
        },
        details: details_from(row.try_get("details")?)?,
        saved_by: row
            .try_get::<Option<String>, _>("saved_by")?
            .unwrap_or_default(),
        saved_at: row.try_get("saved_at")?,
    }))
}

/// Key in, or key in again, a new hire's personal data on their proposal.
pub async fn save_hire_dossier(
    pool: &PgPool,
    proposal_id: &str,
    personal: &HireDossierPersonal,
    details: &EmployeeDetails,
    saved: &Authorization,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO hire_proposal_dossier
            (hire_proposal_id, nik, birth_date, address, phone, email, details, saved)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (hire_proposal_id) DO UPDATE SET
            nik = EXCLUDED.nik, birth_date = EXCLUDED.birth_date, address = EXCLUDED.address,
            phone = EXCLUDED.phone, email = EXCLUDED.email, details = EXCLUDED.details,
            saved = EXCLUDED.saved",
    )
    .bind(proposal_id)
    .bind(&personal.nik)
    .bind(personal.birth_date)
    .bind(&personal.address)
    .bind(&personal.phone)
    .bind(&personal.email)
    .bind(serde_json::to_value(details)?)
    .bind(serde_json::to_value(saved)?)
    .execute(pool)
    .await?;
    Ok(())
}

/// Erase a refused candidate's dossier and scans — the line 1001 holds to
/// where 0232 kept personal data off a proposal altogether. Inside the
/// refusal's transaction: the two land together or not at all.
pub async fn erase_hire_dossier_in(
    tx: &mut Transaction<'_, Postgres>,
    proposal_id: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM hire_proposal_dossier WHERE hire_proposal_id = $1")
        .bind(proposal_id)
        .execute(&mut **tx)
        .await?;
    let files: Vec<Uuid> = sqlx::query_scalar(
        "DELETE FROM employee_document WHERE hire_proposal_id = $1 AND employee_id IS NULL
         RETURNING file_id",
    )
    .bind(proposal_id)
    .fetch_all(&mut **tx)
    .await?;
    erase_files(tx, &files).await?;
    Ok(())
}

/// Move a proposal's dossier onto the employee it became: the personal data
/// (enrolled by the caller through the profile kernel), the detail set as its
/// first revision, the papers onto the file — one transaction. The dossier row
/// goes first, as the claim: of two records opened on one proposal, only the
/// one that deleted it adopts the person's data.
pub async fn adopt_hire_dossier(
    pool: &PgPool,
    proposal_id: &str,
    employee_id: &str,
    profile: &Profile,
    details: &EmployeeDetails,
    taken: &Authorization,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let claimed = sqlx::query("DELETE FROM hire_proposal_dossier WHERE hire_proposal_id = $1")
        .bind(proposal_id)
        .execute(&mut *tx)
        .await?;
    if claimed.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "hire proposal {proposal_id}'s dossier has already been moved onto another record"
        )));
    }
    super::employment::upsert_profile_in(&mut tx, employee_id, profile).await?;
    save_details_in(&mut tx, employee_id, details, taken).await?;
    let waiting: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, kind FROM employee_document
          WHERE hire_proposal_id = $1 AND employee_id IS NULL ORDER BY created_at",
    )
    .bind(proposal_id)
    .fetch_all(&mut *tx)
    .await?;
    take_documents_in(
        &mut tx,
        employee_id,
        &waiting,
        &serde_json::to_value(taken)?,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

// ── a store's change, waiting on head office ───────────────────────────────

/// The personal fields a change touches. `None` leaves a field alone; for a
/// phone or an email, an empty string clears it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PersonalChanges {
    #[serde(default)]
    pub full_name: Option<String>,
    #[serde(default)]
    pub nik: Option<String>,
    #[serde(default)]
    pub birth_date: Option<NaiveDate>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}

impl PersonalChanges {
    pub fn is_empty(&self) -> bool {
        *self == PersonalChanges::default()
    }
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeDataUpdateView {
    pub id: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    /// Where they work today, for the approver's reach.
    pub unit_id: Option<String>,
    /// What becomes of each field the change touches.
    pub personal: PersonalChanges,
    /// What those fields said when the change was filed.
    pub before_personal: PersonalChanges,
    /// The whole new detail set, when the change carries one.
    pub details: Option<EmployeeDetails>,
    pub before_details: Option<EmployeeDetails>,
    pub documents: Vec<EmployeeDocumentView>,
    pub reason: String,
    /// `PENDING`, `APPROVED`, `REJECTED` or `WITHDRAWN`.
    pub state: String,
    pub filed_by: String,
    pub filed_at: DateTime<Utc>,
    pub decided_by: Option<String>,
    pub decision_reason: Option<String>,
}

const UPDATE_SELECT: &str = "
    SELECT u.id, u.employee_id, e.code AS employee_code, p.full_name,
           (SELECT a.unit_id FROM employee_assignment a
             WHERE a.employee_id = u.employee_id AND a.valid_from <= current_date
               AND (a.valid_to IS NULL OR a.valid_to >= current_date)
             ORDER BY a.valid_from DESC LIMIT 1) AS unit_id,
           u.personal, u.before_personal, u.details, u.before_details, u.reason, u.state,
           u.filed->>'actor' AS filed_by, u.created_at,
           u.decided->>'actor' AS decided_by, u.decided->>'reason' AS decision_reason
      FROM employee_data_update u
      JOIN employee e ON e.id = u.employee_id
      LEFT JOIN employee_profile p ON p.employee_id = u.employee_id";

async fn update_view(
    pool: &PgPool,
    row: &sqlx::postgres::PgRow,
) -> Result<EmployeeDataUpdateView, AppError> {
    let id: String = row.try_get("id")?;
    let details: Option<serde_json::Value> = row.try_get("details")?;
    let before_details: Option<serde_json::Value> = row.try_get("before_details")?;
    Ok(EmployeeDataUpdateView {
        documents: update_documents(pool, &id).await?,
        id,
        employee_id: row.try_get("employee_id")?,
        employee_code: row.try_get("employee_code")?,
        full_name: row.try_get("full_name")?,
        unit_id: row.try_get("unit_id")?,
        personal: serde_json::from_value(row.try_get("personal")?)?,
        before_personal: serde_json::from_value(row.try_get("before_personal")?)?,
        details: details.map(details_from).transpose()?,
        before_details: before_details.map(details_from).transpose()?,
        reason: row.try_get("reason")?,
        state: row.try_get("state")?,
        filed_by: row
            .try_get::<Option<String>, _>("filed_by")?
            .unwrap_or_default(),
        filed_at: row.try_get("created_at")?,
        decided_by: row.try_get("decided_by")?,
        decision_reason: row.try_get("decision_reason")?,
    })
}

pub async fn data_update(
    pool: &PgPool,
    id: &str,
) -> Result<Option<EmployeeDataUpdateView>, AppError> {
    let row = sqlx::query(&format!("{UPDATE_SELECT} WHERE u.id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(update_view(pool, &row).await?)),
        None => Ok(None),
    }
}

/// One person's changes, newest first.
pub async fn data_updates_of(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<EmployeeDataUpdateView>, AppError> {
    let rows = sqlx::query(&format!(
        "{UPDATE_SELECT} WHERE u.employee_id = $1 ORDER BY u.created_at DESC"
    ))
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    let mut views = Vec::with_capacity(rows.len());
    for row in &rows {
        views.push(update_view(pool, row).await?);
    }
    Ok(views)
}

/// Changes waiting on head office, oldest first; `all` adds the decided ones.
pub async fn data_updates(
    pool: &PgPool,
    all: bool,
) -> Result<Vec<EmployeeDataUpdateView>, AppError> {
    let rows = sqlx::query(&format!(
        "{UPDATE_SELECT} WHERE $1 OR u.state = 'PENDING'
          ORDER BY (u.state = 'PENDING') DESC, u.created_at"
    ))
    .bind(all)
    .fetch_all(pool)
    .await?;
    let mut views = Vec::with_capacity(rows.len());
    for row in &rows {
        views.push(update_view(pool, row).await?);
    }
    Ok(views)
}

/// What a change files, and what the record said when it was filed.
pub struct DataUpdateFiling<'a> {
    pub employee_id: &'a str,
    pub personal: &'a PersonalChanges,
    pub before_personal: &'a PersonalChanges,
    pub details: Option<&'a EmployeeDetails>,
    pub before_details: Option<&'a EmployeeDetails>,
}

/// File a change. A second while one waits is refused: head office would be
/// choosing between two of the store's minds.
pub async fn file_data_update(
    pool: &PgPool,
    filing: DataUpdateFiling<'_>,
    filed: &Authorization,
) -> Result<String, AppError> {
    let waiting: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM employee_data_update
                         WHERE employee_id = $1 AND state = 'PENDING')",
    )
    .bind(filing.employee_id)
    .fetch_one(pool)
    .await?;
    if waiting {
        return Err(AppError::Conflict(
            "a change to this person's data is already waiting on head office: withdraw it first"
                .into(),
        ));
    }
    let id = format!("edu_{}", Uuid::new_v4().simple());
    sqlx::query(
        "INSERT INTO employee_data_update
            (id, employee_id, personal, details, before_personal, before_details, reason, filed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&id)
    .bind(filing.employee_id)
    .bind(serde_json::to_value(filing.personal)?)
    .bind(filing.details.map(serde_json::to_value).transpose()?)
    .bind(serde_json::to_value(filing.before_personal)?)
    .bind(
        filing
            .before_details
            .map(serde_json::to_value)
            .transpose()?,
    )
    .bind(filed.reason().as_str())
    .bind(serde_json::to_value(filed)?)
    .execute(pool)
    .await?;
    Ok(id)
}

/// Close a waiting change as `state`, signed. Taken, its papers go onto the
/// file; refused or withdrawn, they are erased with their bytes.
pub async fn close_data_update(
    pool: &PgPool,
    id: &str,
    state: &str,
    by: &Authorization,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    close_data_update_in(&mut tx, id, state, by).await?;
    tx.commit().await?;
    Ok(())
}

/// [`close_data_update`] inside a caller's transaction. The claim comes first,
/// so an approver who writes the change in the same transaction writes it only
/// when this decision is the one that closed it.
pub async fn close_data_update_in(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    state: &str,
    by: &Authorization,
) -> Result<(), AppError> {
    let by = serde_json::to_value(by)?;
    let employee_id: Option<String> = sqlx::query_scalar(
        "UPDATE employee_data_update SET state = $2, decided = $3
          WHERE id = $1 AND state = 'PENDING' RETURNING employee_id",
    )
    .bind(id)
    .bind(state)
    .bind(&by)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(employee_id) = employee_id else {
        return Err(AppError::Conflict(format!(
            "change {id} is no longer waiting"
        )));
    };
    if state == "APPROVED" {
        let waiting: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, kind FROM employee_document
              WHERE data_update_id = $1 AND state = 'PENDING' ORDER BY created_at",
        )
        .bind(id)
        .fetch_all(&mut **tx)
        .await?;
        take_documents_in(tx, &employee_id, &waiting, &by).await?;
    } else {
        let files: Vec<Uuid> = sqlx::query_scalar(
            "DELETE FROM employee_document WHERE data_update_id = $1 AND state = 'PENDING'
             RETURNING file_id",
        )
        .bind(id)
        .fetch_all(&mut **tx)
        .await?;
        erase_files(tx, &files).await?;
    }
    Ok(())
}
