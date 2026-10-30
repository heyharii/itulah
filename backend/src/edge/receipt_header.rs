//! The picture this store prints at the top of its receipts (0106).
//!
//! Head office authors it per store (postgres 1009). It arrives on the auth
//! policy as the two widths the paper has and is kept whole; a receipt that
//! prints reads it back (`till::receipt_document`).

use crate::cloud::domain::receipt_header::ReceiptHeader;
use crate::edge::EdgeError;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

/// Replace what this node held with the picture it was just sent.
pub(crate) fn apply(
    tx: &Transaction<'_>,
    header: &ReceiptHeader,
    version: i64,
) -> Result<(), rusqlite::Error> {
    let payload = serde_json::to_string(header).unwrap_or_else(|_| "{}".into());
    tx.prepare_cached(
        "INSERT INTO receipt_header_state (singleton,version,payload_json,updated_at)
         VALUES (1,?1,?2,?3)
         ON CONFLICT(singleton) DO UPDATE SET
             version=excluded.version,
             payload_json=excluded.payload_json,
             updated_at=excluded.updated_at",
    )?
    .execute(params![version, payload, Utc::now().to_rfc3339()])?;
    Ok(())
}

/// The picture this node holds; nothing when none was ever sent.
pub(crate) fn current(connection: &Connection) -> Result<ReceiptHeader, EdgeError> {
    let payload: Option<String> = connection
        .prepare_cached("SELECT payload_json FROM receipt_header_state WHERE singleton=1")
        .map_err(db)?
        .query_row([], |row| row.get(0))
        .optional()
        .map_err(db)?;
    Ok(payload
        .and_then(|payload| serde_json::from_str(&payload).ok())
        .unwrap_or_default())
}
