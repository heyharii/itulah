//! A shop sends its reject back to head office whenever it is ready (owner,
//! 23 Oct 2026): no request from HO is waited for.
//!
//! Every shipment from a shop to the Gudang stands on a return allotment
//! (`RETURN_TO_WAREHOUSE`): the shop's node picks only what an allotment
//! needs, and the Gudang's receipt counts against its lines. So the shop's
//! Send raises one here — off its own reject pool, to head office's site —
//! and its node picks, packs and dispatches it as soon as the activation
//! arrives, the same way it sends what HO moved to To be returned.
//!
//! Raised without a flow document: a flow's start is MD's act
//! (`check_start_permission`), and this one is the shop's.
//!
//! The shop's To be returned has three pockets, all role REJECT (0986):
//! Reject item `{site}.reject`, Over delivery `{site}.to-return.over` and
//! Return HO `{site}.to-return.ho`. The Send names which; a return is raised
//! per pocket. HO fills Return HO with [`mark_store_return`]: a command to
//! the shop's node, which moves the pieces off its shelves at once.

use crate::cloud::application::{AppError, CreateAllotmentLineInput, CreateAllotmentRequest};
use crate::cloud::domain::{AllotmentType, DestinationType};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize)]
pub struct RejectReturnLine {
    pub sku_code: String,
    pub quantity: i64,
}

/// Which pocket of the shop's To be returned a Send empties.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToReturnPocketName {
    #[default]
    Reject,
    OverDelivery,
    ReturnHo,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RaiseRejectReturnRequest {
    /// Reject when left out: the first screens sent nothing else.
    #[serde(default)]
    pub pocket: ToReturnPocketName,
    pub lines: Vec<RejectReturnLine>,
    pub idempotency_key: String,
}

/// One SKU per line, the quantities of a repeated one added up.
fn merged(lines: &[RejectReturnLine]) -> Result<BTreeMap<String, i64>, AppError> {
    let mut wanted: BTreeMap<String, i64> = BTreeMap::new();
    for line in lines {
        let code = line.sku_code.trim().to_ascii_uppercase();
        if code.is_empty() {
            return Err(AppError::Validation("sku_code is required".into()));
        }
        if line.quantity <= 0 {
            return Err(AppError::Validation(format!(
                "{code}: the quantity must be positive"
            )));
        }
        *wanted.entry(code).or_default() += line.quantity;
    }
    if wanted.is_empty() {
        return Err(AppError::Validation("no goods are named".into()));
    }
    Ok(wanted)
}

/// The allotment a shop's Send of its reject stands on, as
/// [`super::allotments::create_allotment`] answers it.
pub async fn raise_store_reject_return(
    pool: &PgPool,
    store_site_id: &str,
    request: RaiseRejectReturnRequest,
    actor_id: &str,
) -> Result<Value, AppError> {
    let key = request.idempotency_key.trim();
    if key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    let wanted = merged(&request.lines)?;

    let source = match request.pocket {
        ToReturnPocketName::Reject => {
            super::sites::pool_of_role(pool, store_site_id, crate::pool_role::PoolRole::Reject)
                .await?
                .ok_or_else(|| {
                    AppError::Validation(format!("{store_site_id} keeps no reject pool"))
                })?
        }
        ToReturnPocketName::OverDelivery => format!("{store_site_id}.to-return.over"),
        ToReturnPocketName::ReturnHo => format!("{store_site_id}.to-return.ho"),
    };
    if super::sites::pool_site_id(pool, &source).await?.as_deref() != Some(store_site_id) {
        return Err(AppError::Validation(format!(
            "{store_site_id} keeps no {source} pocket"
        )));
    }
    let head_office = super::sites::head_office_site_id(pool).await?;

    let codes: Vec<String> = wanted.keys().cloned().collect();
    let rows =
        sqlx::query("SELECT id, upper(sku_code) AS code FROM sku WHERE upper(sku_code) = ANY($1)")
            .bind(&codes)
            .fetch_all(pool)
            .await?;
    let mut ids = BTreeMap::new();
    for row in rows {
        let code: String = row.try_get("code")?;
        let id: uuid::Uuid = row.try_get("id")?;
        ids.insert(code, id);
    }
    let mut lines = Vec::with_capacity(wanted.len());
    for (code, quantity) in wanted {
        let sku_id = *ids.get(&code).ok_or_else(|| {
            AppError::Validation(format!("{code} is not a SKU head office knows"))
        })?;
        lines.push(CreateAllotmentLineInput {
            source_site_id: store_site_id.to_owned(),
            source_pool_id: source.clone(),
            destination_type: DestinationType::Warehouse,
            destination_id: head_office.clone(),
            sku_id,
            quantity,
        });
    }

    super::allotments::create_allotment(
        pool,
        CreateAllotmentRequest {
            allotment_type: AllotmentType::ReturnToWarehouse,
            lines,
            notes: Some(
                match request.pocket {
                    ToReturnPocketName::Reject => "Reject item, sent by the store",
                    ToReturnPocketName::OverDelivery => "Over delivery, sent by the store",
                    ToReturnPocketName::ReturnHo => "Return HO, sent by the store",
                }
                .into(),
            ),
            actor_id: actor_id.to_owned(),
            idempotency_key: format!("store-return:{store_site_id}:{key}"),
        },
    )
    .await
}

#[derive(Clone, Debug, Deserialize)]
pub struct MarkStoreReturnRequest {
    /// The shop whose goods go to its Return HO pocket.
    pub store_id: String,
    pub lines: Vec<RejectReturnLine>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MarkedStoreReturn {
    pub store_id: String,
    pub pieces: i64,
    pub command_id: uuid::Uuid,
}

/// HO moves a shop's goods to its To be returned · Return HO (owner, 23 Oct
/// 2026): one command to the shop's node, which moves them off its shelves.
/// Refused for a shop whose node cannot take the command yet, rather than
/// queued for a node that would never act on it.
pub async fn mark_store_return(
    pool: &PgPool,
    request: MarkStoreReturnRequest,
    moved_by: &str,
    now: DateTime<Utc>,
) -> Result<MarkedStoreReturn, AppError> {
    let wanted = merged(&request.lines)?;
    let moved_by = moved_by.trim();
    if moved_by.is_empty() {
        return Err(AppError::Validation(
            "who moves the goods is required".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let site = super::sync::canonical_site_id_tx(&mut tx, request.store_id.trim()).await?;
    if super::sites::site_kind(&mut *tx, &site).await? != Some(crate::ids::SiteKind::Store) {
        return Err(AppError::Validation(format!("{site} is not a store")));
    }
    let origin = super::sync::inventory_owner_tx(&mut tx, &site)
        .await?
        .ok_or_else(|| AppError::Validation(format!("{site} has no store server")))?;
    if !super::sync::origin_takes_tx(
        &mut tx,
        &origin,
        crate::sync::workflow::STORE_RETURN_MARK_CAPABILITY,
    )
    .await?
    {
        return Err(AppError::Conflict(format!(
            "{site}'s store server is older than Return HO; update it first"
        )));
    }
    let pieces = wanted.values().sum();
    let payload = crate::sync::workflow::StoreReturnMarkPayload {
        schema_version: crate::sync::workflow::STORE_RETURN_MARK_SCHEMA_VERSION,
        site_id: site.clone(),
        lines: wanted
            .into_iter()
            .map(
                |(sku_code, quantity)| crate::sync::workflow::StoreReturnMarkLine {
                    sku_code,
                    quantity,
                },
            )
            .collect(),
        moved_by: moved_by.to_owned(),
        moved_at: now,
    };
    let command_id = super::sync::issue_command_tx(
        &mut tx,
        crate::sync::workflow::INVENTORY_STORE_RETURN_MARK_V1,
        &serde_json::to_value(&payload).map_err(|error| AppError::Validation(error.to_string()))?,
        moved_by,
        None,
        &[origin],
    )
    .await?;
    tx.commit().await?;
    Ok(MarkedStoreReturn {
        store_id: site,
        pieces,
        command_id,
    })
}
