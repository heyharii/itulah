//! The document drawer: files that are things in their own right.
//!
//! Deliberately not `files`. An attachment there is reached only through the
//! conversation or post that carries it, so a link cannot leave the room it
//! was posted in. That is right for correspondence and wrong for a filing
//! cabinet: a supplier's contract is not "a message that happened to have a
//! PDF on it", it is a document somebody will go looking for a year later
//! knowing only that it mentioned cotton.
//!
//! So a document sits ON TOP of `stored_file` rather than replacing it. The
//! bytes, the hash and the `available` flag stay where they are and keep
//! serving chat; this adds the filing — a name, a folder, tags, what it is
//! about, and enough text to find it by.
//!
//! # Uploads go past this process, not through it
//!
//! The browser PUTs to a presigned URL and then tells us where it put it. A
//! node with 512MB of memory should not read a 20MB contract into RAM to hand
//! it to a bucket it could have been given directly. The cost is that the
//! server never sees the bytes, so it cannot hash them — which is why
//! [`file_document`] goes and asks the bucket whether the object is really
//! there before recording a row that claims it is.

use crate::cloud::application::{AppError, AppState};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Where documents live in the private bucket. Separate from `attachments/`
/// so a lifecycle rule can treat correspondence and contracts differently
/// without either having to move.
const DOCUMENT_PREFIX: &str = "documents";

/// Long enough for a large file on a shop's connection, short enough that a
/// URL copied out of a log is useless by the time anyone reads it.
const UPLOAD_URL_TTL_SECONDS: u32 = 900;
const READ_URL_TTL_SECONDS: u32 = 300;

/// A place to put bytes, before there is anything to record.
///
/// No row is written here. A reservation that failed to upload should leave
/// nothing behind: a `stored_file` row whose object never arrived is a
/// document the screens would have to apologise for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DocumentUpload {
    /// Echoed back to `POST /documents` so the server can find the object
    /// without trusting a caller-supplied key.
    pub upload_id: Uuid,
    pub upload_url: String,
    pub expires_in_seconds: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DocumentUploadRequest {
    pub file_name: String,
    #[serde(default)]
    pub content_type: Option<String>,
}

/// What a document is about. One row per link, so a delivery note may name
/// both the order it fulfils and the receipt that accepted it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DocumentLink {
    pub subject_kind: String,
    pub subject_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FileDocumentRequest {
    /// The reservation the bytes were PUT to, when they went straight to the
    /// bucket past this process. Exactly one of this and [`Self::file_id`].
    #[serde(default)]
    pub upload_id: Option<Uuid>,
    /// A file this node has already taken in — what `POST /files` answers with.
    ///
    /// Two reasons this exists beside `upload_id`. The first is that
    /// `reserve_upload` needs a bucket, so on a node with no object storage
    /// configured — every development one, and the seed — filing a document was
    /// not merely awkward but impossible: the first step of three answered 404.
    /// `POST /files` has always worked there, because `stored_file` keeps the
    /// bytes in the row when there is nowhere else to put them.
    ///
    /// The second is the one the drawer actually wanted. A file already
    /// attached in a thread can now be filed as a document without a second
    /// copy of the bytes: the same `stored_file` row carries both, so the
    /// contract somebody posted in a conversation becomes a filed contract
    /// rather than a duplicate of one.
    #[serde(default)]
    pub file_id: Option<Uuid>,
    pub file_name: String,
    #[serde(default)]
    pub content_type: Option<String>,
    /// Computed in the browser. Asserted rather than proven: the bytes never
    /// passed through here. Recorded anyway because two uploads of the same
    /// contract should be visibly the same contract, and a later agent that
    /// reads the object can check it.
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    /// The folder, as segments. An array rather than a string so a prefix can
    /// be matched without parsing separators, and a folder named "SS26/27" is
    /// not two folders.
    #[serde(default)]
    pub path_tokens: Vec<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub doc_date: Option<NaiveDate>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub links: Vec<DocumentLink>,
}

/// One filed document, as a screen sees it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Document {
    pub document_id: Uuid,
    pub file_id: Uuid,
    pub name: String,
    pub title: Option<String>,
    pub path_tokens: Vec<String>,
    pub summary: Option<String>,
    pub language: String,
    pub processing_status: String,
    pub doc_date: Option<NaiveDate>,
    pub byte_size: i64,
    pub content_type: String,
    /// Whether the bytes can be fetched right now. Carried from `stored_file`
    /// so a drawer can say "filed, but the object is gone" rather than hand
    /// out a link that fails.
    pub available: bool,
    pub tags: Vec<String>,
    pub links: Vec<DocumentLink>,
    pub uploaded_by: String,
    pub created_at: DateTime<Utc>,
}

const DOCUMENT_COLUMNS: &str = "d.document_id, d.file_id, d.name, d.title, d.path_tokens,
     d.summary, d.language, d.processing_status, d.doc_date, d.uploaded_by, d.created_at,
     f.byte_size, f.content_type, f.available,
     COALESCE((SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                 FROM document_tag t WHERE t.document_id = d.document_id), '{}') AS tags,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('subject_kind', l.subject_kind,
                                                   'subject_id', l.subject_id)
                                ORDER BY l.subject_kind, l.subject_id)
                 FROM document_link l WHERE l.document_id = d.document_id), '[]'::jsonb) AS links";

fn document_from_row(row: &sqlx::postgres::PgRow) -> Result<Document, AppError> {
    Ok(Document {
        document_id: row.try_get("document_id")?,
        file_id: row.try_get("file_id")?,
        name: row.try_get("name")?,
        title: row.try_get("title")?,
        path_tokens: row.try_get("path_tokens")?,
        summary: row.try_get("summary")?,
        language: row.try_get("language")?,
        processing_status: row.try_get("processing_status")?,
        doc_date: row.try_get("doc_date")?,
        byte_size: row.try_get("byte_size")?,
        content_type: row.try_get("content_type")?,
        available: row.try_get("available")?,
        tags: row.try_get("tags")?,
        links: serde_json::from_value(row.try_get("links")?)?,
        uploaded_by: row.try_get("uploaded_by")?,
        created_at: row.try_get("created_at")?,
    })
}

fn store(state: &AppState) -> Result<&crate::cloud::attachments::AttachmentStore, AppError> {
    state.attachments.as_deref().ok_or_else(|| {
        // Not a 500. A node without a private bucket is a valid deployment
        // that simply has no drawer, and saying so is more use than a stack
        // trace.
        AppError::NotFound(
            "this node has no document storage configured (set the attachment bucket)".into(),
        )
    })
}

fn object_key(upload_id: Uuid) -> String {
    format!("{DOCUMENT_PREFIX}/{upload_id}")
}

/// Hand back somewhere to put the bytes.
pub fn reserve_upload(
    state: &AppState,
    request: &DocumentUploadRequest,
) -> Result<DocumentUpload, AppError> {
    if request.file_name.trim().is_empty() {
        return Err(AppError::Validation("a document needs a file name".into()));
    }
    let upload_id = Uuid::new_v4();
    let upload_url = store(state)?.presign_put(&object_key(upload_id), UPLOAD_URL_TTL_SECONDS)?;
    Ok(DocumentUpload {
        upload_id,
        upload_url,
        expires_in_seconds: UPLOAD_URL_TTL_SECONDS,
    })
}

/// Record the upload as a document, once the bytes are actually there.
pub async fn file_document(
    state: &AppState,
    request: FileDocumentRequest,
    actor: &str,
) -> Result<Document, AppError> {
    let name = request.file_name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("a document needs a file name".into()));
    }
    let language = request.language.unwrap_or_else(|| "indonesian".into());

    let mut tx = state.db.begin().await?;

    // Where the bytes are is the one thing that differs between the two ways in,
    // and it is settled before anything is written. Everything past this point
    // is the filing, which is the same either way.
    let file_id = match (request.file_id, request.upload_id) {
        (Some(file_id), _) => {
            // Filing a file this node already holds. It must exist, and it must
            // not already be filed — a second document over one file would put
            // the same bytes in the drawer twice under two names.
            let held: Option<(bool,)> =
                sqlx::query_as("SELECT true FROM stored_file WHERE file_id = $1")
                    .bind(file_id)
                    .fetch_optional(&mut *tx)
                    .await?;
            if held.is_none() {
                return Err(AppError::Validation(
                    "there is no such uploaded file to file".into(),
                ));
            }
            let filed: Option<(Uuid,)> =
                sqlx::query_as("SELECT document_id FROM document WHERE file_id = $1")
                    .bind(file_id)
                    .fetch_optional(&mut *tx)
                    .await?;
            if filed.is_some() {
                return Err(AppError::Validation(
                    "that file is already filed as a document".into(),
                ));
            }
            file_id
        }
        (None, Some(upload_id)) => {
            let key = object_key(upload_id);
            // Go and look. The browser uploaded past this process, so "the
            // client said it worked" is the only other evidence available, and
            // it is not evidence.
            let byte_size = store(state)?.head(&key).await?.ok_or_else(|| {
                AppError::Validation(
                    "no object was uploaded for this reservation, or the upload did not finish"
                        .into(),
                )
            })?;
            let byte_size = i64::try_from(byte_size)
                .map_err(|_| AppError::Validation("uploaded object is implausibly large".into()))?;

            let content_type = request
                .content_type
                .unwrap_or_else(|| "application/octet-stream".into());
            // A hash the server did not compute is still worth keeping, but it
            // must not masquerade as one it did. Absent means absent.
            let sha256 = request.sha256.unwrap_or_else(|| "0".repeat(64));

            let file_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO stored_file
                     (file_id, file_name, content_type, byte_size, sha256, storage, object_key,
                      uploaded_by, available)
                 VALUES ($1,$2,$3,$4,$5,'OBJECT',$6,$7,true)",
            )
            .bind(file_id)
            .bind(&name)
            .bind(&content_type)
            .bind(byte_size)
            .bind(&sha256)
            .bind(&key)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
            file_id
        }
        (None, None) => {
            return Err(AppError::Validation(
                "a document needs either an upload reservation or an uploaded file".into(),
            ))
        }
    };

    let document_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO document
             (document_id, file_id, name, title, path_tokens, language, doc_date, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(document_id)
    .bind(file_id)
    .bind(&name)
    .bind(
        request
            .title
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(&request.path_tokens)
    .bind(&language)
    .bind(request.doc_date)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    for tag in &request.tags {
        sqlx::query("INSERT INTO document_tag (document_id, tag_code) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(document_id)
            .bind(tag.trim())
            .execute(&mut *tx)
            .await
            .map_err(|error| match &error {
                // The vocabulary refuses the word, and the refusal should name
                // it rather than arrive as a foreign key violation.
                sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => {
                    AppError::Validation(format!("{tag:?} is not a tag in the vocabulary"))
                }
                _ => AppError::from(error),
            })?;
    }
    for link in &request.links {
        sqlx::query(
            "INSERT INTO document_link (document_id, subject_kind, subject_id)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        )
        .bind(document_id)
        .bind(link.subject_kind.trim())
        .bind(link.subject_id.trim())
        .execute(&mut *tx)
        .await
        .map_err(|error| match &error {
            sqlx::Error::Database(db) if db.code().as_deref() == Some("23514") => {
                AppError::Validation(format!(
                    "{:?} is not something a document can be filed against",
                    link.subject_kind
                ))
            }
            _ => AppError::from(error),
        })?;
    }
    tx.commit().await?;
    read_document(&state.db, document_id).await
}

pub async fn read_document(db: &PgPool, document_id: Uuid) -> Result<Document, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {DOCUMENT_COLUMNS}
           FROM document d JOIN stored_file f USING (file_id)
          WHERE d.document_id = $1"
    ))
    .bind(document_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound("Document".into()))?;
    document_from_row(&row)
}

/// A short-lived URL for reading one document, issued after the caller's
/// permission has been checked.
pub async fn download_url(state: &AppState, document_id: Uuid) -> Result<String, AppError> {
    let key: String = sqlx::query("SELECT f.object_key FROM document d JOIN stored_file f USING (file_id) WHERE d.document_id = $1")
        .bind(document_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Document".into()))?
        .try_get::<Option<String>, _>("object_key")?
        .ok_or_else(|| AppError::NotFound("this document's bytes are not in object storage".into()))?;
    store(state)?.presign_get(&key, READ_URL_TTL_SECONDS)
}

/// What a search asks for.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct DocumentQuery {
    pub q: Option<String>,
    pub tags: Vec<String>,
    /// Everything filed under this folder, at any depth.
    pub path: Vec<String>,
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    pub limit: i64,
}

/// Find documents.
///
/// Both text search configurations are consulted, not the one named by the
/// row's `language`. A buyer searching "kontrak cotton" is searching one
/// drawer holding both an Indonesian contract and an English spec sheet, and
/// making them choose a language first is making them guess which one the
/// filing clerk picked.
pub async fn search_documents(
    db: &PgPool,
    query: DocumentQuery,
) -> Result<Vec<Document>, AppError> {
    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let tags = (!query.tags.is_empty()).then_some(query.tags);
    let path = (!query.path.is_empty()).then_some(query.path);
    let rows = sqlx::query(&format!(
        "SELECT {DOCUMENT_COLUMNS},
                CASE WHEN $1::text IS NULL THEN 0
                     ELSE GREATEST(
                        ts_rank('{{0.1,0.2,0.4,1.0}}'::float4[], d.fts_id,
                                plainto_tsquery('indonesian', $1)),
                        ts_rank('{{0.1,0.2,0.4,1.0}}'::float4[], d.fts_en,
                                plainto_tsquery('english', $1)))
                END AS rank
           FROM document d JOIN stored_file f USING (file_id)
          WHERE ($1::text IS NULL
                 OR d.fts_id @@ plainto_tsquery('indonesian', $1)
                 OR d.fts_en @@ plainto_tsquery('english', $1)
                 -- The half-remembered filename, which no stemmer helps with.
                 OR d.name % $1)
            AND ($2::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM document_tag t
                     WHERE t.document_id = d.document_id AND t.tag_code = ANY($2)))
            AND ($3::text[] IS NULL OR d.path_tokens @> $3)
            AND ($4::text IS NULL OR EXISTS (
                    SELECT 1 FROM document_link l
                     WHERE l.document_id = d.document_id
                       AND l.subject_kind = $4
                       AND ($5::text IS NULL OR l.subject_id = $5)))
          ORDER BY rank DESC, d.created_at DESC
          LIMIT $6"
    ))
    .bind(needle)
    .bind(&tags)
    .bind(&path)
    .bind(query.subject_kind.as_deref())
    .bind(query.subject_id.as_deref())
    .bind(query.limit.clamp(1, 200))
    .fetch_all(db)
    .await?;
    rows.iter().map(document_from_row).collect()
}
