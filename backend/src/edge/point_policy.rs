//! The point policy, as a shop holds it.
//!
//! Head office authors an everyday rate and exceptions (postgres 1008). They
//! arrive on the auth policy and are stored whole here; the quote earns by
//! them offline, and adds what they give to what a promotion gave
//! (`pricing::quote_with_coupon_holds`).

use crate::cloud::domain::point_policy::{award, PointArticle, PointPolicySnapshot};
use crate::edge::EdgeError;
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

/// Replace what this node held with the policy it was just sent.
pub(crate) fn apply(
    tx: &Transaction<'_>,
    snapshot: &PointPolicySnapshot,
    version: i64,
) -> Result<(), rusqlite::Error> {
    let payload = serde_json::to_string(snapshot).unwrap_or_else(|_| "{}".into());
    tx.prepare_cached(
        "INSERT INTO point_policy_state (singleton,version,payload_json,updated_at)
         VALUES (1,?1,?2,?3)
         ON CONFLICT(singleton) DO UPDATE SET
             version=excluded.version,
             payload_json=excluded.payload_json,
             updated_at=excluded.updated_at",
    )?
    .execute(params![version, payload, chrono::Utc::now().to_rfc3339()])?;
    Ok(())
}

/// The policy this node holds; off when none ever arrived.
pub(crate) fn current(connection: &Connection) -> Result<PointPolicySnapshot, EdgeError> {
    let payload: Option<String> = connection
        .prepare_cached("SELECT payload_json FROM point_policy_state WHERE singleton=1")
        .map_err(db)?
        .query_row([], |row| row.get(0))
        .optional()
        .map_err(db)?;
    match payload {
        Some(payload) => serde_json::from_str(&payload).map_err(|error| {
            EdgeError::Validation(format!("the stored point policy is unreadable: {error}"))
        }),
        None => Ok(PointPolicySnapshot::default()),
    }
}

/// Policy points per line: `lines` is each line's sku and the rupiah it was
/// charged. A sku the catalogue does not know earns only the everyday rate.
pub(crate) fn points_for(
    connection: &Connection,
    snapshot: &PointPolicySnapshot,
    site_id: &str,
    day: NaiveDate,
    lines: &[(&str, i64)],
) -> Result<Vec<i64>, EdgeError> {
    if !snapshot.setting.enabled && snapshot.rules.is_empty() {
        return Ok(vec![0; lines.len()]);
    }
    let mut rated = Vec::with_capacity(lines.len());
    for (sku_code, amount) in lines {
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
        let rate = match row {
            Some((article_code, division_code, tags)) => {
                let tags: Vec<String> = tags
                    .as_deref()
                    .and_then(|json| serde_json::from_str(json).ok())
                    .unwrap_or_default();
                let article = PointArticle {
                    article_code: &article_code,
                    division_code: division_code.as_deref(),
                    tags: &tags,
                };
                snapshot.rate_for(Some(&article), site_id, day)
            }
            None => snapshot.rate_for(None, site_id, day),
        };
        rated.push((rate, *amount));
    }
    Ok(award(&rated))
}
