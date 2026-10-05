//! The hard cap at the centre: which promotions are split between the shops,
//! what each shop has been granted, and the split re-run as they sell.
//!
//! `domain::cap_allocation` decides a split; this module reads what it needs,
//! writes the grants, and hands the usage message each shop's allowance and
//! its own count. The one rule it leans on is the table's own: a grant only
//! ever grows (0387's trigger refuses anything else), because the centre
//! cannot know what a shop has sold and not yet uploaded.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool, Row};

use crate::cloud::application::AppError;
use crate::cloud::domain::cap_allocation::{self as split, Split, Standing};
use crate::cloud::domain::marketing_watch::Measure;

/// One promotion's split, shop by shop.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CapAllocationView {
    pub kind: String,
    pub key: String,
    /// Whether the limit is split now. `false` for a promotion never split,
    /// and for one switched back to the fleet's count.
    pub enabled: bool,
    /// The limits the newest published book declares. A measure with no
    /// limit is never split.
    pub budget_minor: Option<i64>,
    pub max_uses: Option<i64>,
    /// What has never been granted to any shop, per measure.
    pub budget_pool: Option<i64>,
    pub uses_pool: Option<i64>,
    pub shops: Vec<ShopAllowanceView>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// One shop's allowance under one promotion, beside what it has used.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ShopAllowanceView {
    pub origin_id: String,
    pub label: Option<String>,
    pub site_id: Option<String>,
    pub budget_granted: Option<i64>,
    pub uses_granted: Option<i64>,
    /// What the centre has counted this shop giving away under the limit. The
    /// shop's own figure is ahead of it by whatever it has not uploaded.
    pub own_uses: i64,
    pub own_spent_minor: i64,
}

/// Switch the split on or off.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CapAllocationRequest {
    pub enabled: bool,
}

/// The name the rebalancing is recorded under.
const SPLITTER: &str = "cap-allocation";

fn kind_of(kind: &str) -> Result<String, AppError> {
    let kind = kind.trim().to_ascii_uppercase();
    if matches!(kind.as_str(), "RULE" | "CAMPAIGN") {
        Ok(kind)
    } else {
        Err(AppError::Validation(format!(
            "only a promotion (RULE) or a campaign (CAMPAIGN) can be split, not {kind}"
        )))
    }
}

/// The limits the newest published book gives a rule or a campaign, or `None`
/// when no published book names it.
async fn limits_of(
    conn: &mut PgConnection,
    kind: &str,
    key: &str,
) -> Result<Option<(Option<i64>, Option<i64>)>, AppError> {
    let row = if kind == "RULE" {
        sqlx::query(
            "SELECT (r.definition->'caps'->'budget'->>'minor')::bigint AS budget_minor,
                    (r.definition->'caps'->>'max_uses')::bigint AS max_uses
               FROM commercial_rule r
               JOIN commercial_publication p ON p.id = r.publication_id
              WHERE p.status = 'PUBLISHED' AND r.rule_id = $1
              ORDER BY p.version DESC
              LIMIT 1",
        )
        .bind(key)
        .fetch_optional(&mut *conn)
        .await?
    } else {
        sqlx::query(
            "SELECT c.budget_minor, c.max_uses::bigint AS max_uses
               FROM commercial_campaign c
               JOIN commercial_publication p ON p.id = c.publication_id
              WHERE p.status = 'PUBLISHED' AND c.campaign_id = $1
              ORDER BY p.version DESC
              LIMIT 1",
        )
        .bind(key)
        .fetch_optional(&mut *conn)
        .await?
    };
    Ok(row.map(|row| {
        (
            row.get::<Option<i64>, _>("budget_minor")
                .filter(|limit| *limit > 0),
            row.get::<Option<i64>, _>("max_uses")
                .filter(|limit| *limit > 0),
        )
    }))
}

/// The shops a split is between: every registered shop the usage message is
/// sent to. The same resolution `publish_commercial_usage_to_fleet` makes, so a
/// shop is granted an allowance exactly when it is sent one.
async fn shops_of(
    conn: &mut PgConnection,
) -> Result<Vec<(String, Option<String>, Option<String>)>, AppError> {
    Ok(sqlx::query(
        "SELECT origin_id, label, site_id FROM sync_origin_credential
          WHERE node_role = 'STORE' AND site_id IS NOT NULL
          ORDER BY origin_id",
    )
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|row| (row.get("origin_id"), row.get("label"), row.get("site_id")))
    .collect())
}

/// Each shop's own sales under a limit, as the centre has applied them.
///
/// Counted from the same accepted facts as `commercial_usage` and the same
/// way: one use and the benefit per promotion that came off, and for a
/// campaign, per promotion of it — which is how the till counts itself too.
async fn own_usage(
    conn: &mut PgConnection,
    kind: &str,
    key: &str,
) -> Result<BTreeMap<String, (i64, i64)>, AppError> {
    let rows = sqlx::query(
        "SELECT s.origin_id,
                count(*)::bigint AS uses,
                COALESCE(sum(p.benefit_minor), 0)::bigint AS spent
           FROM edge_sale_promotion p
           JOIN edge_sale s ON s.sale_id = p.sale_id
          WHERE ($1 = 'RULE' AND p.rule_id = $2)
             OR ($1 = 'CAMPAIGN' AND p.campaign_id = $2)
          GROUP BY s.origin_id",
    )
    .bind(kind)
    .bind(key)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.get("origin_id"), (row.get("uses"), row.get("spent"))))
        .collect())
}

/// What each shop holds, per measure.
async fn grants_of(
    conn: &mut PgConnection,
    kind: &str,
    key: &str,
) -> Result<BTreeMap<(String, String), i64>, AppError> {
    let rows = sqlx::query(
        "SELECT origin_id, measure, granted FROM commercial_cap_allocation
          WHERE kind = $1 AND key = $2",
    )
    .bind(kind)
    .bind(key)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                (row.get("origin_id"), row.get("measure")),
                row.get("granted"),
            )
        })
        .collect())
}

/// One promotion's split as the screen reads it.
pub async fn cap_allocation(
    pool: &PgPool,
    kind: &str,
    key: &str,
) -> Result<CapAllocationView, AppError> {
    let kind = kind_of(kind)?;
    let key = key.trim().to_owned();
    let mut conn = pool.acquire().await?;
    let policy = sqlx::query(
        "SELECT enabled, updated_by, updated_at FROM commercial_cap_allocation_policy
          WHERE kind = $1 AND key = $2",
    )
    .bind(&kind)
    .bind(&key)
    .fetch_optional(&mut *conn)
    .await?;
    let (budget_minor, max_uses) = limits_of(&mut conn, &kind, &key)
        .await?
        .unwrap_or((None, None));
    let shops = shops_of(&mut conn).await?;
    let used = own_usage(&mut conn, &kind, &key).await?;
    let grants = grants_of(&mut conn, &kind, &key).await?;
    let pool_of = |measure: Measure, limit: Option<i64>| {
        limit.map(|limit| {
            let granted: i64 = grants
                .iter()
                .filter(|((_, held), _)| held == measure.as_str())
                .map(|(_, granted)| *granted)
                .sum();
            (limit - granted).max(0)
        })
    };
    Ok(CapAllocationView {
        budget_pool: pool_of(Measure::Budget, budget_minor),
        uses_pool: pool_of(Measure::Uses, max_uses),
        kind: kind.clone(),
        key: key.clone(),
        enabled: policy
            .as_ref()
            .is_some_and(|row| row.get::<bool, _>("enabled")),
        budget_minor,
        max_uses,
        shops: shops
            .into_iter()
            .map(|(origin_id, label, site_id)| {
                let (own_uses, own_spent_minor) = used.get(&origin_id).copied().unwrap_or((0, 0));
                ShopAllowanceView {
                    budget_granted: grants
                        .get(&(origin_id.clone(), Measure::Budget.as_str().to_owned()))
                        .copied(),
                    uses_granted: grants
                        .get(&(origin_id.clone(), Measure::Uses.as_str().to_owned()))
                        .copied(),
                    origin_id,
                    label,
                    site_id,
                    own_uses,
                    own_spent_minor,
                }
            })
            .collect(),
        updated_by: policy.as_ref().map(|row| row.get("updated_by")),
        updated_at: policy.as_ref().map(|row| row.get("updated_at")),
    })
}

/// Switch a promotion's split on or off, and tell the shops at once.
///
/// Refused when there is nothing to split — no published book names it, it
/// declares no limit — or when a limit is too small to split across the shops
/// there are: a limit whose first share rounds to nothing would shut the offer
/// at every shop for good (`domain::cap_allocation::can_split`).
pub async fn set_cap_allocation(
    pool: &PgPool,
    kind: &str,
    key: &str,
    request: CapAllocationRequest,
    actor: &str,
) -> Result<CapAllocationView, AppError> {
    let kind = kind_of(kind)?;
    let key = key.trim().to_owned();
    if key.is_empty() {
        return Err(AppError::Validation(
            "which promotion is being split?".into(),
        ));
    }
    let actor = actor.trim();
    if actor.is_empty() {
        return Err(AppError::Validation(
            "a split needs somebody to have made it".into(),
        ));
    }
    if request.enabled {
        let mut conn = pool.acquire().await?;
        let Some((budget_minor, max_uses)) = limits_of(&mut conn, &kind, &key).await? else {
            return Err(AppError::NotFound(format!(
                "no published book carries {key}, so there is no limit to split"
            )));
        };
        if budget_minor.is_none() && max_uses.is_none() {
            return Err(AppError::Validation(format!(
                "{key} declares no budget and no basket limit, so there is nothing to split"
            )));
        }
        let shops = shops_of(&mut conn).await?.len();
        if shops == 0 {
            return Err(AppError::Conflict(
                "no shop is registered to split a limit between".into(),
            ));
        }
        let used = own_usage(&mut conn, &kind, &key).await?;
        let grants = grants_of(&mut conn, &kind, &key).await?;
        for (measure, limit) in [(Measure::Budget, budget_minor), (Measure::Uses, max_uses)] {
            if let Some(limit) = limit {
                // An initial split is not a fresh budget for a promotion
                // already spent under fleet counters. Nor may re-enabling a
                // split ignore sales made while its allocations were off.
                for (origin_id, (uses, spent)) in &used {
                    let consumed = match measure {
                        Measure::Budget => *spent,
                        Measure::Uses => *uses,
                    };
                    let granted = grants
                        .get(&(origin_id.clone(), measure.as_str().to_owned()))
                        .copied()
                        .unwrap_or(0);
                    if consumed > granted {
                        return Err(AppError::Conflict(format!(
                            "{key} has {consumed} {} used by {origin_id} outside its allocation; \
                             start a new promotion with a split before it is used",
                            measure.as_str(),
                        )));
                    }
                }
                if !split::can_split(limit, shops, Split::default()) {
                    return Err(AppError::Validation(format!(
                        "the {} limit of {limit} is too small to split across {shops} shops — \
                         each would start with nothing and could never sell",
                        match measure {
                            Measure::Budget => "budget",
                            Measure::Uses => "basket",
                        }
                    )));
                }
            }
        }
    }
    sqlx::query(
        "INSERT INTO commercial_cap_allocation_policy (kind, key, enabled, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind, key) DO UPDATE
            SET enabled = EXCLUDED.enabled,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()",
    )
    .bind(&kind)
    .bind(&key)
    .bind(request.enabled)
    .bind(actor)
    .execute(pool)
    .await?;
    if request.enabled {
        rebalance_allocations(pool).await?;
    }
    // Either way the shops are told now: a new allowance must reach them
    // before they sell further against the fleet's count, and a split switched
    // off must stop holding them to an allowance nobody is topping up.
    match super::commercial::publish_commercial_usage_to_fleet(pool, actor).await {
        Ok(_) | Err(AppError::Conflict(_)) => {}
        Err(error) => return Err(error),
    }
    cap_allocation(pool, &kind, &key).await
}

/// Every split that is switched on, re-run: new shops given their first
/// share, busy shops topped up from what has never been granted. Returns how
/// many grants changed.
///
/// Grants are written with an upsert that only ever raises them; the table's
/// trigger refuses anything else, so a bug here fails loudly rather than
/// quietly taking allowance back from a shop that may already have used it.
pub async fn rebalance_allocations(pool: &PgPool) -> Result<usize, AppError> {
    let mut conn = pool.acquire().await?;
    let splits: Vec<(String, String)> = sqlx::query(
        "SELECT kind, key FROM commercial_cap_allocation_policy WHERE enabled ORDER BY kind, key",
    )
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|row| (row.get("kind"), row.get("key")))
    .collect();
    if splits.is_empty() {
        return Ok(0);
    }
    drop(conn);
    let mut changed = 0;
    for (kind, key) in splits {
        // Lock the policy before reading the pool. A transaction covers every
        // grant for this policy, so another worker cannot combine a stale
        // calculation with only half of this worker's writes.
        let mut tx = pool.begin().await?;
        let enabled: Option<bool> = sqlx::query_scalar(
            "SELECT enabled FROM commercial_cap_allocation_policy
              WHERE kind = $1 AND key = $2 FOR UPDATE",
        )
        .bind(&kind)
        .bind(&key)
        .fetch_optional(&mut *tx)
        .await?;
        if enabled != Some(true) {
            continue;
        }
        let shops = shops_of(&mut tx).await?;
        let Some((budget_minor, max_uses)) = limits_of(&mut tx, &kind, &key).await? else {
            continue;
        };
        let used = own_usage(&mut tx, &kind, &key).await?;
        let grants = grants_of(&mut tx, &kind, &key).await?;
        let mut policy_changed = 0;
        for (measure, limit) in [(Measure::Budget, budget_minor), (Measure::Uses, max_uses)] {
            let Some(limit) = limit else { continue };
            // Re-check after locking, including a sale that landed between
            // enable validation and this snapshot. Such spending is not a
            // fresh pool to hand out again; it needs reconciliation first.
            for (origin_id, (uses, spent)) in &used {
                let consumed = match measure {
                    Measure::Budget => *spent,
                    Measure::Uses => *uses,
                };
                let granted = grants
                    .get(&(origin_id.clone(), measure.as_str().to_owned()))
                    .copied()
                    .unwrap_or(0);
                if consumed > granted {
                    return Err(AppError::Conflict(format!(
                        "{key} has {consumed} {} used by {origin_id} but only {granted} allocated; \
                         reconcile the spending before granting more",
                        measure.as_str(),
                    )));
                }
            }
            let mut standings: Vec<Standing> = shops
                .iter()
                .map(|(origin_id, _, _)| {
                    let (uses, spent) = used.get(origin_id).copied().unwrap_or((0, 0));
                    Standing {
                        origin_id: origin_id.clone(),
                        granted: grants
                            .get(&(origin_id.clone(), measure.as_str().to_owned()))
                            .copied(),
                        used: match measure {
                            Measure::Budget => spent,
                            Measure::Uses => uses,
                        },
                    }
                })
                .collect();
            // Removing a credential does not recover an allowance: that node
            // may still have offline sales. Keep its grant in the pool sum,
            // but never top up a node that is no longer registered.
            for ((origin_id, held_measure), &granted) in &grants {
                if held_measure == measure.as_str()
                    && !shops
                        .iter()
                        .any(|(registered, _, _)| registered == origin_id)
                {
                    standings.push(Standing {
                        origin_id: origin_id.clone(),
                        granted: Some(granted),
                        used: 0,
                    });
                }
            }
            for (origin_id, granted) in split::rebalance(limit, &standings, Split::default()) {
                sqlx::query(
                    "INSERT INTO commercial_cap_allocation
                         (kind, key, measure, origin_id, granted, limit_value)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (kind, key, measure, origin_id) DO UPDATE
                        SET granted = GREATEST(commercial_cap_allocation.granted, EXCLUDED.granted),
                            limit_value = EXCLUDED.limit_value,
                            granted_at = now()",
                )
                .bind(&kind)
                .bind(&key)
                .bind(measure.as_str())
                .bind(&origin_id)
                .bind(granted)
                .bind(limit)
                .execute(&mut *tx)
                .await?;
                policy_changed += 1;
            }
        }
        tx.commit().await?;
        changed += policy_changed;
    }
    if changed > 0 {
        tracing::info!(changed, actor = SPLITTER, "cap allowances rebalanced");
    }
    Ok(changed)
}

/// Every shop's allowance and own count under every split that is switched
/// on, for the usage message.
///
/// Called inside the usage message's own snapshot (`publish_commercial_usage`),
/// so a shop's own count here describes the same instant as `applied_through`:
/// the till adds its uncounted rows to it and neither misses nor repeats a
/// sale. Every registered shop receives a row. A shop without a grant has
/// zero allowance until rebalancing grants it some; falling back to the fleet
/// count here would bypass the split when its pool is empty.
pub(super) async fn allowances_for_message(
    conn: &mut PgConnection,
) -> Result<Vec<Value>, AppError> {
    let splits: Vec<(String, String)> = sqlx::query(
        "SELECT kind, key FROM commercial_cap_allocation_policy WHERE enabled ORDER BY kind, key",
    )
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|row| (row.get("kind"), row.get("key")))
    .collect();
    let shops = shops_of(conn).await?;
    let mut allowances = Vec::new();
    for (kind, key) in splits {
        let Some((budget_limit, uses_limit)) = limits_of(conn, &kind, &key).await? else {
            continue;
        };
        let used = own_usage(conn, &kind, &key).await?;
        let grants = grants_of(conn, &kind, &key).await?;
        for (origin_id, _, _) in &shops {
            let (own_uses, own_spent_minor) = used.get(origin_id).copied().unwrap_or((0, 0));
            allowances.push(json!({
                "origin_id": origin_id,
                "kind": kind,
                "key": key,
                "budget_minor": budget_limit.map(|_| grants.get(&(origin_id.clone(), Measure::Budget.as_str().to_owned())).copied().unwrap_or(0)),
                "max_uses": uses_limit.map(|_| grants.get(&(origin_id.clone(), Measure::Uses.as_str().to_owned())).copied().unwrap_or(0)),
                "own_uses": own_uses,
                "own_spent_minor": own_spent_minor,
            }));
        }
    }
    Ok(allowances)
}
