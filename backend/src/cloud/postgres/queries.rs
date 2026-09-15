use super::{create_movement, movement_request_for_resolution, parse_missing_id, sync};
use crate::cloud::{
    application::{AppError, AsOfQuery, MissingResolutionRequest},
    domain::{InventoryBalance, OperationalPool},
};
use crate::edge::OperationalPool as EdgeOperationalPool;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{collections::BTreeMap, str::FromStr};
use uuid::Uuid;

// ── the inventory lists ──────────────────────────────────────────────────
//
// Brought up to the shape `money_overview` set in `postgres::statements` and
// `list_employees` repeats in `postgres::employment`: a scope struct in, an
// envelope out — the rows, a keyset cursor, how big the whole matched set is,
// and facet counts drawn from the SAME row definition the page is drawn from.
// The convention is copied rather than reinvented; eight list endpoints that
// page eight ways are eight things to learn and eight things to get wrong.

/// One value a filter can take, and how many rows carry it.
///
/// One struct for every inventory list rather than one per module. They ask
/// the same question of different tables, and five identical shapes would be
/// five things to keep in step. Counted over what the search leaves,
/// deliberately ignoring the filters already applied, so the number answers
/// "how many of these there are" — the question somebody has while choosing —
/// rather than "how many survive what you have already ticked".
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InventoryFacet {
    /// What to send back as the filter — a site id, a pool id, a cause. Never
    /// a display string.
    pub value: String,
    /// What to draw, when it differs from the value. `dc` is what this system
    /// files the distribution centre under; the filter list shows its name.
    pub label: Option<String>,
    pub count: i64,
}

/// Biggest first, ties broken on the value so the order is stable between
/// calls — a filter list that reshuffles under the cursor is one nobody can
/// click.
pub(super) fn rank_facets(list: &mut [InventoryFacet]) {
    list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
}

/// How many pools the list returns when the caller does not say.
///
/// Here, beside the only clamp that enforces it. The fleet holds 112 pools
/// today, so the default is the whole of it in one page: the screens that draw
/// a site-by-pool tree need every row to fold it, and a default that cut them
/// off would break the tree rather than page it.
const POOL_DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const POOL_MAX_LIMIT: i64 = 500;

/// What a caller is asking the pool list for.
#[derive(Clone, Debug, Default)]
pub struct PoolScope {
    /// The moment to fold the ledger to. `None` is now, and only `None` is
    /// answered from the projection rather than by replaying movements.
    pub at: Option<DateTime<Utc>>,
    /// Free text over the pool id, its label, the site id and the site's name.
    pub needle: Option<String>,
    pub site_id: Option<String>,
    /// `PENDING`, `WAREHOUSE`, `OUTBOUND`, `REJECT`, `STORE_INVENTORY`.
    pub group: Option<String>,
    /// One pool, by id. The as-of read narrows with this rather than fetching
    /// every pool and dropping all but one in Rust.
    pub pool_id: Option<String>,
    /// `COUNTED` or `NEVER`. See [`PoolRow::last_counted_at`].
    pub counted: Option<String>,
    /// `pool`, `site`, `stock`, `on_hand`, `missing`, `observed` or
    /// `last_count`. Anything unrecognised is the house order rather than a
    /// 400: a sort arrives from a URL somebody may have kept from an older
    /// build, and refusing a stale bookmark is the worse answer.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    /// Whether to count at all — the lever `GET /audit` established.
    ///
    /// It matters less here than anywhere else on this surface, and saying so
    /// is the point: the counting half reads [`POOL_COUNT_ROWS`], which does
    /// not fold the ledger, so it is 1.4 ms at 106,100 movements against the
    /// page's 42. The lever is here for the shape — one spelling across the
    /// inventory lists — and because a caller paging deeply should not have to
    /// ask why this one list makes them pay for a number they already have.
    ///
    /// `Default` leaves it FALSE, which is right for the internal readers that
    /// take the rows alone and wrong for a route, so every route spells it.
    pub count: bool,
}

/// One operational pool, with its balances.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoolRow {
    /// The canonical pool id — `dc.warehouse`, `store-01.floor`. Parsed back
    /// into a place by the server, so it is an identifier and never a label.
    ///
    /// **The centre and the edge spell the distribution centre differently**:
    /// these ids are the CENTRE's — `dc.` — while an Edge node names the same
    /// shelf after the site it runs as, `dc-01.`. This list answers out of the
    /// centre's own ledger, so every id and every `site_id` in it is the
    /// centre's spelling and a filter written against one of these values
    /// matches. `list_fleet_pools` is where the two vocabularies meet, and it
    /// reconciles them there.
    pub id: String,
    pub site_id: String,
    pub site_name: String,
    pub site_kind: String,
    pub group: String,
    pub pool_code: String,
    pub label: String,
    pub store_origin_site_id: Option<String>,
    pub display_order: i32,
    pub is_rollup: bool,
    pub is_outbound_leaf: bool,
    pub outbound_stage: Option<String>,
    pub destination_store_id: Option<String>,
    pub stock: i64,
    /// Absent where the concept does not apply to this pool, never zero —
    /// "nothing is promised out of here" and "promises are not a thing here"
    /// are different answers.
    pub allotted: Option<i64>,
    pub on_hand: i64,
    pub missing: i64,
    pub observed: i64,
    pub lost_rate: f64,
    pub lost_quantity: i64,
    pub exposure: i64,
    /// When this pool was last counted, and **`None` when it never has been**.
    ///
    /// Three of the hundred and twelve pools in this fleet have ever been
    /// counted. A zero or an epoch here would put a number on that absence and
    /// read as "counted, and found nothing" — which is the one thing it does
    /// not mean. The facet counts it as `NEVER` for the same reason.
    pub last_counted_at: Option<DateTime<Utc>>,
}

/// What the pool list can be narrowed by, and how many rows each value holds.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoolFacets {
    pub sites: Vec<InventoryFacet>,
    pub groups: Vec<InventoryFacet>,
    /// `COUNTED` and `NEVER`. The second is not a zero — see
    /// [`PoolRow::last_counted_at`].
    pub counted: Vec<InventoryFacet>,
}

/// A page of the pool list, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoolPage {
    pub as_of: DateTime<Utc>,
    /// True whenever `as_of` is more than two seconds ago. These numbers are
    /// history and nothing may be posted against them.
    pub read_only: bool,
    pub observed_window_hours: i64,
    pub lost_risk_window_days: i64,
    pub inventory_equation: String,
    pub outbound_rollup_equation: String,
    pub lost_risk_formula: String,
    pub rows: Vec<PoolRow>,
    /// Opaque. Pass it back as `cursor`; absent means this was the last page.
    pub next_cursor: Option<String>,
    /// Every pool the search and the filters match — not just this page.
    ///
    /// `None` means NOT COUNTED, which is a different statement from zero: the
    /// caller passed `count=0`. See [`PoolScope::count`].
    pub total: Option<i64>,
    /// `None` for the same reason, and always together with `total`.
    pub facets: Option<PoolFacets>,
}

/// Where the previous page stopped — as a ROW, not as a position.
#[derive(Serialize, Deserialize)]
struct PoolCursor {
    pool_id: String,
}

/// One pool row, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole
/// reason it is a constant: a facet is only honest if it counts exactly what
/// the page can show.
///
/// Binds: `$1` the moment, `$2` the observed window in hours, `$3` the
/// lost-risk window in days, `$4` whether `$1` is now, `$5` the search pattern
/// or NULL.
///
/// The `*_key` columns are computed here rather than only in `ORDER BY`
/// because a keyset has to COMPARE the sort value in a `WHERE`, and a sort
/// expression that is not also a column is one a `WHERE` cannot see. Every one
/// of them is non-null, which is not decoration: a row comparison against NULL
/// is NULL rather than true, so a single pool with no destination — or the
/// hundred and nine that have never been counted — would end paging at
/// whatever row happened to carry it, silently, with the rest of the fleet
/// below the fold. `NULLS LAST` does not fix that; it orders a result and says
/// nothing a keyset can seek against. A sentinel value does.
const POOL_ROWS: &str = r#"
WITH ledger_deltas AS (
    SELECT place.pool_id,place.state,projection.quantity delta
    FROM inventory_projection projection
    JOIN inventory_place place ON place.id=projection.place_id
    WHERE $4 AND place.kind='OPERATIONAL'
    UNION ALL
    SELECT place.pool_id,place.state,movement.quantity delta
    FROM movement JOIN inventory_place place ON place.id=movement.to_place_id
    WHERE NOT $4 AND place.kind='OPERATIONAL' AND movement.occurred_at <= $1
    UNION ALL
    SELECT place.pool_id,place.state,-movement.quantity delta
    FROM movement JOIN inventory_place place ON place.id=movement.from_place_id
    WHERE NOT $4 AND place.kind='OPERATIONAL' AND movement.occurred_at <= $1
), balances AS (
    SELECT pool_id,state,SUM(delta)::bigint quantity
    FROM ledger_deltas
    GROUP BY pool_id,state
), observed_raw AS (
    SELECT pool_id,COUNT(DISTINCT COALESCE(subject_id::text,epc))::bigint quantity
    FROM observation_sighting
    WHERE last_seen_at > $1-($2::text||' hours')::interval AND last_seen_at <= $1
    GROUP BY pool_id
), risk_raw AS (
    -- ONE pass over the ledger, expanded per posting rather than one pass PER
    -- POOL. The old spelling joined `operational_pool` to `movement` on
    -- `movement.to_place_id = pool.id||':on_hand' OR …`, which the planner can
    -- only answer by looking the whole ledger up once for each of the hundred
    -- and twelve pools: 120,852 rows examined to produce 112, over 10,187
    -- buffers, 128 ms of a 150 ms page. This reads `movement` once — 3,495
    -- buffers, 42 ms — and it is the whole of why `/inventory/pools` and
    -- `/inventory/fleet-pools` came back under budget.
    --
    -- The expansion names the pool off the place id rather than joining to find
    -- it. Every OPERATIONAL place is `<pool id>:on_hand` or `<pool id>:missing`
    -- — checked, not assumed: no operational place breaks that rule and no
    -- external or system place looks like one — so `left(place_id,-8)` IS the
    -- pool, and a derived id that matches no pool is dropped by the roll-up
    -- below rather than needing to be filtered here.
    --
    -- At most ONE of the two branches can name a given pool for a given
    -- posting, which is what makes this arithmetically identical to the ordered
    -- CASE it replaces rather than merely similar. Both naming pool P at once
    -- would need `to_place_id` and `from_place_id` to be the same string —
    -- `P:on_hand` — and `from_place_id <> to_place_id` is a table constraint;
    -- the lost branch needs `P:missing` on the side the other branch needs
    -- `P:on_hand` on. Verified row for row against the old shape over all 112
    -- pools regardless, because an argument is not a measurement.
    SELECT side.pool_id,
           SUM(side.opening)::bigint opening,
           SUM(side.inbound)::bigint inbound,
           SUM(side.lost)::bigint lost
    FROM movement
    CROSS JOIN LATERAL (VALUES
        -- Into the shelf: everything before the window is the opening balance,
        -- everything inside it is inbound.
        (CASE WHEN movement.to_place_id LIKE '%:on_hand'
              THEN left(movement.to_place_id,-8) END,
         CASE WHEN movement.occurred_at < $1-($3::text||' days')::interval
              THEN movement.quantity ELSE 0 END,
         CASE WHEN movement.occurred_at >= $1-($3::text||' days')::interval
              THEN movement.quantity ELSE 0 END,
         0::bigint),
        -- Off the shelf — which lowers the opening balance — or confirmed lost
        -- out of this pool's missing place, which is the numerator.
        (CASE WHEN movement.from_place_id LIKE '%:on_hand'
                OR (movement.from_place_id LIKE '%:missing'
                    AND movement.to_place_id='system/lost')
              THEN left(movement.from_place_id,-8) END,
         CASE WHEN movement.from_place_id LIKE '%:on_hand'
               AND movement.occurred_at < $1-($3::text||' days')::interval
              THEN -movement.quantity ELSE 0 END,
         0::bigint,
         CASE WHEN movement.from_place_id LIKE '%:missing'
               AND movement.to_place_id='system/lost'
               AND movement.occurred_at >= $1-($3::text||' days')::interval
              THEN movement.quantity ELSE 0 END)
    ) AS side(pool_id,opening,inbound,lost)
    WHERE movement.occurred_at <= $1 AND side.pool_id IS NOT NULL
    GROUP BY side.pool_id
), pool_scope AS (
    SELECT output.id output_pool_id,component.id component_pool_id
    FROM operational_pool output
    JOIN operational_pool component ON
        (output.is_placement AND component.id=output.id)
        OR (
            NOT output.is_placement
            AND output.outbound_stage IS NOT NULL
            AND (component.id=output.id OR (component.is_placement AND component.outbound_stage=output.outbound_stage))
        )
), balance_rollup AS (
    SELECT scope.output_pool_id,balance.state,COALESCE(SUM(balance.quantity),0)::bigint quantity
    FROM pool_scope scope LEFT JOIN balances balance ON balance.pool_id=scope.component_pool_id
    GROUP BY scope.output_pool_id,balance.state
), observed_rollup AS (
    SELECT scope.output_pool_id,COALESCE(SUM(observed.quantity),0)::bigint quantity
    FROM pool_scope scope LEFT JOIN observed_raw observed ON observed.pool_id=scope.component_pool_id
    GROUP BY scope.output_pool_id
), risk_rollup AS (
    SELECT scope.output_pool_id,
           COALESCE(SUM(risk.opening),0)::bigint opening,
           COALESCE(SUM(risk.inbound),0)::bigint inbound,
           COALESCE(SUM(risk.lost),0)::bigint lost
    FROM pool_scope scope
    LEFT JOIN risk_raw risk ON risk.pool_id=scope.component_pool_id
    GROUP BY scope.output_pool_id
), allotted_balance AS (
    -- What this shelf still has to put in a carton: `to_pack_qty` out of the
    -- one commitment view, never a sum of event deltas.
    --
    -- The old spelling was `SUM(remaining_delta)`, where CREATED adds and
    -- PICKED subtracts. Picking is destination-less now and commits nothing,
    -- so that formula answered a question nobody asks — and the moment
    -- ALLOTMENT_PICKED is retired it would never release a commitment again,
    -- growing without bound and taking On Hand negative across the fleet.
    --
    -- It is also the reason this CTE is LIVE ONLY. The cloud's event stream
    -- holds ALLOTMENT_CREATED and the legacy pick and cancel, and nothing
    -- else: packing, shipment, loss and Close Short reach the centre as a
    -- progress snapshot, not as events. So there is no honest as-of
    -- commitment to compute, and the column answers NULL for a historical
    -- read — the same `—` the tree already shows for a pool that cannot be a
    -- source — rather than a number that ignores every carton ever packed.
    SELECT commitment.source_pool_id,
           COALESCE(SUM(commitment.to_pack_qty),0)::bigint quantity
    FROM allotment_line_commitment commitment
    WHERE $4
    GROUP BY commitment.source_pool_id
)
-- Two id spaces meet in this SELECT and they no longer agree. `pool.id` is a
-- POOL id and still spells the warehouse `dc.…`; `pool.site_id` is a SITE id
-- and has been `ho` since 0256 folded `dc` and `dc-01` into head office. A
-- test written against one and applied to the other passes silently: the
-- allotted column would be computed for every pool in the fleet, and the
-- `dc_first` sort key would never fire.
SELECT pool.id,pool.site_id,site.name site_name,site.kind site_kind,pool.group_code,pool.pool_code,pool.label,
       pool.store_origin_site_id,pool.display_order,pool.is_placement,pool.outbound_stage,pool.destination_store_id,
       COALESCE(normal.quantity,0)::bigint normal,
       COALESCE(missing.quantity,0)::bigint missing,
       COALESCE(observed.quantity,0)::bigint observed,
       CASE WHEN $4 AND pool.is_placement AND (pool.id IN ('dc.warehouse','dc.reject.dc') OR pool.site_id<>'ho')
            THEN COALESCE(allotted.quantity,0) ELSE NULL END::bigint allotted,
       risk.lost::bigint lost_quantity,
       CASE WHEN GREATEST(risk.opening,0)+risk.inbound > 0
            THEN ROUND(risk.lost::numeric/(GREATEST(risk.opening,0)+risk.inbound)::numeric,6)
            ELSE 0 END::text lost_rate,
       (GREATEST(risk.opening,0)+risk.inbound)::bigint exposure,
       last_count.at last_counted_at,
       -- Sort keys. Every one non-null: see the note above the constant.
       (COALESCE(normal.quantity,0)+COALESCE(missing.quantity,0))::bigint stock_key,
       (COALESCE(normal.quantity,0)
        - CASE WHEN $4 AND pool.is_placement AND (pool.id IN ('dc.warehouse','dc.reject.dc') OR pool.site_id<>'ho')
               THEN COALESCE(allotted.quantity,0) ELSE 0 END)::bigint on_hand_key,
       COALESCE(missing.quantity,0)::bigint missing_key,
       COALESCE(observed.quantity,0)::bigint observed_key,
       COALESCE(last_count.at,TIMESTAMPTZ '-infinity') last_count_key,
       COALESCE(site.name,pool.site_id) site_key,
       CASE WHEN pool.site_id='ho' THEN 0 ELSE 1 END dc_first,
       CASE WHEN pool.is_placement THEN 1 ELSE 0 END placement_rank,
       COALESCE(pool.destination_store_id,'') destination_key,
       CASE WHEN last_count.at IS NULL THEN 'NEVER' ELSE 'COUNTED' END counted_state
FROM operational_pool pool JOIN site ON site.id=pool.site_id
LEFT JOIN balance_rollup normal ON normal.output_pool_id=pool.id AND normal.state='NORMAL'
LEFT JOIN balance_rollup missing ON missing.output_pool_id=pool.id AND missing.state='MISSING'
LEFT JOIN observed_rollup observed ON observed.output_pool_id=pool.id
LEFT JOIN risk_rollup risk ON risk.output_pool_id=pool.id
LEFT JOIN allotted_balance allotted ON allotted.source_pool_id=pool.id
-- When anybody last went and looked. Whichever moment the count reached —
-- closed, submitted, activated, or merely created — is the one that counts as
-- "last": a count still open is not a pool nobody has been to.
LEFT JOIN LATERAL (
    SELECT MAX(COALESCE(official.closed_at,official.submitted_at,
                        official.activated_at,official.created_at)) at
    FROM official_count official WHERE official.pool_id=pool.id
) last_count ON TRUE
WHERE pool.active
  AND ($5::text IS NULL OR pool.id ILIKE $5 OR pool.label ILIKE $5
       OR pool.site_id ILIKE $5 OR site.name ILIKE $5)
"#;

/// The same hundred and twelve pools, without folding the ledger to find them.
///
/// Binds: `$1` the search pattern or NULL — and nothing else, because nothing
/// else is needed to say WHICH pools match.
///
/// This is the counting half's row definition, and it is honest for one
/// checkable reason: [`POOL_ROWS`] is `operational_pool JOIN site` under
/// exactly this `WHERE`, and every other join it makes is a LEFT JOIN on a
/// primary key or on a roll-up already grouped to one row per pool. So it
/// returns one row per active matching pool and so does this — the fold adds
/// COLUMNS, never rows. Counting over the fold was therefore paying 102 ms to
/// learn a number that 1.4 ms of the same rows already knows, twice a request.
///
/// `counted_state` is here rather than derived twice: the facet counts group by
/// it, and a value two places compute separately is a value two places will
/// eventually disagree about.
const POOL_COUNT_ROWS: &str = r#"
SELECT pool.id,pool.site_id,site.name site_name,pool.group_code,
       CASE WHEN last_count.at IS NULL THEN 'NEVER' ELSE 'COUNTED' END counted_state
FROM operational_pool pool JOIN site ON site.id=pool.site_id
LEFT JOIN LATERAL (
    SELECT MAX(COALESCE(official.closed_at,official.submitted_at,
                        official.activated_at,official.created_at)) at
    FROM official_count official WHERE official.pool_id=pool.id
) last_count ON TRUE
WHERE pool.active
  AND ($1::text IS NULL OR pool.id ILIKE $1 OR pool.label ILIKE $1
       OR pool.site_id ILIKE $1 OR site.name ILIKE $1)
"#;

/// The pool list's filters, spelled once for the page and for the count.
///
/// A function of the first bind number rather than a constant, because the two
/// queries that apply them carry a different number of binds ahead of them: the
/// page's row definition folds the ledger and needs five, the count's needs
/// one. The alternative is two constants that agree on the day they are written
/// — which is the failure this codebase names every time it writes a definition
/// down once.
fn pool_filters(first: usize) -> String {
    let (site, group, id, counted) = (first, first + 1, first + 2, first + 3);
    format!(
        "WHERE (${site}::text IS NULL OR site_id=${site})
           AND (${group}::text IS NULL OR group_code=${group})
           AND (${id}::text IS NULL OR id=${id})
           AND (${counted}::text IS NULL OR counted_state=${counted})"
    )
}

fn pool_row_from(row: &sqlx::postgres::PgRow) -> Result<PoolRow, AppError> {
    let balance = InventoryBalance::project(
        row.get::<i64, _>("normal"),
        row.get::<Option<i64>, _>("allotted"),
        row.get::<i64, _>("missing"),
        row.get::<i64, _>("observed"),
    )
    .map_err(|error| AppError::Conflict(format!("invalid inventory projection: {error}")))?;
    let is_placement = row.get::<bool, _>("is_placement");
    let outbound_stage = row.get::<Option<String>, _>("outbound_stage");
    Ok(PoolRow {
        id: row.get("id"),
        site_id: row.get("site_id"),
        site_name: row.get("site_name"),
        site_kind: row.get("site_kind"),
        group: row.get("group_code"),
        pool_code: row.get("pool_code"),
        label: row.get("label"),
        store_origin_site_id: row.get("store_origin_site_id"),
        display_order: row.get("display_order"),
        is_rollup: !is_placement,
        is_outbound_leaf: is_placement && outbound_stage.is_some(),
        outbound_stage,
        destination_store_id: row.get("destination_store_id"),
        stock: balance.stock.value(),
        allotted: balance.allotted.map(|quantity| quantity.value()),
        on_hand: balance.on_hand.value(),
        missing: balance.missing.value(),
        observed: balance.observed.value(),
        lost_rate: row
            .get::<String, _>("lost_rate")
            .parse::<f64>()
            .unwrap_or(0.0),
        lost_quantity: row.get("lost_quantity"),
        exposure: row.get("exposure"),
        last_counted_at: row.get("last_counted_at"),
    })
}

/// Every pool, in the house order, with no filter and no page.
///
/// The internal readers — the fleet read, a pool's own detail, the assistant's
/// tool — want the whole set and then decide for themselves. They are not
/// paging, so handing them a page would only make them walk a cursor to
/// reassemble what they asked for.
pub(super) async fn pool_rows(
    pool: &PgPool,
    at: Option<DateTime<Utc>>,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Vec<PoolRow>, AppError> {
    let current = at.is_none();
    let at = at.unwrap_or_else(Utc::now);
    let sql = format!(
        "WITH searched AS ({POOL_ROWS})
         SELECT * FROM searched
          ORDER BY dc_first,site_id,display_order,placement_rank,destination_key,id"
    );
    let rows = sqlx::query(&sql)
        .bind(at)
        .bind(observed_hours)
        .bind(lost_days)
        .bind(current)
        .bind(Option::<String>::None)
        .fetch_all(pool)
        .await?;
    rows.iter().map(pool_row_from).collect()
}

/// The pool list as the routes that predate the envelope still read it.
///
/// `list_fleet_pools`, `get_pool` and the assistant's inventory tool all take
/// the whole set and work on it; this is that set in the shape they already
/// expect. The envelope is [`pools_page`].
pub async fn list_pools(
    pool: &PgPool,
    at: Option<DateTime<Utc>>,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    let moment = at.unwrap_or_else(Utc::now);
    let items = pool_rows(pool, at, observed_hours, lost_days).await?;
    Ok(json!({
        "as_of":moment,"read_only":moment<Utc::now()-chrono::Duration::seconds(2),
        "observed_window_hours":observed_hours,"lost_risk_window_days":lost_days,
        "inventory_equation":"Stock = On Hand + Allotted + Missing",
        "outbound_rollup_equation":"Stage total = sum of destination Store leaf pools",
        "lost_risk_formula":"confirmed Lost from pool during window / (opening operational balance + inbound movements during window)",
        "items":serde_json::to_value(&items)?
    }))
}

/// The pools: searched, filtered, sorted and paged by the server.
pub async fn pools_page(
    pool: &PgPool,
    scope: PoolScope,
    observed_hours: i64,
    lost_days: i64,
) -> Result<PoolPage, AppError> {
    let current = scope.at.is_none();
    let moment = scope.at.unwrap_or_else(Utc::now);
    // A blank search is not a search. `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));

    // TWO spellings of one order, and they are not interchangeable: `ORDER BY`
    // takes directions, a row expression does not, and `(a ASC, b) > (…)` is a
    // syntax error the compiler cannot catch because the whole clause is a
    // string. Every order ends in the pool id, which is the primary key, so no
    // two rows compare equal — which is what stops a keyset from repeating or
    // losing the rows that tie.
    let dir = if scope.desc { "DESC" } else { "ASC" };
    let seek = if scope.desc { "<" } else { ">" };
    let (cols, order) = match scope.sort.as_deref() {
        Some("site") => (
            "site_key, id".to_owned(),
            format!("site_key {dir}, id {dir}"),
        ),
        Some("stock") => (
            "stock_key, id".to_owned(),
            format!("stock_key {dir}, id {dir}"),
        ),
        Some("on_hand") => (
            "on_hand_key, id".to_owned(),
            format!("on_hand_key {dir}, id {dir}"),
        ),
        Some("missing") => (
            "missing_key, id".to_owned(),
            format!("missing_key {dir}, id {dir}"),
        ),
        Some("observed") => (
            "observed_key, id".to_owned(),
            format!("observed_key {dir}, id {dir}"),
        ),
        // Ascending puts the pools nobody has ever been to first, which is the
        // useful answer rather than an accident of the sentinel.
        Some("last_count") => (
            "last_count_key, id".to_owned(),
            format!("last_count_key {dir}, id {dir}"),
        ),
        // The house order, as five columns rather than one concatenated key:
        // gluing a site id to a display order and comparing the result as text
        // makes `store-1` sort after `store-10`, and under a non-C collation it
        // is anybody's guess. A row comparison over the five is exact.
        _ => (
            "dc_first, site_id, display_order, placement_rank, destination_key, id".to_owned(),
            format!(
                "dc_first {dir}, site_id {dir}, display_order {dir}, \
                 placement_rank {dir}, destination_key {dir}, id {dir}"
            ),
        ),
    };

    let cursor = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor::<PoolCursor>)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(POOL_DEFAULT_LIMIT)
        .clamp(1, POOL_MAX_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor, so one cursor shape serves every order and a
    // seventh sort cannot arrive without its cursor.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let filters = pool_filters(6);
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({POOL_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {filters}
         )
         SELECT * FROM kept
          WHERE $10::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE id = $10)
          ORDER BY {order}
          LIMIT $11"
    );
    let rows = sqlx::query(&sql)
        .bind(moment)
        .bind(observed_hours)
        .bind(lost_days)
        .bind(current)
        .bind(&needle)
        .bind(&scope.site_id)
        .bind(&scope.group)
        .bind(&scope.pool_id)
        .bind(&scope.counted)
        .bind(cursor.as_ref().map(|c| c.pool_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether
    // more rows exist without asking costs a second count of the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&PoolCursor {
            pool_id: row.try_get("id")?,
        })?),
        _ => None,
    };
    let out = rows
        .iter()
        .map(pool_row_from)
        .collect::<Result<Vec<_>, AppError>>()?;

    // The page is done. Everything below is the counting half, and it is
    // skipped entirely rather than approximated when the caller says so.
    let (total, facets) = match scope.count {
        true => {
            let (total, facets) = pool_facets(pool, &scope, needle.as_deref()).await?;
            (Some(total), Some(facets))
        }
        false => (None, None),
    };
    Ok(PoolPage {
        as_of: moment,
        read_only: moment < Utc::now() - chrono::Duration::seconds(2),
        observed_window_hours: observed_hours,
        lost_risk_window_days: lost_days,
        inventory_equation: "Stock = On Hand + Allotted + Missing".into(),
        outbound_rollup_equation: "Stage total = sum of destination Store leaf pools".into(),
        lost_risk_formula: "confirmed Lost from pool during window / (opening operational balance + inbound movements during window)".into(),
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// How many pools there are, and how they split.
///
/// Two scopes, deliberately: the per-value counts read the SEARCHED set,
/// ignoring what is filtered, so "Warehouse 14" means there are fourteen
/// warehouses rather than fourteen among the ones you already narrowed to
/// warehouses. The total reads the FILTERED set, because it describes the list
/// on screen.
///
/// Counted over [`POOL_COUNT_ROWS`] rather than over the fold. Counting pools
/// never needed their balances, and asking for them made this the second of two
/// whole-ledger folds in one request — 102 ms to learn that there are a hundred
/// and twelve pools and how they split by site. It is 1.4 ms now, over the same
/// rows, which is checked rather than assumed: see the note on the constant.
async fn pool_facets(
    pool: &PgPool,
    scope: &PoolScope,
    needle: Option<&str>,
) -> Result<(i64, PoolFacets), AppError> {
    let filters = pool_filters(2);
    let sql = format!(
        "WITH searched AS ({POOL_COUNT_ROWS}), kept AS (
             SELECT * FROM searched {filters}
         )
         SELECT 'site' AS kind, site_id AS value, site_name AS label,
                COUNT(*)::bigint AS n
           FROM searched GROUP BY site_id, site_name
          UNION ALL
         SELECT 'group', group_code, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY group_code
          UNION ALL
         SELECT 'counted', counted_state, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY counted_state
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&scope.site_id)
        .bind(&scope.group)
        .bind(&scope.pool_id)
        .bind(&scope.counted)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = PoolFacets {
        sites: Vec::new(),
        groups: Vec::new(),
        counted: Vec::new(),
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let facet = InventoryFacet {
            value: row.try_get("value")?,
            label: row.try_get("label")?,
            count: row.try_get("n")?,
        };
        match kind.as_str() {
            "site" => facets.sites.push(facet),
            "group" => facets.groups.push(facet),
            "counted" => facets.counted.push(facet),
            _ => total = facet.count,
        }
    }
    for list in [&mut facets.sites, &mut facets.groups, &mut facets.counted] {
        rank_facets(list);
    }
    Ok((total, facets))
}

fn edge_pool_metadata(
    pool: &EdgeOperationalPool,
) -> (
    &'static str,
    &'static str,
    &'static str,
    i32,
    Option<&'static str>,
) {
    use EdgeOperationalPool::*;
    match pool {
        DcPendingUnidentified { .. } => ("PENDING", "UNIDENTIFIED", "Unidentified", 10, None),
        DcPendingUntagged { .. } => ("PENDING", "UNTAGGED", "Untagged", 20, None),
        DcWarehouse { .. } => ("WAREHOUSE", "WAREHOUSE", "Warehouse", 30, None),
        // Off the racks, not yet in a box, and not yet anyone's. It sorts
        // before the destination-scoped leaves because that is the order the
        // goods actually pass through.
        DcOutboundPicking { .. } => ("OUTBOUND", "PICKING", "Pick Area", 40, None),
        DcOutboundPicked { .. } => ("OUTBOUND", "PICKED", "Picked", 41, Some("PICKED")),
        DcOutboundPacked { .. } => ("OUTBOUND", "PACKED", "Packed", 51, Some("PACKED")),
        DcOutboundShipment { .. } => ("OUTBOUND", "SHIPMENT", "Shipment", 61, Some("SHIPMENT")),
        DcOutboundLoaded { .. } => ("OUTBOUND", "LOADED", "Loaded", 71, Some("LOADED")),
        DcOutboundInTransit { .. } => (
            "OUTBOUND",
            "IN_TRANSIT",
            "In Transit",
            81,
            Some("IN_TRANSIT"),
        ),
        DcRejectDc { .. } => ("REJECT", "DC_REJECT", "DC Reject", 90, None),
        DcRejectStore { .. } => ("REJECT", "STORE_REJECT", "Store Reject", 100, None),
        StoreWarehouse { .. } => ("STORE_INVENTORY", "WAREHOUSE", "Warehouse", 10, None),
        StoreFloor { .. } => ("STORE_INVENTORY", "FLOOR", "Floor", 20, None),
        StoreReject { .. } => ("REJECT", "REJECT", "Reject", 30, None),
    }
}

#[derive(Clone)]
struct TransferAttribution {
    in_transit_event_id: Uuid,
    koli_id: Uuid,
    allotment_id: Uuid,
    allotment_line_id: Uuid,
    matched_at: DateTime<Utc>,
}

#[derive(Clone)]
struct TransferEvidence {
    event_id: Uuid,
    origin_id: String,
    generation: i64,
    seq: i64,
    sku_code: String,
    quantity: i64,
    movement_group_id: Uuid,
    receipt_id: Option<Uuid>,
    occurred_at: DateTime<Utc>,
    attribution: Option<TransferAttribution>,
}

#[derive(Default)]
struct TransferIdentityClaims {
    in_transit: Vec<TransferEvidence>,
    received: Vec<TransferEvidence>,
}

#[derive(Default)]
struct TransferReconciliationReport {
    rows: Vec<ReconciliationRow>,
    matched: i64,
    matched_attributed: i64,
    matched_unattributed: i64,
    dc_only: i64,
    store_only: i64,
    unresolved: i64,
    conflicts: i64,
    matched_by_route: BTreeMap<(String, String), i64>,
}

impl TransferReconciliationReport {
    /// The tallies, as the fleet read and the reconciliation page both show
    /// them. Unaffected by any filter: certification turns on these numbers.
    fn summary(&self) -> ReconciliationSummary {
        ReconciliationSummary {
            matched: self.matched,
            matched_attributed: self.matched_attributed,
            matched_unattributed: self.matched_unattributed,
            dc_only: self.dc_only,
            store_only: self.store_only,
            unresolved: self.unresolved,
            conflicts: self.conflicts,
        }
    }

    fn prevents_certification(&self) -> bool {
        self.store_only > 0 || self.unresolved > 0 || self.conflicts > 0
    }
}

fn transfer_attribution_view(attribution: &TransferAttribution) -> TransferAttributionView {
    TransferAttributionView {
        in_transit_event_id: attribution.in_transit_event_id,
        koli_id: attribution.koli_id,
        allotment_id: attribution.allotment_id,
        allotment_line_id: attribution.allotment_line_id,
        matched_at: attribution.matched_at,
    }
}

fn transfer_evidence_view(evidence: &TransferEvidence) -> TransferEvidenceView {
    TransferEvidenceView {
        event_id: evidence.event_id,
        origin_id: evidence.origin_id.clone(),
        generation: evidence.generation,
        seq: evidence.seq,
        sku_code: evidence.sku_code.clone(),
        quantity: evidence.quantity,
        movement_group_id: evidence.movement_group_id,
        receipt_id: evidence.receipt_id,
        occurred_at: evidence.occurred_at,
        attribution: evidence.attribution.as_ref().map(transfer_attribution_view),
    }
}

async fn transfer_reconciliation_report(
    pool: &PgPool,
) -> Result<TransferReconciliationReport, AppError> {
    let rows = sqlx::query(
        "SELECT claim.event_id,claim.origin_id,claim.generation,claim.seq,
                claim.claim_kind,claim.source_dc_id,claim.destination_store_id,
                claim.shipment_reference,claim.epc,claim.quantity,claim.sku_code,
                claim.movement_group_id,claim.receipt_id,claim.occurred_at,
                attribution.in_transit_event_id,attribution.koli_id,
                attribution.allotment_id,attribution.allotment_line_id,
                attribution.matched_at
         FROM edge_transfer_claim claim
         LEFT JOIN edge_transfer_allotment_attribution attribution
           ON attribution.receipt_event_id=claim.event_id
         ORDER BY claim.occurred_at,claim.event_id",
    )
    .fetch_all(pool)
    .await?;
    type ReconciliationKey = (Option<String>, String, Option<String>, String);
    let mut claims: BTreeMap<ReconciliationKey, TransferIdentityClaims> = BTreeMap::new();
    for row in rows {
        let key = (
            row.get::<Option<String>, _>("source_dc_id"),
            row.get::<String, _>("destination_store_id"),
            row.get::<Option<String>, _>("shipment_reference"),
            row.get::<String, _>("epc"),
        );
        let attribution =
            row.get::<Option<Uuid>, _>("koli_id")
                .map(|koli_id| TransferAttribution {
                    in_transit_event_id: row.get("in_transit_event_id"),
                    koli_id,
                    allotment_id: row.get("allotment_id"),
                    allotment_line_id: row.get("allotment_line_id"),
                    matched_at: row.get("matched_at"),
                });
        let evidence = TransferEvidence {
            event_id: row.get("event_id"),
            origin_id: row.get("origin_id"),
            generation: row.get("generation"),
            seq: row.get("seq"),
            sku_code: row.get("sku_code"),
            quantity: row.get("quantity"),
            movement_group_id: row.get("movement_group_id"),
            receipt_id: row.get("receipt_id"),
            occurred_at: row.get("occurred_at"),
            attribution,
        };
        let identity = claims.entry(key).or_default();
        match row.get::<String, _>("claim_kind").as_str() {
            "IN_TRANSIT" => identity.in_transit.push(evidence),
            "RECEIVED" => identity.received.push(evidence),
            other => {
                return Err(AppError::Conflict(format!(
                    "unknown materialized transfer claim kind {other}"
                )));
            }
        }
    }

    let mut report = TransferReconciliationReport::default();
    for ((source_dc_id, destination_store_id, shipment_reference, epc), identity) in claims {
        let complete_key = source_dc_id.is_some() && shipment_reference.is_some();
        let unique_pair = identity.in_transit.len() == 1 && identity.received.len() == 1;
        let same_sku =
            unique_pair && identity.in_transit[0].sku_code == identity.received[0].sku_code;
        let attribution = identity
            .received
            .first()
            .and_then(|evidence| evidence.attribution.as_ref());
        let status = if unique_pair && complete_key && same_sku {
            report.matched += 1;
            if attribution.is_some() {
                report.matched_attributed += 1;
            } else {
                report.matched_unattributed += 1;
            }
            let route = (
                source_dc_id.clone().unwrap_or_default(),
                destination_store_id.clone(),
            );
            *report.matched_by_route.entry(route).or_default() += 1;
            "MATCHED"
        } else if identity.in_transit.len() == 1 && identity.received.is_empty() {
            report.dc_only += 1;
            "DC_ONLY"
        } else if identity.in_transit.is_empty() && identity.received.len() == 1 && complete_key {
            report.store_only += 1;
            "STORE_ONLY"
        } else if !complete_key && !identity.received.is_empty() {
            report.unresolved += 1;
            "UNRESOLVED"
        } else {
            report.conflicts += 1;
            "CONFLICT"
        };
        let sku_codes = identity
            .in_transit
            .iter()
            .chain(identity.received.iter())
            .map(|claim| claim.sku_code.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let occurred_at = identity
            .in_transit
            .iter()
            .chain(identity.received.iter())
            .map(|claim| claim.occurred_at)
            .min();
        report.rows.push(ReconciliationRow {
            id: format!(
                "{}|{destination_store_id}|{}|{epc}",
                source_dc_id.as_deref().unwrap_or(""),
                shipment_reference.as_deref().unwrap_or("")
            ),
            status: status.to_owned(),
            source_dc_id: source_dc_id.clone(),
            destination_store_id: destination_store_id.clone(),
            shipment_reference: shipment_reference.clone(),
            epc: epc.clone(),
            // One SKU when both sides agree what the tag is, and nothing when
            // they do not — the disagreement is the finding, so the set is
            // carried beside it rather than one of the two being picked.
            sku_code: if sku_codes.len() == 1 {
                sku_codes.iter().next().cloned()
            } else {
                None
            },
            sku_codes: sku_codes.iter().cloned().collect(),
            in_transit_claim_count: identity.in_transit.len() as i64,
            received_claim_count: identity.received.len() as i64,
            attributed: status == "MATCHED" && attribution.is_some(),
            attribution: attribution.map(transfer_attribution_view),
            in_transit: identity.in_transit.first().map(transfer_evidence_view),
            received: identity.received.first().map(transfer_evidence_view),
            occurred_at,
        });
    }
    report.rows.sort_by(|left, right| {
        left.status
            .cmp(&right.status)
            .then_with(|| left.destination_store_id.cmp(&right.destination_store_id))
            .then_with(|| left.epc.cmp(&right.epc))
    });
    Ok(report)
}

// ── the transfer reconciliation list ─────────────────────────────────────
//
// The same envelope, narrowed in Rust rather than in SQL — and that is not a
// shortcut. A reconciliation row is not a row in any table: it is one identity
// (source, destination, shipment, tag) with every claim about it folded
// together, and the fold is what decides whether it is MATCHED or a CONFLICT.
// A `WHERE status='CONFLICT'` cannot be pushed below a status that does not
// exist until the fold has run. So the whole claim table is read, folded once,
// and the search, the filters, the sort and the page are applied to the
// result — which still means the caller receives a page rather than the fleet.

/// How many reconciliation rows the list returns when the caller does not say.
const RECONCILIATION_DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const RECONCILIATION_MAX_LIMIT: i64 = 1000;

/// What a caller is asking the reconciliation report for.
#[derive(Clone, Debug, Default)]
pub struct ReconciliationScope {
    /// Free text over the tag, the SKU code, the shipment reference and the
    /// two ends of the route.
    pub needle: Option<String>,
    /// `MATCHED`, `DC_ONLY`, `STORE_ONLY`, `UNRESOLVED` or `CONFLICT`.
    pub status: Option<String>,
    /// The destination shop. A store id — `store-01` — and stores are the one
    /// place the centre and the edge already spell the same.
    pub destination_store_id: Option<String>,
    /// The sending distribution centre, **as the claim records it**. An Edge
    /// node writes its own site id here — `dc-01` — where the centre's pool
    /// model says `dc`, so this filter takes the edge's spelling and the pool
    /// list's takes the centre's. They are different columns from different
    /// authorities and folding them into one name would make one of the two
    /// silently match nothing.
    pub source_dc_id: Option<String>,
    /// `status`, `destination`, `epc` or `occurred_at`. Anything unrecognised
    /// is the house order: by status, then destination, then tag.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// The allotment line a received claim was matched back to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TransferAttributionView {
    pub in_transit_event_id: Uuid,
    pub koli_id: Uuid,
    pub allotment_id: Uuid,
    pub allotment_line_id: Uuid,
    pub matched_at: DateTime<Utc>,
}

/// One side's claim about one piece of stock.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TransferEvidenceView {
    pub event_id: Uuid,
    /// Which Edge node said it — `dc-01-edge`, `store-01-edge`.
    pub origin_id: String,
    pub generation: i64,
    pub seq: i64,
    pub sku_code: String,
    pub quantity: i64,
    pub movement_group_id: Uuid,
    pub receipt_id: Option<Uuid>,
    pub occurred_at: DateTime<Utc>,
    pub attribution: Option<TransferAttributionView>,
}

/// One transfer identity, with both sides' claims folded together.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReconciliationRow {
    /// The identity, as one string: source, destination, shipment and tag.
    /// The keyset's tie-break, and stable across calls because it is the key
    /// the fold was done on.
    pub id: String,
    /// `MATCHED`, `DC_ONLY`, `STORE_ONLY`, `UNRESOLVED` or `CONFLICT`.
    pub status: String,
    pub source_dc_id: Option<String>,
    pub destination_store_id: String,
    pub shipment_reference: Option<String>,
    pub epc: String,
    /// `None` when the two sides do not agree what the tag is — which is
    /// itself the finding, and why the disagreeing set is carried beside it.
    pub sku_code: Option<String>,
    pub sku_codes: Vec<String>,
    pub in_transit_claim_count: i64,
    pub received_claim_count: i64,
    pub attributed: bool,
    pub attribution: Option<TransferAttributionView>,
    pub in_transit: Option<TransferEvidenceView>,
    pub received: Option<TransferEvidenceView>,
    /// When the transfer happened, as the earliest claim about it says.
    /// `None` for an identity with no dated claim at all.
    pub occurred_at: Option<DateTime<Utc>>,
}

/// How the whole report splits, before any filter.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReconciliationSummary {
    pub matched: i64,
    pub matched_attributed: i64,
    pub matched_unattributed: i64,
    pub dc_only: i64,
    pub store_only: i64,
    pub unresolved: i64,
    pub conflicts: i64,
}

/// What the reconciliation list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReconciliationFacets {
    pub statuses: Vec<InventoryFacet>,
    pub destinations: Vec<InventoryFacet>,
    /// Keyed by the SENDING NODE's own spelling — see
    /// [`ReconciliationScope::source_dc_id`].
    pub sources: Vec<InventoryFacet>,
}

/// A page of the reconciliation report.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReconciliationPage {
    pub as_of: DateTime<Utc>,
    /// The whole report's tallies, unaffected by the filters: certification
    /// turns on these, and a summary that moved when somebody ticked a filter
    /// would be a different claim about the fleet every time it was read.
    pub summary: ReconciliationSummary,
    pub rows: Vec<ReconciliationRow>,
    pub next_cursor: Option<String>,
    /// Every identity the search and the filters match.
    pub total: i64,
    pub facets: ReconciliationFacets,
}

#[derive(Serialize, Deserialize)]
struct ReconciliationCursor {
    row_id: String,
}

/// The transfer reconciliation report: searched, filtered, sorted and paged.
pub async fn reconciliations_page(
    pool: &PgPool,
    scope: ReconciliationScope,
) -> Result<ReconciliationPage, AppError> {
    let report = transfer_reconciliation_report(pool).await?;
    let summary = report.summary();

    // A blank search is not a search.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_lowercase);
    let searched: Vec<&ReconciliationRow> = report
        .rows
        .iter()
        .filter(|row| match needle.as_deref() {
            None => true,
            Some(text) => {
                let hit = |value: &str| value.to_lowercase().contains(text);
                hit(&row.epc)
                    || hit(&row.destination_store_id)
                    || row.sku_code.as_deref().is_some_and(hit)
                    || row.shipment_reference.as_deref().is_some_and(hit)
                    || row.source_dc_id.as_deref().is_some_and(hit)
            }
        })
        .collect();

    // Counted over the SEARCHED set, deliberately ignoring the filters already
    // applied, so a facet reads "how many of these there are" rather than "how
    // many survive what you already ticked".
    let mut facets = ReconciliationFacets {
        statuses: tally(&searched, |row| Some(row.status.clone())),
        destinations: tally(&searched, |row| Some(row.destination_store_id.clone())),
        sources: tally(&searched, |row| row.source_dc_id.clone()),
    };
    for list in [
        &mut facets.statuses,
        &mut facets.destinations,
        &mut facets.sources,
    ] {
        rank_facets(list);
    }

    let matches = |row: &ReconciliationRow| {
        scope
            .status
            .as_deref()
            .is_none_or(|want| row.status == want)
            && scope
                .destination_store_id
                .as_deref()
                .is_none_or(|want| row.destination_store_id == want)
            && scope
                .source_dc_id
                .as_deref()
                .is_none_or(|want| row.source_dc_id.as_deref() == Some(want))
    };
    let mut kept: Vec<ReconciliationRow> = searched
        .into_iter()
        .filter(|row| matches(row))
        .cloned()
        .collect();
    let total = kept.len() as i64;

    // Every order ends in the identity, which is the key the fold was done on
    // and therefore unique — the same guarantee a primary key gives the SQL
    // lists, so no two rows compare equal and the cursor cannot repeat or lose
    // the rows that tie.
    let key = |row: &ReconciliationRow| -> (String, String) {
        let lead = match scope.sort.as_deref() {
            Some("destination") => row.destination_store_id.clone(),
            Some("epc") => row.epc.clone(),
            Some("occurred_at") => row
                .occurred_at
                .map(|at| at.to_rfc3339())
                // An identity with no dated claim sorts to the front rather
                // than into a None the comparison cannot order — the same
                // reason the SQL lists carry a `-infinity` sentinel.
                .unwrap_or_default(),
            _ => row.status.clone(),
        };
        (lead, row.id.clone())
    };
    kept.sort_by(|left, right| {
        let ordering = key(left).cmp(&key(right));
        if scope.desc {
            ordering.reverse()
        } else {
            ordering
        }
    });

    let limit = scope
        .limit
        .unwrap_or(RECONCILIATION_DEFAULT_LIMIT)
        .clamp(1, RECONCILIATION_MAX_LIMIT) as usize;
    let start = match scope
        .cursor
        .as_deref()
        .map(super::decode_cursor::<ReconciliationCursor>)
        .transpose()?
    {
        // The seek re-reads the previous row's own place in THIS order rather
        // than trusting a position encoded in the cursor. A cursor whose row
        // the filters no longer keep finds nothing to seek past, and the list
        // ends rather than starting again — the safer of the two wrong
        // answers, because stopping is visible.
        Some(cursor) => match kept.iter().position(|row| row.id == cursor.row_id) {
            Some(at) => at + 1,
            None => kept.len(),
        },
        None => 0,
    };
    let rows: Vec<ReconciliationRow> = kept.into_iter().skip(start).take(limit).collect();
    let next_cursor = match rows.last() {
        Some(row) if rows.len() == limit && (start + limit) < total as usize => {
            Some(super::encode_cursor(&ReconciliationCursor {
                row_id: row.id.clone(),
            })?)
        }
        _ => None,
    };

    Ok(ReconciliationPage {
        as_of: Utc::now(),
        summary,
        rows,
        next_cursor,
        total,
        facets,
    })
}

/// How many rows carry each value of one field.
fn tally(
    rows: &[&ReconciliationRow],
    of: impl Fn(&ReconciliationRow) -> Option<String>,
) -> Vec<InventoryFacet> {
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for row in rows {
        if let Some(value) = of(row) {
            *counts.entry(value).or_default() += 1;
        }
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

/// Current inventory visible to Cloud, preserving each authority boundary.
/// Native ledger rows and Edge fact-derived positions share a display schema.
/// Snapshots are retained only as independently observed reconciliation
/// checkpoints and never provide current quantities or ownership authority.
pub async fn list_fleet_pools(
    pool: &PgPool,
    cloud_node_id: &str,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    let native = list_pools(pool, None, observed_hours, lost_days).await?;
    let mut items = native
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    // Ownership comes from the active inventory credential. Checkpoints may
    // be absent or stale, which affects certification but never hands the site
    // back to Cloud's native ledger.
    let owner_rows = sqlx::query(
        "SELECT credential.origin_id,credential.site_id,credential.node_role,
                credential.label,credential.active_generation,
                watermark.applied_seq AS fact_applied_seq,
                watermark.updated_at AS fact_applied_at,
                EXTRACT(EPOCH FROM (now()-watermark.updated_at))::double precision
                    AS fact_age_seconds,
                snapshot.generation AS checkpoint_generation,
                snapshot.seq AS checkpoint_seq,
                snapshot.captured_at AS checkpoint_captured_at,
                snapshot.applied_at AS checkpoint_applied_at,
                EXTRACT(EPOCH FROM (now()-snapshot.applied_at))::double precision
                    AS checkpoint_age_seconds,
                EXTRACT(EPOCH FROM (now()-snapshot.captured_at))::double precision
                    AS source_capture_age_seconds
         FROM sync_origin_credential credential
         LEFT JOIN sync_applied_watermark watermark
           ON watermark.origin_id=credential.origin_id
          AND watermark.generation=credential.active_generation
         LEFT JOIN edge_inventory_snapshot snapshot
           ON snapshot.origin_id=credential.origin_id
          AND snapshot.generation=credential.active_generation
          AND snapshot.site_id=credential.site_id
          AND snapshot.node_role=credential.node_role
         WHERE credential.inventory_enabled
         ORDER BY credential.origin_id",
    )
    .fetch_all(pool)
    .await?;
    let mut edge_owners = BTreeMap::<String, Value>::new();
    let mut active_edge_sites = BTreeMap::<String, String>::new();
    let mut stale_edge_origins = Vec::<String>::new();
    let mut missing_edge_origins = Vec::<String>::new();
    let mut unreported_edge_origins = Vec::<String>::new();
    for row in owner_rows {
        let origin_id: String = row.get("origin_id");
        let site_id: String = row.get("site_id");
        let role: String = row.get("node_role");
        let owner_label = row
            .get::<Option<String>, _>("label")
            .unwrap_or_else(|| format!("{role} {site_id}"));
        let checkpoint_generation = row.get::<Option<i64>, _>("checkpoint_generation");
        let checkpoint_age_seconds = row
            .get::<Option<f64>, _>("checkpoint_age_seconds")
            .map(|age| age.max(0.0));
        // A credential is a claim of ownership; an applied watermark is the
        // node having actually spoken. Only the second one is allowed to take
        // a site off the Cloud ledger.
        //
        // Registering an Edge node used to be enough to shadow the Cloud rows
        // for its site. A node that is provisioned but has never synced would
        // then contribute base pools of nought while the real balances sat on
        // Cloud rows excluded from the total — a store holding 600 pieces
        // reading 0, with no row on the screen saying so. Ownership is still
        // the credential's: what moved is only *when* it starts.
        let reported = row.get::<Option<i64>, _>("fact_applied_seq").is_some();
        if reported {
            active_edge_sites.insert(site_id.clone(), origin_id.clone());
        } else {
            unreported_edge_origins.push(origin_id.clone());
        }
        if checkpoint_generation.is_none() {
            missing_edge_origins.push(origin_id.clone());
        } else if checkpoint_age_seconds.is_some_and(|age| age > 300.0) {
            stale_edge_origins.push(origin_id.clone());
        }
        edge_owners.insert(
            origin_id.clone(),
            json!({
                "origin_id": origin_id,
                "site_id": site_id,
                "node_role": role,
                "owner_label": owner_label,
                "generation": row.get::<i64, _>("active_generation"),
                "seq": row.get::<Option<i64>, _>("fact_applied_seq"),
                "applied_at": row.get::<Option<DateTime<Utc>>, _>("fact_applied_at"),
                "age_seconds": row.get::<Option<f64>, _>("fact_age_seconds").map(|age| age.max(0.0)),
                "checkpoint_generation": checkpoint_generation,
                "checkpoint_seq": row.get::<Option<i64>, _>("checkpoint_seq"),
                "checkpoint_captured_at": row.get::<Option<DateTime<Utc>>, _>("checkpoint_captured_at"),
                "checkpoint_applied_at": row.get::<Option<DateTime<Utc>>, _>("checkpoint_applied_at"),
                "checkpoint_age_seconds": checkpoint_age_seconds,
                "source_capture_age_seconds": row
                    .get::<Option<f64>, _>("source_capture_age_seconds")
                    .map(|age| age.max(0.0)),
            }),
        );
    }

    // The centre's pool model has exactly one distribution centre and spells it
    // into the id literally — `dc.warehouse`. The Edge parameterises the same
    // grammar by the site it runs as — `dc-01.warehouse`. Stores never diverge,
    // which is why only the DC needs this.
    //
    // Shadowing matches on site id, so nothing ever matched for the DC: the
    // Cloud rows sat under `dc`, the Edge rows under `dc-01`, both were counted,
    // and the same warehouse went into the fleet total twice. The same
    // `dc.warehouse` reading 3.589 appeared as two rows on the screen, each
    // presented as authoritative.
    //
    // 0256 widened that gap rather than closing it: the Cloud rows now sit
    // under `ho` while the pools they name are still `dc.…` and the Edge is
    // still `dc-01`. Which is why the canonical name below is the SITE's and
    // the respelling further down uses the origin's own `runs_as`.
    //
    // Resolved the way `inventory_dc_owner_tx` already resolves it — the
    // canonical name belongs to the sole registered DC — and left unresolved
    // when there are several, because choosing which of two warehouses is "the"
    // DC is not a decision a read may make. That case is named in the
    // diagnostics rather than guessed at.
    let reported_dc_origins: Vec<(&String, &Value)> = edge_owners
        .iter()
        .filter(|(origin_id, owner)| {
            owner.get("node_role").and_then(Value::as_str) == Some("DC")
                && active_edge_sites
                    .values()
                    .any(|active| active == *origin_id)
        })
        .collect();
    let mut ambiguous_canonical_dc = Vec::<String>::new();
    match reported_dc_origins.as_slice() {
        [(origin_id, owner)] => {
            let runs_as = owner.get("site_id").and_then(Value::as_str).unwrap_or("");
            if runs_as != sync::CANONICAL_WAREHOUSE_SITE_ID {
                active_edge_sites
                    .insert(sync::CANONICAL_WAREHOUSE_SITE_ID.to_string(), (*origin_id).clone());
            }
        }
        several if several.len() > 1 => {
            ambiguous_canonical_dc = several
                .iter()
                .map(|(origin_id, _)| (*origin_id).clone())
                .collect();
        }
        _ => {}
    }

    // Where the Cloud rows end and the Edge rows begin. The shadowing pass
    // below needs both halves in hand, so it runs after the Edge read and
    // walks only this prefix.
    let cloud_row_count = items.len();

    let rows = sqlx::query(
        "WITH base_pool AS (
             SELECT credential.origin_id,credential.site_id||base.suffix AS pool_id
             FROM sync_origin_credential credential
             JOIN (VALUES
                 ('DC'::text,'.pending.unidentified'::text),
                 ('DC','.pending.untagged'),('DC','.warehouse'),('DC','.reject.dc'),
                 ('STORE','.warehouse'),('STORE','.floor'),('STORE','.reject')
             ) AS base(node_role,suffix)
               ON base.node_role=credential.node_role
             WHERE credential.inventory_enabled
         ), fact_balance AS (
             SELECT origin_id,
                    regexp_replace(place_id,':(on_hand|missing)$','') AS pool_id,
                    COALESCE(sum(quantity) FILTER (WHERE place_id LIKE '%:on_hand'),0)::bigint AS normal,
                    COALESCE(sum(quantity) FILTER (WHERE place_id LIKE '%:missing'),0)::bigint AS missing
             FROM edge_inventory_fact_position
             WHERE place_id ~ ':(on_hand|missing)$'
             GROUP BY origin_id,regexp_replace(place_id,':(on_hand|missing)$','')
         ), reservation AS (
             -- `source_pool_id` here is the CENTRE's spelling, copied off the
             -- authored `allotment_line` — `dc.warehouse`. Every other branch
             -- of `pool_scope` is the origin's own — `dc-01.warehouse` — so
             -- the prefix is swapped to match, or the reservation lands on a
             -- phantom row and the real warehouse reads Allotted 0. A no-op
             -- for every store, where the two names are already the same.
             --
             -- `accepted - picked - cancelled` was the fleet's own fourth
             -- spelling of the commitment, and it released at pick like the
             -- other three. What blocks a shelf is what still has to go into
             -- a carton, which is `to_pack_qty` out of the one view.
             SELECT commitment.origin_id,
                    regexp_replace(commitment.source_pool_id,'^[^.]+',credential.site_id) AS pool_id,
                    COALESCE(sum(commitment.to_pack_qty),0)::bigint AS allotted
             FROM allotment_line_commitment commitment
             JOIN sync_origin_credential credential
               ON credential.origin_id=commitment.origin_id
             GROUP BY commitment.origin_id,
                      regexp_replace(commitment.source_pool_id,'^[^.]+',credential.site_id)
         ), pool_scope AS (
             SELECT origin_id,pool_id FROM base_pool
             UNION SELECT origin_id,pool_id FROM fact_balance
             UNION SELECT origin_id,pool_id FROM reservation
         )
         SELECT credential.origin_id,credential.site_id,credential.node_role,
                credential.label,credential.active_generation,
                scope.pool_id,COALESCE(balance.normal,0)::bigint AS normal,
                COALESCE(balance.missing,0)::bigint AS missing,
                CASE WHEN credential.node_role='DC'
                     THEN COALESCE(reservation.allotted,0) ELSE NULL END::bigint AS allotted,
                watermark.applied_seq AS fact_applied_seq,
                watermark.updated_at AS fact_applied_at,
                EXTRACT(EPOCH FROM (now()-watermark.updated_at))::double precision
                    AS fact_age_seconds,
                snapshot.generation AS checkpoint_generation,
                snapshot.seq AS checkpoint_seq,
                snapshot.captured_at AS checkpoint_captured_at,
                snapshot.applied_at AS checkpoint_applied_at,
                EXTRACT(EPOCH FROM (now()-snapshot.applied_at))::double precision
                    AS checkpoint_age_seconds,
                EXTRACT(EPOCH FROM (now()-snapshot.captured_at))::double precision
                    AS source_capture_age_seconds
         FROM pool_scope scope
         JOIN sync_origin_credential credential
           ON credential.origin_id=scope.origin_id AND credential.inventory_enabled
         LEFT JOIN fact_balance balance
           ON balance.origin_id=scope.origin_id AND balance.pool_id=scope.pool_id
         LEFT JOIN reservation
           ON reservation.origin_id=scope.origin_id AND reservation.pool_id=scope.pool_id
         LEFT JOIN sync_applied_watermark watermark
           ON watermark.origin_id=credential.origin_id
          AND watermark.generation=credential.active_generation
         LEFT JOIN edge_inventory_snapshot snapshot
           ON snapshot.origin_id=credential.origin_id
          AND snapshot.generation=credential.active_generation
          AND snapshot.site_id=credential.site_id
          AND snapshot.node_role=credential.node_role
         ORDER BY credential.origin_id,scope.pool_id",
    )
    .fetch_all(pool)
    .await?;
    for row in rows {
        let pool_id: String = row.get("pool_id");
        let operational = EdgeOperationalPool::from_str(&pool_id).map_err(|error| {
            AppError::Conflict(format!("invalid fact-derived Edge pool {pool_id}: {error}"))
        })?;
        let (group, pool_code, base_label, display_order, outbound_stage) =
            edge_pool_metadata(&operational);
        let destination_store_id = operational.outbound_destination().map(ToString::to_string);
        let label = destination_store_id
            .as_ref()
            .map(|destination| format!("{base_label} · {destination}"))
            .unwrap_or_else(|| base_label.to_string());
        let origin_id: String = row.get("origin_id");
        let site_id: String = row.get("site_id");
        let role: String = row.get("node_role");
        if operational.site_id().as_str() != site_id {
            return Err(AppError::Conflict(format!(
                "fact-derived Edge pool {pool_id} does not belong to owner site {site_id}"
            )));
        }
        let fact_age_seconds = row
            .get::<Option<f64>, _>("fact_age_seconds")
            .map(|age| age.max(0.0));
        let checkpoint_age_seconds = row
            .get::<Option<f64>, _>("checkpoint_age_seconds")
            .map(|age| age.max(0.0));
        let source_capture_age_seconds = row
            .get::<Option<f64>, _>("source_capture_age_seconds")
            .map(|age| age.max(0.0));
        let owner_label = row
            .get::<Option<String>, _>("label")
            .unwrap_or_else(|| format!("{role} {site_id}"));
        let balance = InventoryBalance::project(
            row.get::<i64, _>("normal"),
            row.get::<Option<i64>, _>("allotted"),
            row.get::<i64, _>("missing"),
            0,
        )
        .map_err(|error| {
            AppError::Conflict(format!("invalid fact-derived Edge pool {pool_id}: {error}"))
        })?;
        let checkpoint_generation = row.get::<Option<i64>, _>("checkpoint_generation");
        let checkpoint_status = if checkpoint_generation.is_none() {
            "MISSING"
        } else if checkpoint_age_seconds.is_some_and(|age| age > 300.0) {
            "STALE"
        } else {
            "CURRENT"
        };
        let sync_status = if row.get::<Option<i64>, _>("fact_applied_seq").is_none() {
            "WAITING"
        } else if fact_age_seconds.is_some_and(|age| age > 300.0) {
            "STALE"
        } else {
            "CURRENT"
        };
        // The other half of the rule above. A node that has never reported does
        // not shadow its site's Cloud rows, so those are in the total — and
        // these base pools, which are nought because nothing has arrived rather
        // than because the shelf is empty, must stay out of it. Exactly one row
        // per pool is counted either way, which is the whole point of the pair.
        let counted = sync_status != "WAITING";
        items.push(json!({
            "id": pool_id,
            "site_id": site_id,
            "site_name": owner_label,
            "site_kind": role,
            "group": group,
            "pool_code": pool_code,
            "label": label,
            "store_origin_site_id": Value::Null,
            "display_order": display_order,
            "is_rollup": false,
            "is_outbound_leaf": outbound_stage.is_some(),
            "outbound_stage": outbound_stage,
            "destination_store_id": destination_store_id,
            "stock": balance.stock.value(),
            "allotted": balance.allotted.map(|quantity| quantity.value()),
            "on_hand": balance.on_hand.value(),
            "missing": balance.missing.value(),
            "observed": Value::Null,
            "lost_rate": Value::Null,
            "lost_quantity": Value::Null,
            "exposure": Value::Null,
            "origin_id": origin_id,
            "origin_role": role,
            "owner_label": owner_label,
            "source_type": "EDGE_FACT_POSITION",
            "fact_generation": row.get::<i64, _>("active_generation"),
            "fact_applied_seq": row.get::<Option<i64>, _>("fact_applied_seq"),
            "snapshot_generation": checkpoint_generation,
            "snapshot_seq": row.get::<Option<i64>, _>("checkpoint_seq"),
            "checkpoint_captured_at": row.get::<Option<DateTime<Utc>>, _>("checkpoint_captured_at"),
            "checkpoint_applied_at": row.get::<Option<DateTime<Utc>>, _>("checkpoint_applied_at"),
            "checkpoint_age_seconds": checkpoint_age_seconds,
            "checkpoint_status": checkpoint_status,
            // Compatibility aliases: capture fields still describe the latest
            // checkpoint; sync-applied fields describe fact projection progress.
            "sync_captured_at": row.get::<Option<DateTime<Utc>>, _>("checkpoint_captured_at"),
            "sync_applied_at": row.get::<Option<DateTime<Utc>>, _>("fact_applied_at"),
            "sync_age_seconds": fact_age_seconds,
            "source_capture_age_seconds": source_capture_age_seconds,
            "sync_status": sync_status,
            "authority": {
                "owner_site_id": site_id,
                "owner_origin_id": origin_id,
                "owner_role": role,
                "source": "EDGE_FACT_POSITION",
                "write_policy": "OWNER_NODE_ONLY",
                "cloud_writable": false,
                "included_in_fleet_total": counted,
                "shadowed_by_origin_id": Value::Null,
                "derived": false,
            },
        }));
    }

    // Every pool an Edge origin actually emits, in that origin's own spelling.
    //
    // Shadowing is decided against this rather than against the site, because
    // owning a site is not the same as modelling every shelf in it. The DC Edge
    // emits four base pools; the centre additionally splits outbound into a row
    // per destination store — `dc.outbound.picked.store-01` and its dozen
    // siblings — which the Edge has no spelling for at all. Shadowing the whole
    // site therefore deleted 539 pieces of outbound stock and replaced them with
    // nothing, which is the same defect as the one below in the other
    // direction: a number vanishing because of who owns it rather than because
    // of what is on the shelf.
    //
    // A Cloud row is shadowed only where the Edge has a row for that exact pool.
    // Everywhere else the centre's ledger is still the only account of it.
    let edge_pool_rows: std::collections::BTreeSet<(String, String)> = items
        .iter()
        .skip(cloud_row_count)
        .filter_map(|item| {
            Some((
                item.get("origin_id").and_then(Value::as_str)?.to_string(),
                item.get("id").and_then(Value::as_str)?.to_string(),
            ))
        })
        .collect();

    let mut shadowed_cloud_sites = std::collections::BTreeSet::<String>::new();
    for item in items.iter_mut().take(cloud_row_count) {
        if let Some(object) = item.as_object_mut() {
            let site_id = object
                .get("site_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let pool_id = object
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let is_rollup = object
                .get("is_rollup")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            // The owner, then the shelf. `pool_id_for_site` respells the
            // centre's `dc.warehouse` as the origin's own `dc-01.warehouse`; a
            // no-op for every store, where the two names already agree.
            let shadowed_by = active_edge_sites
                .get(&site_id)
                .filter(|origin_id| {
                    let runs_as = edge_owners
                        .get(*origin_id)
                        .and_then(|owner| owner.get("site_id"))
                        .and_then(Value::as_str)
                        .unwrap_or(site_id.as_str());
                    edge_pool_rows.contains(&(
                        (*origin_id).clone(),
                        sync::pool_id_for_site(&pool_id, runs_as),
                    ))
                })
                .cloned();
            if shadowed_by.is_some() {
                shadowed_cloud_sites.insert(site_id.clone());
            }
            let included = !is_rollup && shadowed_by.is_none();
            let cloud_writable = included;
            let write_policy = if is_rollup {
                "DERIVED_READ_ONLY"
            } else if shadowed_by.is_some() {
                "SHADOWED_READ_ONLY"
            } else {
                "CLOUD_WRITABLE"
            };
            object.insert("origin_id".into(), json!(cloud_node_id));
            object.insert("origin_role".into(), json!("CLOUD"));
            object.insert("owner_label".into(), json!("Cloud native ledger"));
            object.insert("source_type".into(), json!("CLOUD_LEDGER"));
            object.insert("fact_generation".into(), Value::Null);
            object.insert("fact_applied_seq".into(), Value::Null);
            object.insert("snapshot_generation".into(), Value::Null);
            object.insert("snapshot_seq".into(), Value::Null);
            object.insert("checkpoint_captured_at".into(), Value::Null);
            object.insert("checkpoint_applied_at".into(), Value::Null);
            object.insert("checkpoint_age_seconds".into(), Value::Null);
            object.insert("checkpoint_status".into(), Value::Null);
            object.insert("sync_captured_at".into(), Value::Null);
            object.insert("sync_applied_at".into(), Value::Null);
            object.insert("sync_age_seconds".into(), Value::Null);
            object.insert("source_capture_age_seconds".into(), Value::Null);
            object.insert("sync_status".into(), json!("LOCAL"));
            object.insert(
                "authority".into(),
                json!({
                    "owner_site_id": site_id,
                    "owner_origin_id": cloud_node_id,
                    "owner_role": "CLOUD",
                    "source": "CLOUD_LEDGER",
                    "write_policy": write_policy,
                    "cloud_writable": cloud_writable,
                    "included_in_fleet_total": included,
                    "shadowed_by_origin_id": shadowed_by,
                    "derived": is_rollup,
                }),
            );
        }
    }

    // Rollups are derived from fact-position leaves and never selected into
    // the authoritative fleet total themselves.
    for (origin_id, owner) in edge_owners
        .iter()
        .filter(|(_, owner)| owner.get("node_role").and_then(Value::as_str) == Some("DC"))
    {
        for (stage, label, slug, display_order) in [
            ("PICKED", "Picked", "picked", 40),
            ("PACKED", "Packed", "packed", 50),
            ("SHIPMENT", "Shipment", "shipment", 60),
            ("LOADED", "Loaded", "loaded", 70),
            ("IN_TRANSIT", "In Transit", "in-transit", 80),
        ] {
            let leaves = items.iter().filter(|item| {
                item.get("source_type").and_then(Value::as_str) == Some("EDGE_FACT_POSITION")
                    && item.get("origin_id").and_then(Value::as_str) == Some(origin_id.as_str())
                    && item.get("is_outbound_leaf").and_then(Value::as_bool) == Some(true)
                    && item.get("outbound_stage").and_then(Value::as_str) == Some(stage)
            });
            let (stock, on_hand, missing) = leaves.fold((0_i64, 0_i64, 0_i64), |total, item| {
                (
                    total.0 + item.get("stock").and_then(Value::as_i64).unwrap_or(0),
                    total.1 + item.get("on_hand").and_then(Value::as_i64).unwrap_or(0),
                    total.2 + item.get("missing").and_then(Value::as_i64).unwrap_or(0),
                )
            });
            let site_id = owner.get("site_id").and_then(Value::as_str).unwrap_or("");
            let fact_age = owner.get("age_seconds").and_then(Value::as_f64);
            let checkpoint_age = owner.get("checkpoint_age_seconds").and_then(Value::as_f64);
            let checkpoint_generation = owner
                .get("checkpoint_generation")
                .cloned()
                .unwrap_or(Value::Null);
            items.push(json!({
                "id": format!("{site_id}.outbound.{slug}"),
                "site_id": site_id,
                "site_name": owner.get("owner_label").cloned().unwrap_or(Value::Null),
                "site_kind": "DC",
                "group": "OUTBOUND",
                "pool_code": stage,
                "label": label,
                "store_origin_site_id": Value::Null,
                "display_order": display_order,
                "is_rollup": true,
                "is_outbound_leaf": false,
                "outbound_stage": stage,
                "destination_store_id": Value::Null,
                "stock": stock,
                "allotted": Value::Null,
                "on_hand": on_hand,
                "missing": missing,
                "observed": Value::Null,
                "lost_rate": Value::Null,
                "lost_quantity": Value::Null,
                "exposure": Value::Null,
                "origin_id": origin_id,
                "origin_role": "DC",
                "owner_label": owner.get("owner_label").cloned().unwrap_or(Value::Null),
                "source_type": "EDGE_FACT_POSITION",
                "fact_generation": owner.get("generation").cloned().unwrap_or(Value::Null),
                "fact_applied_seq": owner.get("seq").cloned().unwrap_or(Value::Null),
                "snapshot_generation": checkpoint_generation,
                "snapshot_seq": owner.get("checkpoint_seq").cloned().unwrap_or(Value::Null),
                "checkpoint_captured_at": owner.get("checkpoint_captured_at").cloned().unwrap_or(Value::Null),
                "checkpoint_applied_at": owner.get("checkpoint_applied_at").cloned().unwrap_or(Value::Null),
                "checkpoint_age_seconds": owner.get("checkpoint_age_seconds").cloned().unwrap_or(Value::Null),
                "checkpoint_status": if checkpoint_generation.is_null() { "MISSING" } else if checkpoint_age.is_some_and(|age| age > 300.0) { "STALE" } else { "CURRENT" },
                "sync_captured_at": owner.get("checkpoint_captured_at").cloned().unwrap_or(Value::Null),
                "sync_applied_at": owner.get("applied_at").cloned().unwrap_or(Value::Null),
                "sync_age_seconds": owner.get("age_seconds").cloned().unwrap_or(Value::Null),
                "source_capture_age_seconds": owner.get("source_capture_age_seconds").cloned().unwrap_or(Value::Null),
                "sync_status": if owner.get("seq").is_none_or(Value::is_null) { "WAITING" } else if fact_age.is_some_and(|age| age > 300.0) { "STALE" } else { "CURRENT" },
                "authority": {
                    "owner_site_id": site_id,
                    "owner_origin_id": origin_id,
                    "owner_role": "DC",
                    "source": "EDGE_FACT_POSITION",
                    "write_policy": "DERIVED_READ_ONLY",
                    "cloud_writable": false,
                    "included_in_fleet_total": false,
                    "shadowed_by_origin_id": Value::Null,
                    "derived": true,
                },
            }));
        }
    }

    let mut base_stock_before_overlap = 0_i64;
    let mut included_row_count = 0_i64;
    let mut excluded_rollup_count = 0_i64;
    let mut route_in_transit = BTreeMap::<(String, String), i64>::new();
    for item in &items {
        if item.get("is_rollup").and_then(Value::as_bool) == Some(true) {
            excluded_rollup_count += 1;
        }
        let included = item
            .pointer("/authority/included_in_fleet_total")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !included {
            continue;
        }
        let stock = item.get("stock").and_then(Value::as_i64).unwrap_or(0);
        base_stock_before_overlap = base_stock_before_overlap
            .checked_add(stock)
            .ok_or_else(|| AppError::Conflict("fleet stock total overflow".into()))?;
        included_row_count += 1;
        if item.get("outbound_stage").and_then(Value::as_str) == Some("IN_TRANSIT") {
            if let (Some(source), Some(destination)) = (
                item.get("site_id").and_then(Value::as_str),
                item.get("destination_store_id").and_then(Value::as_str),
            ) {
                let route = (source.to_string(), destination.to_string());
                let current = route_in_transit.entry(route).or_default();
                *current = current
                    .checked_add(stock)
                    .ok_or_else(|| AppError::Conflict("route stock total overflow".into()))?;
            }
        }
    }

    let reconciliation = transfer_reconciliation_report(pool).await?;
    let mut overlap_deduction = 0_i64;
    let mut route_diagnostics = Vec::new();
    for ((source_dc_id, destination_store_id), matched) in &reconciliation.matched_by_route {
        let route = (source_dc_id.clone(), destination_store_id.clone());
        let current = route_in_transit.get(&route).copied().unwrap_or(0);
        let deducted = (*matched).min(current);
        overlap_deduction = overlap_deduction
            .checked_add(deducted)
            .ok_or_else(|| AppError::Conflict("fleet overlap deduction overflow".into()))?;
        route_diagnostics.push(json!({
            "source_dc_id": source_dc_id,
            "destination_store_id": destination_store_id,
            "matched_received_quantity": matched,
            "current_in_transit_stock": current,
            "deducted_quantity": deducted,
            "capped": matched > &current,
        }));
    }
    let calculated_total = base_stock_before_overlap
        .checked_sub(overlap_deduction)
        .ok_or_else(|| AppError::Conflict("fleet overlap exceeds selected stock".into()))?;
    let mut certification_reasons = Vec::<String>::new();
    if !stale_edge_origins.is_empty() {
        certification_reasons.push("STALE_EDGE_CHECKPOINT".into());
    }
    if !missing_edge_origins.is_empty() {
        certification_reasons.push("MISSING_EDGE_CHECKPOINT".into());
    }
    if reconciliation.prevents_certification() {
        certification_reasons.push("UNRESOLVED_STORE_RECEIPT_EVIDENCE".into());
    }
    let certified = certification_reasons.is_empty();
    let fleet_total = if certified {
        json!(calculated_total)
    } else {
        Value::Null
    };

    Ok(json!({
        "as_of": Utc::now(),
        "read_only": false,
        "observed_window_hours": observed_hours,
        "lost_risk_window_days": lost_days,
        "inventory_equation": "Stock = On Hand + Allotted + Missing",
        "aggregation_policy": "Exact-site Edge fact positions shadow Cloud rows once that origin has applied a fact; an Edge origin that has never reported shadows nothing and its own base pools are excluded; rollups are excluded; snapshots are reconciliation checkpoints; matched Store receipts deduct capped DC In Transit overlap",
        "fleet_total": fleet_total,
        "fleet_total_status": if certified { "CERTIFIED" } else { "UNCERTIFIED" },
        "reconciliation_summary": serde_json::to_value(reconciliation.summary())?,
        "fleet_total_diagnostics": {
            "base_stock_before_overlap": base_stock_before_overlap,
            "overlap_deduction": overlap_deduction,
            "calculated_total": calculated_total,
            "included_row_count": included_row_count,
            "excluded_rollup_count": excluded_rollup_count,
            "shadowed_cloud_site_ids": shadowed_cloud_sites,
            "stale_edge_origins": stale_edge_origins,
            "missing_edge_origins": missing_edge_origins,
            // Registered, inventory-enabled, and never once heard from. These
            // shadow nothing — their site's Cloud rows carry the total — and
            // their own base pools are excluded. Named separately from
            // `missing_edge_origins`, which is about a missing *checkpoint*: a
            // node can be projecting facts every minute and still owe one.
            "unreported_edge_origins": unreported_edge_origins,
            // Non-empty only when several DC origins have reported, which the
            // centre's single-DC pool model has no spelling for. While this is
            // set the Cloud `dc` rows are NOT shadowed and the fleet total
            // double-counts that warehouse — named here rather than guessed at.
            "ambiguous_canonical_dc_origins": ambiguous_canonical_dc,
            "certification_reasons": certification_reasons,
            "routes": route_diagnostics,
        },
        "items": items,
    }))
}

pub async fn get_pool(
    pool: &PgPool,
    pool_id: &str,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    let exists = sqlx::query("SELECT 1 FROM operational_pool WHERE id=$1 AND active")
        .bind(pool_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("operational pool".into()));
    }
    let summary = list_pools(pool, None, observed_hours, lost_days).await?;
    let row = summary
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|v| v.get("id").and_then(Value::as_str) == Some(pool_id))
        })
        .cloned()
        .ok_or_else(|| AppError::NotFound("operational pool".into()))?;
    let item_rows = sqlx::query("SELECT p.subject_id,s.subject_type,s.epc,s.barcode,s.quantity subject_quantity,p.quantity,sk.sku_code,a.article_code,a.name FROM inventory_projection p JOIN inventory_subject s ON s.id=p.subject_id LEFT JOIN sku sk ON sk.id=s.sku_id LEFT JOIN article a ON a.id=sk.article_id WHERE p.place_id=$1||':on_hand' ORDER BY s.epc NULLS LAST LIMIT 200")
        .bind(pool_id).fetch_all(pool).await?;
    let items: Vec<Value> = item_rows.into_iter().map(|r| json!({"subject_id":r.get::<Uuid,_>("subject_id"),"subject_type":r.get::<String,_>("subject_type"),"epc":r.get::<Option<String>,_>("epc"),"barcode":r.get::<Option<String>,_>("barcode"),"quantity":r.get::<i64,_>("quantity"),"sku_code":r.get::<Option<String>,_>("sku_code"),"article_code":r.get::<Option<String>,_>("article_code"),"article_name":r.get::<Option<String>,_>("name")})).collect();
    let missing = list_missing_for_pool(pool, Some(pool_id), 200).await?;
    let observations = crate::cloud::postgres::sightings_for_pool(pool, Some(pool_id), 100).await?;
    let movements = crate::cloud::postgres::movements_page(
        pool,
        crate::cloud::postgres::MovementScope {
            pool_id: Some(pool_id.into()),
            limit: Some(100),
            // This read takes the rows and throws the envelope away, so the
            // count would be a whole-ledger scan nobody reads.
            count: false,
            ..crate::cloud::postgres::MovementScope::default()
        },
    )
    .await?;
    let count_rows = sqlx::query("SELECT id,kind,status,reason,created_at,activated_at,submitted_at,closed_at FROM official_count WHERE pool_id=$1 ORDER BY created_at DESC LIMIT 20")
        .bind(pool_id).fetch_all(pool).await?;
    let counts: Vec<Value> = count_rows.into_iter().map(|r| json!({"id":r.get::<Uuid,_>("id"),"kind":r.get::<String,_>("kind"),"status":r.get::<String,_>("status"),"reason":r.get::<String,_>("reason"),"created_at":r.get::<DateTime<Utc>,_>("created_at"),"activated_at":r.get::<Option<DateTime<Utc>>,_>("activated_at"),"submitted_at":r.get::<Option<DateTime<Utc>>,_>("submitted_at"),"closed_at":r.get::<Option<DateTime<Utc>>,_>("closed_at")})).collect();
    Ok(
        json!({"summary":row,"items":items,"missing":serde_json::to_value(&missing)?,"observations":serde_json::to_value(&observations)?,"movements":serde_json::to_value(&movements.rows)?,"counts":counts}),
    )
}

/// The same pool rows, folded to a moment in the past.
///
/// Narrowed by the SERVER now. It used to fold the ledger for all hundred and
/// twelve pools, serialise them, and then drop every row but one in Rust — a
/// screen asking about a single shelf was answered with the whole fleet and
/// told to look away.
pub async fn inventory_as_of(
    pool: &PgPool,
    query: AsOfQuery,
    observed_hours: i64,
    lost_days: i64,
) -> Result<PoolPage, AppError> {
    pools_page(
        pool,
        PoolScope {
            at: Some(query.at),
            site_id: query.site_id,
            pool_id: query.pool_id,
            // The same envelope the pool list answers with, counted the same
            // way: this route serialises `total` and `facets`, so a caller
            // reading one gets a number and not a silence.
            count: true,
            ..PoolScope::default()
        },
        observed_hours,
        lost_days,
    )
    .await
}

/// How many missing subjects the list returns when the caller does not say.
const MISSING_DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const MISSING_MAX_LIMIT: i64 = 1000;

/// What a caller is asking the missing list for.
#[derive(Clone, Debug, Default)]
pub struct MissingScope {
    /// Free text over the tag, the barcode, the SKU code, the pool id and the
    /// pool's label — the four things the screen's search box says it covers.
    pub needle: Option<String>,
    /// The CENTRE's pool id — `dc.warehouse`, `store-01.floor`. This list is
    /// read out of the centre's own projection, so its ids are the centre's;
    /// a caller holding an Edge node's spelling (`dc-01.warehouse`) matches
    /// nothing here, and silently.
    pub pool_id: Option<String>,
    pub site_id: Option<String>,
    /// `COUNTED` or `NEVER` — whether any official count has ever had this
    /// subject in its snapshot. See [`MissingRow::latest_count_id`].
    pub counted: Option<String>,
    /// `missing_since`, `quantity`, `pool`, `last_observation` or `epc`.
    /// Anything unrecognised is the house order.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// One subject the ledger has moved out of sight.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MissingRow {
    /// `subject_uuid@pool_id`. The resolution routes parse it back, so it is a
    /// key and not a display string.
    pub id: String,
    pub subject_id: Uuid,
    pub subject_type: String,
    pub epc: Option<String>,
    pub barcode: Option<String>,
    pub sku_code: Option<String>,
    pub quantity: i64,
    pub site_id: String,
    pub origin_pool: String,
    pub pool_label: String,
    /// When it first went missing. `None` where no movement into the missing
    /// place can be found — an adjustment posted straight into the projection,
    /// which is a row worth seeing rather than hiding.
    pub missing_since: Option<DateTime<Utc>>,
    /// Hours since then, and `None` for the same reason. Not zero: "missing
    /// for no time at all" and "nobody knows since when" are different
    /// answers.
    pub age_hours: Option<i64>,
    pub last_observation: Option<DateTime<Utc>>,
    /// The last official count this subject appeared in, and **`None` when it
    /// has never been in one**. Most of them never have.
    pub latest_count_id: Option<Uuid>,
    pub latest_count_status: Option<String>,
    pub status: String,
}

/// What the missing list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MissingFacets {
    pub pools: Vec<InventoryFacet>,
    pub sites: Vec<InventoryFacet>,
    /// `COUNTED` and `NEVER` — how many of these have ever been looked for.
    pub counted: Vec<InventoryFacet>,
}

/// A page of what cannot be found, and the shape of the whole of it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MissingPage {
    pub rows: Vec<MissingRow>,
    pub next_cursor: Option<String>,
    /// Every missing subject the search and the filters match, which is what a
    /// screen saying "41 open" has to be counting. The old read said "500" the
    /// moment there were five hundred and one.
    pub total: i64,
    pub facets: MissingFacets,
}

#[derive(Serialize, Deserialize)]
struct MissingCursor {
    row_id: String,
}

/// One missing row, defined once — for the page and for the facets.
///
/// Binds: `$1` the search pattern or NULL.
///
/// `since_key` and `seen_key` are the sentinel trick the rest of this file
/// uses and for the same reason: `missing_since` is nullable, a row comparison
/// against NULL is NULL rather than true, and a keyset that meets one would
/// stop there with the rest of the list below the fold. `-infinity` puts the
/// unknown-since rows first in ascending order, which is exactly where the old
/// `NULLS FIRST` put them — except that this one a `WHERE` can seek against.
const MISSING_ROWS: &str = r#"
SELECT pr.subject_id,ip.pool_id,pr.quantity,s.subject_type,s.epc,s.barcode,sk.sku_code,
       op.site_id,op.label,
       first_missing.occurred_at missing_since,last_obs.last_seen_at,
       last_count.id latest_count_id,last_count.status latest_count_status,
       pr.subject_id::text||'@'||ip.pool_id row_id,
       COALESCE(first_missing.occurred_at,TIMESTAMPTZ '-infinity') since_key,
       COALESCE(last_obs.last_seen_at,TIMESTAMPTZ '-infinity') seen_key,
       COALESCE(s.epc,'') epc_key,
       CASE WHEN last_count.id IS NULL THEN 'NEVER' ELSE 'COUNTED' END counted_state
FROM inventory_projection pr JOIN inventory_place ip ON ip.id=pr.place_id AND ip.state='MISSING'
JOIN operational_pool op ON op.id=ip.pool_id JOIN inventory_subject s ON s.id=pr.subject_id LEFT JOIN sku sk ON sk.id=s.sku_id
LEFT JOIN LATERAL (SELECT occurred_at FROM movement WHERE subject_id=pr.subject_id AND to_place_id=pr.place_id ORDER BY occurred_at ASC LIMIT 1) first_missing ON TRUE
LEFT JOIN LATERAL (SELECT last_seen_at FROM observation_sighting WHERE subject_id=pr.subject_id ORDER BY last_seen_at DESC LIMIT 1) last_obs ON TRUE
LEFT JOIN LATERAL (SELECT c.id,c.status FROM official_count c JOIN count_snapshot cs ON cs.count_id=c.id WHERE cs.subject_id=pr.subject_id ORDER BY c.created_at DESC LIMIT 1) last_count ON TRUE
WHERE ($1::text IS NULL OR s.epc ILIKE $1 OR s.barcode ILIKE $1
       OR sk.sku_code ILIKE $1 OR ip.pool_id ILIKE $1 OR op.label ILIKE $1)
"#;

/// The missing list's filters, spelled once for the page and for the facets.
const MISSING_FILTERS: &str = "
     WHERE ($2::text IS NULL OR pool_id=$2)
       AND ($3::text IS NULL OR site_id=$3)
       AND ($4::text IS NULL OR counted_state=$4)
";

fn missing_row_from(
    row: &sqlx::postgres::PgRow,
    now: DateTime<Utc>,
) -> Result<MissingRow, AppError> {
    let since: Option<DateTime<Utc>> = row.try_get("missing_since")?;
    Ok(MissingRow {
        id: row.try_get("row_id")?,
        subject_id: row.try_get("subject_id")?,
        subject_type: row.try_get("subject_type")?,
        epc: row.try_get("epc")?,
        barcode: row.try_get("barcode")?,
        sku_code: row.try_get("sku_code")?,
        quantity: row.try_get("quantity")?,
        site_id: row.try_get("site_id")?,
        origin_pool: row.try_get("pool_id")?,
        pool_label: row.try_get("label")?,
        missing_since: since,
        age_hours: since.map(|at| (now - at).num_hours()),
        last_observation: row.try_get("last_seen_at")?,
        latest_count_id: row.try_get("latest_count_id")?,
        latest_count_status: row.try_get("latest_count_status")?,
        status: "MISSING".into(),
    })
}

/// What cannot be found, in the shape the routes that predate the envelope
/// still read it. The envelope is [`missing_page`].
pub async fn list_missing(pool: &PgPool) -> Result<Value, AppError> {
    let page = missing_page(
        pool,
        MissingScope {
            limit: Some(MISSING_MAX_LIMIT),
            ..MissingScope::default()
        },
    )
    .await?;
    Ok(json!({"items": serde_json::to_value(&page.rows)?}))
}

async fn list_missing_for_pool(
    pool: &PgPool,
    pool_id: Option<&str>,
    limit: i64,
) -> Result<Vec<MissingRow>, AppError> {
    Ok(missing_page(
        pool,
        MissingScope {
            pool_id: pool_id.map(ToOwned::to_owned),
            limit: Some(limit),
            ..MissingScope::default()
        },
    )
    .await?
    .rows)
}

/// What cannot be found: searched, filtered, sorted and paged by the server.
pub async fn missing_page(pool: &PgPool, scope: MissingScope) -> Result<MissingPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let limit = scope
        .limit
        .unwrap_or(MISSING_DEFAULT_LIMIT)
        .clamp(1, MISSING_MAX_LIMIT);
    let cursor = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor::<MissingCursor>)
        .transpose()?;

    // Every order ends in `row_id`, which is the subject and the pool it went
    // missing from — the same pair the projection is keyed by, so no two rows
    // can compare equal.
    let lead = match scope.sort.as_deref() {
        Some("quantity") => "quantity",
        Some("pool") => "pool_id",
        Some("last_observation") => "seen_key",
        Some("epc") => "epc_key",
        _ => "since_key",
    };
    let (cols, order) = super::order_by(lead, "row_id", scope.desc);
    let seek = if scope.desc { "<" } else { ">" };

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({MISSING_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {MISSING_FILTERS}
         )
         SELECT * FROM kept
          WHERE $5::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE row_id = $5)
          ORDER BY {order}
          LIMIT $6"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&scope.pool_id)
        .bind(&scope.site_id)
        .bind(&scope.counted)
        .bind(cursor.as_ref().map(|c| c.row_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let now = Utc::now();
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&MissingCursor {
            row_id: row.try_get("row_id")?,
        })?),
        _ => None,
    };
    let out = rows
        .iter()
        .map(|row| missing_row_from(row, now))
        .collect::<Result<Vec<_>, AppError>>()?;

    let (total, facets) = missing_facets(pool, &scope, needle.as_deref()).await?;
    Ok(MissingPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// How much is missing, and where from.
///
/// Per-value counts read the SEARCHED set and the total reads the FILTERED
/// one, for the reason `pool_facets` gives.
async fn missing_facets(
    pool: &PgPool,
    scope: &MissingScope,
    needle: Option<&str>,
) -> Result<(i64, MissingFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({MISSING_ROWS}), kept AS (
             SELECT * FROM searched {MISSING_FILTERS}
         )
         SELECT 'pool' AS kind, pool_id AS value, label AS l, COUNT(*)::bigint AS n
           FROM searched GROUP BY pool_id, label
          UNION ALL
         SELECT 'site', site_id, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY site_id
          UNION ALL
         SELECT 'counted', counted_state, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY counted_state
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&scope.pool_id)
        .bind(&scope.site_id)
        .bind(&scope.counted)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = MissingFacets {
        pools: Vec::new(),
        sites: Vec::new(),
        counted: Vec::new(),
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let facet = InventoryFacet {
            value: row.try_get("value")?,
            label: row.try_get("l")?,
            count: row.try_get("n")?,
        };
        match kind.as_str() {
            "pool" => facets.pools.push(facet),
            "site" => facets.sites.push(facet),
            "counted" => facets.counted.push(facet),
            _ => total = facet.count,
        }
    }
    for list in [&mut facets.pools, &mut facets.sites, &mut facets.counted] {
        rank_facets(list);
    }
    Ok((total, facets))
}

async fn missing_quantity(pool: &PgPool, subject_id: Uuid, pool_id: &str) -> Result<i64, AppError> {
    let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN to_place_id=$2 THEN quantity WHEN from_place_id=$2 THEN -quantity ELSE 0 END),0)::bigint balance FROM movement WHERE subject_id=$1 AND (from_place_id=$2 OR to_place_id=$2)")
        .bind(subject_id).bind(format!("{pool_id}:missing")).fetch_one(pool).await?;
    let balance: i64 = row.get("balance");
    if balance <= 0 {
        return Err(AppError::NotFound("current missing inventory".into()));
    }
    Ok(balance)
}

pub async fn resolve_missing_found(
    pool: &PgPool,
    missing_id: &str,
    request: MissingResolutionRequest,
) -> Result<Value, AppError> {
    let (subject_id, origin_pool) = parse_missing_id(missing_id)?;
    let available = missing_quantity(pool, subject_id, &origin_pool).await?;
    let quantity = request.quantity.unwrap_or(available);
    let destination = request
        .destination_pool_id
        .clone()
        .unwrap_or_else(|| origin_pool.clone());
    OperationalPool::from_str(&destination).map_err(|e| AppError::Validation(e.to_string()))?;
    create_movement(
        pool,
        movement_request_for_resolution(
            request,
            subject_id,
            quantity,
            format!("{origin_pool}:missing"),
            format!("{destination}:on_hand"),
            "FOUND",
        ),
    )
    .await
}

pub async fn resolve_missing_lost(
    pool: &PgPool,
    missing_id: &str,
    request: MissingResolutionRequest,
) -> Result<Value, AppError> {
    let (subject_id, origin_pool) = parse_missing_id(missing_id)?;
    let available = missing_quantity(pool, subject_id, &origin_pool).await?;
    let quantity = request.quantity.unwrap_or(available);
    create_movement(
        pool,
        movement_request_for_resolution(
            request,
            subject_id,
            quantity,
            format!("{origin_pool}:missing"),
            "system/lost".into(),
            "CONFIRMED_LOST",
        ),
    )
    .await
}

pub async fn resolve_missing_dispose(
    pool: &PgPool,
    missing_id: &str,
    request: MissingResolutionRequest,
) -> Result<Value, AppError> {
    let (subject_id, origin_pool) = parse_missing_id(missing_id)?;
    let available = missing_quantity(pool, subject_id, &origin_pool).await?;
    let quantity = request.quantity.unwrap_or(available);
    create_movement(
        pool,
        movement_request_for_resolution(
            request,
            subject_id,
            quantity,
            format!("{origin_pool}:missing"),
            "external/disposal".into(),
            "DISPOSAL",
        ),
    )
    .await
}
