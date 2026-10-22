//! Papers GA keeps: a document filed before it is scanned, the physical
//! original of it, and every handover of that original (0974).
//!
//! # Three objects, not one (owner, 17 Oct 2026)
//!
//! "BPKB" names three different things. The car is a `fixed_asset`, and its
//! holder is whoever drives it. The paper is a `document`: number, issuer,
//! dates, the records it is about, and a scan when there is one. The sheet of
//! paper is a `ga_document_original`: where it is kept, who has it now, until
//! when, and how it got there (`ga_document_custody_event`). Lending the BPKB
//! to Sari for the STNK renewal changes the original's holder and nothing
//! else — the car's holder stays the driver.
//!
//! Files is the door to the paper and its original; an asset's sheet reads the
//! same rows. The original is never a fixed asset and is never capitalised.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;

/// A record a paper is about, as `document_link` names it — `('asset',
/// <uuid>)`, `('contract', <uuid>)`, `('location', 'store-01')` — with the
/// name a screen shows for it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaPaperSubject {
    pub kind: String,
    pub id: String,
    /// "Toyota Avanza — B 1234 ABC". Absent when the kind is not one GA can
    /// name (the link still stands).
    #[serde(default)]
    pub label: Option<String>,
}

/// One physical original and who has it now.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaOriginalRow {
    pub original_id: Uuid,
    pub document_id: Uuid,
    /// The paper's own words: "BPKB", "M-12345678", its title.
    pub doc_type: Option<String>,
    pub doc_number: Option<String>,
    pub document_title: String,
    /// `ORIGINAL` or `CERTIFIED_COPY`.
    pub kind: String,
    /// `IN_STORAGE` or `OUT`.
    pub status: String,
    /// Where it is kept when it is home.
    pub storage_location: String,
    /// Who has it now — the storage itself while home.
    pub holder_name: String,
    /// `STORAGE`, `EMPLOYEE` or `EXTERNAL`.
    pub holder_kind: String,
    pub out_purpose: Option<String>,
    pub due_back_on: Option<NaiveDate>,
    /// Out and past its due date, by the server's clock.
    pub overdue: bool,
    /// The first asset the paper is about, for a list's second line.
    pub asset_id: Option<Uuid>,
    pub asset_name: Option<String>,
    pub notes: Option<String>,
    pub version: i32,
}

/// One handover, appended and never edited.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaCustodyEvent {
    pub event_id: Uuid,
    /// `REGISTERED`, `RELEASED` or `RETURNED`.
    pub kind: String,
    pub from_holder: Option<String>,
    pub to_holder: String,
    pub to_location: Option<String>,
    pub purpose: Option<String>,
    pub due_back_on: Option<NaiveDate>,
    pub occurred_on: NaiveDate,
    pub recorded_by: String,
    pub recorded_at: chrono::DateTime<chrono::Utc>,
}

/// An original, its handovers, and what its paper is about.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaOriginalHub {
    pub original: GaOriginalRow,
    pub events: Vec<GaCustodyEvent>,
    pub subjects: Vec<GaPaperSubject>,
    pub paper: GaPaper,
}

/// A paper GA keeps, scanned or not, with its originals.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaPaper {
    pub document_id: Uuid,
    pub title: String,
    pub doc_type: Option<String>,
    pub doc_number: Option<String>,
    pub issuer: Option<String>,
    pub issued_on: Option<NaiveDate>,
    pub expires_on: Option<NaiveDate>,
    /// Whether a scan was ever filed for it.
    pub has_scan: bool,
    /// Whether the scan's bytes can be fetched right now.
    pub available: bool,
    pub subjects: Vec<GaPaperSubject>,
    pub originals: Vec<GaOriginalRow>,
}

/// The originals of the papers about one record, or all of them.
#[derive(Clone, Debug, Default)]
pub struct GaOriginalScope {
    pub asset_id: Option<Uuid>,
    pub document_id: Option<Uuid>,
    /// `IN_STORAGE` or `OUT`.
    pub status: Option<String>,
    pub limit: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaPaperSubjectRef {
    pub kind: String,
    pub id: String,
}

/// File a paper with no scan yet — the BPKB in the safe on day one.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct RecordGaPaperRequest {
    /// "BPKB", "STNK", "Sertifikat", "Polis".
    pub doc_type: String,
    #[serde(default)]
    pub doc_number: Option<String>,
    /// What the paper is called on screen; "BPKB · M-12345678" when left out.
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub issuer: Option<String>,
    #[serde(default)]
    pub issued_on: Option<NaiveDate>,
    #[serde(default)]
    pub expires_on: Option<NaiveDate>,
    /// The records it is about. At least one: a paper about nothing is a
    /// paper nobody will find again.
    pub subjects: Vec<GaPaperSubjectRef>,
    /// The original kept in storage, registered in the same step.
    #[serde(default)]
    pub original: Option<RegisterGaOriginalRequest>,
}

/// Register the physical original of a paper already filed.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct RegisterGaOriginalRequest {
    /// `ORIGINAL` (the default) or `CERTIFIED_COPY`.
    #[serde(default)]
    pub kind: Option<String>,
    /// Where it is kept: "Brankas A-02, HO".
    pub storage_location: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub occurred_on: Option<NaiveDate>,
}

/// Hand an original to somebody.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct ReleaseGaOriginalRequest {
    pub to_holder: String,
    /// `EMPLOYEE` or `EXTERNAL`.
    pub holder_kind: String,
    #[serde(default)]
    pub to_location: Option<String>,
    pub purpose: String,
    #[serde(default)]
    pub due_back_on: Option<NaiveDate>,
    pub occurred_on: NaiveDate,
    /// The version the person saw; a sheet handed over twice at once is
    /// refused rather than lent to two people.
    #[serde(default)]
    pub expected_version: Option<i32>,
}

/// Take an original back into storage.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct ReturnGaOriginalRequest {
    pub occurred_on: NaiveDate,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub expected_version: Option<i32>,
}

/// Attach a scan, already uploaded through `/api/v1/files`, to a paper filed
/// without one.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AttachGaScanRequest {
    pub file_id: Uuid,
}

pub const DEFAULT_GA_ORIGINAL_LIMIT: i64 = 200;
const MAX_GA_ORIGINAL_LIMIT: i64 = 1000;

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

const ORIGINAL_SELECT: &str = "SELECT o.original_id, o.document_id, o.kind, o.status,
        o.storage_location, o.holder_name, o.holder_kind, o.out_purpose, o.due_back_on,
        o.notes, o.version, d.doc_type, d.doc_number, COALESCE(d.title, d.name) AS document_title,
        a.asset_id, a.name AS asset_name
   FROM ga_document_original o
   JOIN document d ON d.document_id = o.document_id
   LEFT JOIN LATERAL (
        SELECT fa.asset_id, fa.name
          FROM document_link l
          JOIN fixed_asset fa ON fa.asset_id::text = l.subject_id
         WHERE l.document_id = o.document_id AND l.subject_kind = 'asset'
         ORDER BY fa.asset_number
         LIMIT 1
   ) a ON true";

fn to_original(row: &sqlx::postgres::PgRow, today: NaiveDate) -> Result<GaOriginalRow, AppError> {
    let status: String = row.try_get("status")?;
    let due_back_on: Option<NaiveDate> = row.try_get("due_back_on")?;
    Ok(GaOriginalRow {
        original_id: row.try_get("original_id")?,
        document_id: row.try_get("document_id")?,
        doc_type: row.try_get("doc_type")?,
        doc_number: row.try_get("doc_number")?,
        document_title: row.try_get("document_title")?,
        kind: row.try_get("kind")?,
        overdue: status == "OUT" && due_back_on.is_some_and(|due| due < today),
        status,
        storage_location: row.try_get("storage_location")?,
        holder_name: row.try_get("holder_name")?,
        holder_kind: row.try_get("holder_kind")?,
        out_purpose: row.try_get("out_purpose")?,
        due_back_on,
        asset_id: row.try_get("asset_id")?,
        asset_name: row.try_get("asset_name")?,
        notes: row.try_get("notes")?,
        version: row.try_get("version")?,
    })
}

/// The originals, narrowed in the query.
pub async fn ga_originals(
    pool: &PgPool,
    scope: &GaOriginalScope,
    today: NaiveDate,
) -> Result<Vec<GaOriginalRow>, AppError> {
    let status = trimmed(scope.status.as_deref()).map(|text| text.to_ascii_uppercase());
    let sql = format!(
        "{ORIGINAL_SELECT}
          WHERE ($1::uuid IS NULL OR EXISTS (
                    SELECT 1 FROM document_link l
                     WHERE l.document_id = o.document_id
                       AND l.subject_kind = 'asset' AND l.subject_id = $1::text))
            AND ($2::uuid IS NULL OR o.document_id = $2)
            AND ($3::text IS NULL OR o.status = $3)
          ORDER BY (o.status = 'OUT') DESC, o.due_back_on NULLS LAST, d.doc_type, o.original_id
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(scope.asset_id)
        .bind(scope.document_id)
        .bind(status)
        .bind(scope.limit.clamp(1, MAX_GA_ORIGINAL_LIMIT))
        .fetch_all(pool)
        .await?;
    rows.iter().map(|row| to_original(row, today)).collect()
}

async fn subjects_of(pool: &PgPool, document_id: Uuid) -> Result<Vec<GaPaperSubject>, AppError> {
    let rows = sqlx::query(
        "SELECT l.subject_kind, l.subject_id,
                CASE l.subject_kind
                  WHEN 'asset' THEN (SELECT a.name FROM fixed_asset a WHERE a.asset_id::text = l.subject_id)
                  WHEN 'contract' THEN (SELECT COALESCE(c.contract_number, ct.name)
                                          FROM ga_contract c JOIN contract_type ct ON ct.code = c.contract_type
                                         WHERE c.contract_id::text = l.subject_id)
                  WHEN 'location' THEN (SELECT s.name FROM site s WHERE s.id = l.subject_id)
                  ELSE NULL
                END AS label
           FROM document_link l
          WHERE l.document_id = $1
          ORDER BY l.subject_kind, l.subject_id",
    )
    .bind(document_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(GaPaperSubject {
                kind: row.try_get("subject_kind")?,
                id: row.try_get("subject_id")?,
                label: row.try_get("label")?,
            })
        })
        .collect()
}

/// One paper, scanned or not, with what it is about and its originals.
pub async fn ga_paper(
    pool: &PgPool,
    document_id: Uuid,
    today: NaiveDate,
) -> Result<GaPaper, AppError> {
    let row = sqlx::query(
        "SELECT d.document_id, COALESCE(d.title, d.name) AS title, d.doc_type, d.doc_number,
                d.issuer, d.issued_on, d.expires_on, d.file_id IS NOT NULL AS has_scan,
                COALESCE(f.available, false) AS available
           FROM document d
           LEFT JOIN stored_file f ON f.file_id = d.file_id
          WHERE d.document_id = $1",
    )
    .bind(document_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("paper".into()))?;
    let originals = ga_originals(
        pool,
        &GaOriginalScope {
            document_id: Some(document_id),
            limit: DEFAULT_GA_ORIGINAL_LIMIT,
            ..Default::default()
        },
        today,
    )
    .await?;
    Ok(GaPaper {
        document_id: row.try_get("document_id")?,
        title: row.try_get("title")?,
        doc_type: row.try_get("doc_type")?,
        doc_number: row.try_get("doc_number")?,
        issuer: row.try_get("issuer")?,
        issued_on: row.try_get("issued_on")?,
        expires_on: row.try_get("expires_on")?,
        has_scan: row.try_get("has_scan")?,
        available: row.try_get("available")?,
        subjects: subjects_of(pool, document_id).await?,
        originals,
    })
}

/// The papers about one record — what an asset's or a contract's sheet lists,
/// scanned or not.
pub async fn ga_papers_about(
    pool: &PgPool,
    subject_kind: &str,
    subject_id: &str,
    today: NaiveDate,
) -> Result<Vec<GaPaper>, AppError> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT d.document_id
           FROM document d
           JOIN document_link l ON l.document_id = d.document_id
          WHERE l.subject_kind = $1 AND l.subject_id = $2
          ORDER BY d.expires_on NULLS LAST, d.created_at DESC
          LIMIT 200",
    )
    .bind(subject_kind)
    .bind(subject_id)
    .fetch_all(pool)
    .await?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        out.push(ga_paper(pool, id, today).await?);
    }
    Ok(out)
}

/// Every paper GA keeps that has a type — the Files view of papers, with or
/// without a scan.
pub async fn ga_papers(
    pool: &PgPool,
    needle: Option<&str>,
    today: NaiveDate,
) -> Result<Vec<GaPaper>, AppError> {
    let pattern = trimmed(needle).map(|text| format!("%{text}%"));
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT d.document_id
           FROM document d
          WHERE d.doc_type IS NOT NULL
            AND ($1::text IS NULL OR d.doc_number ILIKE $1 OR d.doc_type ILIKE $1
                 OR COALESCE(d.title, d.name) ILIKE $1)
          ORDER BY d.doc_type, d.doc_number NULLS LAST, d.document_id
          LIMIT 300",
    )
    .bind(pattern)
    .fetch_all(pool)
    .await?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        out.push(ga_paper(pool, id, today).await?);
    }
    Ok(out)
}

const SUBJECT_KINDS: [&str; 4] = ["asset", "contract", "location", "repair"];

/// File a paper with no scan, its links, and optionally its original — one
/// transaction, so a paper is never left about nothing or an original without
/// its first custody line.
pub async fn ga_paper_record(
    pool: &PgPool,
    request: &RecordGaPaperRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaPaper, AppError> {
    let doc_type = trimmed(Some(&request.doc_type)).ok_or_else(|| {
        AppError::Validation("a paper says what it is: BPKB, STNK, a policy".into())
    })?;
    if request.subjects.is_empty() {
        return Err(AppError::Validation(
            "a paper is about something; name the asset, contract or site it belongs to".into(),
        ));
    }
    if let (Some(issued), Some(expires)) = (request.issued_on, request.expires_on) {
        if expires < issued {
            return Err(AppError::Validation(
                "a paper cannot expire before it was issued".into(),
            ));
        }
    }
    let number = trimmed(request.doc_number.as_deref());
    let title = trimmed(request.title.as_deref()).unwrap_or_else(|| match &number {
        Some(number) => format!("{doc_type} · {number}"),
        None => doc_type.clone(),
    });

    let mut tx = pool.begin().await?;
    for subject in &request.subjects {
        let kind = subject.kind.trim();
        if !SUBJECT_KINDS.contains(&kind) {
            return Err(AppError::Validation(format!(
                "a paper is about one of: {}; not {kind:?}",
                SUBJECT_KINDS.join(", ")
            )));
        }
        let exists: bool = match kind {
            "asset" | "contract" | "repair" => {
                let id = Uuid::parse_str(subject.id.trim()).map_err(|_| {
                    AppError::Validation(format!("{kind} {:?} is not an id", subject.id))
                })?;
                let table = match kind {
                    "asset" => "SELECT EXISTS (SELECT 1 FROM fixed_asset WHERE asset_id = $1)",
                    "contract" => {
                        "SELECT EXISTS (SELECT 1 FROM ga_contract WHERE contract_id = $1)"
                    }
                    _ => "SELECT EXISTS (SELECT 1 FROM ga_repair WHERE repair_id = $1)",
                };
                sqlx::query_scalar::<_, bool>(table)
                    .bind(id)
                    .fetch_one(&mut *tx)
                    .await?
            }
            _ => {
                sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
                    .bind(subject.id.trim())
                    .fetch_one(&mut *tx)
                    .await?
            }
        };
        if !exists {
            return Err(AppError::Validation(format!(
                "there is no {kind} {}",
                subject.id
            )));
        }
    }

    // No scan yet: the paper exists, its bytes do not. COMPLETED, because there
    // is nothing for the text extraction to read.
    let document_id: Uuid = sqlx::query_scalar(
        "INSERT INTO document
           (file_id, name, title, doc_type, doc_number, issuer, issued_on, expires_on,
            uploaded_by, processing_status)
         VALUES (NULL, $1, $1, $2, $3, $4, $5, $6, $7, 'COMPLETED')
         RETURNING document_id",
    )
    .bind(&title)
    .bind(&doc_type)
    .bind(&number)
    .bind(trimmed(request.issuer.as_deref()))
    .bind(request.issued_on)
    .bind(request.expires_on)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    for subject in &request.subjects {
        sqlx::query(
            "INSERT INTO document_link (document_id, subject_kind, subject_id)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(document_id)
        .bind(subject.kind.trim())
        .bind(subject.id.trim())
        .execute(&mut *tx)
        .await?;
    }
    if let Some(original) = &request.original {
        register_original_in(&mut tx, document_id, original, actor, today).await?;
    }
    tx.commit().await?;
    ga_paper(pool, document_id, today).await
}

async fn register_original_in(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: Uuid,
    request: &RegisterGaOriginalRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<Uuid, AppError> {
    let kind = trimmed(request.kind.as_deref())
        .map(|text| text.to_ascii_uppercase())
        .unwrap_or_else(|| "ORIGINAL".into());
    if kind != "ORIGINAL" && kind != "CERTIFIED_COPY" {
        return Err(AppError::Validation(format!(
            "an original is ORIGINAL or CERTIFIED_COPY, not {kind:?}"
        )));
    }
    let location = trimmed(Some(&request.storage_location))
        .ok_or_else(|| AppError::Validation("say where the original is kept".into()))?;
    let original_id: Uuid = sqlx::query_scalar(
        "INSERT INTO ga_document_original
           (document_id, kind, storage_location, holder_name, holder_kind, notes, created_by)
         VALUES ($1, $2, $3, $3, 'STORAGE', $4, $5)
         RETURNING original_id",
    )
    .bind(document_id)
    .bind(&kind)
    .bind(&location)
    .bind(trimmed(request.notes.as_deref()))
    .bind(actor)
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO ga_document_custody_event
           (original_id, kind, to_holder, to_location, occurred_on, recorded_by)
         VALUES ($1, 'REGISTERED', $2, $2, $3, $4)",
    )
    .bind(original_id)
    .bind(&location)
    .bind(request.occurred_on.unwrap_or(today))
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    Ok(original_id)
}

/// Register the original of a paper already filed (scanned or not).
pub async fn ga_original_register(
    pool: &PgPool,
    document_id: Uuid,
    request: &RegisterGaOriginalRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaOriginalHub, AppError> {
    let mut tx = pool.begin().await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM document WHERE document_id = $1)")
            .bind(document_id)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(AppError::NotFound("paper".into()));
    }
    let original_id = register_original_in(&mut tx, document_id, request, actor, today).await?;
    tx.commit().await?;
    ga_original_hub(pool, original_id, today).await
}

/// One original, its handovers, and its paper.
pub async fn ga_original_hub(
    pool: &PgPool,
    original_id: Uuid,
    today: NaiveDate,
) -> Result<GaOriginalHub, AppError> {
    let sql = format!("{ORIGINAL_SELECT} WHERE o.original_id = $1");
    let row = sqlx::query(&sql)
        .bind(original_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("original".into()))?;
    let original = to_original(&row, today)?;
    let event_rows = sqlx::query(
        "SELECT event_id, kind, from_holder, to_holder, to_location, purpose, due_back_on,
                occurred_on, recorded_by, recorded_at
           FROM ga_document_custody_event
          WHERE original_id = $1
          ORDER BY occurred_on DESC, recorded_at DESC",
    )
    .bind(original_id)
    .fetch_all(pool)
    .await?;
    let events = event_rows
        .iter()
        .map(|row| {
            Ok(GaCustodyEvent {
                event_id: row.try_get("event_id")?,
                kind: row.try_get("kind")?,
                from_holder: row.try_get("from_holder")?,
                to_holder: row.try_get("to_holder")?,
                to_location: row.try_get("to_location")?,
                purpose: row.try_get("purpose")?,
                due_back_on: row.try_get("due_back_on")?,
                occurred_on: row.try_get("occurred_on")?,
                recorded_by: row.try_get("recorded_by")?,
                recorded_at: row.try_get("recorded_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let paper = ga_paper(pool, original.document_id, today).await?;
    Ok(GaOriginalHub {
        subjects: paper.subjects.clone(),
        original,
        events,
        paper,
    })
}

/// Lock an original and check the version the person saw.
async fn lock_original(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    original_id: Uuid,
    expected_version: Option<i32>,
) -> Result<(String, String, String), AppError> {
    let row = sqlx::query(
        "SELECT status, holder_name, storage_location, version
           FROM ga_document_original WHERE original_id = $1 FOR UPDATE",
    )
    .bind(original_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("original".into()))?;
    let version: i32 = row.try_get("version")?;
    if let Some(expected) = expected_version {
        if expected != version {
            return Err(AppError::Conflict(
                "somebody else handed this original over a moment ago; open it again".into(),
            ));
        }
    }
    Ok((
        row.try_get("status")?,
        row.try_get("holder_name")?,
        row.try_get("storage_location")?,
    ))
}

/// A handover is dated on or after the last one and not in the future, so the
/// history reads in the order the original actually moved.
async fn check_handover_date(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    original_id: Uuid,
    occurred_on: NaiveDate,
    today: NaiveDate,
) -> Result<(), AppError> {
    if occurred_on > today {
        return Err(AppError::Validation(
            "a handover cannot be dated in the future".into(),
        ));
    }
    let last: Option<NaiveDate> = sqlx::query_scalar(
        "SELECT max(occurred_on) FROM ga_document_custody_event WHERE original_id = $1",
    )
    .bind(original_id)
    .fetch_one(&mut **tx)
    .await?;
    if let Some(last) = last {
        if occurred_on < last {
            return Err(AppError::Validation(format!(
                "the last handover of this original is dated {}; this one cannot be earlier",
                last.format("%-d %b %Y")
            )));
        }
    }
    Ok(())
}

/// Hand an original that is in storage to somebody.
pub async fn ga_original_release(
    pool: &PgPool,
    original_id: Uuid,
    request: &ReleaseGaOriginalRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaOriginalHub, AppError> {
    let to_holder = trimmed(Some(&request.to_holder))
        .ok_or_else(|| AppError::Validation("say who receives the original".into()))?;
    let purpose = trimmed(Some(&request.purpose))
        .ok_or_else(|| AppError::Validation("say why the original leaves storage".into()))?;
    let holder_kind = request.holder_kind.trim().to_ascii_uppercase();
    if holder_kind != "EMPLOYEE" && holder_kind != "EXTERNAL" {
        return Err(AppError::Validation(
            "an original goes to an EMPLOYEE or to an EXTERNAL party".into(),
        ));
    }
    if let Some(due) = request.due_back_on {
        if due < request.occurred_on {
            return Err(AppError::Validation(
                "an original cannot be due back before it leaves".into(),
            ));
        }
    }
    let mut tx = pool.begin().await?;
    let (status, holder, _) = lock_original(&mut tx, original_id, request.expected_version).await?;
    if status != "IN_STORAGE" {
        return Err(AppError::Conflict(format!(
            "the original is already out with {holder}; take it back before lending it again"
        )));
    }
    check_handover_date(&mut tx, original_id, request.occurred_on, today).await?;
    sqlx::query(
        "UPDATE ga_document_original
            SET status = 'OUT', holder_name = $2, holder_kind = $3, out_purpose = $4,
                due_back_on = $5, version = version + 1
          WHERE original_id = $1",
    )
    .bind(original_id)
    .bind(&to_holder)
    .bind(&holder_kind)
    .bind(&purpose)
    .bind(request.due_back_on)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO ga_document_custody_event
           (original_id, kind, from_holder, to_holder, to_location, purpose, due_back_on,
            occurred_on, recorded_by)
         VALUES ($1, 'RELEASED', $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(original_id)
    .bind(&holder)
    .bind(&to_holder)
    .bind(trimmed(request.to_location.as_deref()))
    .bind(&purpose)
    .bind(request.due_back_on)
    .bind(request.occurred_on)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ga_original_hub(pool, original_id, today).await
}

/// Take an original that is out back into its storage.
pub async fn ga_original_return(
    pool: &PgPool,
    original_id: Uuid,
    request: &ReturnGaOriginalRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaOriginalHub, AppError> {
    let mut tx = pool.begin().await?;
    let (status, holder, location) =
        lock_original(&mut tx, original_id, request.expected_version).await?;
    if status != "OUT" {
        return Err(AppError::Conflict(
            "the original is already in storage".into(),
        ));
    }
    check_handover_date(&mut tx, original_id, request.occurred_on, today).await?;
    sqlx::query(
        "UPDATE ga_document_original
            SET status = 'IN_STORAGE', holder_name = storage_location, holder_kind = 'STORAGE',
                out_purpose = NULL, due_back_on = NULL, version = version + 1
          WHERE original_id = $1",
    )
    .bind(original_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO ga_document_custody_event
           (original_id, kind, from_holder, to_holder, to_location, purpose, occurred_on,
            recorded_by)
         VALUES ($1, 'RETURNED', $2, $3, $3, $4, $5, $6)",
    )
    .bind(original_id)
    .bind(&holder)
    .bind(&location)
    .bind(trimmed(request.note.as_deref()))
    .bind(request.occurred_on)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ga_original_hub(pool, original_id, today).await
}

/// Attach a scan to a paper filed without one. A paper that already has a scan
/// keeps it: a second scan is a new paper or a new version, not an overwrite.
pub async fn ga_paper_attach_scan(
    pool: &PgPool,
    document_id: Uuid,
    request: &AttachGaScanRequest,
    today: NaiveDate,
) -> Result<GaPaper, AppError> {
    let done = sqlx::query(
        "UPDATE document SET file_id = $2, updated_at = now()
          WHERE document_id = $1 AND file_id IS NULL
            AND EXISTS (SELECT 1 FROM stored_file f WHERE f.file_id = $2)",
    )
    .bind(document_id)
    .bind(request.file_id)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "the paper already has a scan, or the file does not exist".into(),
        ));
    }
    ga_paper(pool, document_id, today).await
}
