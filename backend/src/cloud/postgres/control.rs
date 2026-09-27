use super::{begin_idempotent, complete_idempotent, payload_digest, rank_facets, InventoryFacet};
use crate::cloud::application::{
    AppError, CorruptProjectionRequest, ReplayRequest, ReplayScope, RepostRequest,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

async fn replay_differences<'e, E>(executor: E, scope: &ReplayScope) -> Result<Vec<Value>, AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let rows=sqlx::query(r#"WITH d AS (
 SELECT subject_id,to_place_id place_id,quantity delta FROM movement
 UNION ALL SELECT subject_id,from_place_id,-quantity FROM movement
), ledger AS (
 SELECT subject_id,place_id,SUM(delta)::bigint quantity FROM d GROUP BY subject_id,place_id HAVING SUM(delta)>0
), compared AS (
 SELECT COALESCE(l.subject_id,p.subject_id) subject_id,COALESCE(l.place_id,p.place_id) place_id,COALESCE(l.quantity,0)::bigint ledger_quantity,COALESCE(p.quantity,0)::bigint projection_quantity
 FROM ledger l FULL OUTER JOIN inventory_projection p ON p.subject_id=l.subject_id AND p.place_id=l.place_id
)
SELECT c.subject_id,c.place_id,c.ledger_quantity,c.projection_quantity,(c.ledger_quantity-c.projection_quantity)::bigint difference
FROM compared c JOIN inventory_place ip ON ip.id=c.place_id LEFT JOIN operational_pool op ON op.id=ip.pool_id
WHERE ip.kind='OPERATIONAL' AND c.ledger_quantity<>c.projection_quantity
AND ($1::uuid IS NULL OR c.subject_id=$1) AND ($2::text IS NULL OR op.id=$2 OR EXISTS (SELECT 1 FROM operational_pool scope WHERE scope.id=$2 AND scope.destination_store_id IS NULL AND scope.outbound_stage IS NOT NULL AND op.is_placement AND op.outbound_stage=scope.outbound_stage AND op.site_id=scope.site_id)) AND ($3::text IS NULL OR op.site_id=$3)
ORDER BY c.place_id,c.subject_id LIMIT 1000"#)
        .bind(scope.subject_id).bind(&scope.pool_id).bind(&scope.site_id).fetch_all(executor).await?;
    Ok(rows.into_iter().map(|r|json!({"subject_id":r.get::<Uuid,_>("subject_id"),"place_id":r.get::<String,_>("place_id"),"ledger_quantity":r.get::<i64,_>("ledger_quantity"),"projection_quantity":r.get::<i64,_>("projection_quantity"),"difference":r.get::<i64,_>("difference")})).collect())
}

async fn outbound_stage_rollup_differences<'e, E>(
    executor: E,
    scope: &ReplayScope,
) -> Result<Vec<Value>, AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let rows = sqlx::query(
        r#"
-- A stage scope is the stage at its origin (0610), or a retired parent; its
-- components are itself and the legacy per-destination leaves of the same
-- stage AT THE SAME SITE.
WITH parents AS (
    SELECT parent.id,parent.outbound_stage,parent.site_id
    FROM operational_pool parent
    WHERE parent.active AND parent.destination_store_id IS NULL
      AND parent.outbound_stage IS NOT NULL
      AND ($1::text IS NULL OR parent.id=$1 OR EXISTS (
          SELECT 1 FROM operational_pool selected
          WHERE selected.id=$1 AND selected.is_placement
            AND selected.outbound_stage=parent.outbound_stage
            AND selected.site_id=parent.site_id
      ))
      AND ($2::text IS NULL OR parent.site_id=$2)
), components AS (
    SELECT parent.id parent_pool_id,component.id component_pool_id
    FROM parents parent
    JOIN operational_pool component ON component.id=parent.id
      OR (component.is_placement AND component.outbound_stage=parent.outbound_stage
          AND component.site_id=parent.site_id AND component.destination_store_id IS NOT NULL)
), ledger_delta AS (
    SELECT component.parent_pool_id,place.state,movement.quantity delta
    FROM movement
    JOIN inventory_place place ON place.id=movement.to_place_id
    JOIN components component ON component.component_pool_id=place.pool_id
    WHERE ($3::uuid IS NULL OR movement.subject_id=$3)
    UNION ALL
    SELECT component.parent_pool_id,place.state,-movement.quantity delta
    FROM movement
    JOIN inventory_place place ON place.id=movement.from_place_id
    JOIN components component ON component.component_pool_id=place.pool_id
    WHERE ($3::uuid IS NULL OR movement.subject_id=$3)
), ledger AS (
    SELECT parent_pool_id,state,COALESCE(SUM(delta),0)::bigint quantity
    FROM ledger_delta GROUP BY parent_pool_id,state
), projection AS (
    SELECT component.parent_pool_id,place.state,COALESCE(SUM(projected.quantity),0)::bigint quantity
    FROM inventory_projection projected
    JOIN inventory_place place ON place.id=projected.place_id
    JOIN components component ON component.component_pool_id=place.pool_id
    WHERE ($3::uuid IS NULL OR projected.subject_id=$3)
    GROUP BY component.parent_pool_id,place.state
), compared AS (
    SELECT COALESCE(ledger.parent_pool_id,projection.parent_pool_id) parent_pool_id,
           COALESCE(ledger.state,projection.state) state,
           COALESCE(ledger.quantity,0)::bigint ledger_quantity,
           COALESCE(projection.quantity,0)::bigint projection_quantity
    FROM ledger FULL OUTER JOIN projection
      ON projection.parent_pool_id=ledger.parent_pool_id AND projection.state=ledger.state
)
SELECT parent_pool_id,state,ledger_quantity,projection_quantity,
       (ledger_quantity-projection_quantity)::bigint difference
FROM compared WHERE ledger_quantity<>projection_quantity
ORDER BY parent_pool_id,state
"#,
    )
    .bind(&scope.pool_id)
    .bind(&scope.site_id)
    .bind(scope.subject_id)
    .fetch_all(executor)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "parent_pool_id":row.get::<String,_>("parent_pool_id"),
                "state":row.get::<String,_>("state"),
                "ledger_quantity":row.get::<i64,_>("ledger_quantity"),
                "projection_quantity":row.get::<i64,_>("projection_quantity"),
                "difference":row.get::<i64,_>("difference")
            })
        })
        .collect())
}

pub async fn run_replay(pool: &PgPool, request: ReplayRequest) -> Result<Value, AppError> {
    let differences = replay_differences(pool, &request.scope).await?;
    let outbound_rollup_differences =
        outbound_stage_rollup_differences(pool, &request.scope).await?;
    let fact_count = sqlx::query("SELECT count(*)::bigint count FROM movement")
        .fetch_one(pool)
        .await?
        .get::<i64, _>("count");
    let difference_count = differences.len() + outbound_rollup_differences.len();
    let status = if difference_count == 0 {
        "MATCH"
    } else {
        "DIFFERENCE"
    };
    let run_id = Uuid::new_v4();
    let result = json!({
        "run_id":run_id,
        "status":status,
        "scope":request.scope,
        "ledger_fact_count":fact_count,
        "difference_count":difference_count,
        "differences":differences,
        "outbound_rollup_status":if outbound_rollup_differences.is_empty(){"MATCH"}else{"DIFFERENCE"},
        "outbound_rollup_difference_count":outbound_rollup_differences.len(),
        "outbound_rollup_differences":outbound_rollup_differences,
        "read_only":true,
        "ran_at":Utc::now()
    });
    sqlx::query("INSERT INTO replay_run(id,scope_json,status,ledger_fact_count,difference_count,result_json,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(run_id).bind(serde_json::to_value(&request.scope)?).bind(status).bind(fact_count).bind(difference_count as i64).bind(&result).bind(&request.actor_id).execute(pool).await?;
    Ok(result)
}

pub async fn run_repost(pool: &PgPool, request: RepostRequest) -> Result<Value, AppError> {
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "REPOST_PROJECTION",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    sqlx::query("SELECT pg_advisory_xact_lock(78236491)")
        .execute(&mut *tx)
        .await?;
    let before = sqlx::query("SELECT count(*)::bigint count FROM movement")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("count");
    let differences_before = replay_differences(&mut *tx, &request.scope).await?;
    let outbound_rollup_differences_before =
        outbound_stage_rollup_differences(&mut *tx, &request.scope).await?;
    sqlx::query("DELETE FROM inventory_projection p USING inventory_place ip LEFT JOIN operational_pool op ON op.id=ip.pool_id WHERE p.place_id=ip.id AND ip.kind='OPERATIONAL' AND ($1::uuid IS NULL OR p.subject_id=$1) AND ($2::text IS NULL OR op.id=$2 OR EXISTS (SELECT 1 FROM operational_pool scope WHERE scope.id=$2 AND scope.destination_store_id IS NULL AND scope.outbound_stage IS NOT NULL AND op.is_placement AND op.outbound_stage=scope.outbound_stage AND op.site_id=scope.site_id)) AND ($3::text IS NULL OR op.site_id=$3)")
        .bind(request.scope.subject_id).bind(&request.scope.pool_id).bind(&request.scope.site_id).execute(&mut *tx).await?;
    let inserted=sqlx::query(r#"INSERT INTO inventory_projection(subject_id,place_id,quantity,last_fact_sequence,updated_at)
WITH d AS (
 SELECT subject_id,to_place_id place_id,quantity delta,fact_sequence FROM movement
 UNION ALL SELECT subject_id,from_place_id,-quantity,fact_sequence FROM movement
), b AS (
 SELECT subject_id,place_id,SUM(delta)::bigint quantity,MAX(fact_sequence)::bigint seq FROM d GROUP BY subject_id,place_id HAVING SUM(delta)>0
)
SELECT b.subject_id,b.place_id,b.quantity,b.seq,now() FROM b JOIN inventory_place ip ON ip.id=b.place_id LEFT JOIN operational_pool op ON op.id=ip.pool_id
WHERE ip.kind='OPERATIONAL' AND ($1::uuid IS NULL OR b.subject_id=$1) AND ($2::text IS NULL OR op.id=$2 OR EXISTS (SELECT 1 FROM operational_pool scope WHERE scope.id=$2 AND scope.destination_store_id IS NULL AND scope.outbound_stage IS NOT NULL AND op.is_placement AND op.outbound_stage=scope.outbound_stage AND op.site_id=scope.site_id)) AND ($3::text IS NULL OR op.site_id=$3)
ON CONFLICT(subject_id,place_id) DO UPDATE SET quantity=EXCLUDED.quantity,last_fact_sequence=EXCLUDED.last_fact_sequence,updated_at=now()"#)
        .bind(request.scope.subject_id).bind(&request.scope.pool_id).bind(&request.scope.site_id).execute(&mut *tx).await?.rows_affected();
    let after = sqlx::query("SELECT count(*)::bigint count FROM movement")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("count");
    if before != after {
        return Err(AppError::Conflict(
            "ledger changed during repost; transaction aborted".into(),
        ));
    }
    let differences_after = replay_differences(&mut *tx, &request.scope).await?;
    let outbound_rollup_differences_after =
        outbound_stage_rollup_differences(&mut *tx, &request.scope).await?;
    if !differences_after.is_empty() || !outbound_rollup_differences_after.is_empty() {
        return Err(AppError::Conflict(
            "repost failed to reproduce ledger projection and outbound stage rollups".into(),
        ));
    }
    let run_id = Uuid::new_v4();
    sqlx::query("INSERT INTO repost_run(id,scope_json,ledger_fact_count_before,ledger_fact_count_after,projection_rows,actor_id) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(run_id).bind(serde_json::to_value(&request.scope)?).bind(before).bind(after).bind(inserted as i64).bind(&request.actor_id).execute(&mut *tx).await?;
    let response = json!({
        "run_id":run_id,
        "status":"REPAIRED",
        "scope":request.scope,
        "differences_before":differences_before.len(),
        "differences_after":0,
        "outbound_rollup_status":"MATCH",
        "outbound_rollup_differences_before":outbound_rollup_differences_before.len(),
        "outbound_rollup_differences_after":0,
        "projection_rows_rebuilt":inserted,
        "ledger_fact_count_before":before,
        "ledger_fact_count_after":after,
        "ledger_facts_created":0
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

// ── the control list ─────────────────────────────────────────────────────
//
// The ledger-versus-projection differences, in the same envelope as every
// other list here. Two things were wrong with the old answer and both were
// invisible: the route built a `ReplayScope::default()` and so could not be
// narrowed at all, and `projection_difference_count` was the LENGTH OF THE
// PAGE — capped at a thousand — presented as the number of differences. A
// ledger with twelve hundred broken rows reported a thousand, and a screen
// showing "1000 differences" had no way to know it was reading a ceiling.

/// How many differences the control read returns when the caller does not say.
///
/// Small deliberately: a difference is a thing somebody investigates one at a
/// time, not a list anybody scrolls. The count above it is what says how big
/// the problem is, and it is now counted rather than measured off the page.
const DIFFERENCE_DEFAULT_LIMIT: i64 = 100;
/// And the most it will return however loudly a caller asks.
const DIFFERENCE_MAX_LIMIT: i64 = 500;

/// What a caller is asking the control read for.
#[derive(Clone, Debug, Default)]
pub struct ControlScope {
    /// The CENTRE's site id — `dc`, not an Edge node's `dc-01`. These rows
    /// compare Cloud's own ledger against Cloud's own projection, so both
    /// sides are the centre's vocabulary throughout.
    pub site_id: Option<String>,
    pub pool_id: Option<String>,
    pub subject_id: Option<Uuid>,
    /// Free text over the place id, the tag and the SKU code.
    pub needle: Option<String>,
    /// `place`, `difference`, `ledger` or `projection`. Anything unrecognised
    /// is the house order — by place, then by subject.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    /// Whether to count at all — the lever `GET /audit` established.
    ///
    /// Off, this route still answers whether the ledger is HEALTHY; what it
    /// stops being able to say is exactly how many rows disagree. That is a
    /// smaller loss than it sounds and a real one, so the default is on — and
    /// on costs nothing in the case that matters, because a difference list
    /// short enough to fit in one page IS the whole count. See
    /// [`ledger_differences_page`].
    pub count: bool,
}

/// One row where the ledger and the projection disagree.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LedgerDifference {
    /// `place_id#subject_id`. The pair the projection is keyed by, and the
    /// keyset's tie-break.
    pub id: String,
    pub subject_id: Uuid,
    pub place_id: String,
    pub pool_id: Option<String>,
    pub site_id: Option<String>,
    pub epc: Option<String>,
    pub sku_code: Option<String>,
    pub ledger_quantity: i64,
    pub projection_quantity: i64,
    pub difference: i64,
}

/// One outbound rollup that does not add up to its leaves.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RollupDifference {
    pub parent_pool_id: String,
    pub state: String,
    pub ledger_quantity: i64,
    pub projection_quantity: i64,
    pub difference: i64,
}

/// What the difference list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DifferenceFacets {
    pub pools: Vec<InventoryFacet>,
    pub sites: Vec<InventoryFacet>,
}

/// A page of differences, and how many there really are.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DifferencePage {
    pub rows: Vec<LedgerDifference>,
    pub next_cursor: Option<String>,
    /// Every difference the filters match — counted, not measured off the
    /// page. This is the number `projection_difference_count` should always
    /// have been.
    ///
    /// `None` means NOT COUNTED — `count=0` — and never zero, which on this
    /// route is the one answer that must not be guessed: zero here means the
    /// ledger and the projection agree.
    pub total: Option<i64>,
    /// `None` for the same reason, and always together with `total`.
    pub facets: Option<DifferenceFacets>,
}

/// A run of the replay or the repost, as the console shows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReplayRunSummary {
    pub id: Uuid,
    pub status: String,
    pub difference_count: i64,
    pub ran_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RepostRunSummary {
    pub id: Uuid,
    pub projection_rows: i64,
    pub ran_at: DateTime<Utc>,
}

/// Whether the ledger and what is drawn from it still agree.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ControlStatus {
    pub ledger_fact_count: i64,
    /// How many rows disagree — the whole count, not the page's length.
    ///
    /// `None` only when the caller passed `count=0`. `ledger_health` beside it
    /// is never `None`: whether the two agree AT ALL is answered by whether the
    /// first page is empty, which costs nothing.
    pub projection_difference_count: Option<i64>,
    pub outbound_rollup_status: String,
    pub outbound_rollup_difference_count: i64,
    pub ledger_health: String,
    pub last_replay: Option<ReplayRunSummary>,
    pub last_repost: Option<RepostRunSummary>,
    pub differences: DifferencePage,
    /// Not paged: there is one of these per outbound stage per state, which is
    /// a dozen rows at the fleet's largest. A cursor over twelve rows is
    /// machinery nobody would ever turn.
    pub outbound_rollup_differences: Vec<RollupDifference>,
}

#[derive(Serialize, Deserialize)]
struct DifferenceCursor {
    row_id: String,
}

/// One difference row, defined once — for the page and for the facets.
///
/// Binds: `$1` a subject or NULL, `$2` a pool or NULL, `$3` a site or NULL,
/// `$4` the search pattern or NULL.
///
/// The three scope binds stop here rather than outside because they are what
/// the caller means by "which ledger" — they were already the shape of
/// `ReplayScope`, and the facet counts beside one pool's differences should
/// describe that pool. Only the search is layered on top.
const DIFFERENCE_ROWS: &str = r#"
WITH ledger AS (
 -- ONE pass over the ledger. The two-branch UNION ALL this replaces read
 -- `movement` twice to say the same thing — 6,934 buffers where a single scan
 -- expanded per posting costs 3,467, and 46 ms against 31 at 106,100 rows.
 -- Same multiset of deltas, verified row for row over all 3,624 balances.
 SELECT movement.subject_id,side.place_id,SUM(side.delta)::bigint quantity
 FROM movement CROSS JOIN LATERAL (VALUES (movement.to_place_id,movement.quantity),
                                          (movement.from_place_id,-movement.quantity)) AS side(place_id,delta)
 GROUP BY movement.subject_id,side.place_id HAVING SUM(side.delta)>0
), compared AS (
 SELECT COALESCE(l.subject_id,p.subject_id) subject_id,COALESCE(l.place_id,p.place_id) place_id,
        COALESCE(l.quantity,0)::bigint ledger_quantity,COALESCE(p.quantity,0)::bigint projection_quantity
 FROM ledger l FULL OUTER JOIN inventory_projection p ON p.subject_id=l.subject_id AND p.place_id=l.place_id
)
SELECT c.subject_id,c.place_id,c.ledger_quantity,c.projection_quantity,
       (c.ledger_quantity-c.projection_quantity)::bigint difference,
       ABS(c.ledger_quantity-c.projection_quantity)::bigint magnitude,
       op.id pool_id,op.site_id,subject.epc,sk.sku_code,
       c.place_id||'#'||c.subject_id::text row_id
FROM compared c
JOIN inventory_place ip ON ip.id=c.place_id
LEFT JOIN operational_pool op ON op.id=ip.pool_id
LEFT JOIN inventory_subject subject ON subject.id=c.subject_id
LEFT JOIN sku sk ON sk.id=subject.sku_id
WHERE ip.kind='OPERATIONAL' AND c.ledger_quantity<>c.projection_quantity
AND ($1::uuid IS NULL OR c.subject_id=$1)
AND ($2::text IS NULL OR op.id=$2 OR EXISTS (SELECT 1 FROM operational_pool scope WHERE scope.id=$2 AND scope.destination_store_id IS NULL AND scope.outbound_stage IS NOT NULL AND op.is_placement AND op.outbound_stage=scope.outbound_stage AND op.site_id=scope.site_id))
AND ($3::text IS NULL OR op.site_id=$3)
AND ($4::text IS NULL OR c.place_id ILIKE $4 OR subject.epc ILIKE $4 OR sk.sku_code ILIKE $4)
"#;

fn difference_row_from(row: &sqlx::postgres::PgRow) -> Result<LedgerDifference, AppError> {
    Ok(LedgerDifference {
        id: row.try_get("row_id")?,
        subject_id: row.try_get("subject_id")?,
        place_id: row.try_get("place_id")?,
        pool_id: row.try_get("pool_id")?,
        site_id: row.try_get("site_id")?,
        epc: row.try_get("epc")?,
        sku_code: row.try_get("sku_code")?,
        ledger_quantity: row.try_get("ledger_quantity")?,
        projection_quantity: row.try_get("projection_quantity")?,
        difference: row.try_get("difference")?,
    })
}

/// Where the ledger and the projection disagree: searched, filtered, sorted
/// and paged by the server.
pub async fn ledger_differences_page(
    pool: &PgPool,
    scope: &ControlScope,
) -> Result<DifferencePage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let limit = scope
        .limit
        .unwrap_or(DIFFERENCE_DEFAULT_LIMIT)
        .clamp(1, DIFFERENCE_MAX_LIMIT);
    let cursor = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor::<DifferenceCursor>)
        .transpose()?;

    // Every order ends in `row_id` — the place and the subject, which is the
    // pair `inventory_projection` is keyed by, so no two rows can compare
    // equal.
    let (lead, descending) = match scope.sort.as_deref() {
        // Biggest discrepancy first unless asked otherwise: that is the row
        // somebody opening this screen is looking for.
        Some("difference") => ("magnitude", !scope.desc),
        Some("ledger") => ("ledger_quantity", scope.desc),
        Some("projection") => ("projection_quantity", scope.desc),
        _ => ("place_id", scope.desc),
    };
    let (cols, order) = super::order_by(lead, "row_id", descending);
    let seek = if descending { "<" } else { ">" };

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH kept AS NOT MATERIALIZED ({DIFFERENCE_ROWS})
         SELECT * FROM kept
          WHERE $5::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE row_id = $5)
          ORDER BY {order}
          LIMIT $6"
    );
    let rows = sqlx::query(&sql)
        .bind(scope.subject_id)
        .bind(&scope.pool_id)
        .bind(&scope.site_id)
        .bind(&needle)
        .bind(cursor.as_ref().map(|c| c.row_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&DifferenceCursor {
            row_id: row.try_get("row_id")?,
        })?),
        _ => None,
    };
    let out = rows
        .iter()
        .map(difference_row_from)
        .collect::<Result<Vec<_>, AppError>>()?;

    if !scope.count {
        return Ok(DifferencePage {
            rows: out,
            next_cursor,
            total: None,
            facets: None,
        });
    }

    // A first page that came back SHORT is the whole matched set, and the
    // numbers are already in hand.
    //
    // Not an optimisation that trades away truth — the opposite. The facets and
    // the total here are counted over `kept`, which is precisely the set the
    // page was drawn from (see the note below), so when the page holds all of
    // it, tallying the rows gives the same integers the second query would: 31
    // ms instead of 62, and the case it fires in is the ordinary one. A healthy
    // ledger has NO differences at all, and this route's default page is a
    // hundred — the run where the count is worth its whole-ledger fold is the
    // run where the projection is badly broken, which is exactly when nobody
    // minds waiting.
    if cursor.is_none() && next_cursor.is_none() {
        let mut facets = DifferenceFacets {
            pools: tally(&out, |row| row.pool_id.clone().unwrap_or_default()),
            sites: tally(&out, |row| row.site_id.clone().unwrap_or_default()),
        };
        for list in [&mut facets.pools, &mut facets.sites] {
            rank_facets(list);
        }
        return Ok(DifferencePage {
            total: Some(out.len() as i64),
            rows: out,
            next_cursor,
            facets: Some(facets),
        });
    }

    // There is no wider "searched" set to count the facets over here: every
    // bind in the row definition is part of what the caller means by "which
    // ledger", and a facet counted outside the subject being investigated
    // would be describing a different question. So the per-value counts and
    // the total read the same set, and say so.
    let facet_sql = format!(
        "WITH kept AS ({DIFFERENCE_ROWS})
         SELECT 'pool' AS kind, COALESCE(pool_id,'') AS value, COUNT(*)::bigint AS n
           FROM kept GROUP BY pool_id
          UNION ALL
         SELECT 'site', COALESCE(site_id,''), COUNT(*)::bigint FROM kept GROUP BY site_id
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    );
    let facet_rows = sqlx::query(&facet_sql)
        .bind(scope.subject_id)
        .bind(&scope.pool_id)
        .bind(&scope.site_id)
        .bind(&needle)
        .fetch_all(pool)
        .await?;
    let mut total = 0i64;
    let mut facets = DifferenceFacets {
        pools: Vec::new(),
        sites: Vec::new(),
    };
    for row in &facet_rows {
        let kind: String = row.try_get("kind")?;
        let facet = InventoryFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
        };
        match kind.as_str() {
            "pool" => facets.pools.push(facet),
            "site" => facets.sites.push(facet),
            _ => total = facet.count,
        }
    }
    for list in [&mut facets.pools, &mut facets.sites] {
        rank_facets(list);
    }

    Ok(DifferencePage {
        rows: out,
        next_cursor,
        total: Some(total),
        facets: Some(facets),
    })
}

/// How many of these rows carry each value of one field.
///
/// The Rust half of the shortcut above, and it has to agree with the SQL it
/// stands in for: `GROUP BY pool_id` with `COALESCE(pool_id,'')` files the rows
/// that belong to no pool under the empty string, and so does this. A value no
/// row carries gets no entry in either.
fn tally(
    rows: &[LedgerDifference],
    of: impl Fn(&LedgerDifference) -> String,
) -> Vec<InventoryFacet> {
    let mut counts: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for row in rows {
        *counts.entry(of(row)).or_default() += 1;
    }
    counts
        .into_iter()
        .map(|(value, count)| InventoryFacet {
            value,
            label: None,
            count,
        })
        .collect()
}

/// Whether the ledger and everything drawn from it still agree.
///
/// The five reads run CONCURRENTLY. They were serial, and nothing ever asked
/// them to be: none reads another's answer, none is in a transaction, and they
/// were already four separate statements against a twenty-connection pool, so
/// running them together loses no consistency that running them in a row was
/// buying. What it buys is the wall clock — this route's cost is the SLOWEST of
/// them rather than the sum. On a ledger whose projection has diverged in every
/// row, which is the case this screen exists for, that is 126 ms against 62.
pub async fn control_status(pool: &PgPool, scope: ControlScope) -> Result<ControlStatus, AppError> {
    // The rollup check reads the same three-field scope the difference list
    // does, rather than the empty one this route used to hand it.
    let rollup_scope = ReplayScope {
        site_id: scope.site_id.clone(),
        pool_id: scope.pool_id.clone(),
        subject_id: scope.subject_id,
    };
    let (fact_count, differences, outbound_rollup_rows, replay, repost) = tokio::try_join!(
        async {
            Ok::<i64, AppError>(
                sqlx::query("SELECT count(*)::bigint count FROM movement")
                    .fetch_one(pool)
                    .await?
                    .get::<i64, _>("count"),
            )
        },
        ledger_differences_page(pool, &scope),
        outbound_stage_rollup_differences(pool, &rollup_scope),
        async {
            Ok::<_, AppError>(
                sqlx::query(
                    "SELECT id,status,difference_count,ran_at FROM replay_run ORDER BY ran_at DESC LIMIT 1",
                )
                .fetch_optional(pool)
                .await?,
            )
        },
        async {
            Ok::<_, AppError>(
                sqlx::query(
                    "SELECT id,projection_rows,ran_at FROM repost_run ORDER BY ran_at DESC LIMIT 1",
                )
                .fetch_optional(pool)
                .await?,
            )
        },
    )?;
    let outbound_rollup_differences = outbound_rollup_rows
        .iter()
        .map(|row| {
            Ok(RollupDifference {
                parent_pool_id: row
                    .get("parent_pool_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                state: row
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                ledger_quantity: row
                    .get("ledger_quantity")
                    .and_then(Value::as_i64)
                    .unwrap_or_default(),
                projection_quantity: row
                    .get("projection_quantity")
                    .and_then(Value::as_i64)
                    .unwrap_or_default(),
                difference: row
                    .get("difference")
                    .and_then(Value::as_i64)
                    .unwrap_or_default(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    // Whether anything disagrees, which is a different question from how much.
    // An uncounted page that came back empty — with no cursor to follow — has
    // seen the whole matched set, so this stays exact even when the count is
    // off.
    let any_difference = differences
        .total
        .map(|total| total > 0)
        .unwrap_or(!differences.rows.is_empty());
    let healthy = !any_difference && outbound_rollup_differences.is_empty();
    Ok(ControlStatus {
        ledger_fact_count: fact_count,
        projection_difference_count: differences.total,
        outbound_rollup_status: if outbound_rollup_differences.is_empty() {
            "MATCH"
        } else {
            "DIFFERENCE"
        }
        .into(),
        outbound_rollup_difference_count: outbound_rollup_differences.len() as i64,
        ledger_health: if healthy { "HEALTHY" } else { "DIFFERENCE" }.into(),
        last_replay: replay
            .map(|r| -> Result<ReplayRunSummary, AppError> {
                Ok(ReplayRunSummary {
                    id: r.try_get("id")?,
                    status: r.try_get("status")?,
                    difference_count: r.try_get("difference_count")?,
                    ran_at: r.try_get("ran_at")?,
                })
            })
            .transpose()?,
        last_repost: repost
            .map(|r| -> Result<RepostRunSummary, AppError> {
                Ok(RepostRunSummary {
                    id: r.try_get("id")?,
                    projection_rows: r.try_get("projection_rows")?,
                    ran_at: r.try_get("ran_at")?,
                })
            })
            .transpose()?,
        differences,
        outbound_rollup_differences,
    })
}

pub async fn corrupt_projection_for_test(
    pool: &PgPool,
    request: CorruptProjectionRequest,
    enabled: bool,
) -> Result<Value, AppError> {
    if !enabled {
        return Err(AppError::Forbidden("test controls are disabled; set INVENTORY_ENABLE_TEST_CONTROLS=true only in a disposable environment".into()));
    }
    let row=sqlx::query("UPDATE inventory_projection SET quantity=quantity+$3,updated_at=now() WHERE subject_id=$1 AND place_id=$2 RETURNING quantity")
        .bind(request.subject_id).bind(&request.place_id).bind(request.delta).fetch_optional(pool).await?.ok_or_else(||AppError::NotFound("projection row".into()))?;
    Ok(
        json!({"warning":"TEST-ONLY projection corruption applied","subject_id":request.subject_id,"place_id":request.place_id,"new_projection_quantity":row.get::<i64,_>("quantity"),"ledger_changed":false}),
    )
}

/// One row in the clock's own history: what changed, for whom, and what the
/// business clock said on either side of the change. Evidence only — the
/// caller logs and moves on when this fails (see `http::clock`).
pub async fn record_clock_epoch(
    pool: &PgPool,
    before: &crate::clock::ClockStatus,
    after: &crate::clock::ClockStatus,
    actor: Option<&str>,
    op: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO clock_epoch(op, actor, previous_mode, previous_virtual_at, mode, \
         virtual_at, paused, real_at, config) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(op)
    .bind(actor.unwrap_or("anonymous"))
    .bind(before.source.kind())
    .bind(before.virtual_now)
    .bind(after.source.kind())
    .bind(after.virtual_now)
    .bind(after.paused)
    .bind(after.real_now)
    .bind(serde_json::to_value(&after.source)?)
    .execute(pool)
    .await?;
    Ok(())
}
