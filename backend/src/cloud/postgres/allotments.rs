use super::sync::{
    inventory_owner_tx, issue_command_tx, origin_site_id_tx, origin_takes_goods_routes_tx,
    pool_id_for_site,
};
use super::{apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest};
use crate::cloud::{
    application::{
        AllotmentQuery, AppError, AvailabilityQuery, CancelAllotmentRequest,
        CreateAllotmentRequest, ExecuteAllotmentRequest,
    },
    domain::{
        AllotmentPurpose, AllotmentStatus, AllotmentType, DestinationType, FulfillmentStatus,
        MovementCause, MovementCommand, MovementGroupId, MovementLine, Place, SubjectId,
    },
};
use crate::pool_role::PoolRole;
use crate::sync::workflow::{
    parse_allotment_cancellation, AllotmentActivationLine, AllotmentActivationPayload,
    AllotmentCancellationLine, AllotmentCancellationPayload, AllotmentCancellationResultLine,
    INVENTORY_ALLOTMENT_ACTIVATE_V1, INVENTORY_ALLOTMENT_CANCEL_V1,
    INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    str::FromStr,
};
use uuid::Uuid;

/// `unit.kind` of head office (0600). A KIND, read off the unit row a site
/// belongs to — never a site id.
const HEAD_OFFICE_UNIT_KIND: &str = "HO";

#[derive(Clone, Debug)]
pub(super) struct LineIdentity {
    pub(super) source_site_id: String,
    pub(super) source_pool_id: String,
    pub(super) destination_type: DestinationType,
    pub(super) destination_id: String,
    pub(super) sku_id: Uuid,
}

#[derive(Clone, Debug)]
struct NormalizedLine {
    identity: LineIdentity,
    quantity: i64,
}

/// What the rows say about one site a line names.
#[derive(Clone, Debug)]
struct SiteFacts {
    /// `site.kind`.
    kind: String,
    /// The kind of the unit that owns it: HO or STORE (0600).
    unit_kind: String,
    /// Its unit was removed by head office (`unit.status = 'CLOSED'`, 0990).
    closed: bool,
}

/// Everything the route rules read, read once, from rows.
struct CreateValidationContext {
    /// Source pool id → (the site it stands at, its role).
    source_pools: HashMap<String, (String, String)>,
    sites: HashMap<String, SiteFacts>,
    /// Site kinds whose template gives a saleable floor: sites that sell.
    selling_kinds: HashSet<String>,
    /// Site kinds whose template gives receiving: warehouses.
    warehouse_kinds: HashSet<String>,
}

impl CreateValidationContext {
    fn sells(&self, site_id: &str) -> bool {
        self.sites
            .get(site_id)
            .is_some_and(|site| self.selling_kinds.contains(&site.kind))
    }

    fn is_warehouse(&self, site_id: &str) -> bool {
        self.sites
            .get(site_id)
            .is_some_and(|site| self.warehouse_kinds.contains(&site.kind))
    }

    fn of_head_office(&self, site_id: &str) -> bool {
        self.sites
            .get(site_id)
            .is_some_and(|site| site.unit_kind == HEAD_OFFICE_UNIT_KIND)
    }

    fn of_removed_store(&self, site_id: &str) -> bool {
        self.sites.get(site_id).is_some_and(|site| site.closed)
    }

    /// Stores keep the same id on Cloud and their Edge node. A warehouse can
    /// be enrolled under a different node spelling (for example `dc-01`), so
    /// only those destinations need the owner lookup before an activation is
    /// built. See `sync::node_site_id_tx`.
    fn node_spelling_may_differ(&self, site_id: &str) -> bool {
        self.sites
            .get(site_id)
            .is_some_and(|site| site.kind == "DC" || site.unit_kind == HEAD_OFFICE_UNIT_KIND)
    }
}

pub async fn create_allotment(
    pool: &PgPool,
    request: CreateAllotmentRequest,
) -> Result<Value, AppError> {
    create_allotment_as(pool, request, None).await
}

/// [`create_allotment`] by a signed-in person. The plan is written and, in
/// the same transaction, one flow document per destination is started from
/// the route's default template (`flows::start_flow_for_allotment_tx`), so an
/// allotment on a route no template serves is refused with its plan: the
/// template is what says how goods may travel a route (owner, 27 Sep).
/// Without an actor (tools, the simulator) only the plan is written.
pub async fn create_allotment_as(
    pool: &PgPool,
    request: CreateAllotmentRequest,
    actor: Option<&crate::cloud::domain::flow::Actor>,
) -> Result<Value, AppError> {
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "allotment must contain at least one line".into(),
        ));
    }

    let mut lines = Vec::with_capacity(request.lines.len());
    let mut identities = HashSet::new();
    for line in &request.lines {
        if line.quantity <= 0 {
            return Err(AppError::Validation(
                "allotment line quantity must be positive".into(),
            ));
        }
        let source_site_id = line.source_site_id.trim().to_ascii_lowercase();
        let source_pool_id = line.source_pool_id.trim().to_ascii_lowercase();
        let destination_id = line.destination_id.trim().to_ascii_lowercase();
        if source_site_id.is_empty() || source_pool_id.is_empty() || destination_id.is_empty() {
            return Err(AppError::Validation(
                "line source and destination identifiers are required".into(),
            ));
        }
        let identity_key = (
            source_pool_id.clone(),
            line.destination_type,
            destination_id.clone(),
            line.sku_id,
        );
        if !identities.insert(identity_key) {
            return Err(AppError::Validation(
                "duplicate allotment line identity".into(),
            ));
        }
        lines.push(NormalizedLine {
            identity: LineIdentity {
                source_site_id,
                source_pool_id,
                destination_type: line.destination_type,
                destination_id,
                sku_id: line.sku_id,
            },
            quantity: line.quantity,
        });
    }
    lines.sort_by(|left, right| {
        left.identity
            .sku_id
            .cmp(&right.identity.sku_id)
            .then_with(|| {
                left.identity
                    .source_pool_id
                    .cmp(&right.identity.source_pool_id)
            })
            .then_with(|| {
                left.identity
                    .destination_type
                    .as_str()
                    .cmp(right.identity.destination_type.as_str())
            })
            .then_with(|| {
                left.identity
                    .destination_id
                    .cmp(&right.identity.destination_id)
            })
    });

    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CREATE_ALLOTMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    let validation = load_create_validation_context(&mut tx, &lines).await?;
    // The destination word nodes read (STORE / DC) is derived from the
    // destination site's kind, never trusted from the id or the request.
    for line in &mut lines {
        line.identity.destination_type = resolve_destination_type(&line.identity, &validation)?;
    }
    let mut purpose = None;
    for line in &lines {
        purpose = validate_create_line(request.allotment_type, line, &validation)?.or(purpose);
    }
    let mut sku_ids: Vec<Uuid> = lines.iter().map(|line| line.identity.sku_id).collect();
    sku_ids.sort_unstable();
    sku_ids.dedup();
    let sku_codes_by_id = lock_active_skus_with_codes(&mut tx, &sku_ids).await?;
    let source_sites = lines
        .iter()
        .map(|line| line.identity.source_site_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    if source_sites.len() != 1 {
        return Err(AppError::Validation(
            "one Allotment must have exactly one source site".into(),
        ));
    }
    let source_site_id = source_sites
        .iter()
        .next()
        .cloned()
        .ok_or_else(|| AppError::Validation("allotment source site is required".into()))?;
    // Whoever owns the source site's ledger executes the allotment: the
    // Gudang's node, or a shop's for its return or transfer. A site no node
    // owns is executed by the centre.
    let activation_target_origin_id = inventory_owner_tx(&mut tx, &source_site_id).await?;
    // A node that cannot yet send goods is not sent the work: an unreadable
    // command blocks its whole stream. The Gudang's allotment has always
    // been understood; anything a shop sends needs the newer build, which
    // says so in its heartbeat.
    if let Some(origin_id) = activation_target_origin_id.as_deref() {
        if !validation.of_head_office(&source_site_id)
            && !origin_takes_goods_routes_tx(&mut tx, origin_id).await?
        {
            return Err(AppError::Conflict(format!(
                "the server at {source_site_id} runs a build that cannot send goods yet; update it before raising this allotment"
            )));
        }
    }
    // What that owner calls itself. `inventory_owner_tx` resolves the
    // centre's canonical `dc` to whichever origin is registered, and that
    // origin is entitled to run as `dc-01` — so every name leaving this
    // transaction for it has to be respelled. Identical to `source_site_id`
    // whenever the two agree, which is every store. See `pool_id_for_site`.
    let owner_site_id = match activation_target_origin_id.as_deref() {
        Some(origin_id) => Some(origin_site_id_tx(&mut tx, origin_id).await?),
        None => None,
    };
    // Read each SKU's fact-derived supply and commitment once for
    // the whole request. The source pool and SKU, not the destination, define
    // availability; several destination lines may share the same answer.
    let availability = match activation_target_origin_id.as_deref() {
        Some(origin) => {
            load_edge_create_availability(
                &mut tx,
                &lines,
                &sku_codes_by_id,
                origin,
                owner_site_id.as_deref().unwrap_or(&source_site_id),
            )
            .await?
        }
        None => load_create_availability(&mut tx, &lines).await?,
    };
    let mut requested_allotments = HashMap::<(String, Uuid), i64>::new();

    let allotment_id = Uuid::new_v4();
    let sequence = sqlx::query("SELECT nextval('allotment_number_sequence')::bigint sequence")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("sequence");
    let allotment_number = format!("ALT-{sequence:08}");
    let now = Utc::now();
    sqlx::query("INSERT INTO allotment(id,allotment_number,type,purpose,status,created_by,notes,idempotency_key,created_at,updated_at,activation_target_origin_id,edge_application_status) VALUES($1,$2,$3,$9,'ACTIVE',$4,$5,$6,$7,$7,$8,CASE WHEN $8 IS NULL THEN NULL ELSE 'PENDING' END)")
        .bind(allotment_id)
        .bind(&allotment_number)
        .bind(request.allotment_type.as_str())
        .bind(request.actor_id.trim())
        .bind(request.notes.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(&request.idempotency_key)
        .bind(now)
        .bind(activation_target_origin_id.as_deref())
        .bind(purpose.map(AllotmentPurpose::as_str))
        .execute(&mut *tx)
        .await?;

    let mut response_lines = Vec::with_capacity(lines.len());
    let mut flow_lines = Vec::with_capacity(lines.len());
    let line_count = lines.len();
    let mut line_ids = Vec::with_capacity(line_count);
    let mut line_source_sites = Vec::with_capacity(line_count);
    let mut line_source_pools = Vec::with_capacity(line_count);
    let mut line_destination_types = Vec::with_capacity(line_count);
    let mut line_destinations = Vec::with_capacity(line_count);
    let mut line_skus = Vec::with_capacity(line_count);
    let mut line_quantities = Vec::with_capacity(line_count);
    let mut event_details = Vec::with_capacity(line_count);
    for line in lines {
        let sku_code = sku_codes_by_id
            .get(&line.identity.sku_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("sku {}", line.identity.sku_id)))?;
        let (normal_quantity, persisted_allotted_quantity) = availability
            .get(&(line.identity.source_pool_id.clone(), line.identity.sku_id))
            .copied()
            .ok_or_else(|| {
                AppError::Conflict(format!(
                    "could not determine availability for SKU {} at {}",
                    line.identity.sku_id, line.identity.source_pool_id
                ))
            })?;
        let pair = (line.identity.source_pool_id.clone(), line.identity.sku_id);
        // As lines are committed below, the old per-line reads saw earlier
        // lines from this same request. Preserve that sequential reservation
        // when the reads and writes are batched.
        let allotted_quantity = persisted_allotted_quantity
            .checked_add(requested_allotments.get(&pair).copied().unwrap_or_default())
            .ok_or_else(|| AppError::Conflict("allotment quantity overflow".into()))?;
        let on_hand_quantity = normal_quantity - allotted_quantity;
        if line.quantity > on_hand_quantity {
            return Err(AppError::Conflict(format!(
                "cannot allot SKU {} from {}: fact-derived available quantity {on_hand_quantity}, requested {}",
                line.identity.sku_id, line.identity.source_pool_id, line.quantity
            )));
        }

        let line_id = Uuid::new_v4();
        line_ids.push(line_id);
        line_source_sites.push(line.identity.source_site_id.clone());
        line_source_pools.push(line.identity.source_pool_id.clone());
        line_destination_types.push(line.identity.destination_type.as_str().to_owned());
        line_destinations.push(line.identity.destination_id.clone());
        line_skus.push(line.identity.sku_id);
        line_quantities.push(line.quantity);
        flow_lines.push((
            line.identity.source_site_id.clone(),
            line.identity.destination_type,
            line.identity.destination_id.clone(),
            line.identity.sku_id,
            line.quantity,
        ));
        if activation_target_origin_id.is_none() {
            event_details.push(json!({
                "id":line_id,
                "ordinal":event_details.len() as i64,
                "normal_qty": normal_quantity,
                "allotted_qty_before": allotted_quantity,
                "on_hand_qty_before": on_hand_quantity,
                "on_hand_qty_after": on_hand_quantity - line.quantity
            }));
        }
        let requested = requested_allotments.entry(pair).or_default();
        *requested = requested
            .checked_add(line.quantity)
            .ok_or_else(|| AppError::Conflict("allotment quantity overflow".into()))?;
        response_lines.push(json!({
            "id":line_id,
            "source_site_id":line.identity.source_site_id,
            "source_pool_id":line.identity.source_pool_id,
            "destination_type":line.identity.destination_type.as_str(),
            "destination_id":line.identity.destination_id,
            "sku_id":line.identity.sku_id,
            "sku_code":sku_code,
            "quantity":line.quantity,
            // Kept for the wire; the commitment no longer waits on it.
            "accepted_quantity":if activation_target_origin_id.is_some() { 0 } else { line.quantity },
            "picked_quantity":0,
            "packed_quantity":0,
            "shipment_quantity":0,
            "dispatched_quantity":0,
            "in_transit_quantity":0,
            "received_quantity":0,
            "cancelled_quantity":0,
            // Was 0 whenever a DC owned the line, because the old model only
            // counted a commitment the DC had accepted. MD's promise binds the
            // shelf when MD makes it: a command still in flight is a delivery
            // state, not a reason for two merchandisers to promise the same
            // shirt.
            "remaining_allotted":line.quantity,
            "to_receive_qty":line.quantity,
            "on_hand_qty_before":on_hand_quantity,
            "on_hand_qty_after":on_hand_quantity-line.quantity
        }));
    }

    // Lines precede their immutable creation events because the latter carry
    // line foreign keys. One statement writes both: the line INSERT returns
    // the rows it wrote and the event INSERT takes them from there, joined
    // to each line's before/after detail. The route trigger (0925) still
    // sees one statement. When a node owns the ledger the events belong to
    // its replay, and only the lines travel.
    if activation_target_origin_id.is_none() {
        sqlx::query(
            "WITH line AS (
                 INSERT INTO allotment_line
                      (id,allotment_id,source_site_id,source_pool_id,destination_type,
                       destination_id,sku_id,quantity)
                 SELECT l.id,$1,l.source_site_id,l.source_pool_id,
                        l.destination_type,l.destination_id,l.sku_id,l.quantity
                   FROM unnest($2::uuid[],$3::text[],$4::text[],$5::text[],$6::text[],$7::uuid[],$8::bigint[])
                     AS l(id,source_site_id,source_pool_id,destination_type,destination_id,sku_id,quantity)
                 RETURNING id,sku_id,source_site_id,source_pool_id,destination_type,destination_id,quantity
             ), detail AS (
                 SELECT * FROM jsonb_to_recordset($9::jsonb)
                   AS detail(id uuid,ordinal bigint,normal_qty bigint,
                             allotted_qty_before bigint,on_hand_qty_before bigint,
                             on_hand_qty_after bigint)
             )
             INSERT INTO allotment_event
                  (id,event_key,allotment_id,allotment_line_id,event_type,sku_id,
                   source_site_id,source_pool_id,destination_type,destination_id,
                   quantity,remaining_delta,actor_id,details,occurred_at)
             SELECT line.id,$10 || ':created:' || line.id::text,$1,line.id,
                    'ALLOTMENT_CREATED',line.sku_id,line.source_site_id,
                    line.source_pool_id,line.destination_type,line.destination_id,
                    line.quantity,line.quantity,$11,
                    jsonb_build_object('normal_qty',detail.normal_qty,
                                       'allotted_qty_before',detail.allotted_qty_before,
                                       'on_hand_qty_before',detail.on_hand_qty_before,
                                       'on_hand_qty_after',detail.on_hand_qty_after),
                    $12
               FROM line JOIN detail ON detail.id = line.id
              ORDER BY detail.ordinal",
        )
        .bind(allotment_id)
        .bind(&line_ids)
        .bind(&line_source_sites)
        .bind(&line_source_pools)
        .bind(&line_destination_types)
        .bind(&line_destinations)
        .bind(&line_skus)
        .bind(&line_quantities)
        .bind(json!(event_details))
        .bind(&request.idempotency_key)
        .bind(request.actor_id.trim())
        .bind(now)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO allotment_line
                 (id,allotment_id,source_site_id,source_pool_id,destination_type,
                  destination_id,sku_id,quantity)
             SELECT l.id,$1,l.source_site_id,l.source_pool_id,
                    l.destination_type,l.destination_id,l.sku_id,l.quantity
               FROM unnest($2::uuid[],$3::text[],$4::text[],$5::text[],$6::text[],$7::uuid[],$8::bigint[])
                 AS l(id,source_site_id,source_pool_id,destination_type,destination_id,sku_id,quantity)",
        )
        .bind(allotment_id)
        .bind(&line_ids)
        .bind(&line_source_sites)
        .bind(&line_source_pools)
        .bind(&line_destination_types)
        .bind(&line_destinations)
        .bind(&line_skus)
        .bind(&line_quantities)
        .execute(&mut *tx)
        .await?;
    }

    // Each destination's flow document, from the route's template. A return
    // to a supplier is the buyer's to raise; everything else is MD's.
    if let Some(actor) = actor {
        let as_role = match request.allotment_type {
            AllotmentType::ReturnToSupplier => crate::cloud::domain::flow::FlowRole::HoBuyer,
            AllotmentType::ToSite | AllotmentType::ReturnToWarehouse => {
                crate::cloud::domain::flow::FlowRole::HoMd
            }
        };
        super::flows::start_flow_for_allotment_tx(
            &mut tx,
            allotment_id,
            &flow_lines,
            actor,
            as_role,
            now,
        )
        .await?;
    }

    let total_quantity: i64 = response_lines
        .iter()
        .filter_map(|line| line["quantity"].as_i64())
        .sum();
    let mut activation_command_id = None;
    if let Some(target_origin_id) = activation_target_origin_id.as_ref() {
        // Everything below crosses the wire, so everything below is respelled.
        // The Edge checks the site against its own `node_metadata` and the pool
        // against its own place model, and refuses both if they name a
        // warehouse it is not — which is what it should do, and why the
        // translation belongs here rather than in a lenient parser over there.
        let command_site_id = owner_site_id.as_deref().unwrap_or(&source_site_id);
        // A destination goes on the wire as the node that owns it spells it,
        // so that the koli, both transfer claims and the announcement name ONE
        // site: a shop's return is packed for `dc-01`, the name the Gudang's
        // node answers to, not the centre's `dc` (inventory-fleet G1). Every
        // shop is spelled the same on both sides.
        let mut wire_destinations = HashMap::<String, String>::new();
        for line in &response_lines {
            let destination = line["destination_id"].as_str().unwrap_or_default();
            if line["destination_type"].as_str() != Some("SUPPLIER")
                && !wire_destinations.contains_key(destination)
            {
                let spelled = if validation.node_spelling_may_differ(destination) {
                    super::sync::node_site_id_tx(&mut tx, destination).await?
                } else {
                    destination.to_string()
                };
                wire_destinations.insert(destination.to_string(), spelled);
            }
        }
        let command_lines = response_lines
            .iter()
            .map(|line| {
                Ok(AllotmentActivationLine {
                    allotment_line_id: serde_json::from_value(line["id"].clone())?,
                    source_pool_id: pool_id_for_site(
                        line["source_pool_id"].as_str().unwrap_or_default(),
                        command_site_id,
                    ),
                    destination_type: line["destination_type"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    destination_id: {
                        let destination = line["destination_id"].as_str().unwrap_or_default();
                        wire_destinations
                            .get(destination)
                            .cloned()
                            .unwrap_or_else(|| destination.to_string())
                    },
                    sku_id: serde_json::from_value(line["sku_id"].clone())?,
                    sku_code: line["sku_code"].as_str().unwrap_or_default().to_string(),
                    quantity: line["quantity"].as_i64().unwrap_or_default(),
                })
            })
            .collect::<Result<Vec<_>, serde_json::Error>>()?;
        let command_payload = AllotmentActivationPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            allotment_id,
            allotment_number: allotment_number.clone(),
            // The old word, which every build in the field reads.
            allotment_type: request.allotment_type.wire_code().to_string(),
            status: "ACTIVE".into(),
            source_site_id: command_site_id.to_string(),
            created_by: request.actor_id.trim().to_string(),
            notes: request.notes.clone(),
            created_at: now,
            lines: command_lines,
        };
        let payload = serde_json::to_value(command_payload)?;
        let command_id = issue_command_tx(
            &mut tx,
            INVENTORY_ALLOTMENT_ACTIVATE_V1,
            &payload,
            request.actor_id.trim(),
            None,
            std::slice::from_ref(target_origin_id),
        )
        .await?;
        sqlx::query("UPDATE allotment SET activation_command_id=$2 WHERE id=$1")
            .bind(allotment_id)
            .bind(command_id)
            .execute(&mut *tx)
            .await?;
        activation_command_id = Some(command_id);
    }

    let response = json!({
        "id":allotment_id,
        "allotment_number":allotment_number,
        "type":request.allotment_type.as_str(),
        "purpose":purpose.map(AllotmentPurpose::as_str),
        "status":"ACTIVE",
        "total_quantity":total_quantity,
        "total_picked_quantity":0,
        "total_cancelled_quantity":0,
        "remaining_allotted":total_quantity,
        "to_receive_qty":total_quantity,
        "remaining_quantity":if activation_command_id.is_some() { 0 } else { total_quantity },
        "edge_application_status":if activation_command_id.is_some() { json!("PENDING") } else { Value::Null },
        "created_by":request.actor_id.trim(),
        "notes":request.notes,
        "created_at":now,
        "lines":response_lines,
        "activation_command_id":activation_command_id,
        "activation_target_origin_id":activation_target_origin_id,
        // The wire word; a shop that executes its own return answers here too.
        "execution_authority":if activation_command_id.is_some() { "EDGE_DC" } else { "CLOUD" },
        "inventory_effect":{"movement_count":0,"ledger_changed":false}
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn cancel_allotment(
    pool: &PgPool,
    allotment_id: Uuid,
    request: CancelAllotmentRequest,
) -> Result<Value, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "cancellation reason is required".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CANCEL_ALLOTMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    let header = lock_open_allotment(&mut tx, allotment_id).await?;
    if let Some(target_origin_id) = header.get::<Option<String>, _>("activation_target_origin_id") {
        if header
            .get::<Option<String>, _>("edge_application_status")
            .as_deref()
            != Some("ACCEPTED")
        {
            return Err(AppError::Conflict(
                "Edge-owned Allotment must be accepted by its DC before cancellation".into(),
            ));
        }
        if header
            .get::<Option<Uuid>, _>("cancellation_command_id")
            .is_some()
            || header
                .get::<Option<String>, _>("edge_cancellation_status")
                .is_some()
        {
            return Err(AppError::Conflict(
                "Edge-owned Allotment already has a cancellation workflow".into(),
            ));
        }

        let lines = sqlx::query(
            "SELECT line.id,line.source_site_id,line.source_pool_id,line.destination_type,
                    line.destination_id,line.sku_id,progress.accepted_quantity,
                    progress.picked_quantity,progress.cancelled_quantity
             FROM allotment_line line
             JOIN edge_allotment_line_progress progress
               ON progress.allotment_line_id=line.id
              AND progress.allotment_id=line.allotment_id
              AND progress.origin_id=$2
             WHERE line.allotment_id=$1
             ORDER BY line.id FOR UPDATE OF line,progress",
        )
        .bind(allotment_id)
        .bind(&target_origin_id)
        .fetch_all(&mut *tx)
        .await?;
        let authored_count: i64 = sqlx::query(
            "SELECT count(*)::bigint AS count FROM allotment_line WHERE allotment_id=$1",
        )
        .bind(allotment_id)
        .fetch_one(&mut *tx)
        .await?
        .get("count");
        if lines.is_empty() || i64::try_from(lines.len()).ok() != Some(authored_count) {
            return Err(AppError::Conflict(
                "accepted Edge Allotment line projection is incomplete".into(),
            ));
        }

        let source_site_id = lines[0].get::<String, _>("source_site_id");
        let mut command_lines = Vec::with_capacity(lines.len());
        let mut accepted_total = 0_i64;
        let mut picked_total = 0_i64;
        let mut cancelled_total = 0_i64;
        for line in &lines {
            if line.get::<String, _>("source_site_id") != source_site_id {
                return Err(AppError::Conflict(
                    "Edge-owned Allotment spans more than one source site".into(),
                ));
            }
            let accepted = line.get::<i64, _>("accepted_quantity");
            if accepted <= 0 {
                return Err(AppError::Conflict(
                    "Edge-owned cancellation requires every line to be fully accepted".into(),
                ));
            }
            accepted_total = accepted_total
                .checked_add(accepted)
                .ok_or_else(|| AppError::Conflict("accepted quantity overflow".into()))?;
            picked_total = picked_total
                .checked_add(line.get::<i64, _>("picked_quantity"))
                .ok_or_else(|| AppError::Conflict("picked quantity overflow".into()))?;
            cancelled_total = cancelled_total
                .checked_add(line.get::<i64, _>("cancelled_quantity"))
                .ok_or_else(|| AppError::Conflict("cancelled quantity overflow".into()))?;
            command_lines.push(AllotmentCancellationLine {
                allotment_line_id: line.get("id"),
                quantity: accepted,
            });
        }
        let remaining = accepted_total
            .checked_sub(picked_total)
            .and_then(|quantity| quantity.checked_sub(cancelled_total))
            .filter(|quantity| *quantity >= 0)
            .ok_or_else(|| AppError::Conflict("invalid Edge reservation progress".into()))?;
        let cancellation_id = Uuid::new_v4();
        let requested_at = Utc::now();
        // The owner's own name, for the same reason the activation carries it:
        // the Edge matches this against its `node_metadata` and against the
        // `dc_allotment_work` row it filed under that name, and a DC running as
        // `dc-01` recognises neither under the centre's `dc`.
        let command_site_id = origin_site_id_tx(&mut tx, &target_origin_id).await?;
        let command_payload = AllotmentCancellationPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            cancellation_id,
            allotment_id,
            source_site_id: command_site_id,
            reason: request.reason.trim().to_string(),
            requested_by: request.actor_id.trim().to_string(),
            requested_at,
            lines: command_lines,
        };
        let command_id = issue_command_tx(
            &mut tx,
            INVENTORY_ALLOTMENT_CANCEL_V1,
            &serde_json::to_value(&command_payload)?,
            request.actor_id.trim(),
            None,
            std::slice::from_ref(&target_origin_id),
        )
        .await?;
        sqlx::query(
            "UPDATE allotment
             SET cancellation_id=$2,cancellation_command_id=$3,
                 edge_cancellation_status='PENDING',updated_at=$4
             WHERE id=$1",
        )
        .bind(allotment_id)
        .bind(cancellation_id)
        .bind(command_id)
        .bind(requested_at)
        .execute(&mut *tx)
        .await?;
        let cancellation_reference = cancellation_id.to_string();
        for line in &lines {
            let line_id: Uuid = line.get("id");
            let accepted: i64 = line.get("accepted_quantity");
            let identity = line_identity_from_row(line)?;
            insert_allotment_event(
                &mut tx,
                &format!("edge-cancellation:{cancellation_id}:requested:{line_id}"),
                Some(allotment_id),
                Some(line_id),
                "ALLOTMENT_CANCELLATION_REQUESTED",
                Some(&identity),
                accepted,
                0,
                None,
                Some("ALLOTMENT_CANCELLATION"),
                Some(&cancellation_reference),
                request.actor_id.trim(),
                json!({
                    "reason": request.reason.trim(),
                    "cancellation_id": cancellation_id,
                    "cancellation_command_id": command_id,
                    "reservation_changed": false
                }),
                requested_at,
            )
            .await?;
        }

        let response = json!({
            "id":allotment_id,
            "allotment_number":header.get::<String,_>("allotment_number"),
            "type":header.get::<String,_>("type"),
            "status":header.get::<String,_>("status"),
            "cancellation_id":cancellation_id,
            "cancellation_command_id":command_id,
            "edge_cancellation_status":"PENDING",
            "requested_cancellation_quantity":accepted_total,
            "cancelled_quantity":cancelled_total,
            "blocked_picked_quantity":Value::Null,
            "remaining_quantity":remaining,
            "requested_at":requested_at,
            "cancellation":{
                "status":"PENDING",
                "reason":request.reason.trim(),
                "requested_by":request.actor_id.trim(),
                "lines":command_payload.lines
            },
            "inventory_effect":{
                "movement_count":0,
                "ledger_changed":false,
                "reservation_changed":false
            }
        });
        complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
        tx.commit().await?;
        return Ok(response);
    }

    // A cloud-run allotment is cancelled at any stage before it is sent
    // (owner, 9 Oct 2026): every line comes down to what is already on a
    // delivery note, by the same act as MD's edit in place
    // (`allotment_amend`), written as a CANCEL. Demand nobody packed yet is
    // closed at once — picked pieces waiting in the pick area included, which
    // no longer go on to the store but are owed back to the racks; pieces in
    // cartons that have not left are owed back too, and the Gudang moves them.
    // Sent stays sent.
    let now = Utc::now();
    let reason = request.reason.trim();
    let actor_id = request.actor_id.trim();
    let standing = super::allotment_amend::lock_lines_tx(&mut tx, allotment_id).await?;
    // Only while nothing is sent (owner, 10 Oct 2026): once a piece is on a
    // delivery note the allotment is not called off — MD edits the rest down
    // to nought instead, and what was sent keeps its history.
    let already_sent: i64 = standing.iter().map(|line| line.floor).sum();
    if already_sent > 0 {
        return Err(AppError::Conflict(format!(
            "{already_sent} pcs are already sent, so this allotment can no longer be cancelled. Edit the rest down instead."
        )));
    }
    let mut lines = Vec::with_capacity(standing.len());
    let mut released_total = 0_i64;
    let mut owed_total = 0_i64;
    let mut sent_total = 0_i64;
    for line in &standing {
        sent_total += line.floor;
        // Never raises a line: one whose target already sits at what is sent
        // has nothing left to give up.
        let to = line.floor.min(line.target);
        let amended = super::allotment_amend::apply_target_tx(
            &mut tx,
            allotment_id,
            line,
            to,
            true,
            Some(reason),
            actor_id,
            &request.idempotency_key,
            now,
        )
        .await?;
        released_total += amended.released;
        owed_total += amended.owed;
        lines.push(amended);
    }
    if released_total + owed_total == 0 && sent_total > 0 {
        return Err(AppError::Conflict(
            "Everything left on this allotment is already sent; there is nothing to cancel.".into(),
        ));
    }
    // The status is the view's, never a CANCELLED written by hand. While a
    // carton still holds pieces MD took out, or anything is on its way to a
    // store, the view keeps the allotment open and `refresh_allotment_status`
    // closes it once the carton is opened and the store has counted; a
    // CANCELLED header is final (0005) and would refuse that. Only an
    // allotment with nothing sent is stamped cancelled; a partly sent one
    // keeps its cancel in its CANCEL amendments.
    let totals = allotment_totals_tx(&mut tx, allotment_id).await?;
    let status = totals.legacy_status();
    let cancelled_at = (sent_total == 0).then_some(now);
    sqlx::query(
        "UPDATE allotment SET status=$2,cancelled_at=COALESCE($3,cancelled_at),updated_at=$4 WHERE id=$1",
    )
    .bind(allotment_id)
    .bind(status.as_str())
    .bind(cancelled_at)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let (owed_picked, owed_packed) = super::allotment_amend::owed_tx(&mut tx, allotment_id).await?;
    let response = json!({
        "id":allotment_id,
        "allotment_number":header.get::<String,_>("allotment_number"),
        "type":header.get::<String,_>("type"),
        "status":status.as_str(),
        "cancellation_status":"APPLIED",
        "edge_cancellation_status":Value::Null,
        // Everything this cancel gave up: released now plus owed back.
        "cancelled_quantity":released_total+owed_total,
        "total_cancelled_quantity":totals.cancelled,
        "remaining_quantity":totals.remaining(),
        "cancelled_at":cancelled_at,
        "released_total":released_total,
        "owed_total":owed_total,
        // What the Gudang now has to move back on this allotment: picked
        // pieces nobody wants, and pieces MD took out of unsent cartons.
        "owed_picked":owed_picked,
        "owed_packed":owed_packed,
        "sent_quantity":sent_total,
        "lines":lines,
        "inventory_effect":{"movement_count":0,"ledger_changed":false}
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn execute_allotment(
    pool: &PgPool,
    allotment_id: Uuid,
    request: ExecuteAllotmentRequest,
) -> Result<Value, AppError> {
    if request.quantity <= 0 {
        return Err(AppError::Validation(
            "execution quantity must be positive".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "EXECUTE_ALLOTMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    let header = lock_open_allotment(&mut tx, allotment_id).await?;
    if header
        .get::<Option<String>, _>("activation_target_origin_id")
        .is_some()
    {
        return Err(AppError::Conflict(
            "Edge-owned allotment must be picked by the authoritative DC".into(),
        ));
    }
    let line = sqlx::query("SELECT id,source_site_id,source_pool_id,destination_type,destination_id,sku_id,quantity,picked_quantity,cancelled_quantity FROM allotment_line WHERE id=$1 AND allotment_id=$2 FOR UPDATE")
        .bind(request.allotment_line_id)
        .bind(allotment_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("allotment line belonging to header".into()))?;
    let identity = line_identity_from_row(&line)?;
    lock_active_skus(&mut tx, &[identity.sku_id]).await?;

    let quantity: i64 = line.get("quantity");
    let picked_quantity: i64 = line.get("picked_quantity");
    let cancelled_quantity: i64 = line.get("cancelled_quantity");
    let remaining = quantity - picked_quantity - cancelled_quantity;
    if request.quantity > remaining {
        return Err(AppError::Conflict(format!(
            "cannot execute more than remaining allotment quantity: remaining {remaining}, requested {}",
            request.quantity
        )));
    }

    let allotment_type = AllotmentType::from_str(&header.get::<String, _>("type"))
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    // MD may have reduced or cancelled the line since the picklist was read
    // (docs/research/2026-10-09-outbound-cancel-edit-build.md): a pick never
    // fetches more than the line still wants, less what already waits for it
    // in the pick area (`dc_pick_waiting`, read for this one line).
    if matches!(allotment_type, AllotmentType::ToSite) {
        let still_wanted: i64 = sqlx::query_scalar(
            "SELECT (commitment.to_pack_qty - COALESCE((
                        SELECT SUM(LEAST(piece.quantity, projection.quantity - newer.quantity))
                          FROM dc_pick_piece piece
                          JOIN inventory_projection projection
                            ON projection.subject_id = piece.subject_id
                           AND projection.place_id = piece.place_id
                         CROSS JOIN LATERAL (
                               SELECT COALESCE(SUM(later.quantity), 0)::bigint AS quantity
                                 FROM dc_pick_piece later
                                WHERE later.subject_id = piece.subject_id
                                  AND later.place_id = piece.place_id
                                  AND later.seq > piece.seq) newer
                         WHERE piece.allotment_line_id = commitment.allotment_line_id
                           AND projection.quantity - newer.quantity > 0), 0))::bigint
               FROM allotment_line_commitment commitment
              WHERE commitment.allotment_line_id = $1",
        )
        .bind(request.allotment_line_id)
        .fetch_one(&mut *tx)
        .await?;
        if request.quantity > still_wanted {
            return Err(AppError::Conflict(format!(
                "this line no longer wants that many: {} still to pick, {} requested",
                still_wanted.max(0),
                request.quantity
            )));
        }
    }
    let (cause, destination_place_id) =
        execution_transition(&mut tx, allotment_type, &identity).await?;
    let source_place_id = format!("{}:on_hand", identity.source_pool_id);
    let movement_lines = allocate_source_subjects(
        &mut tx,
        identity.sku_id,
        request.quantity,
        &source_place_id,
        &destination_place_id,
    )
    .await?;
    let movement_group_id = MovementGroupId::new();
    let now = Utc::now();
    let movement = MovementCommand {
        movement_group_id,
        lines: movement_lines,
        cause,
        reference_type: Some("ALLOTMENT_LINE".into()),
        reference_id: Some(request.allotment_line_id.to_string()),
        reason: format!(
            "Execute {} units for {} line {}",
            request.quantity,
            header.get::<String, _>("allotment_number"),
            request.allotment_line_id
        ),
        actor_id: request.actor_id.trim().into(),
        occurred_at: now,
    };
    crate::cloud::domain::validate_command(&movement)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let movement_key = format!("{}:inventory", request.idempotency_key);
    insert_group(&mut tx, &movement, &movement_key, &digest).await?;
    let movement_ids = apply_lines(&mut tx, &movement, &movement_key, &digest).await?;

    sqlx::query(
        "UPDATE allotment_line SET picked_quantity=picked_quantity+$2,updated_at=$3 WHERE id=$1",
    )
    .bind(request.allotment_line_id)
    .bind(request.quantity)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let totals = allotment_totals_tx(&mut tx, allotment_id).await?;
    let status = totals.legacy_status();
    // Reported because this route still has to answer with it; it is not read
    // by anything that decides anything, and it goes out with the route in
    // step 3. A pick commits to no store, so it moves neither the status above
    // nor `remaining_quantity` below.
    let picked_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(picked_quantity),0)::bigint FROM allotment_line WHERE allotment_id=$1",
    )
    .bind(allotment_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE allotment SET status=$2,updated_at=$3 WHERE id=$1")
        .bind(allotment_id)
        .bind(status.as_str())
        .bind(now)
        .execute(&mut *tx)
        .await?;
    insert_allotment_event(
        &mut tx,
        &format!(
            "{}:picked:{}",
            request.idempotency_key, request.allotment_line_id
        ),
        Some(allotment_id),
        Some(request.allotment_line_id),
        "ALLOTMENT_PICKED",
        Some(&identity),
        request.quantity,
        -request.quantity,
        Some(movement_group_id.0),
        Some("ALLOTMENT_LINE"),
        Some(&request.allotment_line_id.to_string()),
        request.actor_id.trim(),
        json!({"source":source_place_id,"destination":destination_place_id}),
        now,
    )
    .await?;

    let response = json!({
        "id":allotment_id,
        "allotment_number":header.get::<String,_>("allotment_number"),
        "type":allotment_type.as_str(),
        "status":status.as_str(),
        "allotment_line_id":request.allotment_line_id,
        "source_site_id":identity.source_site_id,
        "source_pool_id":identity.source_pool_id,
        "destination_type":identity.destination_type.as_str(),
        "destination_id":identity.destination_id,
        "sku_id":identity.sku_id,
        "picked_quantity":request.quantity,
        "total_picked_quantity":picked_total,
        "remaining_quantity":totals.remaining(),
        "movement_group_id":movement_group_id.0,
        "movement_ids":movement_ids,
        "inventory_effect":format!("{source_place_id} -> {destination_place_id}")
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn get_allotment(pool: &PgPool, allotment_id: Uuid) -> Result<Value, AppError> {
    let header = sqlx::query("SELECT id,allotment_number,type,status,created_by,notes,created_at,updated_at,cancelled_at,activation_command_id,activation_target_origin_id,edge_application_status,edge_application_result_id,edge_application_received_at,cancellation_id,cancellation_command_id,edge_cancellation_status,edge_cancellation_result_id,edge_cancellation_received_at FROM allotment WHERE id=$1")
        .bind(allotment_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("allotment".into()))?;
    let cancellation_command = if let Some(command_id) =
        header.get::<Option<Uuid>, _>("cancellation_command_id")
    {
        let row = sqlx::query("SELECT command_type,payload FROM sync_command WHERE command_id=$1")
            .bind(command_id)
            .fetch_one(pool)
            .await?;
        if row.get::<String, _>("command_type") != INVENTORY_ALLOTMENT_CANCEL_V1 {
            return Err(AppError::Conflict(
                "Allotment cancellation command has the wrong type".into(),
            ));
        }
        Some(
            parse_allotment_cancellation(&row.get::<Value, _>("payload"))
                .map_err(AppError::Conflict)?,
        )
    } else {
        None
    };
    let cancellation_result =
        if let Some(result_id) = header.get::<Option<Uuid>, _>("edge_cancellation_result_id") {
            sqlx::query(
                "SELECT outcome,reason,lines,applied_at
             FROM edge_allotment_cancellation_result WHERE result_id=$1",
            )
            .bind(result_id)
            .fetch_optional(pool)
            .await?
        } else {
            None
        };
    let cancellation_result_lines = cancellation_result
        .as_ref()
        .map(|row| {
            serde_json::from_value::<Vec<AllotmentCancellationResultLine>>(
                row.get::<Value, _>("lines"),
            )
        })
        .transpose()?;
    let cancellation_requested_by_line = cancellation_command
        .as_ref()
        .map(|payload| {
            payload
                .lines
                .iter()
                .map(|line| (line.allotment_line_id, line.quantity))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let cancellation_result_by_line = cancellation_result_lines
        .as_ref()
        .map(|lines| {
            lines
                .iter()
                .map(|line| (line.allotment_line_id, line))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let lines = sqlx::query("SELECT l.id,l.source_site_id,l.source_pool_id,l.destination_type,l.destination_id,l.sku_id,sk.sku_code,ar.article_code,ar.name article_name,l.quantity,COALESCE(progress.accepted_quantity,CASE WHEN header.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END)::bigint accepted_quantity,COALESCE(progress.picked_quantity,l.picked_quantity)::bigint picked_quantity,COALESCE(progress.packed_quantity,l.packed_quantity)::bigint packed_quantity,COALESCE(progress.shipment_quantity,l.shipment_quantity)::bigint shipment_quantity,COALESCE(progress.dispatched_quantity,l.dispatched_quantity)::bigint dispatched_quantity,COALESCE(progress.in_transit_quantity,l.in_transit_quantity)::bigint in_transit_quantity,COALESCE(progress.received_quantity,l.received_quantity)::bigint received_quantity,COALESCE(progress.cancelled_quantity,l.cancelled_quantity)::bigint cancelled_quantity,commitment.to_pack_qty::bigint remaining_allotted,commitment.to_receive_qty::bigint to_receive_qty,commitment.receiving_gap_qty::bigint receiving_gap_qty,COALESCE(commitment.at_packed,0)::bigint at_packed,COALESCE(commitment.at_shipment,0)::bigint at_shipment,COALESCE(commitment.at_loaded,0)::bigint at_loaded,COALESCE(commitment.at_in_transit,0)::bigint at_in_transit,COALESCE(commitment.closed_short_total,0)::bigint closed_short,COALESCE(commitment.at_shipment+commitment.at_loaded+commitment.at_in_transit+commitment.receiving_gap_qty+commitment.received,0)::bigint sent_quantity,l.takeout_pending_quantity::bigint takeout_pending_quantity,GREATEST(l.quantity-COALESCE(amended.taken,0),0)::bigint target_quantity,ar.id article_id,ar.image_url,sk.color colour,sk.size size,destination.name destination_name,l.created_at,l.updated_at FROM allotment_line l JOIN allotment header ON header.id=l.allotment_id JOIN sku sk ON sk.id=l.sku_id JOIN article ar ON ar.id=sk.article_id LEFT JOIN edge_allotment_line_progress progress ON progress.allotment_line_id=l.id LEFT JOIN allotment_line_commitment commitment ON commitment.allotment_line_id=l.id LEFT JOIN (SELECT allotment_line_id,SUM(released+owed)::bigint taken FROM allotment_amendment WHERE allotment_id=$1 AND kind IN ('REDUCE','CANCEL') GROUP BY allotment_line_id) amended ON amended.allotment_line_id=l.id LEFT JOIN site destination ON destination.id=l.destination_id WHERE l.allotment_id=$1 ORDER BY l.source_pool_id,l.destination_type,l.destination_id,sk.sku_code")
        .bind(allotment_id)
        .fetch_all(pool)
        .await?;
    let events = sqlx::query("SELECT id,event_sequence,event_type,sku_id,source_site_id,source_pool_id,destination_type,destination_id,quantity,remaining_delta,movement_group_id,reference_type,reference_id,actor_id,details,occurred_at,recorded_at FROM allotment_event WHERE allotment_id=$1 ORDER BY event_sequence")
        .bind(allotment_id)
        .fetch_all(pool)
        .await?;
    let movements = sqlx::query("SELECT m.movement_id,m.movement_group_id,m.subject_id,m.quantity,m.from_place_id,m.to_place_id,m.cause,m.reference_type,m.reference_id,l.id allotment_line_id,l.destination_type,l.destination_id,m.actor_id,m.occurred_at,m.recorded_at FROM movement m LEFT JOIN allotment_line l ON m.reference_type='ALLOTMENT_LINE' AND m.reference_id=l.id::text WHERE (l.allotment_id=$1) OR (m.reference_type='ALLOTMENT' AND m.reference_id=$1::text) ORDER BY m.fact_sequence")
        .bind(allotment_id)
        .fetch_all(pool)
        .await?;
    let received_rows = sqlx::query(
        "SELECT attribution.allotment_line_id,attribution.koli_id,
                attribution.epc,attribution.receipt_event_id,
                attribution.in_transit_event_id,attribution.matched_at,
                receipt.receipt_id,receipt.movement_group_id AS receipt_movement_group_id,
                receipt.occurred_at AS received_at,receipt.source_dc_id,
                receipt.destination_store_id,receipt.shipment_reference,
                receipt.sku_code,
                in_transit.movement_group_id AS in_transit_movement_group_id
         FROM edge_transfer_allotment_attribution attribution
         JOIN edge_transfer_claim receipt
           ON receipt.event_id=attribution.receipt_event_id
         JOIN edge_transfer_claim in_transit
           ON in_transit.event_id=attribution.in_transit_event_id
         WHERE attribution.allotment_id=$1
         ORDER BY attribution.allotment_line_id,attribution.epc",
    )
    .bind(allotment_id)
    .fetch_all(pool)
    .await?;
    let mut received_breakdown = BTreeMap::<Uuid, Vec<Value>>::new();
    for row in received_rows {
        received_breakdown
            .entry(row.get("allotment_line_id"))
            .or_default()
            .push(json!({
                "epc": row.get::<String, _>("epc"),
                "sku_code": row.get::<String, _>("sku_code"),
                "koli_id": row.get::<Uuid, _>("koli_id"),
                "source_dc_id": row.get::<Option<String>, _>("source_dc_id"),
                "destination_store_id": row.get::<String, _>("destination_store_id"),
                "shipment_reference": row.get::<Option<String>, _>("shipment_reference"),
                "receipt_id": row.get::<Option<Uuid>, _>("receipt_id"),
                "receipt_event_id": row.get::<Uuid, _>("receipt_event_id"),
                "in_transit_event_id": row.get::<Uuid, _>("in_transit_event_id"),
                "receipt_movement_group_id": row.get::<Uuid, _>("receipt_movement_group_id"),
                "in_transit_movement_group_id": row.get::<Uuid, _>("in_transit_movement_group_id"),
                "received_at": row.get::<DateTime<Utc>, _>("received_at"),
                "matched_at": row.get::<DateTime<Utc>, _>("matched_at"),
            }));
    }
    let line_values: Vec<Value> = lines
        .iter()
        .map(|row| {
            let line_id = row.get::<Uuid, _>("id");
            let received_quantity = row.get::<i64, _>("received_quantity");
            let breakdown = received_breakdown
                .get(&line_id)
                .cloned()
                .unwrap_or_default();
            let breakdown_quantity = i64::try_from(breakdown.len()).unwrap_or(i64::MAX);
            json!({
                "id":line_id,
                "source_site_id":row.get::<String,_>("source_site_id"),
                "source_pool_id":row.get::<String,_>("source_pool_id"),
                "destination_type":row.get::<String,_>("destination_type"),
                "destination_id":row.get::<String,_>("destination_id"),
                "sku_id":row.get::<Uuid,_>("sku_id"),
                "sku_code":row.get::<String,_>("sku_code"),
                "article_code":row.get::<String,_>("article_code"),
                "article_name":row.get::<String,_>("article_name"),
                "quantity":row.get::<i64,_>("quantity"),
                "accepted_quantity":row.get::<i64,_>("accepted_quantity"),
                "picked_quantity":row.get::<i64,_>("picked_quantity"),
                "packed_quantity":row.get::<i64,_>("packed_quantity"),
                "shipment_quantity":row.get::<i64,_>("shipment_quantity"),
                "dispatched_quantity":row.get::<i64,_>("dispatched_quantity"),
                "in_transit_quantity":row.get::<i64,_>("in_transit_quantity"),
                "received_quantity":received_quantity,
                "cancelled_quantity":row.get::<i64,_>("cancelled_quantity"),
                "remaining_allotted":row.get::<i64,_>("remaining_allotted"),
                "to_receive_qty":row.get::<i64,_>("to_receive_qty"),
                "receiving_gap_qty":row.get::<i64,_>("receiving_gap_qty"),
                // The line as allotment V1 §12 reads it, straight off the view.
                // The identity beside it is what lets the sheet draw the
                // allotment in the shape it was raised in — SKUs down, stores
                // across — without a catalogue read per row.
                "to_pack_qty":row.get::<i64,_>("remaining_allotted"),
                "at_packed_qty":row.get::<i64,_>("at_packed"),
                "at_shipment_qty":row.get::<i64,_>("at_shipment"),
                "at_loaded_qty":row.get::<i64,_>("at_loaded"),
                "at_in_transit_qty":row.get::<i64,_>("at_in_transit"),
                "closed_short_qty":row.get::<i64,_>("closed_short"),
                // What MD wants the store to end up with: what she allotted,
                // additions included, less what her reductions and cancels
                // took; what is on a delivery note or beyond (the lowest an
                // edit may go); and what MD took out of cartons the Gudang
                // has not opened yet. As `allotment_amend` reads them.
                "target_quantity":row.get::<i64,_>("target_quantity"),
                "sent_quantity":row.get::<i64,_>("sent_quantity"),
                "takeout_pending_quantity":row.get::<i64,_>("takeout_pending_quantity"),
                "article_id":row.get::<Uuid,_>("article_id"),
                "image_url":row.get::<Option<String>,_>("image_url"),
                "colour":row.get::<Option<String>,_>("colour"),
                "size":row.get::<Option<String>,_>("size"),
                "destination_name":row.get::<Option<String>,_>("destination_name"),
                "cancellation_requested_quantity":cancellation_requested_by_line.get(&line_id).copied(),
                "cancellation_actual_cancelled_quantity":cancellation_result_by_line.get(&line_id).map(|line| line.cancelled_quantity),
                "cancellation_blocked_picked_quantity":cancellation_result_by_line.get(&line_id).map(|line| line.blocked_picked_quantity),
                "received_breakdown_quantity": breakdown_quantity,
                "received_projection_consistent": received_quantity == breakdown_quantity,
                "received_breakdown": breakdown,
            })
        })
        .collect();
    // The detail already holds every line, so the three counts the list row
    // carries are folded from what is in hand rather than asked of the
    // database a second time. Destinations are counted as the pair, because
    // the id alone is only unique within its kind.
    let line_count = i64::try_from(lines.len()).unwrap_or(i64::MAX);
    let sku_count = i64::try_from(
        lines
            .iter()
            .map(|row| row.get::<Uuid, _>("sku_id"))
            .collect::<HashSet<_>>()
            .len(),
    )
    .unwrap_or(i64::MAX);
    let destination_count = i64::try_from(
        lines
            .iter()
            .map(|row| {
                (
                    row.get::<String, _>("destination_type"),
                    row.get::<String, _>("destination_id"),
                )
            })
            .collect::<HashSet<_>>()
            .len(),
    )
    .unwrap_or(i64::MAX);
    let total_quantity: i64 = lines.iter().map(|row| row.get::<i64, _>("quantity")).sum();
    // Folded off the view, line by line, rather than subtracted here: a
    // rollup that does its own arithmetic is a second model of the same thing.
    let total_to_pack: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("remaining_allotted"))
        .sum();
    let total_to_receive: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("to_receive_qty"))
        .sum();
    let total_receiving_gap: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("receiving_gap_qty"))
        .sum();
    let total_at_packed: i64 = lines.iter().map(|row| row.get::<i64, _>("at_packed")).sum();
    let total_at_shipment: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("at_shipment"))
        .sum();
    let total_at_loaded: i64 = lines.iter().map(|row| row.get::<i64, _>("at_loaded")).sum();
    let total_at_in_transit: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("at_in_transit"))
        .sum();
    let total_closed_short: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("closed_short"))
        .sum();
    // The status is the view's, not a fold here: it is the one derivation the
    // three arms of allotment V1 §8 are spelled in, and a second spelling of
    // it in Rust is how the two would come to disagree.
    let header_commitment = sqlx::query(
        "SELECT status,article_count,dc_fulfilled FROM allotment_commitment WHERE allotment_id=$1",
    )
    .bind(allotment_id)
    .fetch_one(pool)
    .await?;
    let total_accepted: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("accepted_quantity"))
        .sum();
    let total_picked: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("picked_quantity"))
        .sum();
    let total_packed: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("packed_quantity"))
        .sum();
    let total_shipment: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("shipment_quantity"))
        .sum();
    let total_dispatched: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("dispatched_quantity"))
        .sum();
    let total_in_transit: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("in_transit_quantity"))
        .sum();
    let total_received: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("received_quantity"))
        .sum();
    let total_cancelled: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("cancelled_quantity"))
        .sum();
    let total_received_breakdown = received_breakdown
        .values()
        .try_fold(0_i64, |total, rows| {
            i64::try_from(rows.len())
                .ok()
                .and_then(|quantity| total.checked_add(quantity))
        })
        .ok_or_else(|| AppError::Conflict("received breakdown quantity overflow".into()))?;
    let cancellation_requested_total = cancellation_command
        .as_ref()
        .map(|payload| {
            payload
                .lines
                .iter()
                .try_fold(0_i64, |total, line| total.checked_add(line.quantity))
        })
        .unwrap_or(Some(0))
        .ok_or_else(|| AppError::Conflict("cancellation requested quantity overflow".into()))?;
    let cancellation_actual_total = cancellation_result_lines
        .as_ref()
        .map(|lines| {
            lines.iter().try_fold(0_i64, |total, line| {
                total.checked_add(line.cancelled_quantity)
            })
        })
        .unwrap_or(Some(0))
        .ok_or_else(|| AppError::Conflict("cancellation actual quantity overflow".into()))?;
    let cancellation_blocked_total = cancellation_result_lines
        .as_ref()
        .map(|lines| {
            lines.iter().try_fold(0_i64, |total, line| {
                total.checked_add(line.blocked_picked_quantity)
            })
        })
        .unwrap_or(Some(0))
        .ok_or_else(|| AppError::Conflict("cancellation blocked quantity overflow".into()))?;
    let cancellation_lines = if let Some(lines) = cancellation_result_lines.as_ref() {
        lines
            .iter()
            .map(|line| {
                json!({
                    "allotment_line_id":line.allotment_line_id,
                    "requested_quantity":line.requested_quantity,
                    "cancelled_quantity":line.cancelled_quantity,
                    "blocked_picked_quantity":line.blocked_picked_quantity
                })
            })
            .collect::<Vec<_>>()
    } else {
        cancellation_command
            .as_ref()
            .map(|payload| {
                payload
                    .lines
                    .iter()
                    .map(|line| {
                        json!({
                            "allotment_line_id":line.allotment_line_id,
                            "requested_quantity":line.quantity,
                            "cancelled_quantity":Value::Null,
                            "blocked_picked_quantity":Value::Null
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    let cancellation = cancellation_command.as_ref().map(|payload| {
        json!({
            "cancellation_id":payload.cancellation_id,
            "command_id":header.get::<Option<Uuid>,_>("cancellation_command_id"),
            "status":header.get::<Option<String>,_>("edge_cancellation_status"),
            "result_id":header.get::<Option<Uuid>,_>("edge_cancellation_result_id"),
            "requested_by":payload.requested_by,
            "reason":payload.reason,
            "requested_at":payload.requested_at,
            "received_at":header.get::<Option<DateTime<Utc>>,_>("edge_cancellation_received_at"),
            "outcome":cancellation_result.as_ref().map(|row| row.get::<String,_>("outcome")),
            "result_reason":cancellation_result.as_ref().and_then(|row| row.get::<Option<String>,_>("reason")),
            "applied_at":cancellation_result.as_ref().map(|row| row.get::<DateTime<Utc>,_>("applied_at")),
            "requested_quantity":cancellation_requested_total,
            "cancelled_quantity":cancellation_result_lines.as_ref().map(|_| cancellation_actual_total),
            "blocked_picked_quantity":cancellation_result_lines.as_ref().map(|_| cancellation_blocked_total),
            "lines":cancellation_lines
        })
    });
    // What the Gudang did about MD's changes, for MD's History (owner, 10 Oct
    // 2026): who acknowledged them, per store, and every move back of this
    // allotment's pieces. Acks the migration that introduced them (0964)
    // wrote for older changes are not history.
    let acknowledgements = sqlx::query(
        "SELECT line.destination_id, ack.actor_id, MAX(ack.acknowledged_at) AS at
           FROM allotment_amendment_ack ack
           JOIN allotment_amendment am ON am.id = ack.amendment_id
           JOIN allotment_line line ON line.id = am.allotment_line_id
          WHERE am.allotment_id = $1 AND ack.actor_id <> 'migration'
          GROUP BY line.destination_id, ack.actor_id, ack.acknowledged_at
          ORDER BY at",
    )
    .bind(allotment_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "destination_id": row.get::<String, _>("destination_id"),
            "by": row.get::<String, _>("actor_id"),
            "at": row.get::<DateTime<Utc>, _>("at"),
        })
    })
    .collect::<Vec<_>>();
    let move_backs = sqlx::query(
        "SELECT actor_id, created_at, moved FROM dc_move_back
          WHERE allotment_id = $1 ORDER BY created_at",
    )
    .bind(allotment_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "by": row.get::<String, _>("actor_id"),
            "at": row.get::<DateTime<Utc>, _>("created_at"),
            "pieces": row.get::<i64, _>("moved"),
        })
    })
    .collect::<Vec<_>>();
    Ok(json!({
        "acknowledgements":acknowledgements,
        "move_backs":move_backs,
        "id":header.get::<Uuid,_>("id"),
        "allotment_number":header.get::<String,_>("allotment_number"),
        "type":header.get::<String,_>("type"),
        "status":header.get::<String,_>("status"),
        "created_by":header.get::<String,_>("created_by"),
        "notes":header.get::<Option<String>,_>("notes"),
        "created_at":header.get::<DateTime<Utc>,_>("created_at"),
        "updated_at":header.get::<DateTime<Utc>,_>("updated_at"),
        "cancelled_at":header.get::<Option<DateTime<Utc>>,_>("cancelled_at"),
        "activation_command_id":header.get::<Option<Uuid>,_>("activation_command_id"),
        "activation_target_origin_id":header.get::<Option<String>,_>("activation_target_origin_id"),
        "edge_application_status":header.get::<Option<String>,_>("edge_application_status"),
        "edge_application_result_id":header.get::<Option<Uuid>,_>("edge_application_result_id"),
        "edge_application_received_at":header.get::<Option<DateTime<Utc>>,_>("edge_application_received_at"),
        "cancellation_id":header.get::<Option<Uuid>,_>("cancellation_id"),
        "cancellation_command_id":header.get::<Option<Uuid>,_>("cancellation_command_id"),
        "edge_cancellation_status":header.get::<Option<String>,_>("edge_cancellation_status"),
        "edge_cancellation_result_id":header.get::<Option<Uuid>,_>("edge_cancellation_result_id"),
        "edge_cancellation_received_at":header.get::<Option<DateTime<Utc>>,_>("edge_cancellation_received_at"),
        "cancellation":cancellation,
        "line_count":line_count,
        "sku_count":sku_count,
        "destination_count":destination_count,
        "total_quantity":total_quantity,
        "total_accepted_quantity":total_accepted,
        "total_picked_quantity":total_picked,
        "total_packed_quantity":total_packed,
        "total_shipment_quantity":total_shipment,
        "total_dispatched_quantity":total_dispatched,
        "total_in_transit_quantity":total_in_transit,
        "total_received_quantity":total_received,
        "total_received_breakdown_quantity":total_received_breakdown,
        "received_projection_consistent":total_received == total_received_breakdown,
        "total_cancelled_quantity":total_cancelled,
        "remaining_allotted":total_to_pack,
        "to_pack_qty":total_to_pack,
        "to_receive_qty":total_to_receive,
        "receiving_gap_qty":total_receiving_gap,
        "fulfillment_status":header_commitment.get::<String,_>("status"),
        "article_count":header_commitment.get::<i64,_>("article_count"),
        "dc_fulfilled":header_commitment.get::<bool,_>("dc_fulfilled"),
        "at_packed_qty":total_at_packed,
        "at_shipment_qty":total_at_shipment,
        "at_loaded_qty":total_at_loaded,
        "at_in_transit_qty":total_at_in_transit,
        "received_qty":total_received,
        "closed_short_qty":total_closed_short,
        "remaining_quantity":total_accepted-total_picked-total_cancelled,
        "lines":line_values,
        "events":events.into_iter().map(|row|json!({
            "id":row.get::<Uuid,_>("id"),
            "sequence":row.get::<i64,_>("event_sequence"),
            "event_type":row.get::<String,_>("event_type"),
            "sku_id":row.get::<Option<Uuid>,_>("sku_id"),
            "source_site_id":row.get::<Option<String>,_>("source_site_id"),
            "source_pool_id":row.get::<Option<String>,_>("source_pool_id"),
            "destination_type":row.get::<Option<String>,_>("destination_type"),
            "destination_id":row.get::<Option<String>,_>("destination_id"),
            "quantity":row.get::<i64,_>("quantity"),
            "remaining_delta":row.get::<i64,_>("remaining_delta"),
            "movement_group_id":row.get::<Option<Uuid>,_>("movement_group_id"),
            "reference_type":row.get::<Option<String>,_>("reference_type"),
            "reference_id":row.get::<Option<String>,_>("reference_id"),
            "actor_id":row.get::<String,_>("actor_id"),
            "details":row.get::<Value,_>("details"),
            "occurred_at":row.get::<DateTime<Utc>,_>("occurred_at"),
            "recorded_at":row.get::<DateTime<Utc>,_>("recorded_at")
        })).collect::<Vec<_>>(),
        "movements":movements.into_iter().map(|row|json!({
            "movement_id":row.get::<Uuid,_>("movement_id"),
            "movement_group_id":row.get::<Uuid,_>("movement_group_id"),
            "subject_id":row.get::<Uuid,_>("subject_id"),
            "quantity":row.get::<i64,_>("quantity"),
            "from":row.get::<String,_>("from_place_id"),
            "to":row.get::<String,_>("to_place_id"),
            "cause":row.get::<String,_>("cause"),
            "reference_type":row.get::<Option<String>,_>("reference_type"),
            "reference_id":row.get::<Option<String>,_>("reference_id"),
            "allotment_line_id":row.get::<Option<Uuid>,_>("allotment_line_id"),
            "allotment_id":allotment_id,
            "destination_type":row.get::<Option<String>,_>("destination_type"),
            "destination_id":row.get::<Option<String>,_>("destination_id"),
            "actor_id":row.get::<String,_>("actor_id"),
            "occurred_at":row.get::<DateTime<Utc>,_>("occurred_at"),
            "recorded_at":row.get::<DateTime<Utc>,_>("recorded_at")
        })).collect::<Vec<_>>()
    }))
}

pub async fn list_allotments(pool: &PgPool, query: AllotmentQuery) -> Result<Value, AppError> {
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    // Every spelling the route was ever stored under (0611).
    let allotment_type = query.allotment_type.map(|value| {
        value
            .spellings()
            .iter()
            .map(|spelling| (*spelling).to_owned())
            .collect::<Vec<String>>()
    });
    // Asked of the status the counters derive (`allotment_commitment`), never
    // of the stored column: a legacy `DC_COMPLETED` is live work until the
    // shop has the goods (allotment V1 §8), and the stored spelling of it
    // would file it under a status MD no longer reads.
    let status = query.status.map(|value| {
        FulfillmentStatus::from_legacy(value.as_str())
            .as_str()
            .to_owned()
    });
    // A row here is read before the allotment is opened, so it carries the
    // shape of the promise beside its size: lines written, SKUs named, and
    // places the goods are going. Destinations are counted as the pair,
    // because the id alone is only unique within its kind. The filter is what
    // keeps a line-less allotment honest — the outer join hands it a pair of
    // nulls, and a pair of nulls is still a value COUNT DISTINCT would call
    // one destination.
    // The page is chosen before it is folded (0947). `page` walks the
    // headers newest-first through the created_at index and reads each
    // candidate's header fold (`allotment_commitment`) off that allotment's
    // own lines — so the status filter, which only the fold derives, never
    // reverts to folding the whole book — and `base` then folds only the
    // chosen page's lines through the per-line view: one reading of each
    // line where the old query read line, progress and the view's own line
    // and progress beside it, for every allotment in the book.
    let rows = sqlx::query("WITH page AS (SELECT a.id,hc.status fulfillment_status,hc.article_count,hc.to_pack_qty,hc.at_packed,hc.at_shipment,hc.at_loaded,hc.at_in_transit,hc.closed_short_total,hc.dc_fulfilled FROM allotment a CROSS JOIN LATERAL (SELECT commitment.status,commitment.article_count,commitment.to_pack_qty,commitment.at_packed,commitment.at_shipment,commitment.at_loaded,commitment.at_in_transit,commitment.closed_short_total,commitment.dc_fulfilled FROM allotment_commitment commitment WHERE commitment.allotment_id=a.id LIMIT 1) hc WHERE ($1::text[] IS NULL OR a.type=ANY($1)) AND ($2::text IS NULL OR hc.status=$2) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM allotment_line source_line WHERE source_line.allotment_id=a.id AND source_line.source_pool_id=$3)) AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM allotment_line destination_line WHERE destination_line.allotment_id=a.id AND destination_line.destination_id=$4)) ORDER BY a.created_at DESC LIMIT $5) SELECT base.*,(SELECT array_agg(place ORDER BY place) FROM (SELECT DISTINCT COALESCE(store.name,place_line.destination_id) place FROM allotment_line place_line LEFT JOIN site store ON store.id=place_line.destination_id WHERE place_line.allotment_id=base.id) places) destination_names,page.fulfillment_status,page.article_count,page.to_pack_qty,page.at_packed,page.at_shipment,page.at_loaded,page.at_in_transit,page.closed_short_total,page.dc_fulfilled FROM (SELECT a.id,a.allotment_number,a.type,a.status,a.cancelled_at,a.edge_cancellation_status,a.edge_application_status,a.activation_target_origin_id,a.created_by,a.notes,a.created_at,a.updated_at,COUNT(commitment.allotment_line_id)::bigint line_count,COUNT(DISTINCT commitment.sku_id)::bigint sku_count,COUNT(DISTINCT (commitment.destination_type,commitment.destination_id)) FILTER (WHERE commitment.allotment_line_id IS NOT NULL)::bigint destination_count,COALESCE(SUM(commitment.original_alloted),0)::bigint quantity,COALESCE(SUM(commitment.accepted_total),0)::bigint accepted,COALESCE(SUM(commitment.picked_total),0)::bigint picked,COALESCE(SUM(commitment.packed_total),0)::bigint packed,COALESCE(SUM(commitment.shipment_total),0)::bigint shipment,COALESCE(SUM(commitment.loaded_total),0)::bigint dispatched,COALESCE(SUM(commitment.in_transit_total),0)::bigint in_transit,COALESCE(SUM(commitment.received_total),0)::bigint received,COALESCE(SUM(commitment.cancelled_legacy),0)::bigint cancelled,COALESCE(SUM(commitment.to_pack_qty),0)::bigint remaining,COALESCE(SUM(commitment.to_receive_qty),0)::bigint to_receive,COALESCE(SUM(commitment.receiving_gap_qty),0)::bigint receiving_gap_qty FROM page JOIN allotment a ON a.id=page.id LEFT JOIN allotment_line_commitment commitment ON commitment.allotment_id=a.id GROUP BY a.id) base JOIN page ON page.id=base.id ORDER BY base.created_at DESC")
        .bind(allotment_type)
        .bind(status)
        .bind(query.source_pool_id.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(query.destination_id.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(limit)
        .fetch_all(pool)
        .await?;
    // Who the goods came from, traced the same way availability traces an
    // article's orders — through the setup session that tied the supplier's
    // goods to our article — so an allotment of one supplier's delivery
    // names that supplier. The trace was once a seven-table walk run per row
    // of the page; run once for the ids the page chose, it names the same
    // suppliers without repeating the walk per allotment.
    let page_ids = rows
        .iter()
        .map(|row| row.get::<Uuid, _>("id"))
        .collect::<Vec<_>>();
    let supplier_names: HashMap<Uuid, Option<String>> = if page_ids.is_empty() {
        HashMap::new()
    } else {
        sqlx::query("SELECT supplier_line.allotment_id,string_agg(DISTINCT COALESCE(po.supplier_name_snapshot,po.supplier_name,po.supplier_id),', ') supplier_names FROM allotment_line supplier_line JOIN sku ON sku.id=supplier_line.sku_id JOIN article ON article.id=sku.article_id JOIN article_setup_session setup ON setup.article_code=article.article_code JOIN goods_receipt_line receipt ON receipt.receipt_line_id=setup.receipt_line_id JOIN purchase_order_line order_line ON order_line.po_line_id=receipt.po_line_id JOIN purchase_order po ON po.purchase_order_id=order_line.purchase_order_id WHERE supplier_line.allotment_id=ANY($1) GROUP BY supplier_line.allotment_id")
            .bind(&page_ids)
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|row| {
                (
                    row.get::<Uuid, _>("allotment_id"),
                    row.get::<Option<String>, _>("supplier_names"),
                )
            })
            .collect()
    };
    // What the allotment carries and where it leaves from, as words, for the
    // list's search (article names) and the Return HO cards (the sending
    // store): once for the page, as the suppliers are.
    let line_words: HashMap<Uuid, (Vec<String>, Vec<String>)> = if page_ids.is_empty() {
        HashMap::new()
    } else {
        sqlx::query("SELECT word_line.allotment_id,COALESCE(array_agg(DISTINCT word_article.name ORDER BY word_article.name) FILTER (WHERE word_article.name IS NOT NULL),'{}') article_names,COALESCE(array_agg(DISTINCT word_line.source_site_id ORDER BY word_line.source_site_id) FILTER (WHERE word_line.source_site_id IS NOT NULL),'{}') source_site_ids FROM allotment_line word_line LEFT JOIN sku word_sku ON word_sku.id=word_line.sku_id LEFT JOIN article word_article ON word_article.id=word_sku.article_id WHERE word_line.allotment_id=ANY($1) GROUP BY word_line.allotment_id")
            .bind(&page_ids)
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|row| {
                (
                    row.get::<Uuid, _>("allotment_id"),
                    (
                        row.get::<Vec<String>, _>("article_names"),
                        row.get::<Vec<String>, _>("source_site_ids"),
                    ),
                )
            })
            .collect()
    };
    // A store's return on the road, read off its node's facts: the pieces of
    // its IN_TRANSIT koli still standing in the store's `.outbound.in-transit`
    // pool. The centre's per-line fold reads only a DC's progress, so a
    // return a shop sent read 0 in transit until HO received it.
    let store_road: HashMap<Uuid, i64> = if page_ids.is_empty() {
        HashMap::new()
    } else {
        sqlx::query("SELECT road_unit.allotment_id,COUNT(DISTINCT road_unit.epc)::bigint pieces FROM edge_fulfillment_progress_fact road_fact JOIN sync_origin_credential road_origin ON road_origin.origin_id=road_fact.origin_id AND road_origin.node_role='STORE' JOIN edge_fulfillment_progress_unit road_unit ON road_unit.progress_event_id=road_fact.event_id JOIN edge_inventory_fact_position road_position ON road_position.origin_id=road_fact.origin_id AND road_position.epc=road_unit.epc AND road_position.place_id LIKE '%.outbound.in-transit%:on_hand' WHERE road_fact.stage='IN_TRANSIT' AND road_unit.allotment_id=ANY($1) GROUP BY road_unit.allotment_id")
            .bind(&page_ids)
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|row| (row.get::<Uuid, _>("allotment_id"), row.get::<i64, _>("pieces")))
            .collect()
    };
    // A rollup is one destination by definition, so it says how much of the
    // list's work lands there rather than counting the place again. The
    // whole book is folded once, through the per-line view — line, progress
    // and header a single pass each — where the old query read line and
    // progress here a second time beside the view's own reading of them.
    let destination_rows = sqlx::query("SELECT commitment.destination_type,commitment.destination_id,s.name destination_name,COUNT(commitment.allotment_line_id)::bigint line_count,COUNT(DISTINCT commitment.sku_id)::bigint sku_count,COALESCE(SUM(commitment.original_alloted),0)::bigint quantity,COALESCE(SUM(commitment.accepted_total),0)::bigint accepted,COALESCE(SUM(commitment.picked_total),0)::bigint picked,COALESCE(SUM(commitment.packed_total),0)::bigint packed,COALESCE(SUM(commitment.shipment_total),0)::bigint shipment,COALESCE(SUM(commitment.loaded_total),0)::bigint dispatched,COALESCE(SUM(commitment.in_transit_total),0)::bigint in_transit,COALESCE(SUM(commitment.received_total),0)::bigint received,COALESCE(SUM(commitment.cancelled_legacy),0)::bigint cancelled,COALESCE(SUM(commitment.to_pack_qty),0)::bigint remaining,COALESCE(SUM(commitment.to_receive_qty),0)::bigint to_receive,COALESCE(SUM(commitment.receiving_gap_qty),0)::bigint receiving_gap_qty FROM allotment_line_commitment commitment LEFT JOIN site s ON s.id=commitment.destination_id GROUP BY commitment.destination_type,commitment.destination_id,s.name ORDER BY commitment.destination_type,commitment.destination_id")
        .fetch_all(pool)
        .await?;
    let projection = get_availability(
        pool,
        AvailabilityQuery {
            at: None,
            source_pool_id: query.source_pool_id,
            cursor: None,
            q: None,
            limit: None,
            // The shortage projection compares a promise against every SKU it
            // could name, so it wants the zeroes too — but it only keeps the
            // rows where the promise won, and the server can say which those
            // are without building the other 2,722.
            held: None,
            shortfall: Some(true),
            unbounded: true,
        },
    )
    .await?;
    let shortages = projection["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    // Read off `shortfall_qty`, never off a negative On Hand.
                    // On Hand stops at nought now, so the old test silently
                    // stopped finding anything the day the guard landed — and
                    // a warning that disappears is worse than no warning.
                    let shortfall = item["shortfall_qty"].as_i64()?;
                    if shortfall <= 0 {
                        return None;
                    }
                    let mut shortage = item.clone();
                    shortage["shortage_qty"] = json!(shortfall);
                    Some(shortage)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "id":row.get::<Uuid,_>("id"),
                "allotment_number":row.get::<String,_>("allotment_number"),
                "type":row.get::<String,_>("type"),
                "status":row.get::<String,_>("status"),
                // When MD cancelled it: what tells a cancel from a close
                // short once both end CLOSED (owner, 10 Oct 2026: a
                // Cancelled tab of its own).
                "cancelled_at":row.get::<Option<DateTime<Utc>>,_>("cancelled_at"),
                "edge_cancellation_status":row.get::<Option<String>,_>("edge_cancellation_status"),
                // Whether the DC has taken the command yet — MD's "Waiting for
                // DC" (allotment V1 §8), shown beside the status, never in it.
                "edge_application_status":row.get::<Option<String>,_>("edge_application_status"),
                "activation_target_origin_id":row.get::<Option<String>,_>("activation_target_origin_id"),
                "line_count":row.get::<i64,_>("line_count"),
                "sku_count":row.get::<i64,_>("sku_count"),
                "destination_count":row.get::<i64,_>("destination_count"),
                // Who the goods came from and where they are going, as words,
                // for the list's Supplier and Stores columns — the supplier
                // from the batched trace above, the stores from the page row.
                "supplier_names":supplier_names.get(&row.get::<Uuid,_>("id")).cloned().flatten(),
                "destination_names":row.get::<Option<Vec<String>>,_>("destination_names").unwrap_or_default(),
                "article_names":line_words.get(&row.get::<Uuid,_>("id")).map(|words| words.0.clone()).unwrap_or_default(),
                "source_site_ids":line_words.get(&row.get::<Uuid,_>("id")).map(|words| words.1.clone()).unwrap_or_default(),
                "total_quantity":row.get::<i64,_>("quantity"),
                "total_accepted_quantity":row.get::<i64,_>("accepted"),
                "total_picked_quantity":row.get::<i64,_>("picked"),
                "total_packed_quantity":row.get::<i64,_>("packed"),
                "total_shipment_quantity":row.get::<i64,_>("shipment"),
                "total_dispatched_quantity":row.get::<i64,_>("dispatched"),
                "total_in_transit_quantity":row.get::<i64,_>("in_transit").max(store_road.get(&row.get::<Uuid,_>("id")).copied().unwrap_or(0)),
                "total_received_quantity":row.get::<i64,_>("received"),
                "total_cancelled_quantity":row.get::<i64,_>("cancelled"),
                "remaining_quantity":row.get::<i64,_>("remaining"),
                "to_receive_qty":row.get::<i64,_>("to_receive"),
                "receiving_gap_qty":row.get::<i64,_>("receiving_gap_qty"),
                // Allotment V1 §12, read off `allotment_commitment` whole: the
                // three statuses MD reads, and the places the promised pieces
                // are in now. `status` above stays the stored spelling for the
                // callers that still switch on it.
                "fulfillment_status":row.get::<String,_>("fulfillment_status"),
                "article_count":row.get::<i64,_>("article_count"),
                "to_pack_qty":row.get::<i64,_>("to_pack_qty"),
                "at_packed_qty":row.get::<i64,_>("at_packed"),
                "at_shipment_qty":row.get::<i64,_>("at_shipment"),
                "at_loaded_qty":row.get::<i64,_>("at_loaded"),
                "at_in_transit_qty":row.get::<i64,_>("at_in_transit"),
                "received_qty":row.get::<i64,_>("received"),
                "closed_short_qty":row.get::<i64,_>("closed_short_total"),
                "dc_fulfilled":row.get::<bool,_>("dc_fulfilled"),
                "created_by":row.get::<String,_>("created_by"),
                "notes":row.get::<Option<String>,_>("notes"),
                "created_at":row.get::<DateTime<Utc>,_>("created_at"),
                "updated_at":row.get::<DateTime<Utc>,_>("updated_at")
            })
        })
        .collect();
    Ok(json!({
        "items":items,
        "limit":limit,
        "by_destination":destination_rows.into_iter().map(|row|json!({
            "destination_type":row.get::<String,_>("destination_type"),
            "destination_id":row.get::<String,_>("destination_id"),
            "destination_name":row.get::<Option<String>,_>("destination_name"),
            "line_count":row.get::<i64,_>("line_count"),
            "sku_count":row.get::<i64,_>("sku_count"),
            "total_quantity":row.get::<i64,_>("quantity"),
            "total_accepted_quantity":row.get::<i64,_>("accepted"),
            "total_picked_quantity":row.get::<i64,_>("picked"),
            "total_packed_quantity":row.get::<i64,_>("packed"),
            "total_shipment_quantity":row.get::<i64,_>("shipment"),
            "total_dispatched_quantity":row.get::<i64,_>("dispatched"),
            "total_in_transit_quantity":row.get::<i64,_>("in_transit"),
            "total_received_quantity":row.get::<i64,_>("received"),
            "total_cancelled_quantity":row.get::<i64,_>("cancelled"),
            "remaining_quantity":row.get::<i64,_>("remaining"),
            "to_receive_qty":row.get::<i64,_>("to_receive"),
            "receiving_gap_qty":row.get::<i64,_>("receiving_gap_qty")
        })).collect::<Vec<_>>(),
        "shortages":shortages
    }))
}

pub async fn list_allotments_by_store(pool: &PgPool, store_id: &str) -> Result<Value, AppError> {
    let store_id = store_id.trim().to_ascii_lowercase();
    let store = sqlx::query("SELECT name FROM site WHERE id=$1 AND kind='STORE'")
        .bind(&store_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("destination store".into()))?;
    let mut result = list_allotments(
        pool,
        AllotmentQuery {
            allotment_type: None,
            status: None,
            source_pool_id: None,
            destination_id: Some(store_id.clone()),
            limit: Some(500),
        },
    )
    .await?;
    let rows = sqlx::query("SELECT l.sku_id,sk.sku_code,SUM(l.quantity)::bigint quantity,SUM(COALESCE(progress.accepted_quantity,CASE WHEN a.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END))::bigint accepted,SUM(COALESCE(progress.picked_quantity,l.picked_quantity))::bigint picked,SUM(COALESCE(progress.packed_quantity,l.packed_quantity))::bigint packed,SUM(COALESCE(progress.shipment_quantity,l.shipment_quantity))::bigint shipment,SUM(COALESCE(progress.dispatched_quantity,l.dispatched_quantity))::bigint dispatched,SUM(COALESCE(progress.in_transit_quantity,l.in_transit_quantity))::bigint in_transit,SUM(COALESCE(progress.received_quantity,l.received_quantity))::bigint received,SUM(COALESCE(progress.cancelled_quantity,l.cancelled_quantity))::bigint cancelled,SUM(commitment.to_pack_qty)::bigint remaining,SUM(commitment.to_receive_qty)::bigint to_receive,SUM(commitment.receiving_gap_qty)::bigint receiving_gap_qty,SUM(commitment.at_packed)::bigint at_packed,SUM(commitment.at_shipment)::bigint at_shipment,SUM(commitment.at_loaded)::bigint at_loaded,SUM(commitment.at_in_transit)::bigint at_in_transit,SUM(commitment.closed_short_total)::bigint closed_short FROM allotment_line l JOIN allotment a ON a.id=l.allotment_id JOIN sku sk ON sk.id=l.sku_id LEFT JOIN edge_allotment_line_progress progress ON progress.allotment_line_id=l.id LEFT JOIN allotment_line_commitment commitment ON commitment.allotment_line_id=l.id WHERE l.destination_type='STORE' AND l.destination_id=$1 GROUP BY l.sku_id,sk.sku_code ORDER BY sk.sku_code")
        .bind(&store_id)
        .fetch_all(pool)
        .await?;
    result["destination_type"] = json!("STORE");
    result["destination_id"] = json!(store_id);
    result["destination_name"] = json!(store.get::<String, _>("name"));
    result["sku_summary"] = json!(rows
        .into_iter()
        .map(|row| json!({
            "sku_id":row.get::<Uuid,_>("sku_id"),
            "sku_code":row.get::<String,_>("sku_code"),
            "quantity":row.get::<i64,_>("quantity"),
            "accepted_quantity":row.get::<i64,_>("accepted"),
            "picked_quantity":row.get::<i64,_>("picked"),
            "packed_quantity":row.get::<i64,_>("packed"),
            "shipment_quantity":row.get::<i64,_>("shipment"),
            "dispatched_quantity":row.get::<i64,_>("dispatched"),
            "in_transit_quantity":row.get::<i64,_>("in_transit"),
            "received_quantity":row.get::<i64,_>("received"),
            "cancelled_quantity":row.get::<i64,_>("cancelled"),
            "remaining_quantity":row.get::<i64,_>("remaining"),
            "to_receive_qty":row.get::<i64,_>("to_receive"),
            "receiving_gap_qty":row.get::<i64,_>("receiving_gap_qty"),
            // The size run read as allotment V1 §12 asks for it — Alloted ·
            // To Pack · Packed · Shipment · In Transit · Received · To
            // Receive — summed off the line view, never subtracted here.
            "to_pack_qty":row.get::<i64,_>("remaining"),
            "at_packed_qty":row.get::<i64,_>("at_packed"),
            "at_shipment_qty":row.get::<i64,_>("at_shipment"),
            "at_loaded_qty":row.get::<i64,_>("at_loaded"),
            "at_in_transit_qty":row.get::<i64,_>("at_in_transit"),
            "closed_short_qty":row.get::<i64,_>("closed_short")
        }))
        .collect::<Vec<_>>());
    Ok(result)
}

/// What every article, rather than every SKU, is owed across the whole book.
///
/// The per-store summary above answers by SKU, and a SKU is one colour in one
/// size: a shirt cut in ten colourways and six sizes lands as sixty rows that
/// the reader has to add up before they can say whether the shirt is moving at
/// all. Buying and allocation ask about the garment first, so the fold happens
/// here in PostgreSQL over the same lines and the same stage columns the SKU
/// summary reads — the two are meant to agree when you total them.
///
/// Every filter is optional and spelled the way the allotment list already
/// spells it, so a screen can hand its current filter straight through. With
/// none of them set the rollup spans everything.
pub async fn list_allotments_by_article(
    pool: &PgPool,
    query: AllotmentQuery,
) -> Result<Value, AppError> {
    // Every spelling the route was ever stored under (0611).
    let allotment_type = query.allotment_type.map(|value| {
        value
            .spellings()
            .iter()
            .map(|spelling| (*spelling).to_owned())
            .collect::<Vec<String>>()
    });
    // Asked of the status the counters derive (`allotment_commitment`), never
    // of the stored column: a legacy `DC_COMPLETED` is live work until the
    // shop has the goods (allotment V1 §8), and the stored spelling of it
    // would file it under a status MD no longer reads.
    let status = query.status.map(|value| {
        FulfillmentStatus::from_legacy(value.as_str())
            .as_str()
            .to_owned()
    });
    let destination_id = query
        .destination_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    // Destinations are counted as the pair, because the id alone is only
    // unique within its kind — a store and a supplier may answer to the same
    // string, and they are two places to send goods.
    //
    // The fold reads each line once, through the per-line view (0947): the
    // stage sums are the view's appended columns — accepted, picked and
    // cancelled_legacy are the same COALESCEs this query used to respell by
    // joining line and progress beside the view's own join of them — so the
    // article picker reads line, progress and header a single pass each,
    // where it used to read line and progress three times over and then
    // folded every allotment's whole ledger through `allotment_commitment`
    // just to file a page of articles by status. The status filter, the only
    // thing the fold derives, walks the headers instead (the list's page
    // pattern): one per-header fold per candidate, narrowed by type first,
    // and never at all when no status is asked for.
    let rows = sqlx::query("SELECT ar.id article_id,ar.article_code,ar.name article_name,ar.division_code,ar.image_url,COUNT(DISTINCT commitment.sku_id)::bigint sku_count,COUNT(DISTINCT (commitment.destination_type,commitment.destination_id))::bigint destination_count,SUM(commitment.original_alloted)::bigint quantity,SUM(commitment.accepted_total)::bigint accepted,SUM(commitment.picked_total)::bigint picked,SUM(commitment.packed_total)::bigint packed,SUM(commitment.shipment_total)::bigint shipment,SUM(commitment.loaded_total)::bigint dispatched,SUM(commitment.in_transit_total)::bigint in_transit,SUM(commitment.received_total)::bigint received,SUM(commitment.cancelled_legacy)::bigint cancelled,SUM(commitment.to_pack_qty)::bigint remaining,SUM(commitment.to_receive_qty)::bigint to_receive,SUM(commitment.receiving_gap_qty)::bigint receiving_gap_qty FROM allotment_line_commitment commitment JOIN allotment a ON a.id=commitment.allotment_id JOIN sku sk ON sk.id=commitment.sku_id JOIN article ar ON ar.id=sk.article_id WHERE ($1::text[] IS NULL OR a.type=ANY($1)) AND ($3::text IS NULL OR commitment.destination_id=$3) AND ($2::text IS NULL OR a.id IN (SELECT h.id FROM allotment h CROSS JOIN LATERAL (SELECT hc.status FROM allotment_commitment hc WHERE hc.allotment_id=h.id LIMIT 1) fold WHERE fold.status=$2 AND ($1::text[] IS NULL OR h.type=ANY($1)))) GROUP BY ar.id,ar.article_code,ar.name,ar.division_code,ar.image_url ORDER BY ar.name")
        .bind(allotment_type)
        .bind(status)
        .bind(destination_id)
        .fetch_all(pool)
        .await?;
    Ok(json!({
        "items":rows.into_iter().map(|row|json!({
            "article_id":row.get::<Uuid,_>("article_id"),
            "article_code":row.get::<String,_>("article_code"),
            "article_name":row.get::<String,_>("article_name"),
            "division_code":row.get::<Option<String>,_>("division_code"),
            "image_url":row.get::<Option<String>,_>("image_url"),
            "sku_count":row.get::<i64,_>("sku_count"),
            "destination_count":row.get::<i64,_>("destination_count"),
            "total_quantity":row.get::<i64,_>("quantity"),
            "total_accepted_quantity":row.get::<i64,_>("accepted"),
            "total_picked_quantity":row.get::<i64,_>("picked"),
            "total_packed_quantity":row.get::<i64,_>("packed"),
            "total_shipment_quantity":row.get::<i64,_>("shipment"),
            "total_dispatched_quantity":row.get::<i64,_>("dispatched"),
            "total_in_transit_quantity":row.get::<i64,_>("in_transit"),
            "total_received_quantity":row.get::<i64,_>("received"),
            "total_cancelled_quantity":row.get::<i64,_>("cancelled"),
            "remaining_quantity":row.get::<i64,_>("remaining"),
            "to_receive_qty":row.get::<i64,_>("to_receive"),
            "receiving_gap_qty":row.get::<i64,_>("receiving_gap_qty")
        })).collect::<Vec<_>>()
    }))
}

/// How many rows one page may carry.
///
/// This is not a page size in the usual sense, because a page here is not
/// cheaper than the whole set: every page folds the entire ledger for the
/// pool, runs the window totals over all of it, and only then throws away
/// everything before the cursor. Six pages of five hundred is therefore six
/// times the work of one page of three thousand and, over a link to the node,
/// six round trips instead of one — which is what made the allotment matrix
/// sit on "reading everything the pool holds".
///
/// So the cap is set above the size of a real catalogue rather than at a
/// comfortable-looking round number, and the screen that wants the whole pool
/// asks for it once. The cursor stays, because a catalogue can outgrow any
/// number written here.
const AVAILABILITY_PAGE_MAX: i64 = 5_000;

pub async fn get_availability(pool: &PgPool, query: AvailabilityQuery) -> Result<Value, AppError> {
    let at = query.at.unwrap_or_else(Utc::now);
    let limit = if query.unbounded {
        i64::MAX
    } else {
        query.limit.unwrap_or(100).clamp(1, AVAILABILITY_PAGE_MAX)
    };
    let fetch_limit = if query.unbounded { limit } else { limit + 1 };
    let cursor = query
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    // Without a pool named, head office's stockroom — found by the site's
    // kind and the pool's role (0610), never by a spelled id.
    let source_pool_id = match query
        .source_pool_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(named) => named.to_ascii_lowercase(),
        None => {
            let head_office = super::sites::head_office_site_id(pool).await?;
            super::sites::pool_of_role(pool, &head_office, PoolRole::Stockroom)
                .await?
                .ok_or_else(|| AppError::NotFound("head office stockroom".into()))?
        }
    };
    let source =
        sqlx::query("SELECT p.site_id,p.label FROM operational_pool p WHERE p.id=$1 AND p.active AND p.is_placement")
            .bind(&source_pool_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("active placement source pool".into()))?;
    // A site owned by an Edge node has two inventory representations: its
    // authoritative positions in `edge_inventory_fact_position`, and any
    // Cloud-native movements left by older workflows. Allotment creation
    // already validates against the Edge positions, so presenting the Cloud
    // ledger here would show zero (or a stale duplicate) for the same shelf.
    // Resolve the same owner and Edge spelling used by that write path.
    let source_site_id: String = source.get("site_id");
    let mut ownership_tx = pool.begin().await?;
    let edge_origin_id = inventory_owner_tx(&mut ownership_tx, &source_site_id).await?;
    // The same supply scope as the centre's ledger reads (`eligible_pool`
    // below), in the owner's spelling.
    let edge_source_pools = if let Some(origin_id) = edge_origin_id.as_deref() {
        let owner_site_id = origin_site_id_tx(&mut ownership_tx, origin_id).await?;
        Some(
            eligible_supply_pools_tx(&mut ownership_tx, &source_pool_id)
                .await?
                .iter()
                .map(|pool_id| pool_id_for_site(pool_id, &owner_site_id))
                .collect::<Vec<String>>(),
        )
    } else {
        None
    };
    ownership_tx.commit().await?;
    let rows = sqlx::query(r#"
WITH eligible_pool AS (
    -- Supply and commitment must be measured over the SAME scope, or the
    -- subtraction is meaningless. A promise raised against the warehouse is
    -- served from the warehouse or from the picking area — a picker carrying
    -- goods between them settles nothing about who they are for — so both are
    -- supply, and the commitment is subtracted from the pair exactly once.
    --
    -- Measuring only the warehouse is what made a morning's picking look like
    -- a morning's shrinkage: every piece moved into the pick area left the
    -- supply while its promise stayed, and the same shirts were reported
    -- missing and over-promised at once.
    --
    -- The per-store `picked.{store}` pools are legacy and take no new writes,
    -- but the goods standing in them are as packable as any other, so they
    -- are supply too.
    --
    -- Which pools those are is their ROLE (0610): a stockroom's supply is the
    -- stockroom and every pick area at its site — the one pick area, and the
    -- legacy per-store ones.
    SELECT pool.id
    FROM operational_pool pool
    JOIN operational_pool source ON source.id=$2
    WHERE pool.id=$2
       OR (source.role='STOCKROOM' AND pool.site_id=source.site_id AND pool.role='PICKING')
), ledger_delta AS (
    -- Now: the maintained balance (`inventory_projection`), as the pool list
    -- reads it. Replaying the ledger for the present re-summed every movement
    -- the stockroom ever had — 4.4M rows, two minutes, at a year of sales.
    -- The subject's SKU is read here, not when the balance was kept, so goods
    -- identified after they arrived count under the SKU they have now.
    SELECT subject.sku_id,place.state,projection.quantity delta
    FROM inventory_projection projection
    JOIN inventory_subject subject ON subject.id=projection.subject_id
    JOIN inventory_place place ON place.id=projection.place_id
    WHERE $10 AND place.pool_id IN (SELECT id FROM eligible_pool) AND place.state IN ('NORMAL','MISSING')
      AND subject.sku_id IS NOT NULL
    UNION ALL
    -- A moment in the past: the ledger replayed up to it.
    SELECT subject.sku_id,place.state,movement.quantity delta
    FROM movement
    JOIN inventory_subject subject ON subject.id=movement.subject_id
    JOIN inventory_place place ON place.id=movement.to_place_id
    WHERE NOT $10 AND place.pool_id IN (SELECT id FROM eligible_pool) AND place.state IN ('NORMAL','MISSING')
      AND subject.sku_id IS NOT NULL AND movement.occurred_at <= $1
    UNION ALL
    SELECT subject.sku_id,place.state,-movement.quantity delta
    FROM movement
    JOIN inventory_subject subject ON subject.id=movement.subject_id
    JOIN inventory_place place ON place.id=movement.from_place_id
    WHERE NOT $10 AND place.pool_id IN (SELECT id FROM eligible_pool) AND place.state IN ('NORMAL','MISSING')
      AND subject.sku_id IS NOT NULL AND movement.occurred_at <= $1
), cloud_ledger_balance AS (
    SELECT sku_id,
           COALESCE(SUM(delta) FILTER(WHERE state='NORMAL'),0)::bigint normal_quantity,
           COALESCE(SUM(delta) FILTER(WHERE state='MISSING'),0)::bigint missing_quantity
    FROM ledger_delta GROUP BY sku_id
), edge_ledger_balance AS (
    -- The Edge projection carries pool and state in `place_id`. Warehouse
    -- availability includes the warehouse plus picking and already-picked
    -- shelves, and reports missing units as stock but never as spendable.
    SELECT sku.id sku_id,
           COALESCE(SUM(position.quantity) FILTER(WHERE split_part(position.place_id,':',2)='on_hand'),0)::bigint normal_quantity,
           COALESCE(SUM(position.quantity) FILTER(WHERE split_part(position.place_id,':',2)='missing'),0)::bigint missing_quantity
    FROM edge_inventory_fact_position position
    JOIN sku ON sku.sku_code=position.sku_code
    -- A place id is `{pool}:{state}`; the pools are the eligible scope in the
    -- owner's spelling, worked out from the roles before this query.
    WHERE position.origin_id=$8
      AND split_part(position.place_id,':',1)=ANY($9::text[])
    GROUP BY sku.id
), ledger_balance AS (
    -- Edge owns the supply when registered; otherwise retain the Cloud
    -- movement ledger used by non-Edge sites.
    SELECT sku.id sku_id,
           CASE WHEN $8::text IS NULL THEN COALESCE(cloud.normal_quantity,0)
                ELSE COALESCE(edge.normal_quantity,0) END::bigint normal_quantity,
           CASE WHEN $8::text IS NULL THEN COALESCE(cloud.missing_quantity,0)
                ELSE COALESCE(edge.missing_quantity,0) END::bigint missing_quantity
    FROM sku
    LEFT JOIN cloud_ledger_balance cloud ON cloud.sku_id=sku.id
    LEFT JOIN edge_ledger_balance edge ON edge.sku_id=sku.id
), allotted_balance AS (
    -- What this pool still has to put into cartons, SKU by SKU: `to_pack_qty`
    -- out of the one commitment view.
    --
    -- Not `to_receive_qty`, which is MD's number and includes goods that have
    -- physically left this shelf already — subtracting it here would count
    -- every packed piece twice, once as gone and once as owed.
    --
    -- Live, and deliberately not `occurred_at <= $1`: the centre keeps no
    -- history of the commitment, only of the ledger. A caller asking what the
    -- pool held last Tuesday gets last Tuesday's stock against today's
    -- promises, and there is no honest alternative until the fulfillment
    -- events reach the centre.
    SELECT commitment.sku_id,
           COALESCE(SUM(commitment.to_pack_qty),0)::bigint allotted_quantity
    FROM allotment_line_commitment commitment
    WHERE commitment.source_pool_id=$2
      -- Only lines that can still owe packing are read (0928). A line's own
      -- counters never net below zero (allotment_line_fulfillment_places_check),
      -- so one that nets to zero owes nothing — every allotment line ever
      -- completed, 1.87M at a year of sales, was read for a sum of zeros.
      -- Lines a DC reports progress for are read whatever their counters say,
      -- because the progress row is what the commitment uses for them.
      AND commitment.allotment_line_id IN (
          SELECT line.id FROM allotment_line line
           WHERE line.source_pool_id=$2
             AND line.quantity + line.unpacked_quantity + line.lost_packed_quantity
                 + line.lost_in_transit_quantity + line.lost_at_store_quantity
                 - line.packed_quantity - line.cancelled_quantity
                 - line.closed_short_quantity > 0
          UNION ALL
          SELECT progress.allotment_line_id FROM edge_allotment_line_progress progress
      )
    GROUP BY commitment.sku_id
-- What the article IS, carried alongside what there is of it. The screen that
-- promises goods to stores reads by article, not by SKU code, so the division,
-- the tags and the photograph have to arrive with the balances rather than in
-- a second read per row.
), article_tags AS (
    SELECT article_id,array_agg(tag_code ORDER BY tag_code) codes
    FROM article_tag GROUP BY article_id
-- Which orders this article has actually arrived on.
--
-- Joined on OUR article code rather than on `article.created_by_session_id`,
-- and the difference matters: that column records only the setup session that
-- first minted the article, so a second delivery of the same shirt on a later
-- order would still trace back to the first one. An article belongs to every
-- order that ever brought it in.
--
-- The order line's own `article_code` cannot be used for this at all — it is
-- the supplier's code, and two suppliers reuse each other's. The setup session
-- is the only place the supplier's string and ours are tied together, and it
-- is tied there by a human deciding what the goods are.
), article_orders AS (
    SELECT setup.article_code,
           array_agg(DISTINCT line.purchase_order_id) purchase_order_ids
    FROM article_setup_session setup
    JOIN goods_receipt_line receipt ON receipt.receipt_line_id=setup.receipt_line_id
    JOIN purchase_order_line line ON line.po_line_id=receipt.po_line_id
    GROUP BY setup.article_code
), availability_rows AS (
SELECT sku.id sku_id,sku.sku_code,article.id article_id,
       article.article_code,article.name article_name,
       article.division_code,article.image_url,
       COALESCE(tags.codes,ARRAY[]::text[]) tags,
       COALESCE(orders.purchase_order_ids,ARRAY[]::uuid[]) purchase_order_ids,
       sku.color colour,sku.size size,
       (COALESCE(ledger.normal_quantity,0)+COALESCE(ledger.missing_quantity,0))::bigint stock_quantity,
       COALESCE(allotted.allotted_quantity,0)::bigint allotted_quantity,
       -- On Hand is what may still be spent, so it stops at nought. Promising
       -- more than the shelf holds is allowed — a warehouse is entitled to
       -- find out it cannot keep a promise — but it is reported as a shortfall
       -- rather than as a negative quantity of goods, which is not a thing.
       GREATEST(COALESCE(ledger.normal_quantity,0)-COALESCE(allotted.allotted_quantity,0),0)::bigint on_hand_quantity,
       GREATEST(COALESCE(allotted.allotted_quantity,0)-COALESCE(ledger.normal_quantity,0),0)::bigint shortfall_quantity,
       COALESCE(ledger.missing_quantity,0)::bigint missing_quantity
FROM sku JOIN article ON article.id=sku.article_id
LEFT JOIN ledger_balance ledger ON ledger.sku_id=sku.id
LEFT JOIN allotted_balance allotted ON allotted.sku_id=sku.id
LEFT JOIN article_tags tags ON tags.article_id=article.id
LEFT JOIN article_orders orders ON orders.article_code=article.article_code
WHERE sku.active
  AND ($4::text IS NULL OR sku.sku_code ILIKE '%'||$4||'%'
       OR article.article_code ILIKE '%'||$4||'%'
       OR article.name ILIKE '%'||$4||'%')
-- Held only, when the caller asked for it. Applied here rather than around
-- `numbered` so the totals, the sort and the page are all about the same set
-- of rows — a caller asking what it can send is not helped by a total that
-- counts what it cannot.
  AND ($6::bool IS NOT TRUE
       OR (COALESCE(ledger.normal_quantity,0)+COALESCE(ledger.missing_quantity,0)) > 0)
-- Over-promised only. Same reason, other direction: the allotment list wants
-- the rows where the promise outruns the pool, and nothing else.
  AND ($7::bool IS NOT TRUE
       OR (COALESCE(allotted.allotted_quantity,0)-COALESCE(ledger.normal_quantity,0)) > 0)
), numbered AS (
SELECT availability_rows.*,
       COUNT(*) OVER()::bigint total_items,
       SUM(stock_quantity) OVER()::bigint total_stock_quantity,
       SUM(allotted_quantity) OVER()::bigint total_allotted_quantity,
       SUM(on_hand_quantity) OVER()::bigint total_on_hand_quantity,
       SUM(shortfall_quantity) OVER()::bigint total_shortfall_quantity,
       SUM(missing_quantity) OVER()::bigint total_missing_quantity
FROM availability_rows
)
SELECT * FROM numbered
WHERE ($3::text IS NULL OR sku_code > $3)
ORDER BY sku_code
LIMIT $5
"#)
        .bind(at)
        .bind(&source_pool_id)
        .bind(cursor)
        .bind(needle)
        .bind(fetch_limit)
        .bind(query.held.unwrap_or(false))
        .bind(query.shortfall.unwrap_or(false))
        .bind(edge_origin_id.as_deref())
        .bind(edge_source_pools)
        .bind(query.at.is_none())
        .fetch_all(pool)
        .await?;
    let has_more = !query.unbounded && rows.len() > limit as usize;
    let total_items = rows
        .first()
        .map(|row| row.get::<i64, _>("total_items"))
        .unwrap_or(0);
    let stock_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_stock_quantity"))
        .unwrap_or(0);
    let allotted_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_allotted_quantity"))
        .unwrap_or(0);
    let on_hand_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_on_hand_quantity"))
        .unwrap_or(0);
    let shortfall_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_shortfall_quantity"))
        .unwrap_or(0);
    let missing_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_missing_quantity"))
        .unwrap_or(0);
    let items: Vec<Value> = rows
        .into_iter()
        .take(limit as usize)
        .map(|row| {
            json!({
                "sku_id":row.get::<Uuid,_>("sku_id"),
                "sku_code":row.get::<String,_>("sku_code"),
                "article_id":row.get::<Uuid,_>("article_id"),
                "article_code":row.get::<String,_>("article_code"),
                "article_name":row.get::<String,_>("article_name"),
                "division_code":row.get::<Option<String>,_>("division_code"),
                "image_url":row.get::<Option<String>,_>("image_url"),
                "tags":row.get::<Vec<String>,_>("tags"),
                "purchase_order_ids":row.get::<Vec<Uuid>,_>("purchase_order_ids"),
                "colour":row.get::<Option<String>,_>("colour"),
                "size":row.get::<Option<String>,_>("size"),
                "stock_qty":row.get::<i64,_>("stock_quantity"),
                "allotted_qty":row.get::<i64,_>("allotted_quantity"),
                "on_hand_qty":row.get::<i64,_>("on_hand_quantity"),
                "shortfall_qty":row.get::<i64,_>("shortfall_quantity"),
                "missing_qty":row.get::<i64,_>("missing_quantity")
            })
        })
        .collect();
    let next_cursor = has_more
        .then(|| {
            items
                .last()
                .and_then(|item| item["sku_code"].as_str())
                .map(str::to_owned)
        })
        .flatten();
    Ok(json!({
        "source_site_id":source.get::<String,_>("site_id"),
        "source_pool_id":source_pool_id,
        "source_pool_label":source.get::<String,_>("label"),
        "source_place_id":format!("{source_pool_id}:on_hand"),
        "as_of":at,
        "total_items":total_items,
        "stock_qty":stock_qty,
        "allotted_qty":allotted_qty,
        "on_hand_qty":on_hand_qty,
        "shortfall_qty":shortfall_qty,
        "missing_qty":missing_qty,
        // On Hand now means available, and it never goes below nought: the
        // excess is `shortfall_qty`, not a negative quantity of shirts. So the
        // old identity is a reading rather than an invariant, and it is
        // spelled out here as what it actually is.
        "inventory_equation": crate::cloud::domain::INVENTORY_EQUATION,
        "limit":limit,
        "next_cursor":next_cursor,
        "items":items
    }))
}

pub(super) async fn record_allotment_shortages_for_count(
    tx: &mut Transaction<'_, Postgres>,
    count_id: Uuid,
    movement_group_id: Option<Uuid>,
    pool_id: &str,
    shortage_subject_ids: &[Uuid],
    actor_id: &str,
) -> Result<i64, AppError> {
    if shortage_subject_ids.is_empty() {
        return Ok(0);
    }
    let Some(movement_group_id) = movement_group_id else {
        return Ok(0);
    };
    let source = sqlx::query("SELECT site_id FROM operational_pool WHERE id=$1")
        .bind(pool_id)
        .fetch_one(&mut **tx)
        .await?;
    let source_site_id: String = source.get("site_id");
    let rows = sqlx::query("SELECT DISTINCT sku_id FROM inventory_subject WHERE id=ANY($1) AND sku_id IS NOT NULL ORDER BY sku_id")
        .bind(shortage_subject_ids)
        .fetch_all(&mut **tx)
        .await?;
    let mut inserted = 0_i64;
    for row in rows {
        let sku_id: Uuid = row.get("sku_id");
        let normal_quantity = normal_balance_tx(tx, pool_id, sku_id).await?;
        let allotted_quantity = active_allotment_tx(tx, pool_id, sku_id).await?;
        let shortage_quantity = allotted_quantity - normal_quantity;
        if shortage_quantity <= 0 {
            continue;
        }
        let event_key = format!("official-count:{count_id}:allotment-shortage:{pool_id}:{sku_id}");
        let result = sqlx::query("INSERT INTO allotment_event(id,event_key,event_type,sku_id,quantity,remaining_delta,movement_group_id,reference_type,reference_id,actor_id,details,occurred_at) VALUES($1,$2,'ALLOTMENT_SHORTAGE',$3,$4,0,$5,'OFFICIAL_COUNT',$6,$7,$8,now()) ON CONFLICT(event_key) DO NOTHING")
            .bind(Uuid::new_v4())
            .bind(event_key)
            .bind(sku_id)
            .bind(shortage_quantity)
            .bind(movement_group_id)
            .bind(count_id.to_string())
            .bind(actor_id)
            .bind(json!({
                "source_site_id":source_site_id,
                "source_pool_id":pool_id,
                "normal_qty":normal_quantity,
                "allotted_qty":allotted_quantity,
                "shortage_qty":shortage_quantity
            }))
            .execute(&mut **tx)
            .await?;
        inserted += result.rows_affected() as i64;
    }
    Ok(inserted)
}

async fn load_create_validation_context(
    tx: &mut Transaction<'_, Postgres>,
    lines: &[NormalizedLine],
) -> Result<CreateValidationContext, AppError> {
    let pool_ids: Vec<String> = lines
        .iter()
        .map(|line| line.identity.source_pool_id.clone())
        .collect();
    let site_ids: Vec<String> = lines
        .iter()
        .flat_map(|line| {
            [
                line.identity.source_site_id.clone(),
                line.identity.destination_id.clone(),
            ]
        })
        .collect();
    let source_pools = sqlx::query(
        "SELECT pool.id,pool.site_id,pool.role FROM operational_pool pool
         WHERE pool.id=ANY($1) AND pool.active AND pool.is_placement",
    )
    .bind(&pool_ids)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| (row.get("id"), (row.get("site_id"), row.get("role"))))
    .collect();
    let sites = sqlx::query(
        "SELECT site.id,site.kind,unit.kind unit_kind,unit.status='CLOSED' closed
         FROM site JOIN unit ON unit.id=site.unit_id
         WHERE site.id=ANY($1)",
    )
    .bind(&site_ids)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| {
        (
            row.get::<String, _>("id"),
            SiteFacts {
                kind: row.get("kind"),
                unit_kind: row.get("unit_kind"),
                closed: row.get("closed"),
            },
        )
    })
    .collect();
    // What a kind of site IS comes from its template (0610): one that is given
    // a saleable floor sells, one that is given receiving is a warehouse. No
    // kind word is written into this file.
    let mut selling_kinds = HashSet::new();
    let mut warehouse_kinds = HashSet::new();
    for row in sqlx::query(
        "SELECT site_kind,bool_or(role='FLOOR') sells,bool_or(role='RECEIVING') receives
         FROM pool_template GROUP BY site_kind",
    )
    .fetch_all(&mut **tx)
    .await?
    {
        let kind: String = row.get("site_kind");
        if row.get::<bool, _>("sells") {
            selling_kinds.insert(kind.clone());
        }
        if row.get::<bool, _>("receives") {
            warehouse_kinds.insert(kind);
        }
    }
    Ok(CreateValidationContext {
        source_pools,
        sites,
        selling_kinds,
        warehouse_kinds,
    })
}

/// Lines MD adds to an allotment that already exists (`allotment_amend`: the
/// Edit opens the New Allotment grid, owner 9 Oct 2026). Checked exactly as a
/// new allotment's lines are — the source pool on its own site, the
/// destination's kind derived from its row, the route allowed for the
/// allotment's type — and answered with the destination word resolved.
pub(super) async fn validate_added_lines_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_type: AllotmentType,
    added: Vec<(LineIdentity, i64)>,
) -> Result<Vec<(LineIdentity, i64)>, AppError> {
    let mut lines: Vec<NormalizedLine> = added
        .into_iter()
        .map(|(identity, quantity)| NormalizedLine { identity, quantity })
        .collect();
    let validation = load_create_validation_context(tx, &lines).await?;
    for line in &mut lines {
        line.identity.destination_type = resolve_destination_type(&line.identity, &validation)?;
    }
    for line in &lines {
        validate_create_line(allotment_type, line, &validation)?;
    }
    Ok(lines
        .into_iter()
        .map(|line| (line.identity, line.quantity))
        .collect())
}

/// The word a line's destination is stored and sent under, from the
/// destination's row. A request may say SITE and leave it to the centre; one
/// that says STORE or DC must agree with the site it names.
fn resolve_destination_type(
    identity: &LineIdentity,
    context: &CreateValidationContext,
) -> Result<DestinationType, AppError> {
    if identity.destination_type == DestinationType::Supplier {
        return Ok(DestinationType::Supplier);
    }
    let destination = &identity.destination_id;
    if !context.sites.contains_key(destination) {
        return Err(AppError::NotFound(format!(
            "destination site {destination}"
        )));
    }
    let derived = if context.sells(destination) {
        DestinationType::Store
    } else if context.is_warehouse(destination) {
        DestinationType::Warehouse
    } else {
        return Err(AppError::Validation(format!(
            "destination {destination} neither sells nor keeps goods for others"
        )));
    };
    if identity.destination_type != DestinationType::Site && identity.destination_type != derived {
        return Err(AppError::Validation(format!(
            "destination {destination} is a {} site, not {}",
            derived.as_str(),
            identity.destination_type.as_str()
        )));
    }
    Ok(derived)
}

/// Whether one line fits its route, read from rows. Returns the purpose a
/// TO_SITE line implies.
fn validate_create_line(
    allotment_type: AllotmentType,
    line: &NormalizedLine,
    context: &CreateValidationContext,
) -> Result<Option<AllotmentPurpose>, AppError> {
    let identity = &line.identity;
    let (pool_site_id, pool_role) = context
        .source_pools
        .get(&identity.source_pool_id)
        .ok_or_else(|| AppError::NotFound("active placement source pool/site pair".into()))?;
    if pool_site_id != &identity.source_site_id {
        return Err(AppError::NotFound(
            "active placement source pool/site pair".into(),
        ));
    }
    // Goods at rest at the source, by the pool's role; the pool's own row
    // has already proved it stands at the source site.
    let role = PoolRole::from_code(pool_role).ok_or_else(|| {
        AppError::Conflict(format!(
            "pool {} has a role this build does not know",
            identity.source_pool_id
        ))
    })?;
    if !role.is_fulfillment_source() {
        return Err(AppError::Validation(format!(
            "{} is a {role} pool; an allotment is served from goods at rest",
            identity.source_pool_id
        )));
    }
    if !context.sites.contains_key(&identity.source_site_id) {
        return Err(AppError::NotFound(format!(
            "source site {}",
            identity.source_site_id
        )));
    }
    if identity.destination_id == identity.source_site_id {
        return Err(AppError::Validation(
            "an allotment cannot send goods to the site they stand at".into(),
        ));
    }
    match allotment_type {
        // Gudang → store is REPLENISH; store → store is a TRANSFER.
        AllotmentType::ToSite => {
            if identity.destination_type != DestinationType::Store {
                return Err(AppError::Validation(
                    "TO_SITE goes to a site of ours that sells".into(),
                ));
            }
            // A removed store (0990) takes nothing more. Only the destination:
            // its own goods still go back to the Gudang from there.
            if context.of_removed_store(&identity.destination_id) {
                return Err(AppError::Conflict(format!(
                    "{} belongs to a store that has been removed; nothing more is allotted to it",
                    identity.destination_id
                )));
            }
            // Owner's ruling, 28 Sep 2026 ("toko vs toko ga bisa ya, udah
            // titik"): a store never sends goods to another store. The database
            // refuses it too (`allotment_line_destination_is_a_site_of_its_kind`,
            // 0628, which reads the two units' kinds); refusing it HERE as well
            // is what turns a raw constraint error into a sentence the person
            // who raised the allotment can act on, and what stops the rest of
            // this transaction from being written and rolled back around it.
            if !context.of_head_office(&identity.source_site_id)
                && !context.of_head_office(&identity.destination_id)
            {
                return Err(AppError::Validation(
                    "goods never move from one store to another; return them to the Gudang and \
                     allot them from there"
                        .into(),
                ));
            }
            Ok(Some(if context.of_head_office(&identity.source_site_id) {
                AllotmentPurpose::Replenish
            } else {
                AllotmentPurpose::Transfer
            }))
        }
        // A shop's goods back to a warehouse of head office, into that store's
        // return pool there.
        AllotmentType::ReturnToWarehouse => {
            if !context.sells(&identity.source_site_id)
                || context.of_head_office(&identity.source_site_id)
            {
                return Err(AppError::Validation(
                    "RETURN_TO_WAREHOUSE starts at a shop of a store unit".into(),
                ));
            }
            if identity.destination_type != DestinationType::Warehouse
                || !context.of_head_office(&identity.destination_id)
            {
                return Err(AppError::Validation(
                    "RETURN_TO_WAREHOUSE goes to a warehouse of head office".into(),
                ));
            }
            if role == PoolRole::Picking {
                return Err(AppError::Validation(
                    "a return is served from the shop's stockroom, floor or reject".into(),
                ));
            }
            Ok(None)
        }
        // Stores never deal with suppliers: goods leave for one only from a
        // site of the head-office unit.
        AllotmentType::ReturnToSupplier => {
            if !context.of_head_office(&identity.source_site_id) {
                return Err(AppError::Validation(
                    "RETURN_TO_SUPPLIER leaves only from a site of the head-office unit".into(),
                ));
            }
            if identity.destination_type != DestinationType::Supplier
                || identity.destination_id != "external/supplier"
            {
                return Err(AppError::Validation(
                    "RETURN_TO_SUPPLIER goes to SUPPLIER/external/supplier".into(),
                ));
            }
            if !matches!(
                role,
                PoolRole::Stockroom | PoolRole::Reject | PoolRole::Return
            ) {
                return Err(AppError::Validation(
                    "a supplier return is served from a stockroom, reject or return pool".into(),
                ));
            }
            Ok(None)
        }
    }
}

/// The movement the centre writes for a line it executes itself — a source
/// site no node owns. Every pool is found by its site and role (0610).
async fn execution_transition(
    tx: &mut Transaction<'_, Postgres>,
    allotment_type: AllotmentType,
    identity: &LineIdentity,
) -> Result<(MovementCause, String), AppError> {
    match allotment_type {
        AllotmentType::ToSite if identity.destination_type == DestinationType::Store => {
            // The destination is carried by the allotment line, which is where
            // a promise belongs. Executing a line fetches goods to the source
            // site's pick area, and which piece serves which site is settled
            // when it goes into a carton (INVENTORY-V1 INV-05).
            let picking =
                super::sites::pool_of_role(&mut **tx, &identity.source_site_id, PoolRole::Picking)
                    .await?
                    .ok_or_else(|| {
                        AppError::Conflict(format!("{} has no pick area", identity.source_site_id))
                    })?;
            Ok((MovementCause::NormalMove, format!("{picking}:on_hand")))
        }
        AllotmentType::ReturnToWarehouse
            if identity.destination_type == DestinationType::Warehouse =>
        {
            // Into that store's own return pool at the warehouse, to be
            // inspected; the warehouse's stockroom only where no return pool
            // has been made for it.
            let landing = match super::sites::return_pool_for(
                &mut **tx,
                &identity.destination_id,
                &identity.source_site_id,
            )
            .await?
            {
                Some(pool_id) => pool_id,
                None => super::sites::pool_of_role(
                    &mut **tx,
                    &identity.destination_id,
                    PoolRole::Stockroom,
                )
                .await?
                .ok_or_else(|| {
                    AppError::Conflict(format!(
                        "{} has neither a return pool for {} nor a stockroom",
                        identity.destination_id, identity.source_site_id
                    ))
                })?,
            };
            Ok((
                MovementCause::ReturnToWarehouse,
                format!("{landing}:on_hand"),
            ))
        }
        AllotmentType::ReturnToSupplier
            if identity.destination_type == DestinationType::Supplier
                && identity.destination_id == "external/supplier" =>
        {
            Ok((MovementCause::SupplierReturn, "external/supplier".into()))
        }
        _ => Err(AppError::Conflict(
            "persisted allotment type and line endpoints are inconsistent".into(),
        )),
    }
}

async fn lock_active_skus(
    tx: &mut Transaction<'_, Postgres>,
    sku_ids: &[Uuid],
) -> Result<(), AppError> {
    lock_active_skus_with_codes(tx, sku_ids).await?;
    Ok(())
}

async fn lock_active_skus_with_codes(
    tx: &mut Transaction<'_, Postgres>,
    sku_ids: &[Uuid],
) -> Result<HashMap<Uuid, String>, AppError> {
    let rows = sqlx::query(
        "SELECT id,sku_code FROM sku WHERE id=ANY($1) AND active ORDER BY id FOR UPDATE",
    )
    .bind(sku_ids)
    .fetch_all(&mut **tx)
    .await?;
    if rows.len() != sku_ids.len() {
        return Err(AppError::Validation(
            "every allotment line must reference an active SKU".into(),
        ));
    }
    Ok(rows
        .into_iter()
        .map(|row| (row.get("id"), row.get("sku_code")))
        .collect())
}

/// One read of fact-derived stock and commitments for every distinct source
/// pool/SKU pair in a create request. One scan per subject sums both sides of
/// eligible warehouse/picking places; a transfer between them contributes
/// once in and once out, matching `normal_balance_tx`'s net balance exactly.
async fn load_create_availability(
    tx: &mut Transaction<'_, Postgres>,
    lines: &[NormalizedLine],
) -> Result<HashMap<(String, Uuid), (i64, i64)>, AppError> {
    let pairs: std::collections::BTreeSet<(String, Uuid)> = lines
        .iter()
        .map(|line| (line.identity.source_pool_id.clone(), line.identity.sku_id))
        .collect();
    let (source_pool_ids, sku_ids): (Vec<_>, Vec<_>) = pairs.into_iter().unzip();
    let rows = sqlx::query(
        "WITH requested AS MATERIALIZED (
             SELECT DISTINCT line.source_pool_id,line.sku_id
               FROM unnest($1::text[],$2::uuid[]) AS line(source_pool_id,sku_id)
         ), eligible AS MATERIALIZED (
             SELECT requested.source_pool_id,
                    array_agg(DISTINCT pool.id||':on_hand') AS place_ids
               FROM requested
               JOIN operational_pool source ON source.id=requested.source_pool_id
               JOIN operational_pool pool
                 ON pool.id=source.id
                 OR (source.role='STOCKROOM' AND pool.site_id=source.site_id
                     AND pool.role='PICKING')
              GROUP BY requested.source_pool_id
         ), normal AS (
             SELECT requested.source_pool_id,requested.sku_id,
                    sum(subject_balance.quantity)::bigint AS quantity
               FROM requested
               JOIN inventory_subject subject ON subject.sku_id=requested.sku_id
               JOIN eligible ON eligible.source_pool_id=requested.source_pool_id
               CROSS JOIN LATERAL (
                   SELECT (COALESCE(sum(movement.quantity)
                                        FILTER (WHERE movement.to_place_id=ANY(eligible.place_ids)),0)
                          - COALESCE(sum(movement.quantity)
                                        FILTER (WHERE movement.from_place_id=ANY(eligible.place_ids)),0))
                          AS quantity
                     FROM movement
                    WHERE movement.subject_id=subject.id
               ) subject_balance
              GROUP BY requested.source_pool_id,requested.sku_id
         ), allotted AS (
             SELECT commitment.source_pool_id,commitment.sku_id,
                    sum(commitment.to_pack_qty)::bigint AS quantity
               FROM requested
               JOIN allotment_line_commitment commitment
                 ON commitment.source_pool_id=requested.source_pool_id
                AND commitment.sku_id=requested.sku_id
              GROUP BY commitment.source_pool_id,commitment.sku_id
         )
         SELECT requested.source_pool_id,requested.sku_id,
                COALESCE(normal.quantity,0)::bigint AS normal_quantity,
                COALESCE(allotted.quantity,0)::bigint AS allotted_quantity
           FROM requested
           LEFT JOIN normal USING (source_pool_id,sku_id)
           LEFT JOIN allotted USING (source_pool_id,sku_id)",
    )
    .bind(&source_pool_ids)
    .bind(&sku_ids)
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                (row.get("source_pool_id"), row.get("sku_id")),
                (row.get("normal_quantity"), row.get("allotted_quantity")),
            )
        })
        .collect())
}

/// Edge-owned stock uses the node's pool spelling, but the centre's same
/// immutable commitments. Resolve each pool once and aggregate the whole
/// request rather than reading stock and reservations for every destination.
async fn load_edge_create_availability(
    tx: &mut Transaction<'_, Postgres>,
    lines: &[NormalizedLine],
    sku_codes: &HashMap<Uuid, String>,
    origin_id: &str,
    owner_site: &str,
) -> Result<HashMap<(String, Uuid), (i64, i64)>, AppError> {
    let source_pools: Vec<String> = lines
        .iter()
        .map(|line| line.identity.source_pool_id.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let rows = sqlx::query(
        "SELECT DISTINCT source.id AS source_pool_id,pool.id AS eligible_pool_id
         FROM operational_pool source JOIN operational_pool pool
           ON pool.id=source.id OR (source.role='STOCKROOM' AND pool.site_id=source.site_id AND pool.role='PICKING')
         WHERE source.id=ANY($1)",
    ).bind(&source_pools).fetch_all(&mut **tx).await?;
    let mut places: HashMap<String, Vec<String>> = source_pools
        .iter()
        .map(|pool| {
            (
                pool.clone(),
                vec![format!("{}:on_hand", pool_id_for_site(pool, owner_site))],
            )
        })
        .collect();
    for row in rows {
        let source: String = row.get("source_pool_id");
        let eligible: String = row.get("eligible_pool_id");
        places.entry(source).or_default().push(format!(
            "{}:on_hand",
            pool_id_for_site(&eligible, owner_site)
        ));
    }
    for values in places.values_mut() {
        values.sort();
        values.dedup();
    }
    let pairs: std::collections::BTreeSet<_> = lines
        .iter()
        .map(|line| (line.identity.source_pool_id.clone(), line.identity.sku_id))
        .collect();
    let mut requested = Vec::with_capacity(pairs.len());
    for (source, sku) in pairs {
        let code = sku_codes
            .get(&sku)
            .ok_or_else(|| AppError::NotFound(format!("sku {sku}")))?;
        requested.push(json!({"source_pool_id":source,"sku_id":sku,"sku_code":code,"places":places.get(&source)}));
    }
    let rows = sqlx::query(
        "WITH requested AS MATERIALIZED (
             SELECT * FROM jsonb_to_recordset($1::jsonb)
                 AS line(source_pool_id text,sku_id uuid,sku_code text,places text[])
         ), normal AS (
             SELECT requested.source_pool_id,requested.sku_id,sum(position.quantity)::bigint AS quantity
             FROM requested JOIN edge_inventory_fact_position position
               ON position.origin_id=$2 AND position.sku_code=requested.sku_code
              AND position.place_id=ANY(requested.places)
             GROUP BY requested.source_pool_id,requested.sku_id
         ), allotted AS (
             SELECT requested.source_pool_id,requested.sku_id,sum(commitment.to_pack_qty)::bigint AS quantity
             FROM requested JOIN allotment_line_commitment commitment
               ON commitment.source_pool_id=requested.source_pool_id AND commitment.sku_id=requested.sku_id
             JOIN allotment header ON header.id=commitment.allotment_id
             WHERE commitment.origin_id=$2 OR header.activation_target_origin_id=$2
             GROUP BY requested.source_pool_id,requested.sku_id
         )
         SELECT requested.source_pool_id,requested.sku_id,
                COALESCE(normal.quantity,0)::bigint AS normal_quantity,
                COALESCE(allotted.quantity,0)::bigint AS allotted_quantity
         FROM requested LEFT JOIN normal USING(source_pool_id,sku_id)
         LEFT JOIN allotted USING(source_pool_id,sku_id)",
    ).bind(json!(requested)).bind(origin_id).fetch_all(&mut **tx).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                (row.get("source_pool_id"), row.get("sku_id")),
                (row.get("normal_quantity"), row.get("allotted_quantity")),
            )
        })
        .collect())
}

pub(super) async fn lock_open_allotment(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
) -> Result<sqlx::postgres::PgRow, AppError> {
    let row =
        sqlx::query("SELECT id,allotment_number,type,status,activation_command_id,activation_target_origin_id,edge_application_status,cancellation_id,cancellation_command_id,edge_cancellation_status FROM allotment WHERE id=$1 FOR UPDATE")
            .bind(allotment_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::NotFound("allotment".into()))?;
    let status: String = row.get("status");
    if !matches!(status.as_str(), "ACTIVE" | "IN_PROGRESS") {
        return Err(AppError::Conflict(format!(
            "allotment must have remaining active quantity, currently {status}"
        )));
    }
    Ok(row)
}

/// Every pool a commitment against `source_pool_id` can actually be served
/// out of, as `:on_hand` place ids.
///
/// The warehouse and the picking area are one supply for this purpose: a
/// picker carrying goods between them settles nothing about who the goods are
/// for, and the carton they end up in is what binds them to a shop. Measuring
/// only the warehouse is what let the screen offer goods the writer then
/// refused — the same shirts counted as available by one and gone by the
/// other.
///
/// The per-store `picked.{store}` pools are legacy and take no new writes, but
/// what stands in them is as packable as anything else, so it is supply too.
///
/// Which pools those are is their ROLE (0610), never their spelling: a
/// stockroom's supply is itself and every PICKING pool at its site.
const ELIGIBLE_SUPPLY_PLACES: &str = "SELECT pool.id||':on_hand' AS place_id
     FROM operational_pool pool
     JOIN operational_pool source ON source.id=$2
     WHERE pool.id=$2
        OR (source.role='STOCKROOM' AND pool.site_id=source.site_id AND pool.role='PICKING')";

/// The pools of [`ELIGIBLE_SUPPLY_PLACES`], as ids in the centre's spelling —
/// for a reader that has to respell them for a node.
pub(super) async fn eligible_supply_pools_tx(
    tx: &mut Transaction<'_, Postgres>,
    source_pool_id: &str,
) -> Result<Vec<String>, AppError> {
    let mut pools: Vec<String> = sqlx::query_scalar(
        "SELECT pool.id
           FROM operational_pool pool
           JOIN operational_pool source ON source.id=$1
          WHERE pool.id=$1
             OR (source.role='STOCKROOM' AND pool.site_id=source.site_id AND pool.role='PICKING')",
    )
    .bind(source_pool_id)
    .fetch_all(&mut **tx)
    .await?;
    // A pool the centre holds no row for is still its own scope.
    if pools.is_empty() {
        pools.push(source_pool_id.to_string());
    }
    Ok(pools)
}

pub(super) async fn normal_balance_tx(
    tx: &mut Transaction<'_, Postgres>,
    source_pool_id: &str,
    sku_id: Uuid,
) -> Result<i64, AppError> {
    let row = sqlx::query(&format!(
        "WITH eligible AS ({ELIGIBLE_SUPPLY_PLACES})
         SELECT COALESCE(SUM(
             CASE WHEN movement.to_place_id IN (SELECT place_id FROM eligible) THEN movement.quantity ELSE 0 END
           - CASE WHEN movement.from_place_id IN (SELECT place_id FROM eligible) THEN movement.quantity ELSE 0 END
         ),0)::bigint quantity
         FROM movement JOIN inventory_subject subject ON subject.id=movement.subject_id
         WHERE subject.sku_id=$1
           AND (movement.to_place_id IN (SELECT place_id FROM eligible)
                OR movement.from_place_id IN (SELECT place_id FROM eligible))"
    ))
    .bind(sku_id)
    .bind(source_pool_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get("quantity"))
}

pub(super) async fn active_allotment_tx(
    tx: &mut Transaction<'_, Postgres>,
    source_pool_id: &str,
    sku_id: Uuid,
) -> Result<i64, AppError> {
    // `quantity − picked − cancelled` was this route's own spelling of the
    // commitment, and the fifth in the estate. It released at pick, so two
    // merchandisers could promise the same shirt the moment a picker touched
    // it.
    let row = sqlx::query(
        "SELECT COALESCE(SUM(to_pack_qty),0)::bigint quantity
         FROM allotment_line_commitment WHERE source_pool_id=$1 AND sku_id=$2",
    )
    .bind(source_pool_id)
    .bind(sku_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get("quantity"))
}

pub(super) async fn edge_normal_balance_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    scope_pool_ids: &[String],
    sku_code: &str,
) -> Result<i64, AppError> {
    // The node's own spelling of the same scope as `ELIGIBLE_SUPPLY_PLACES`
    // (`eligible_supply_pools_tx`, respelled by the caller): its stockroom and
    // its pick areas are one supply, because a carton is what binds a piece to
    // a destination.
    let places: Vec<String> = scope_pool_ids
        .iter()
        .map(|pool_id| format!("{pool_id}:on_hand"))
        .collect();
    let row = sqlx::query(
        "SELECT COALESCE(SUM(quantity),0)::bigint quantity
         FROM edge_inventory_fact_position
         WHERE origin_id=$1 AND sku_code=$3 AND place_id=ANY($2)",
    )
    .bind(origin_id)
    .bind(&places)
    .bind(sku_code)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get("quantity"))
}

async fn allocate_source_subjects(
    tx: &mut Transaction<'_, Postgres>,
    sku_id: Uuid,
    quantity: i64,
    source_place_id: &str,
    destination_place_id: &str,
) -> Result<Vec<MovementLine>, AppError> {
    let rows = sqlx::query(
        r#"
WITH delta AS (
    SELECT subject_id,quantity delta FROM movement WHERE to_place_id=$2
    UNION ALL SELECT subject_id,-quantity delta FROM movement WHERE from_place_id=$2
), balance AS (
    SELECT subject_id,SUM(delta)::bigint quantity FROM delta GROUP BY subject_id HAVING SUM(delta)>0
)
SELECT subject.id,subject.subject_type,balance.quantity
FROM balance JOIN inventory_subject subject ON subject.id=balance.subject_id
WHERE subject.sku_id=$1 ORDER BY subject.id FOR UPDATE OF subject
"#,
    )
    .bind(sku_id)
    .bind(source_place_id)
    .fetch_all(&mut **tx)
    .await?;
    let source: Place =
        source_place_id
            .parse()
            .map_err(|error: crate::cloud::domain::PlaceError| {
                AppError::Validation(error.to_string())
            })?;
    let destination: Place =
        destination_place_id
            .parse()
            .map_err(|error: crate::cloud::domain::PlaceError| {
                AppError::Validation(error.to_string())
            })?;
    let mut needed = quantity;
    let mut lines = Vec::new();
    for row in rows {
        if needed == 0 {
            break;
        }
        let balance: i64 = row.get("quantity");
        let subject_type: String = row.get("subject_type");
        let take = if subject_type == "UNIT" {
            1.min(needed)
        } else {
            balance.min(needed)
        };
        if take <= 0 {
            continue;
        }
        lines.push(MovementLine {
            subject_id: SubjectId(row.get("id")),
            quantity: take,
            from: source.clone(),
            to: destination.clone(),
        });
        needed -= take;
    }
    if needed > 0 {
        return Err(AppError::Conflict(format!(
            "insufficient inventory at {source_place_id}: balance {}, requested {quantity}",
            quantity - needed
        )));
    }
    Ok(lines)
}

/// One allotment, folded, as the commitment view sees it inside this
/// transaction — writes not yet committed included, which is the whole reason
/// the status is read here rather than recomputed from counters in hand.
struct AllotmentTotals {
    quantity: i64,
    cancelled: i64,
    to_pack: i64,
    to_receive: i64,
    status: FulfillmentStatus,
}

impl AllotmentTotals {
    /// What still has to leave the shelf. Deliberately not `quantity − picked
    /// − cancelled`: a free pick moves goods without promising them to
    /// anybody, so subtracting it here released a commitment nobody had met.
    fn remaining(&self) -> i64 {
        self.to_pack
    }

    /// The legacy spelling of the column, for the routes that still write it.
    fn legacy_status(&self) -> AllotmentStatus {
        AllotmentStatus::from(self.status)
    }
}

async fn allotment_totals_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
) -> Result<AllotmentTotals, AppError> {
    let row = sqlx::query(
        "SELECT commitment.original_alloted,commitment.to_pack_qty,commitment.to_receive_qty,
                commitment.closed_short_total,commitment.status
         FROM allotment_commitment commitment WHERE commitment.allotment_id=$1",
    )
    .bind(allotment_id)
    .fetch_one(&mut **tx)
    .await?;
    let stored: String = row.get("status");
    Ok(AllotmentTotals {
        quantity: row.get("original_alloted"),
        cancelled: row.get("closed_short_total"),
        to_pack: row.get("to_pack_qty"),
        to_receive: row.get("to_receive_qty"),
        status: FulfillmentStatus::from_legacy(&stored),
    })
}

pub(super) fn line_identity_from_row(
    row: &sqlx::postgres::PgRow,
) -> Result<LineIdentity, AppError> {
    let destination_type = DestinationType::from_str(&row.get::<String, _>("destination_type"))
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    Ok(LineIdentity {
        source_site_id: row.get("source_site_id"),
        source_pool_id: row.get("source_pool_id"),
        destination_type,
        destination_id: row.get("destination_id"),
        sku_id: row.get("sku_id"),
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn insert_allotment_event(
    tx: &mut Transaction<'_, Postgres>,
    event_key: &str,
    allotment_id: Option<Uuid>,
    allotment_line_id: Option<Uuid>,
    event_type: &str,
    identity: Option<&LineIdentity>,
    quantity: i64,
    remaining_delta: i64,
    movement_group_id: Option<Uuid>,
    reference_type: Option<&str>,
    reference_id: Option<&str>,
    actor_id: &str,
    details: Value,
    occurred_at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO allotment_event(id,event_key,allotment_id,allotment_line_id,event_type,sku_id,source_site_id,source_pool_id,destination_type,destination_id,quantity,remaining_delta,movement_group_id,reference_type,reference_id,actor_id,details,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
        .bind(Uuid::new_v4())
        .bind(event_key)
        .bind(allotment_id)
        .bind(allotment_line_id)
        .bind(event_type)
        .bind(identity.map(|value| value.sku_id))
        .bind(identity.map(|value| value.source_site_id.as_str()))
        .bind(identity.map(|value| value.source_pool_id.as_str()))
        .bind(identity.map(|value| value.destination_type.as_str()))
        .bind(identity.map(|value| value.destination_id.as_str()))
        .bind(quantity)
        .bind(remaining_delta)
        .bind(movement_group_id)
        .bind(reference_type)
        .bind(reference_id)
        .bind(actor_id)
        .bind(details)
        .bind(occurred_at)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_warehouse_or_head_office_destinations_need_node_spelling_lookup() {
        let context = CreateValidationContext {
            source_pools: HashMap::new(),
            sites: HashMap::from([
                (
                    "store-01".to_owned(),
                    SiteFacts {
                        kind: "STORE".into(),
                        unit_kind: "STORE".into(),
                        closed: false,
                    },
                ),
                (
                    "dc".to_owned(),
                    SiteFacts {
                        kind: "DC".into(),
                        unit_kind: HEAD_OFFICE_UNIT_KIND.into(),
                        closed: false,
                    },
                ),
            ]),
            selling_kinds: HashSet::new(),
            warehouse_kinds: HashSet::new(),
        };

        assert!(!context.node_spelling_may_differ("store-01"));
        assert!(context.node_spelling_may_differ("dc"));
        assert!(!context.node_spelling_may_differ("unknown"));
    }
}
