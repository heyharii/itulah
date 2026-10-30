//! Whether head office holds the sales a till rang (25 Oct 2026).
//!
//! A till keeps a sale until head office has it, not only until this server
//! took it: if this PC dies while the line to head office is down, a sale it
//! accepted and had not sent yet exists nowhere else, and the till's copy is
//! the one that survives. So the till asks, by the idempotency key it minted
//! for each sale (`pos-desktop/ui/src/outbox.ts`), and each key gets one of
//! three answers:
//!
//! - **at head office**: the sale's `sales.completed` fact sits at or under
//!   the durable watermark of the stream it was written to. Head office said
//!   it holds everything up to there — a fact it refused included, since it
//!   keeps its own copy of every fact it set aside (see `removal`).
//! - **waiting**: taken here, not acknowledged yet.
//! - **unknown**: this server never took that key — a replacement server, or
//!   a database put back from before the sale.
//!
//! An unknown key is never the till's cue to send the sale again: the server
//! that took it may well have sent it before it died, and a second delivery
//! here would be a second sale at head office under a new sale id.

use crate::edge::EdgeError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// The most keys one question may carry. A till holds what it rang while the
/// line was down; more than this it asks about in turns.
pub const MAX_KEYS: usize = 200;

/// `POST /api/v1/store/sales/at-head-office`.
#[derive(Debug, Clone, Deserialize)]
pub struct AtHeadOfficeRequest {
    pub keys: Vec<String>,
}

/// Every key asked about lands in exactly one list, spelled as it was sent.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct AtHeadOfficeReply {
    pub at_head_office: Vec<String>,
    pub waiting: Vec<String>,
    pub unknown: Vec<String>,
}

/// The sale a key created, its fact's place in its stream, and how far head
/// office has acknowledged that stream.
///
/// Joined on the fact's own origin and generation, as `removal::Readiness`
/// and `sync::purge_synced` read it: a fact from before a generation rollover
/// is measured against its own generation, which a rollover only leaves once
/// every fact in it is acknowledged. `event_id` is unique in the log and a
/// sale's fact is filed under the sale id (`ring_sale` in `sqlite.rs`), so
/// there is at most one row.
const QUERY: &str = "SELECT f.seq, COALESCE(w.durable_seq, 0)
       FROM sale s
       LEFT JOIN sync_fact_log f ON f.event_id = s.id
       LEFT JOIN sync_watermark w
              ON w.origin_id = f.origin_id AND w.generation = f.generation
      WHERE s.idempotency_key = ?1";

/// Answer for each key, in the order asked; a key repeated is answered once.
pub fn answer(connection: &Connection, keys: &[String]) -> Result<AtHeadOfficeReply, EdgeError> {
    if keys.len() > MAX_KEYS {
        return Err(EdgeError::Validation(format!(
            "ask about at most {MAX_KEYS} sales at a time"
        )));
    }
    let mut statement = connection.prepare_cached(QUERY).map_err(db)?;
    let mut reply = AtHeadOfficeReply::default();
    let mut seen = HashSet::new();
    for key in keys {
        if !seen.insert(key.as_str()) {
            continue;
        }
        let row: Option<(Option<i64>, i64)> = statement
            .query_row(params![key], |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()
            .map_err(db)?;
        let list = match row {
            None => &mut reply.unknown,
            // The sale is here and its fact is not: the only thing that takes
            // a fact out of the log is the retention purge, and it takes only
            // what head office has acknowledged. This node always writes the
            // fact with the sale (`ensure_capture_origin` keeps enqueueing on).
            Some((None, _)) => &mut reply.at_head_office,
            Some((Some(seq), durable)) if seq <= durable => &mut reply.at_head_office,
            Some(_) => &mut reply.waiting,
        };
        list.push(key.clone());
    }
    Ok(reply)
}

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(format!("reading what head office holds: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shop() -> Connection {
        let connection =
            Connection::open_in_memory().unwrap_or_else(|error| panic!("open: {error}"));
        connection
            .execute_batch(
                "CREATE TABLE sale (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE);
                 CREATE TABLE sync_fact_log (origin_id TEXT, generation INTEGER, seq INTEGER,
                     event_id TEXT UNIQUE);
                 CREATE TABLE sync_watermark (origin_id TEXT, generation INTEGER,
                     durable_seq INTEGER);
                 INSERT INTO sale VALUES ('s1','k1'),('s2','k2'),('s3','k3'),('s4','k4');
                 INSERT INTO sync_fact_log VALUES ('shop',2,7,'s1'),('shop',2,9,'s2'),
                     ('shop',1,40,'s4');
                 INSERT INTO sync_watermark VALUES ('shop',2,8),('shop',1,40);",
            )
            .unwrap_or_else(|error| panic!("schema: {error}"));
        connection
    }

    #[test]
    fn each_key_lands_in_one_list() {
        let keys: Vec<String> = ["k1", "k2", "k3", "k4", "k9", "k1"]
            .iter()
            .map(|key| (*key).to_string())
            .collect();
        let reply = answer(&shop(), &keys).unwrap_or_else(|error| panic!("answer: {error}"));
        // k1 under the watermark; k3's fact was purged after head office had
        // it; k4 is an older generation, acknowledged in full.
        assert_eq!(reply.at_head_office, ["k1", "k3", "k4"]);
        assert_eq!(reply.waiting, ["k2"]);
        assert_eq!(reply.unknown, ["k9"]);
    }

    #[test]
    fn too_many_keys_is_refused() {
        let keys = vec![String::from("k"); MAX_KEYS + 1];
        assert!(matches!(
            answer(&shop(), &keys),
            Err(EdgeError::Validation(_))
        ));
    }
}
