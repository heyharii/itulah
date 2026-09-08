use super::{create_movement, movement_request_for_resolution, parse_missing_id};
use crate::cloud::{
    application::{AppError, AsOfQuery, MissingResolutionRequest},
    domain::{InventoryBalance, OperationalPool},
};
use crate::edge::OperationalPool as EdgeOperationalPool;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{collections::BTreeMap, str::FromStr};
use uuid::Uuid;

pub async fn list_pools(
    pool: &PgPool,
    at: Option<DateTime<Utc>>,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    let current = at.is_none();
    let at = at.unwrap_or_else(Utc::now);
    let rows = sqlx::query(r#"
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
    SELECT pool.id pool_id,
           COALESCE(SUM(CASE
               WHEN movement.occurred_at < $1-($3::text||' days')::interval
                AND movement.to_place_id=pool.id||':on_hand' THEN movement.quantity
               WHEN movement.occurred_at < $1-($3::text||' days')::interval
                AND movement.from_place_id=pool.id||':on_hand' THEN -movement.quantity
               ELSE 0 END),0)::bigint opening,
           COALESCE(SUM(CASE
               WHEN movement.occurred_at >= $1-($3::text||' days')::interval
                AND movement.to_place_id=pool.id||':on_hand' THEN movement.quantity
               ELSE 0 END),0)::bigint inbound,
           COALESCE(SUM(CASE
               WHEN movement.occurred_at >= $1-($3::text||' days')::interval
                AND movement.from_place_id=pool.id||':missing'
                AND movement.to_place_id='system/lost' THEN movement.quantity
               ELSE 0 END),0)::bigint lost
    FROM operational_pool pool LEFT JOIN movement
      ON movement.occurred_at <= $1 AND (
           movement.to_place_id=pool.id||':on_hand'
        OR movement.from_place_id=pool.id||':on_hand'
        OR (movement.from_place_id=pool.id||':missing' AND movement.to_place_id='system/lost'))
    GROUP BY pool.id
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
    SELECT COALESCE(event.source_pool_id,line.source_pool_id) source_pool_id,
           COALESCE(SUM(event.remaining_delta),0)::bigint quantity
    FROM allotment_event event LEFT JOIN allotment_line line ON line.id=event.allotment_line_id
    WHERE event.occurred_at <= $1
    GROUP BY COALESCE(event.source_pool_id,line.source_pool_id)
)
SELECT pool.id,pool.site_id,site.name site_name,site.kind site_kind,pool.group_code,pool.pool_code,pool.label,
       pool.store_origin_site_id,pool.display_order,pool.is_placement,pool.outbound_stage,pool.destination_store_id,
       COALESCE(normal.quantity,0)::bigint normal,
       COALESCE(missing.quantity,0)::bigint missing,
       COALESCE(observed.quantity,0)::bigint observed,
       CASE WHEN pool.is_placement AND (pool.id IN ('dc.warehouse','dc.reject.dc') OR pool.site_id<>'dc')
            THEN COALESCE(allotted.quantity,0) ELSE NULL END::bigint allotted,
       risk.lost::bigint lost_quantity,
       CASE WHEN GREATEST(risk.opening,0)+risk.inbound > 0
            THEN ROUND(risk.lost::numeric/(GREATEST(risk.opening,0)+risk.inbound)::numeric,6)
            ELSE 0 END::text lost_rate,
       (GREATEST(risk.opening,0)+risk.inbound)::bigint exposure
FROM operational_pool pool JOIN site ON site.id=pool.site_id
LEFT JOIN balance_rollup normal ON normal.output_pool_id=pool.id AND normal.state='NORMAL'
LEFT JOIN balance_rollup missing ON missing.output_pool_id=pool.id AND missing.state='MISSING'
LEFT JOIN observed_rollup observed ON observed.output_pool_id=pool.id
LEFT JOIN risk_rollup risk ON risk.output_pool_id=pool.id
LEFT JOIN allotted_balance allotted ON allotted.source_pool_id=pool.id
WHERE pool.active
ORDER BY CASE WHEN pool.site_id='dc' THEN 0 ELSE 1 END,pool.site_id,pool.display_order,pool.is_placement,pool.destination_store_id NULLS FIRST,pool.id
"#).bind(at).bind(observed_hours).bind(lost_days).bind(current).fetch_all(pool).await?;
    let items = rows
        .into_iter()
        .map(|row| {
            let balance = InventoryBalance::project(
                row.get::<i64, _>("normal"),
                row.get::<Option<i64>, _>("allotted"),
                row.get::<i64, _>("missing"),
                row.get::<i64, _>("observed"),
            )
            .map_err(|error| AppError::Conflict(format!("invalid inventory projection: {error}")))?;
            let is_placement = row.get::<bool, _>("is_placement");
            let outbound_stage = row.get::<Option<String>, _>("outbound_stage");
            Ok(json!({
                "id":row.get::<String,_>("id"),"site_id":row.get::<String,_>("site_id"),"site_name":row.get::<String,_>("site_name"),"site_kind":row.get::<String,_>("site_kind"),
                "group":row.get::<String,_>("group_code"),"pool_code":row.get::<String,_>("pool_code"),"label":row.get::<String,_>("label"),
                "store_origin_site_id":row.get::<Option<String>,_>("store_origin_site_id"),"display_order":row.get::<i32,_>("display_order"),
                "is_rollup":!is_placement,"is_outbound_leaf":is_placement&&outbound_stage.is_some(),"outbound_stage":outbound_stage,
                "destination_store_id":row.get::<Option<String>,_>("destination_store_id"),
                "stock":balance.stock.value(),"allotted":balance.allotted.map(|quantity| quantity.value()),"on_hand":balance.on_hand.value(),
                "missing":balance.missing.value(),"observed":balance.observed.value(),
                "lost_rate":row.get::<String,_>("lost_rate").parse::<f64>().unwrap_or(0.0),"lost_quantity":row.get::<i64,_>("lost_quantity"),"exposure":row.get::<i64,_>("exposure")
            }))
        })
        .collect::<Result<Vec<Value>, AppError>>()?;
    Ok(json!({
        "as_of":at,"read_only":at<Utc::now()-chrono::Duration::seconds(2),"observed_window_hours":observed_hours,"lost_risk_window_days":lost_days,
        "inventory_equation":"Stock = On Hand + Allotted + Missing",
        "outbound_rollup_equation":"Stage total = sum of destination Store leaf pools",
        "lost_risk_formula":"confirmed Lost from pool during window / (opening operational balance + inbound movements during window)","items":items
    }))
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
        DcOutboundPicking { .. } => ("OUTBOUND", "PICKING", "Picking", 40, None),
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
    items: Vec<Value>,
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
    fn summary(&self) -> Value {
        json!({
            "matched": self.matched,
            "matched_attributed": self.matched_attributed,
            "matched_unattributed": self.matched_unattributed,
            "dc_only": self.dc_only,
            "store_only": self.store_only,
            "unresolved": self.unresolved,
            "conflicts": self.conflicts,
        })
    }

    fn prevents_certification(&self) -> bool {
        self.store_only > 0 || self.unresolved > 0 || self.conflicts > 0
    }
}

fn transfer_attribution_json(attribution: &TransferAttribution) -> Value {
    json!({
        "in_transit_event_id": attribution.in_transit_event_id,
        "koli_id": attribution.koli_id,
        "allotment_id": attribution.allotment_id,
        "allotment_line_id": attribution.allotment_line_id,
        "matched_at": attribution.matched_at,
    })
}

fn transfer_evidence_json(evidence: &TransferEvidence) -> Value {
    json!({
        "event_id": evidence.event_id,
        "origin_id": evidence.origin_id,
        "generation": evidence.generation,
        "seq": evidence.seq,
        "sku_code": evidence.sku_code,
        "quantity": evidence.quantity,
        "movement_group_id": evidence.movement_group_id,
        "receipt_id": evidence.receipt_id,
        "occurred_at": evidence.occurred_at,
    })
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
        report.items.push(json!({
            "status": status,
            "source_dc_id": source_dc_id,
            "destination_store_id": destination_store_id,
            "shipment_reference": shipment_reference,
            "epc": epc,
            "sku_code": if sku_codes.len() == 1 {
                sku_codes.iter().next().cloned().map(Value::String).unwrap_or(Value::Null)
            } else {
                Value::Null
            },
            "sku_codes": sku_codes,
            "in_transit_claim_count": identity.in_transit.len(),
            "received_claim_count": identity.received.len(),
            "attributed": status == "MATCHED" && attribution.is_some(),
            "attribution": attribution.map(transfer_attribution_json),
            "in_transit": identity.in_transit.first().map(transfer_evidence_json),
            "received": identity.received.first().map(transfer_evidence_json),
        }));
    }
    report.items.sort_by(|left, right| {
        let left_status = left.get("status").and_then(Value::as_str).unwrap_or("");
        let right_status = right.get("status").and_then(Value::as_str).unwrap_or("");
        left_status
            .cmp(right_status)
            .then_with(|| {
                left["destination_store_id"]
                    .to_string()
                    .cmp(&right["destination_store_id"].to_string())
            })
            .then_with(|| left["epc"].to_string().cmp(&right["epc"].to_string()))
    });
    Ok(report)
}

pub async fn list_transfer_reconciliations(pool: &PgPool) -> Result<Value, AppError> {
    let report = transfer_reconciliation_report(pool).await?;
    Ok(json!({
        "as_of": Utc::now(),
        "summary": report.summary(),
        "items": report.items,
    }))
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
        active_edge_sites.insert(site_id.clone(), origin_id.clone());
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

    let mut shadowed_cloud_sites = std::collections::BTreeSet::<String>::new();
    for item in &mut items {
        if let Some(object) = item.as_object_mut() {
            let site_id = object
                .get("site_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let is_rollup = object
                .get("is_rollup")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let shadowed_by = active_edge_sites.get(&site_id).cloned();
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
             SELECT progress.origin_id,
                    regexp_replace(progress.source_pool_id,'^[^.]+',credential.site_id) AS pool_id,
                    COALESCE(sum(progress.accepted_quantity-progress.picked_quantity-progress.cancelled_quantity),0)::bigint AS allotted
             FROM edge_allotment_line_progress progress
             JOIN sync_origin_credential credential
               ON credential.origin_id=progress.origin_id
             GROUP BY progress.origin_id,
                      regexp_replace(progress.source_pool_id,'^[^.]+',credential.site_id)
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
                "included_in_fleet_total": true,
                "shadowed_by_origin_id": Value::Null,
                "derived": false,
            },
        }));
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
        "aggregation_policy": "Exact-site active Edge fact positions shadow Cloud rows; rollups are excluded; snapshots are reconciliation checkpoints; matched Store receipts deduct capped DC In Transit overlap",
        "fleet_total": fleet_total,
        "fleet_total_status": if certified { "CERTIFIED" } else { "UNCERTIFIED" },
        "reconciliation_summary": reconciliation.summary(),
        "fleet_total_diagnostics": {
            "base_stock_before_overlap": base_stock_before_overlap,
            "overlap_deduction": overlap_deduction,
            "calculated_total": calculated_total,
            "included_row_count": included_row_count,
            "excluded_rollup_count": excluded_rollup_count,
            "shadowed_cloud_site_ids": shadowed_cloud_sites,
            "stale_edge_origins": stale_edge_origins,
            "missing_edge_origins": missing_edge_origins,
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
    let observations =
        crate::cloud::postgres::list_observations(pool, Some(pool_id), None, 100).await?;
    let movements = crate::cloud::postgres::list_movements(
        pool,
        crate::cloud::application::MovementQuery {
            pool_id: Some(pool_id.into()),
            subject_id: None,
            limit: Some(100),
        },
    )
    .await?;
    let count_rows = sqlx::query("SELECT id,kind,status,reason,created_at,activated_at,submitted_at,closed_at FROM official_count WHERE pool_id=$1 ORDER BY created_at DESC LIMIT 20")
        .bind(pool_id).fetch_all(pool).await?;
    let counts: Vec<Value> = count_rows.into_iter().map(|r| json!({"id":r.get::<Uuid,_>("id"),"kind":r.get::<String,_>("kind"),"status":r.get::<String,_>("status"),"reason":r.get::<String,_>("reason"),"created_at":r.get::<DateTime<Utc>,_>("created_at"),"activated_at":r.get::<Option<DateTime<Utc>>,_>("activated_at"),"submitted_at":r.get::<Option<DateTime<Utc>>,_>("submitted_at"),"closed_at":r.get::<Option<DateTime<Utc>>,_>("closed_at")})).collect();
    Ok(
        json!({"summary":row,"items":items,"missing":missing.get("items").cloned().unwrap_or(json!([])),"observations":observations.get("items").cloned().unwrap_or(json!([])),"movements":movements.get("items").cloned().unwrap_or(json!([])),"counts":counts}),
    )
}

pub async fn inventory_as_of(
    pool: &PgPool,
    query: AsOfQuery,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    let mut result = list_pools(pool, Some(query.at), observed_hours, lost_days).await?;
    if let Some(items) = result.get_mut("items").and_then(Value::as_array_mut) {
        items.retain(|v| {
            query
                .site_id
                .as_deref()
                .map(|x| v.get("site_id").and_then(Value::as_str) == Some(x))
                .unwrap_or(true)
                && query
                    .pool_id
                    .as_deref()
                    .map(|x| v.get("id").and_then(Value::as_str) == Some(x))
                    .unwrap_or(true)
        });
    }
    Ok(result)
}

pub async fn list_missing(pool: &PgPool) -> Result<Value, AppError> {
    list_missing_for_pool(pool, None, 500).await
}

async fn list_missing_for_pool(
    pool: &PgPool,
    pool_id: Option<&str>,
    limit: i64,
) -> Result<Value, AppError> {
    let rows = sqlx::query(r#"
SELECT pr.subject_id,ip.pool_id,pr.quantity,s.subject_type,s.epc,s.barcode,sk.sku_code,op.site_id,op.label,
       first_missing.occurred_at missing_since,last_obs.last_seen_at,last_count.id latest_count_id,last_count.status latest_count_status
FROM inventory_projection pr JOIN inventory_place ip ON ip.id=pr.place_id AND ip.state='MISSING'
JOIN operational_pool op ON op.id=ip.pool_id JOIN inventory_subject s ON s.id=pr.subject_id LEFT JOIN sku sk ON sk.id=s.sku_id
LEFT JOIN LATERAL (SELECT occurred_at FROM movement WHERE subject_id=pr.subject_id AND to_place_id=pr.place_id ORDER BY occurred_at ASC LIMIT 1) first_missing ON TRUE
LEFT JOIN LATERAL (SELECT last_seen_at FROM observation_sighting WHERE subject_id=pr.subject_id ORDER BY last_seen_at DESC LIMIT 1) last_obs ON TRUE
LEFT JOIN LATERAL (SELECT c.id,c.status FROM official_count c JOIN count_snapshot cs ON cs.count_id=c.id WHERE cs.subject_id=pr.subject_id ORDER BY c.created_at DESC LIMIT 1) last_count ON TRUE
WHERE ($1::text IS NULL OR ip.pool_id=$1) ORDER BY first_missing.occurred_at ASC NULLS FIRST LIMIT $2
"#).bind(pool_id).bind(limit).fetch_all(pool).await?;
    let now = Utc::now();
    let items: Vec<Value> = rows.into_iter().map(|r| {
        let subject_id: Uuid=r.get("subject_id"); let origin_pool: String=r.get("pool_id"); let since: Option<DateTime<Utc>>=r.get("missing_since");
        json!({"id":format!("{subject_id}@{origin_pool}"),"subject_id":subject_id,"subject_type":r.get::<String,_>("subject_type"),"epc":r.get::<Option<String>,_>("epc"),"barcode":r.get::<Option<String>,_>("barcode"),"sku_code":r.get::<Option<String>,_>("sku_code"),"quantity":r.get::<i64,_>("quantity"),"site_id":r.get::<String,_>("site_id"),"origin_pool":origin_pool,"pool_label":r.get::<String,_>("label"),"missing_since":since,"age_hours":since.map(|s|(now-s).num_hours()),"last_observation":r.get::<Option<DateTime<Utc>>,_>("last_seen_at"),"latest_count_id":r.get::<Option<Uuid>,_>("latest_count_id"),"latest_count_status":r.get::<Option<String>,_>("latest_count_status"),"status":"MISSING"})
    }).collect();
    Ok(json!({"items":items}))
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
