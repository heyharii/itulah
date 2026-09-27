//! Attached bytes, and the two places they can physically live.
//!
//! A file here is never addressed on its own. It is reached through the
//! conversation or the discussion post that carries it, and the routes prove
//! it: `/chat/conversations/{id}/attachments/{file_id}`. That is the whole
//! reason there is no URL column and no `GET /files/{id}` — a link that works
//! outside the room it was posted in is a link that leaves the room.
//!
//! Bytes go to object storage when the node has any, and into the row when it
//! does not. The second case is not a fallback nobody uses: it is every
//! developer's laptop and every node deployed without R2, and a file feature
//! that only exists in production is a file feature nobody can test.

use crate::cloud::application::{AppError, AppState};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// The largest thing anyone may attach.
///
/// Chosen to sit under the router's own body limit with room for the JSON
/// envelope around it, and refused here with a sentence rather than by the
/// transport with a bare 413.
pub const MAX_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;

/// Where the bucket keeps conversation and discussion attachments. Separate
/// from catalogue imagery on purpose: one prefix is public-facing product
/// photography, this one is private correspondence, and they should never
/// share a lifecycle rule.
const ATTACHMENT_PREFIX: &str = "attachments";

/// One attached file, as any screen sees it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoredFile {
    pub file_id: Uuid,
    pub file_name: String,
    pub content_type: String,
    pub byte_size: i64,
    /// Content hash, shown beside the name. The same invoice uploaded twice is
    /// two rows and one hash, and a screen may say so.
    pub sha256: String,
    pub uploaded_by: String,
    pub uploaded_at: DateTime<Utc>,
    /// Whether the bytes can actually be fetched right now. Attached-but-gone
    /// is a state the screens render, not one they hide: a row saying the file
    /// is there beside a link that 404s is worse than saying it plainly.
    pub available: bool,
}

/// Read one `stored_file` out of a row that selected [`FILE_COLUMNS`].
///
/// Public because chat and discussion both stitch attachments onto their own
/// rows, and a second copy of this mapping is a second place for the wire
/// shape of a file to be decided.
pub fn file_from_row(row: &sqlx::postgres::PgRow) -> Result<StoredFile, AppError> {
    Ok(StoredFile {
        file_id: row.try_get("file_id")?,
        file_name: row.try_get("file_name")?,
        content_type: row.try_get("content_type")?,
        byte_size: row.try_get("byte_size")?,
        sha256: row.try_get("sha256")?,
        uploaded_by: row.try_get("uploaded_by")?,
        uploaded_at: row.try_get("uploaded_at")?,
        available: row.try_get("available")?,
    })
}

pub const FILE_COLUMNS: &str = "f.file_id, f.file_name, f.content_type, f.byte_size,
     f.sha256, f.uploaded_by, f.uploaded_at, f.available";

/// The same columns, unqualified, for reading them back out of a derived table.
///
/// [`FILE_COLUMNS`] names `f`, which exists only inside the query that joined
/// `stored_file`. Selecting it again from a subquery's result is
/// `missing FROM-clause entry for table "f"` — the alias does not survive the
/// parentheses.
const FILE_COLUMNS_UNQUALIFIED: &str = "file_id, file_name, content_type, byte_size,
     sha256, uploaded_by, uploaded_at, available";

/// The bytes themselves, on their way out to a browser.
pub struct FileContent {
    pub file_name: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

/// Take in a file and record it, without attaching it to anything yet.
///
/// Upload and attach are two steps because that is how people work: the photo
/// finishes uploading while the message is still being typed. The row exists
/// with nothing pointing at it until a message or a post claims it.
pub async fn store_file(
    state: &AppState,
    uploaded_by: &str,
    file_name: &str,
    content_type: &str,
    bytes: Vec<u8>,
) -> Result<StoredFile, AppError> {
    if bytes.is_empty() {
        return Err(AppError::Validation("an empty file is not a file".into()));
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AppError::Validation(format!(
            "attachments are limited to {} MB; this one is {:.1} MB",
            MAX_ATTACHMENT_BYTES / (1024 * 1024),
            bytes.len() as f64 / (1024.0 * 1024.0)
        )));
    }
    let file_name = safe_file_name(file_name)?;
    let content_type = safe_content_type(content_type);
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let file_id = Uuid::new_v4();
    let byte_size = bytes.len() as i64;

    // Which storage is decided here and recorded in the row, so a node that
    // gains object storage later still serves the files it took before.
    //
    // `state.attachments`, never `state.media`. The catalogue store is
    // configured with a public base URL so a till can fetch a photograph
    // without a signature; writing correspondence there made every attachment
    // readable at a permanent public URL by anyone holding the file id. See
    // `cloud::attachments`. With no attachment bucket configured these bytes
    // go to Postgres, which is slower and entirely private.
    let (storage, object_key, row_bytes): (&str, Option<String>, Option<Vec<u8>>) =
        match state.attachments.as_ref() {
            Some(store) => {
                let key = attachment_key(file_id, &file_name);
                store.put(&key, bytes, &content_type).await?;
                ("OBJECT", Some(key), None)
            }
            None => ("DATABASE", None, Some(bytes)),
        };

    let row = sqlx::query(
        "INSERT INTO stored_file
             (file_id, file_name, content_type, byte_size, sha256, storage,
              object_key, bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING file_id, file_name, content_type, byte_size, sha256,
                   uploaded_by, uploaded_at, available",
    )
    .bind(file_id)
    .bind(&file_name)
    .bind(&content_type)
    .bind(byte_size)
    .bind(&sha256)
    .bind(storage)
    .bind(&object_key)
    .bind(&row_bytes)
    .bind(uploaded_by)
    .fetch_one(&state.db)
    .await?;
    file_from_row(&row)
}

/// Read the bytes back. The caller has already proved it may — this function
/// deliberately takes no username, because permission belongs to the room the
/// file hangs in, not to the file.
pub async fn read_file(state: &AppState, file_id: Uuid) -> Result<FileContent, AppError> {
    let row = sqlx::query(
        "SELECT file_name, content_type, storage, object_key, bytes
           FROM stored_file WHERE file_id = $1",
    )
    .bind(file_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no file {file_id}")))?;

    let file_name: String = row.try_get("file_name")?;
    let content_type: String = row.try_get("content_type")?;
    let storage: String = row.try_get("storage")?;
    let bytes = match storage.as_str() {
        "DATABASE" => row
            .try_get::<Option<Vec<u8>>, _>("bytes")?
            .unwrap_or_default(),
        _ => {
            let key: Option<String> = row.try_get("object_key")?;
            let key =
                key.ok_or_else(|| AppError::Configuration("stored file has no object key".into()))?;
            let store = state.attachments.as_ref().ok_or_else(|| {
                AppError::NotFound(
                    "this file lives in object storage, which this node is not configured for"
                        .into(),
                )
            })?;
            match store.get(&key).await {
                Ok(bytes) => bytes,
                Err(error) => {
                    // The row outlives the object. Record that and answer with
                    // the truth rather than a 500 that blames the server.
                    mark_unavailable(&state.db, file_id).await?;
                    return Err(AppError::NotFound(format!(
                        "the file was attached but its bytes are no longer retrievable: {error}"
                    )));
                }
            }
        }
    };
    Ok(FileContent {
        file_name,
        content_type,
        bytes,
    })
}

async fn mark_unavailable(db: &PgPool, file_id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE stored_file SET available = false WHERE file_id = $1")
        .bind(file_id)
        .execute(db)
        .await?;
    Ok(())
}

/// Every file id in the list must exist, or the message referring to them is
/// refused before it is written. Half-attached is not a state worth having.
pub async fn require_files_exist(db: &PgPool, file_ids: &[Uuid]) -> Result<(), AppError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    let found: i64 = sqlx::query_scalar("SELECT count(*) FROM stored_file WHERE file_id = ANY($1)")
        .bind(file_ids)
        .fetch_one(db)
        .await?;
    if found != file_ids.len() as i64 {
        return Err(AppError::Validation(
            "one of the attachments has not been uploaded".into(),
        ));
    }
    Ok(())
}

/// A file the caller can see, with the room it belongs to.
///
/// This is what the Files screen lists. It is NOT a global file browser: the
/// query below is scoped to conversations the caller is in, plus discussions,
/// which everybody signed in may read. `source_id` is carried so the screen
/// can open the file through its own room's route — the only route there is.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FileInContext {
    pub file: StoredFile,
    /// `CONVERSATION` or `DISCUSSION`.
    pub source_kind: String,
    pub source_id: Uuid,
    /// What to call that room on screen.
    pub source_title: String,
}

/// Everything the caller may reach, newest first.
pub async fn list_files(
    db: &PgPool,
    username: &str,
    limit: i64,
) -> Result<Vec<FileInContext>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {FILE_COLUMNS_UNQUALIFIED}, source_kind, source_id, source_title
           FROM (
             SELECT {FILE_COLUMNS}, 'CONVERSATION' AS source_kind,
                    c.conversation_id AS source_id,
                    COALESCE(c.title, 'Direct') AS source_title,
                    m.sent_at AS at
               FROM chat_message_attachment a
               JOIN stored_file f ON f.file_id = a.file_id
               JOIN chat_message m
                 ON m.conversation_id = a.conversation_id AND m.seq = a.seq
               JOIN chat_conversation c ON c.conversation_id = a.conversation_id
              WHERE EXISTS (
                      SELECT 1 FROM chat_participant p
                       WHERE p.conversation_id = a.conversation_id
                         AND p.username = $1)
             UNION ALL
             SELECT {FILE_COLUMNS}, 'DISCUSSION' AS source_kind,
                    t.thread_id AS source_id, t.title AS source_title,
                    p.created_at AS at
               FROM discussion_post_attachment a
               JOIN stored_file f ON f.file_id = a.file_id
               JOIN discussion_post p ON p.post_id = a.post_id
               JOIN discussion_thread t ON t.thread_id = p.thread_id
              -- A withdrawn post takes its files with it; the thread's own
              -- route refuses them, so listing them here would be a tile
              -- that cannot be opened.
              WHERE p.withdrawn_at IS NULL
           ) reachable
          ORDER BY at DESC
          LIMIT $2"
    ))
    .bind(username)
    .bind(limit.clamp(1, 500))
    .fetch_all(db)
    .await?;

    rows.iter()
        .map(|row| {
            Ok(FileInContext {
                file: file_from_row(row)?,
                source_kind: row.try_get("source_kind")?,
                source_id: row.try_get("source_id")?,
                source_title: row.try_get("source_title")?,
            })
        })
        .collect()
}

/// The bucket key for one attachment.
///
/// The id leads, so two files called `faktur.pdf` never collide, and the
/// original name is not part of the key at all — a person's file name is not
/// path-safe and sanitising it into one would quietly rename their file.
fn attachment_key(file_id: Uuid, file_name: &str) -> String {
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, ext)| ext)
        .filter(|ext| {
            !ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric())
        })
        .map(|ext| format!(".{}", ext.to_ascii_lowercase()))
        .unwrap_or_default();
    format!("{ATTACHMENT_PREFIX}/{file_id}{extension}")
}

/// A file name fit to be stored and later sent back in a header.
///
/// Path separators and control characters are removed rather than rejected:
/// a browser on Windows sends `C:\fakepath\faktur.pdf` for an ordinary pick,
/// and refusing that would be refusing the file.
fn safe_file_name(raw: &str) -> Result<String, AppError> {
    let name = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(raw)
        .trim()
        .chars()
        .filter(|c| !c.is_control() && *c != '"')
        .take(180)
        .collect::<String>();
    if name.is_empty() {
        return Err(AppError::Validation("the file needs a name".into()));
    }
    Ok(name)
}

/// Content types are echoed back on download, so anything unrecognisable
/// becomes the type that makes a browser save rather than render. An
/// attacker-chosen `text/html` served from our own origin is a stored XSS.
fn safe_content_type(raw: &str) -> String {
    const ALLOWED: [&str; 12] = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/csv",
        "application/json",
        "application/zip",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    ];
    let value = raw
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if ALLOWED.contains(&value.as_str()) {
        value
    } else {
        "application/octet-stream".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_the_id_and_never_the_persons_file_name() {
        let id = Uuid::nil();
        assert_eq!(
            attachment_key(id, "faktur MT-2609.pdf"),
            format!("attachments/{id}.pdf")
        );
        // No extension, and nothing that could walk out of the prefix.
        assert_eq!(
            attachment_key(id, "../../etc/passwd"),
            format!("attachments/{id}")
        );
    }

    #[test]
    fn a_windows_path_is_still_a_file_name() {
        #[allow(clippy::expect_used)]
        let name = safe_file_name("C:\\fakepath\\faktur.pdf").expect("a name");
        assert_eq!(name, "faktur.pdf");
    }

    /// Serving somebody's uploaded HTML from our own origin is stored XSS, so
    /// anything not on the list downloads instead of rendering.
    #[test]
    fn only_known_types_are_echoed_back() {
        assert_eq!(safe_content_type("image/jpeg"), "image/jpeg");
        assert_eq!(safe_content_type("IMAGE/PNG; charset=x"), "image/png");
        assert_eq!(safe_content_type("text/html"), "application/octet-stream");
        assert_eq!(
            safe_content_type("image/svg+xml"),
            "application/octet-stream"
        );
    }
}
