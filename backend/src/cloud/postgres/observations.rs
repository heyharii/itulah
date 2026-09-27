use super::{begin_idempotent, complete_idempotent, payload_digest, rank_facets, InventoryFacet};
use crate::cloud::{
    application::{AppError, ObservationBatchRequest},
    domain::{belongs_to_same_burst, consolidate_reads, OperationalPool, SiteId},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{collections::HashMap, str::FromStr};
use uuid::Uuid;

pub async fn ingest_observations(
    pool: &PgPool,
    request: ObservationBatchRequest,
    burst_window_seconds: i64,
) -> Result<Value, AppError> {
    if request.observations.is_empty() {
        return Err(AppError::Validation(
            "observations batch cannot be empty".into(),
        ));
    }
    if request.device_id.trim().is_empty() || request.reader_session_id.trim().is_empty() {
        return Err(AppError::Validation(
            "device_id and reader_session_id are required".into(),
        ));
    }
    let site = SiteId::new(&request.site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    let operational_pool = OperationalPool::from_str(&request.pool)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    // The pool's site is its row's, not its id's first segment.
    if super::sites::pool_site_id(pool, &operational_pool.id())
        .await?
        .as_deref()
        != Some(site.as_str())
    {
        return Err(AppError::Validation(
            "observation pool does not belong to site_id".into(),
        ));
    }
    let consolidated = consolidate_reads(&request.observations);
    if consolidated.is_empty() {
        return Err(AppError::Validation("batch contains no valid EPC".into()));
    }
    let digest = payload_digest(&request)?;
    let raw_read_count: i64 = request
        .observations
        .iter()
        .map(|r| i64::from(r.read_count.max(1)))
        .sum();
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "RFID_OBSERVATION_BATCH",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let mut inserted = 0_i64;
    let mut merged = 0_i64;
    let mut observation_ids = Vec::new();
    let epcs: Vec<String> = consolidated.iter().map(|read| read.epc.clone()).collect();
    let subjects: HashMap<String, Uuid> =
        sqlx::query("SELECT epc,id FROM inventory_subject WHERE epc = ANY($1)")
            .bind(&epcs)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|row| (row.get("epc"), row.get("id")))
            .collect();
    let existing_rows = sqlx::query(
        "SELECT epc,observation_id,last_seen_at FROM observation_sighting
         WHERE device_id=$1 AND reader_session_id=$2 AND pool_id=$3 AND epc = ANY($4)
         ORDER BY epc,last_seen_at DESC FOR UPDATE",
    )
    .bind(&request.device_id)
    .bind(&request.reader_session_id)
    .bind(&request.pool)
    .bind(&epcs)
    .fetch_all(&mut *tx)
    .await?;
    let mut existing_by_epc: HashMap<String, (Uuid, DateTime<Utc>)> = HashMap::new();
    for row in existing_rows {
        existing_by_epc
            .entry(row.get("epc"))
            .or_insert_with(|| (row.get("observation_id"), row.get("last_seen_at")));
    }
    for read in consolidated {
        let subject_id = subjects.get(&read.epc).copied();
        if let Some((id, last_seen)) = existing_by_epc.remove(&read.epc) {
            if belongs_to_same_burst(last_seen, request.observed_at, burst_window_seconds) {
                sqlx::query("UPDATE observation_sighting SET last_seen_at=$2,received_at=now(),read_count=read_count+$3,best_rssi=CASE WHEN best_rssi IS NULL THEN $4 WHEN $4 IS NULL THEN best_rssi ELSE GREATEST(best_rssi,$4) END,antenna=COALESCE($5,antenna),subject_id=COALESCE(subject_id,$6) WHERE observation_id=$1")
                    .bind(id).bind(request.observed_at).bind(read.read_count).bind(read.best_rssi).bind(&read.antenna).bind(subject_id).execute(&mut *tx).await?;
                merged += 1;
                observation_ids.push(id);
                continue;
            }
        }
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO observation_sighting(observation_id,subject_id,epc,site_id,pool_id,first_seen_at,last_seen_at,device_id,reader_session_id,method,read_count,best_rssi,antenna) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,'RFID_HANDHELD',$9,$10,$11)")
            .bind(id).bind(subject_id).bind(&read.epc).bind(site.as_str()).bind(&request.pool).bind(request.observed_at)
            .bind(&request.device_id).bind(&request.reader_session_id).bind(read.read_count).bind(read.best_rssi).bind(&read.antenna)
            .execute(&mut *tx).await?;
        inserted += 1;
        observation_ids.push(id);
    }
    let response = json!({
        "idempotency_key":request.idempotency_key,"raw_read_count":raw_read_count,"consolidated_sighting_count":observation_ids.len(),
        "inserted":inserted,"merged_into_burst":merged,"observation_ids":observation_ids,"observed_at":request.observed_at,"received_at":Utc::now(),
        "inventory_effect":{"movement_count":0,"missing_created":0}
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

// ── the sighting list ────────────────────────────────────────────────────
//
// Same envelope as the rest of this surface: a scope in, `{ rows,
// next_cursor, total, facets }` out, facets counted from the same row
// definition the page is drawn from.

/// How many sightings the list returns when the caller does not say.
const SIGHTING_DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const SIGHTING_MAX_LIMIT: i64 = 500;

/// What a caller is asking the sighting list for.
#[derive(Clone, Debug, Default)]
pub struct SightingScope {
    /// The CENTRE's pool id. `observation_sighting.pool_id` is written by
    /// whatever submitted the batch, and Cloud's own readers write the
    /// centre's spelling — `dc.warehouse`. An outbound ROLLUP pool also
    /// matches its leaves, which is what the `EXISTS` in the row definition is
    /// for.
    pub pool_id: Option<String>,
    /// One tag, exactly. Upper-cased before it is compared, because an EPC is
    /// hexadecimal and the readers do not agree on its case.
    pub epc: Option<String>,
    /// Free text over the tag, the SKU code, the device and the reader
    /// session. Not the same thing as `epc`, which is an equality.
    pub needle: Option<String>,
    pub device_id: Option<String>,
    /// `RFID`, `MANUAL` — however the read was taken.
    pub method: Option<String>,
    pub site_id: Option<String>,
    /// `last_seen_at`, `first_seen_at`, `received_at`, `read_count` or `epc`.
    /// Anything unrecognised is the house order — newest first.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// One consolidated sighting.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SightingRow {
    pub observation_id: Uuid,
    /// Absent for a tag this system has never been told about — a read is a
    /// fact whether or not anybody can say what was read.
    pub subject_id: Option<Uuid>,
    pub epc: String,
    pub sku_code: Option<String>,
    pub site_id: String,
    pub pool_id: String,
    pub first_seen_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub received_at: DateTime<Utc>,
    pub device_id: String,
    pub reader_session_id: String,
    pub method: String,
    pub read_count: i64,
    pub best_rssi: Option<f32>,
    pub antenna: Option<String>,
}

/// What the sighting list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SightingFacets {
    pub pools: Vec<InventoryFacet>,
    pub devices: Vec<InventoryFacet>,
    pub methods: Vec<InventoryFacet>,
}

/// A page of sightings, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SightingPage {
    pub rows: Vec<SightingRow>,
    pub next_cursor: Option<String>,
    pub total: i64,
    pub facets: SightingFacets,
}

#[derive(Serialize, Deserialize)]
struct SightingCursor {
    observation_id: Uuid,
}

/// One sighting row, defined once — for the page and for the facets.
///
/// Binds: `$1` a pool or NULL, `$2` an exact EPC or NULL, `$3` the search
/// pattern or NULL.
///
/// The pool and the EPC stop here rather than outside because both existed on
/// this route before the envelope did and both are what a caller means by
/// "which sightings" rather than "narrow these sightings" — the facet counts
/// beside one pool's reads should describe that pool.
const SIGHTING_ROWS: &str = r#"
SELECT o.observation_id,o.subject_id,o.epc,o.site_id,o.pool_id,o.first_seen_at,o.last_seen_at,o.received_at,
       o.device_id,o.reader_session_id,o.method,o.read_count,o.best_rssi,o.antenna,sk.sku_code,
       pool.label pool_label
FROM observation_sighting o
LEFT JOIN inventory_subject s ON s.id=o.subject_id
LEFT JOIN sku sk ON sk.id=s.sku_id
LEFT JOIN operational_pool observed_pool ON observed_pool.id=o.pool_id
LEFT JOIN operational_pool pool ON pool.id=o.pool_id
WHERE (
    $1::text IS NULL OR o.pool_id=$1
    OR EXISTS (
        SELECT 1 FROM operational_pool scope
        WHERE scope.id=$1 AND scope.destination_store_id IS NULL AND scope.outbound_stage IS NOT NULL
          AND observed_pool.is_placement AND observed_pool.outbound_stage=scope.outbound_stage
          AND observed_pool.site_id=scope.site_id
    )
) AND ($2::text IS NULL OR o.epc=$2)
  AND ($3::text IS NULL OR o.epc ILIKE $3 OR sk.sku_code ILIKE $3
       OR o.device_id ILIKE $3 OR o.reader_session_id ILIKE $3)
"#;

/// The sighting list's filters, spelled once for the page and for the facets.
const SIGHTING_FILTERS: &str = "
     WHERE ($4::text IS NULL OR device_id=$4)
       AND ($5::text IS NULL OR method=$5)
       AND ($6::text IS NULL OR site_id=$6)
";

fn sighting_row_from(row: &sqlx::postgres::PgRow) -> Result<SightingRow, AppError> {
    Ok(SightingRow {
        observation_id: row.try_get("observation_id")?,
        subject_id: row.try_get("subject_id")?,
        epc: row.try_get("epc")?,
        sku_code: row.try_get("sku_code")?,
        site_id: row.try_get("site_id")?,
        pool_id: row.try_get("pool_id")?,
        first_seen_at: row.try_get("first_seen_at")?,
        last_seen_at: row.try_get("last_seen_at")?,
        received_at: row.try_get("received_at")?,
        device_id: row.try_get("device_id")?,
        reader_session_id: row.try_get("reader_session_id")?,
        method: row.try_get("method")?,
        read_count: row.try_get("read_count")?,
        best_rssi: row.try_get("best_rssi")?,
        antenna: row.try_get("antenna")?,
    })
}

/// The sightings a pool's own detail carries, in the shape it already reads.
pub async fn sightings_for_pool(
    pool: &PgPool,
    pool_id: Option<&str>,
    limit: i64,
) -> Result<Vec<SightingRow>, AppError> {
    Ok(sightings_page(
        pool,
        SightingScope {
            pool_id: pool_id.map(ToOwned::to_owned),
            limit: Some(limit),
            ..SightingScope::default()
        },
    )
    .await?
    .rows)
}

/// The sightings: searched, filtered, sorted and paged by the server.
///
/// The house order is `last_seen_at` DESCENDING — the newest read first — so
/// `desc` is inverted on the default key, as the ledger's is, rather than
/// leaving the default backwards.
pub async fn sightings_page(pool: &PgPool, scope: SightingScope) -> Result<SightingPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let epc = scope
        .epc
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_ascii_uppercase);
    let limit = scope
        .limit
        .unwrap_or(SIGHTING_DEFAULT_LIMIT)
        .clamp(1, SIGHTING_MAX_LIMIT);
    let cursor = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor::<SightingCursor>)
        .transpose()?;

    // Every order ends in `observation_id`, the primary key, so no two rows
    // can compare equal — which is what stops a keyset from repeating or
    // losing the rows that tie. A burst of reads from one antenna shares a
    // `last_seen_at` to the second, so the tie-break is not theoretical here.
    let (lead, descending) = match scope.sort.as_deref() {
        Some("first_seen_at") => ("first_seen_at", scope.desc),
        Some("received_at") => ("received_at", scope.desc),
        Some("read_count") => ("read_count", scope.desc),
        Some("epc") => ("epc", scope.desc),
        _ => ("last_seen_at", !scope.desc),
    };
    let (cols, order) = super::order_by(lead, "observation_id", descending);
    let seek = if descending { "<" } else { ">" };

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({SIGHTING_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {SIGHTING_FILTERS}
         )
         SELECT * FROM kept
          WHERE $7::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE observation_id = $7)
          ORDER BY {order}
          LIMIT $8"
    );
    let rows = sqlx::query(&sql)
        .bind(&scope.pool_id)
        .bind(&epc)
        .bind(&needle)
        .bind(&scope.device_id)
        .bind(&scope.method)
        .bind(&scope.site_id)
        .bind(cursor.as_ref().map(|c| c.observation_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&SightingCursor {
            observation_id: row.try_get("observation_id")?,
        })?),
        _ => None,
    };
    let out = rows
        .iter()
        .map(sighting_row_from)
        .collect::<Result<Vec<_>, AppError>>()?;

    let (total, facets) = sighting_facets(pool, &scope, epc.as_deref(), needle.as_deref()).await?;
    Ok(SightingPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// How many sightings there are, and how they split.
async fn sighting_facets(
    pool: &PgPool,
    scope: &SightingScope,
    epc: Option<&str>,
    needle: Option<&str>,
) -> Result<(i64, SightingFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({SIGHTING_ROWS}), kept AS (
             SELECT * FROM searched {SIGHTING_FILTERS}
         )
         SELECT 'pool' AS kind, pool_id AS value, pool_label AS l, COUNT(*)::bigint AS n
           FROM searched GROUP BY pool_id, pool_label
          UNION ALL
         SELECT 'device', device_id, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY device_id
          UNION ALL
         SELECT 'method', method, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY method
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(&scope.pool_id)
        .bind(epc)
        .bind(needle)
        .bind(&scope.device_id)
        .bind(&scope.method)
        .bind(&scope.site_id)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = SightingFacets {
        pools: Vec::new(),
        devices: Vec::new(),
        methods: Vec::new(),
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
            "device" => facets.devices.push(facet),
            "method" => facets.methods.push(facet),
            _ => total = facet.count,
        }
    }
    for list in [&mut facets.pools, &mut facets.devices, &mut facets.methods] {
        rank_facets(list);
    }
    Ok((total, facets))
}

pub async fn observation_anomalies(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(r#"
WITH latest_observation AS (
    SELECT DISTINCT ON (subject_id) subject_id,epc,pool_id,last_seen_at,device_id
    FROM observation_sighting WHERE subject_id IS NOT NULL ORDER BY subject_id,last_seen_at DESC
), deltas AS (
    SELECT subject_id,to_place_id place_id,quantity delta FROM movement
    UNION ALL SELECT subject_id,from_place_id,-quantity FROM movement
), current_ledger AS (
    SELECT d.subject_id,ip.pool_id,SUM(d.delta)::bigint quantity FROM deltas d JOIN inventory_place ip ON ip.id=d.place_id
    WHERE ip.kind='OPERATIONAL' GROUP BY d.subject_id,ip.pool_id HAVING SUM(d.delta)>0
)
SELECT o.subject_id,o.epc,o.pool_id observed_pool,o.last_seen_at,o.device_id,c.pool_id ledger_pool,c.quantity
FROM latest_observation o JOIN current_ledger c ON c.subject_id=o.subject_id WHERE c.pool_id<>o.pool_id
ORDER BY o.last_seen_at DESC
"#).fetch_all(pool).await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "type":"PLACEMENT_MISMATCH","subject_id":r.get::<Uuid,_>("subject_id"),"epc":r.get::<String,_>("epc"),
        "ledger_pool":r.get::<String,_>("ledger_pool"),"observed_pool":r.get::<String,_>("observed_pool"),"quantity":r.get::<i64,_>("quantity"),
        "last_observed_at":r.get::<DateTime<Utc>,_>("last_seen_at"),"device_id":r.get::<String,_>("device_id"),
        "automatic_inventory_effect":false
    })).collect();
    Ok(json!({"items":items}))
}
