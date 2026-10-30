//! The return promise, as a shop holds it.
//!
//! Head office authors one setting and any number of exceptions (postgres
//! 1005). They arrive on the auth policy — the one command every node receives
//! — and are stored whole here (`0101`). Everything the till needs is local:
//! the last day is written onto the sale when it completes, and the receipt
//! prints the promise without asking anybody.
//!
//! # Why the deadline is stored, and not recomputed
//!
//! A policy edited in November must not shorten the promise printed in
//! October. The customer holds that paper. `sale.return_by` is therefore a
//! fact of the sale, like its total, and a reprint reads it back. A sale from
//! before `0101` has no such fact; its reprint falls back to the policy in
//! force, which is the only answer available for a promise nobody recorded.

use crate::cloud::domain::return_policy::{
    indonesian_date, receipt_return_note, return_deadline, ReturnArticle, ReturnPolicySetting,
    ReturnPolicySnapshot,
};
use crate::edge::EdgeError;
use chrono::{DateTime, Local, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::str::FromStr;

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

/// Replace what this node held with the promise it was just sent.
pub(crate) fn apply(
    tx: &Transaction<'_>,
    snapshot: &ReturnPolicySnapshot,
    version: i64,
) -> Result<(), rusqlite::Error> {
    let payload = serde_json::to_string(snapshot).unwrap_or_else(|_| "{}".into());
    tx.prepare_cached(
        "INSERT INTO return_policy_state (singleton,version,payload_json,updated_at)
         VALUES (1,?1,?2,?3)
         ON CONFLICT(singleton) DO UPDATE SET
             version=excluded.version,
             payload_json=excluded.payload_json,
             updated_at=excluded.updated_at",
    )?
    .execute(params![version, payload, Utc::now().to_rfc3339()])?;
    Ok(())
}

/// The promise this node holds, or the fallback when no policy ever arrived.
pub(crate) fn current(connection: &Connection) -> Result<ReturnPolicySnapshot, EdgeError> {
    let payload: Option<String> = connection
        .prepare_cached("SELECT payload_json FROM return_policy_state WHERE singleton=1")
        .map_err(db)?
        .query_row([], |row| row.get(0))
        .optional()
        .map_err(db)?;
    match payload {
        Some(payload) => serde_json::from_str(&payload).map_err(|error| {
            EdgeError::Validation(format!("the stored return policy is unreadable: {error}"))
        }),
        None => Ok(ReturnPolicySnapshot::default()),
    }
}

/// What a sku is, for the one question "which policy speaks for it".
fn article_of(
    connection: &Connection,
    sku_code: &str,
) -> Result<Option<(String, Option<String>, Vec<String>)>, EdgeError> {
    let row = connection
        .prepare_cached(
            "SELECT article_code,division_code,tags_json FROM catalog_item WHERE sku_code=?1",
        )
        .map_err(db)?
        .query_row([sku_code], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .optional()
        .map_err(db)?;
    Ok(row.map(|(article, division, tags)| {
        let tags: Vec<String> = tags
            .as_deref()
            .and_then(|json| serde_json::from_str(json).ok())
            .unwrap_or_default();
        (article, division, tags)
    }))
}

/// The shortest window any piece on this sale was sold under.
///
/// A basket may mix a seven-day article and a thirty-day one. The receipt has
/// one date on it, and the honest one is the earliest: promising the longest
/// would send a customer back after the shorter article had lapsed.
pub(crate) fn days_for(
    connection: &Connection,
    snapshot: &ReturnPolicySnapshot,
    sku_codes: &[String],
) -> Option<u32> {
    // Every piece known and none of them comes back: there is no last day to
    // print (Hari, 29 Oct 2026) — the struk says "Barang tidak bisa ditukar".
    let mut any_back = sku_codes.is_empty();
    let setting = &snapshot.setting;
    let mut days: Option<u32> = None;
    for sku in sku_codes {
        let resolved = match article_of(connection, sku) {
            Ok(Some((article_code, division_code, tags))) => {
                let article = ReturnArticle {
                    article_code: &article_code,
                    division_code: division_code.as_deref(),
                    tags: &tags,
                };
                // A piece that never comes back promises nothing, and must
                // not shorten the date printed for the rest of the basket.
                if !snapshot.exchangeable(&article) {
                    continue;
                }
                any_back = true;
                snapshot.resolve(&article).max_days
            }
            // A piece the catalogue does not know (an unknown item, or a sku
            // that has not synced) is sold under the fallback. It is still a
            // real sale, and refusing to print a date would print no promise.
            _ => {
                any_back = true;
                setting.max_days
            }
        };
        days = Some(match days {
            Some(current) => current.min(resolved),
            None => resolved,
        });
    }
    if !any_back {
        return None;
    }
    Some(days.unwrap_or(setting.max_days))
}

/// The last day for a sale completed at `completed_at`, written once; none
/// when nothing on it may come back.
pub(crate) fn return_by_for_sale(
    connection: &Connection,
    occurred_at: DateTime<Utc>,
    sku_codes: &[String],
) -> Result<Option<String>, EdgeError> {
    let snapshot = current(connection)?;
    let Some(days) = days_for(connection, &snapshot, sku_codes) else {
        return Ok(None);
    };
    let sold_on = occurred_at.with_timezone(&Local).date_naive();
    Ok(Some(
        return_deadline(sold_on, days)
            .format("%Y-%m-%d")
            .to_string(),
    ))
}

/// Whether the sale wrote down that none of its goods may come back (0103).
fn nothing_comes_back(connection: &Connection, sale_id: &str) -> Result<bool, EdgeError> {
    let (rows, refused): (i64, i64) = connection
        .prepare_cached(
            "SELECT COUNT(*), COUNT(refused_by) FROM sale_line_promise WHERE sale_id=?1",
        )
        .map_err(db)?
        .query_row([sale_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(db)?;
    Ok(rows > 0 && rows == refused)
}

/// The sentence the receipt prints, or nothing when the promise is silent.
pub(crate) fn receipt_footer(
    connection: &Connection,
    sale_id: &str,
) -> Result<Option<String>, EdgeError> {
    let row: Option<(Option<String>, String)> = connection
        .prepare_cached("SELECT return_by,completed_at FROM sale WHERE id=?1")
        .map_err(db)?
        .query_row([sale_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()
        .map_err(db)?;
    let Some((return_by, completed_at)) = row else {
        return Ok(None);
    };
    if return_by.is_none() && nothing_comes_back(connection, sale_id)? {
        return Ok(None);
    }
    let snapshot = current(connection)?;
    let deadline = match return_by
        .as_deref()
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
    {
        Some(date) => date,
        None => {
            // A sale from before `0101`: no promise was written. The best
            // available answer is the window in force today, counted from the
            // day it sold.
            let sold_on = DateTime::parse_from_rfc3339(&completed_at)
                .map(|at| at.with_timezone(&Local).date_naive())
                .unwrap_or_else(|_| Local::now().date_naive());
            return_deadline(sold_on, snapshot.setting.max_days)
        }
    };
    Ok(Some(receipt_return_note(
        deadline,
        snapshot.setting.require_hang_tag,
        snapshot.setting.require_receipt,
    )))
}

/// Refuse a return or exchange whose receipt has run out.
///
/// A sale with no recorded promise is allowed: the promise cannot be enforced
/// against a customer when the shop cannot say what it promised. New sales all
/// carry one.
pub(crate) fn assert_within_window(
    connection: &Connection,
    sale_id: &str,
) -> Result<(), EdgeError> {
    let return_by: Option<Option<String>> = connection
        .prepare_cached("SELECT return_by FROM sale WHERE id=?1")
        .map_err(db)?
        .query_row([sale_id], |row| row.get(0))
        .optional()
        .map_err(db)?;
    let Some(Some(return_by)) = return_by else {
        return Ok(());
    };
    let deadline = match NaiveDate::from_str(&return_by) {
        Ok(date) => date,
        Err(_) => return Ok(()),
    };
    let today = Local::now().date_naive();
    if today > deadline {
        return Err(EdgeError::Conflict(format!(
            "Retur untuk struk ini sudah lewat batas {}.",
            indonesian_date(deadline)
        )));
    }
    Ok(())
}

/// The setting alone, for a screen that wants to explain the rule before a
/// sale exists.
#[allow(dead_code)]
pub(crate) fn setting(connection: &Connection) -> Result<ReturnPolicySetting, EdgeError> {
    Ok(current(connection)?.setting)
}

/// Which generation of the promise this node holds; nought before the first.
/// Folded into the catalogue's ETag, because each item carries `exchangeable`.
pub(crate) fn version(connection: &Connection) -> i64 {
    connection
        .prepare_cached("SELECT version FROM return_policy_state WHERE singleton=1")
        .and_then(|mut statement| statement.query_row([], |row| row.get(0)).optional())
        .ok()
        .flatten()
        .unwrap_or(0)
}

/// Whether one article may come back at all, from facts already in hand —
/// the catalogue page's (`pricing::store_catalog_page`).
pub(crate) fn exchangeable_article(
    snapshot: &ReturnPolicySnapshot,
    article_code: Option<&str>,
    division_code: Option<&str>,
    tags: &[String],
) -> bool {
    snapshot.exchangeable(&ReturnArticle {
        article_code: article_code.unwrap_or_default(),
        division_code,
        tags,
    })
}

/// Whether a sku may come back (1006: "pakaian dalam … tidak bisa
/// ditukar"). A sku the catalogue does not know is taken back: there is no
/// policy that could be said to cover it.
pub(crate) fn exchangeable_sku(
    connection: &Connection,
    snapshot: &ReturnPolicySnapshot,
    sku_code: &str,
) -> Result<bool, EdgeError> {
    Ok(match article_of(connection, sku_code)? {
        Some((article_code, division_code, tags)) => snapshot.exchangeable(&ReturnArticle {
            article_code: &article_code,
            division_code: division_code.as_deref(),
            tags: &tags,
        }),
        None => true,
    })
}

/// The policy that keeps a sku from coming back, by name, when one does.
pub(crate) fn refused_by_sku(
    connection: &Connection,
    snapshot: &ReturnPolicySnapshot,
    sku_code: &str,
) -> Result<Option<String>, EdgeError> {
    Ok(match article_of(connection, sku_code)? {
        Some((article_code, division_code, tags)) => snapshot
            .refused_by(&ReturnArticle {
                article_code: &article_code,
                division_code: division_code.as_deref(),
                tags: &tags,
            })
            .map(str::to_string),
        None => None,
    })
}

/// Write, once, which goods of a sale never come back and by which policy
/// (0103). A sku the catalogue does not know may come back, as everywhere.
pub(crate) fn write_sale_promise(
    connection: &Connection,
    sale_id: &str,
    sku_codes: &[String],
) -> Result<(), EdgeError> {
    let snapshot = current(connection)?;
    let mut statement = connection
        .prepare_cached(
            "INSERT OR IGNORE INTO sale_line_promise(sale_id,sku_code,refused_by) VALUES(?1,?2,?3)",
        )
        .map_err(db)?;
    for sku in sku_codes {
        if sku.is_empty() {
            continue;
        }
        let refused = refused_by_sku(connection, &snapshot, sku)?;
        statement
            .execute(rusqlite::params![sale_id, sku, refused])
            .map_err(db)?;
    }
    Ok(())
}

/// The policy that keeps this sku of this sale, as the sale was made: the
/// frozen answer when the sale wrote one (0103), today's otherwise.
pub(crate) fn refused_on_sale(
    connection: &Connection,
    snapshot: &ReturnPolicySnapshot,
    sale_id: &str,
    sku_code: &str,
) -> Result<Option<String>, EdgeError> {
    let frozen: Option<Option<String>> = connection
        .prepare_cached("SELECT refused_by FROM sale_line_promise WHERE sale_id=?1 AND sku_code=?2")
        .map_err(db)?
        .query_row([sale_id, sku_code], |row| row.get(0))
        .optional()
        .map_err(db)?;
    match frozen {
        Some(answer) => Ok(answer),
        None => refused_by_sku(connection, snapshot, sku_code),
    }
}

/// Refuse a return whose pieces include one that never comes back, by the
/// promise the sale was made under.
pub(crate) fn assert_exchangeable(
    connection: &Connection,
    sale_id: &str,
    sku_codes: &[String],
) -> Result<(), EdgeError> {
    let snapshot = current(connection)?;
    for sku in sku_codes {
        if refused_on_sale(connection, &snapshot, sale_id, sku)?.is_some() {
            let name: Option<String> = connection
                .prepare_cached("SELECT name FROM catalog_item WHERE sku_code=?1")
                .map_err(db)?
                .query_row([sku], |row| row.get(0))
                .optional()
                .map_err(db)?;
            return Err(EdgeError::Conflict(format!(
                "{} {} tidak bisa ditukar.",
                sku,
                name.unwrap_or_else(|| sku.clone())
            )));
        }
    }
    Ok(())
}
