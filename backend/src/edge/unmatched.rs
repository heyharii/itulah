//! What a till sells that this shop's own stock cannot give it.
//!
//! Owner, 23 Oct 2026: a piece the till cannot take from its own store's stock
//! still sells ("barang harus bisa dijual"), and the sale belongs to the store
//! where the shopper paid. Head office matches it later to a piece at a store
//! or at HO, and that piece leaves that place's stock.
//!
//! So a basket is read here before it is priced. A tag on this shop's floor
//! sells from the floor, as it always did; a tag in this shop's stockroom sells
//! from the stockroom; any other tag — unknown here, sold already, elsewhere, on
//! its way — becomes an `OTHER` line and moves nothing. A SKU typed off the
//! label is `NO_TAG` when this shop holds one on hand and `NOT_IN_STOCK` when it
//! holds none. An item with neither is `UNKNOWN`: the Kepala toko approved its
//! name and price beforehand (`approve_unknown`) and the sale spends that
//! approval.

use super::contracts::{EdgeError, UnknownItemApproval, UnknownItemApprovalRequest, UntaggedLine};
use super::sqlite::db;
use crate::edge::{sku_stock_pools, InventoryState, Place, SiteId, SubjectId};
use crate::sync::unmatched::{KIND_NOT_IN_STOCK, KIND_NO_TAG, KIND_OTHER};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::HashSet;
use uuid::Uuid;

/// A tag this shop holds on hand: it sells from where it stands.
#[derive(Clone, Debug)]
pub(crate) struct HeldTag {
    pub subject_id: SubjectId,
    pub epc: String,
    pub sku_code: String,
    /// The price stamped on it at intake — the fallback with no book in force.
    pub unit_price_minor: i64,
    pub from: Place,
}

/// A line that sells with no stock moving here.
#[derive(Clone, Debug)]
pub(crate) struct UnmatchedDraft {
    /// Its position in the request's `untagged`; `None` for a tag in `epcs`.
    pub index: Option<u32>,
    pub kind: &'static str,
    pub sku_code: String,
    pub epc: Option<String>,
    pub from_place: Option<String>,
    /// What to charge with no book in force: the piece's intake price when
    /// this node knows the piece, else the catalogue's price.
    pub fallback_price_minor: Option<i64>,
    /// The catalogue's name, for the till and the receipt.
    pub name: Option<String>,
}

/// One line the engine prices, in the order it prices them.
#[derive(Clone, Debug)]
pub(crate) enum PricedSlot {
    Held(HeldTag),
    Unmatched(UnmatchedDraft),
}

/// An item with no tag and no SKU, at the Kepala toko's price.
///
/// No longer built: since 23 Oct 2026 the client refuses such an item at the
/// till ([`not_in_this_shop`]). Kept so the sale path that spends an approval
/// still reads, and the rows already written still show at head office.
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct UnknownDraft {
    pub index: u32,
    pub name: String,
    pub unit_price_minor: i64,
    pub approval_id: Option<String>,
}

/// A basket read before it is priced.
///
/// `slots` are in the order the till reads the quote's `lines[]`: the tags of
/// `epcs` in request order, then the untagged lines that name a SKU or a tag,
/// in request order. UNKNOWN lines are not priced by the engine and are only in
/// `unknown`.
#[derive(Clone, Debug, Default)]
pub(crate) struct Basket {
    pub slots: Vec<PricedSlot>,
    pub unknown: Vec<UnknownDraft>,
}

impl Basket {
    pub fn sku_codes(&self) -> Vec<String> {
        self.slots
            .iter()
            .map(|slot| match slot {
                PricedSlot::Held(tag) => tag.sku_code.clone(),
                PricedSlot::Unmatched(line) => line.sku_code.clone(),
            })
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty() && self.unknown.is_empty()
    }
}

/// A SKU as typed: the digits and letters of it, whatever the label put
/// between them (`00000004·103`).
pub(crate) fn normalized_sku(value: &str) -> String {
    value
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_uppercase()
}

fn normalized_epc(value: &str) -> Result<String, EdgeError> {
    let value = value.trim().to_ascii_uppercase();
    if value.is_empty() {
        return Err(EdgeError::Validation("EPC is required".into()));
    }
    Ok(value)
}

/// Read a basket: every tag where it stands, every typed line by kind.
///
/// `epcs` arrive normalised and without duplicates. Nothing is refused for
/// where a piece is — only for what cannot be priced at all (a tag that is not
/// ours and names no SKU) or an UNKNOWN line missing its name or price.
pub(crate) fn classify(
    connection: &Connection,
    site_id: &SiteId,
    epcs: &[String],
    untagged: &[UntaggedLine],
) -> Result<Basket, EdgeError> {
    let (floor, stockroom) = sku_stock_pools(site_id);
    let floor = Place::Operational {
        pool: floor,
        state: InventoryState::Normal,
    };
    let stockroom = Place::Operational {
        pool: stockroom,
        state: InventoryState::Normal,
    };
    let mut seen: HashSet<String> = epcs.iter().cloned().collect();
    let mut basket = Basket::default();
    for epc in epcs {
        basket.slots.push(refuse_other(classify_tag(
            connection, &floor, &stockroom, epc, None,
        ))?);
    }
    for (position, line) in untagged.iter().enumerate() {
        let index = u32::try_from(position).unwrap_or(u32::MAX);
        let sku = line
            .sku_code
            .as_deref()
            .map(normalized_sku)
            .filter(|sku| !sku.is_empty());
        let epc = match line.epc.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
            Some(epc) => {
                let epc = normalized_epc(epc)?;
                if !seen.insert(epc.clone()) {
                    return Err(EdgeError::Validation(format!(
                        "EPC {epc} is on this basket twice"
                    )));
                }
                Some(epc)
            }
            None => None,
        };
        match (sku, epc) {
            // Typed off the label. Which of the two kinds is this shop's own
            // stock's answer: does it hold any of that SKU on hand?
            (Some(sku_code), epc) => {
                let held = on_hand_of_sku(connection, &sku_code, &floor, &stockroom)?;
                let (name, catalogue_price) = catalogue(connection, &sku_code)?;
                basket.slots.push(PricedSlot::Unmatched(UnmatchedDraft {
                    index: Some(index),
                    kind: if held > 0 { KIND_NO_TAG } else { KIND_NOT_IN_STOCK },
                    sku_code,
                    epc,
                    from_place: None,
                    fallback_price_minor: catalogue_price,
                    name,
                }));
            }
            // A tag the till says is not held here. The node reads it anyway:
            // if this shop does hold it, it sells from stock like any tag.
            (None, Some(epc)) => {
                basket.slots.push(refuse_other(classify_tag(
                    connection,
                    &floor,
                    &stockroom,
                    &epc,
                    Some(index),
                ))?);
            }
            // No tag and no SKU: not sold (client, 23 Oct 2026). The shopper
            // waits for a new barcode instead.
            (None, None) => {
                let label = line
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .unwrap_or("Barang tanpa SKU");
                return Err(not_in_this_shop(label));
            }
        }
    }
    Ok(basket)
}

/// What the till is told for a piece it may not sell (client, 23 Oct 2026):
/// a tag recorded at another store or unknown here, or an item with no SKU.
/// 409, on the quote as on the sale, so the till can say it before Bayar.
pub(crate) fn not_in_this_shop(label: &str) -> EdgeError {
    EdgeError::Conflict(format!("{label} tidak ada di toko ini · minta barcode baru"))
}

/// The SKU as the label prints it: `00000004·103`.
fn sku_label(sku_code: &str) -> String {
    if sku_code.len() == 11 && sku_code.bytes().all(|b| b.is_ascii_digit()) {
        format!("{}·{}", &sku_code[..8], &sku_code[8..])
    } else {
        sku_code.to_string()
    }
}

/// A tag this shop does not hold is refused, never sold as `OTHER` any more
/// (client, 23 Oct 2026). Typed SKUs (`NO_TAG`, `NOT_IN_STOCK`) still sell.
fn refuse_other(slot: Result<PricedSlot, EdgeError>) -> Result<PricedSlot, EdgeError> {
    match slot? {
        PricedSlot::Unmatched(line) if line.kind == KIND_OTHER => {
            let label = line
                .name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| sku_label(&line.sku_code));
            Err(not_in_this_shop(&label))
        }
        slot => Ok(slot),
    }
}

fn classify_tag(
    connection: &Connection,
    floor: &Place,
    stockroom: &Place,
    epc: &str,
    index: Option<u32>,
) -> Result<PricedSlot, EdgeError> {
    let subject: Option<(String, Option<String>, i64)> = connection
        .prepare_cached(
            "SELECT id, sku_code, unit_price_minor FROM inventory_subject WHERE epc = ?1",
        )
        .map_err(db)?
        .query_row([epc], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .optional()
        .map_err(db)?;
    if let Some((id, Some(sku_code), unit_price_minor)) = &subject {
        let subject_id = SubjectId(
            Uuid::parse_str(id).map_err(|error| EdgeError::Persistence(error.to_string()))?,
        );
        // The floor first — where a shopper picks from — then the stockroom.
        for place in [floor, stockroom] {
            if balance(connection, subject_id, &place.id())? >= 1 {
                return Ok(PricedSlot::Held(HeldTag {
                    subject_id,
                    epc: epc.to_string(),
                    sku_code: sku_code.clone(),
                    unit_price_minor: *unit_price_minor,
                    from: place.clone(),
                }));
            }
        }
    }
    // Not this shop's to give. Which SKU it is: the piece's own when this node
    // knows it, the delivery's when it is in one on its way here, else what the
    // tag itself encodes.
    let in_transit: Option<String> = connection
        .prepare_cached(
            "SELECT u.sku_code FROM store_inbound_unit u
               JOIN store_inbound_delivery d ON d.delivery_id = u.delivery_id
              WHERE u.epc = ?1 AND d.status = 'IN_TRANSIT' AND u.outcome IS NULL
              LIMIT 1",
        )
        .map_err(db)?
        .query_row([epc], |row| row.get(0))
        .optional()
        .map_err(db)?;
    let known_sku = subject.as_ref().and_then(|(_, sku, _)| sku.clone());
    let sku_code = known_sku
        .clone()
        .or_else(|| in_transit.clone())
        .or_else(|| {
            crate::cloud::domain::decode_epc(epc)
                .ok()
                .map(|(sku, _)| sku)
        })
        .or_else(|| {
            // EPC characters 2..13, when they are digits: the SKU as our
            // labels print it, read from a tag whose header is not ours.
            epc.get(2..13)
                .filter(|digits| digits.bytes().all(|b| b.is_ascii_digit()))
                .map(str::to_string)
        })
        .ok_or_else(|| not_in_this_shop(epc))?;
    let (name, catalogue_price) = catalogue(connection, &sku_code)?;
    Ok(PricedSlot::Unmatched(UnmatchedDraft {
        index,
        kind: KIND_OTHER,
        sku_code,
        epc: Some(epc.to_string()),
        from_place: in_transit.map(|_| "In transit".to_string()),
        fallback_price_minor: match (&subject, known_sku) {
            (Some((_, _, intake)), Some(_)) => Some(*intake),
            _ => catalogue_price,
        },
        name,
    }))
}

fn balance(connection: &Connection, subject_id: SubjectId, place_id: &str) -> Result<i64, EdgeError> {
    connection
        .prepare_cached(
            "SELECT quantity FROM inventory_projection WHERE subject_id = ?1 AND place_id = ?2",
        )
        .map_err(db)?
        .query_row(params![subject_id.to_string(), place_id], |row| row.get(0))
        .optional()
        .map(|quantity| quantity.unwrap_or(0))
        .map_err(db)
}

/// Pieces of one SKU this shop holds on hand, floor and stockroom.
fn on_hand_of_sku(
    connection: &Connection,
    sku_code: &str,
    floor: &Place,
    stockroom: &Place,
) -> Result<i64, EdgeError> {
    connection
        .prepare_cached(
            "SELECT COALESCE(SUM(p.quantity), 0) FROM inventory_projection p
               JOIN inventory_subject s ON s.id = p.subject_id
              WHERE s.sku_code = ?1 AND p.place_id IN (?2, ?3) AND p.quantity > 0",
        )
        .map_err(db)?
        .query_row(params![sku_code, floor.id(), stockroom.id()], |row| row.get(0))
        .map_err(db)
}

/// The catalogue's name and price for a SKU, when it has a row.
fn catalogue(
    connection: &Connection,
    sku_code: &str,
) -> Result<(Option<String>, Option<i64>), EdgeError> {
    Ok(connection
        .prepare_cached("SELECT name, base_price_minor FROM catalog_item WHERE sku_code = ?1")
        .map_err(db)?
        .query_row([sku_code], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<i64>>(1)?))
        })
        .optional()
        .map_err(db)?
        .unwrap_or((None, None)))
}

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// The Kepala toko approves one unknown item, once.
///
/// Verified here and only here: a finger's grant is single-use and lives a
/// few seconds, and the till quotes every couple of seconds, so a supervisor
/// carried on the quote or checked again at the sale would burn the grant or
/// miss it. The approval is what the sale's UNKNOWN line carries.
pub(crate) fn approve_unknown(
    tx: &Transaction<'_>,
    request: &UnknownItemApprovalRequest,
    now: DateTime<Utc>,
) -> Result<UnknownItemApproval, EdgeError> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err(EdgeError::Validation(
            "an unknown item needs a name".into(),
        ));
    }
    if request.unit_price_minor <= 0 {
        return Err(EdgeError::Validation(
            "an unknown item needs a price above nought".into(),
        ));
    }
    let approved_by = crate::edge::till::verify_supervisor(tx, Some(&request.supervisor))?;
    let approved_by_name: String = tx
        .prepare_cached("SELECT display_name FROM edge_user WHERE username = ?1")
        .map_err(db)?
        .query_row([&approved_by], |row| row.get(0))
        .optional()
        .map_err(db)?
        .unwrap_or_else(|| approved_by.clone());
    let approval_id = Uuid::new_v4().to_string();
    tx.prepare_cached(
        "INSERT INTO unknown_item_approval (id, name, unit_price_minor, approved_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .map_err(db)?
    .execute(params![
        approval_id,
        name,
        request.unit_price_minor,
        approved_by,
        stamp(now)
    ])
    .map_err(db)?;
    Ok(UnknownItemApproval {
        approval_id,
        approved_by,
        approved_by_name,
    })
}

/// Spend an approval on the sale that rings its line, inside that sale's
/// transaction: one approval, one line, and only for the name and the price
/// that were approved. Answers who approved it — the line's `priced_by`.
pub(crate) fn spend_approval(
    tx: &Transaction<'_>,
    line: &UnknownDraft,
    sale_id: Uuid,
) -> Result<String, EdgeError> {
    let approval_id = line.approval_id.as_deref().ok_or_else(|| {
        EdgeError::Validation(format!(
            "unknown item {} needs the Kepala toko's approval",
            line.name
        ))
    })?;
    let row: Option<(String, i64, String, Option<String>)> = tx
        .prepare_cached(
            "SELECT name, unit_price_minor, approved_by, used_sale_id
               FROM unknown_item_approval WHERE id = ?1",
        )
        .map_err(db)?
        .query_row([approval_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .optional()
        .map_err(db)?;
    let (name, price, approved_by, used) = row.ok_or_else(|| {
        EdgeError::Validation(format!(
            "unknown item {} carries an approval this shop never gave",
            line.name
        ))
    })?;
    if used.is_some() {
        return Err(EdgeError::Conflict(format!(
            "the approval for {} was already used on another sale",
            line.name
        )));
    }
    if !name.trim().eq_ignore_ascii_case(line.name.trim()) || price != line.unit_price_minor {
        return Err(EdgeError::Validation(format!(
            "the approval was for {name} at {price}, not {} at {}",
            line.name, line.unit_price_minor
        )));
    }
    tx.prepare_cached(
        "UPDATE unknown_item_approval SET used_sale_id = ?2
          WHERE id = ?1 AND used_sale_id IS NULL",
    )
    .map_err(db)?
    .execute(params![approval_id, sale_id.to_string()])
    .map_err(db)?;
    Ok(approved_by)
}

/// The receipt number and the till label an unmatched line travels with, so
/// head office shows them as the shop printed them.
pub(crate) fn till_label(
    connection: &Connection,
    shift_id: Option<&str>,
) -> Result<Option<String>, EdgeError> {
    let Some(shift_id) = shift_id else {
        return Ok(None);
    };
    let terminal: Option<String> = connection
        .prepare_cached("SELECT terminal_id FROM cash_shift WHERE id = ?1")
        .map_err(db)?
        .query_row([shift_id], |row| row.get(0))
        .optional()
        .map_err(db)?;
    Ok(terminal.map(|terminal| crate::edge::till::seat_label(&terminal)))
}

/// Head office matched a sale to a piece THIS shop holds: let it go
/// (`inventory.unmatched_sale.take.v1`).
///
/// The node writes the SALE movement itself, because its ledger is its own to
/// write; it travels up like any other. The piece head office saw is taken if
/// it is still here, any piece of the SKU otherwise — floor first, then the
/// stockroom. Every outcome is recorded and none blocks: a take addressed to
/// another site is ignored, and one for a SKU this shop no longer holds is
/// written down as NOT_HELD and passed. Stopping the command stream over a
/// piece that is already gone would be worse than the gap it leaves.
pub(crate) fn apply_take(
    tx: &Transaction<'_>,
    node: &crate::edge::NodeContext,
    command_id: Uuid,
    payload: &crate::sync::unmatched::UnmatchedSaleTakePayload,
) -> Result<(), EdgeError> {
    if node.site_id.as_str() != payload.site_id {
        tracing::warn!(
            take = %payload.take_id,
            site = %payload.site_id,
            node_site = %node.site_id,
            "ignoring an unmatched sale take addressed to another site"
        );
        return Ok(());
    }
    let already: Option<String> = tx
        .prepare_cached("SELECT outcome FROM unmatched_sale_take WHERE take_id = ?1")
        .map_err(db)?
        .query_row([payload.take_id.to_string()], |row| row.get(0))
        .optional()
        .map_err(db)?;
    if already.is_some() {
        return Ok(());
    }
    let (floor, stockroom) = sku_stock_pools(&node.site_id);
    let floor = Place::Operational {
        pool: floor,
        state: InventoryState::Normal,
    };
    let stockroom = Place::Operational {
        pool: stockroom,
        state: InventoryState::Normal,
    };
    let sku_code = normalized_sku(&payload.sku_code);
    let preferred = payload
        .epc
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_uppercase)
        .unwrap_or_default();
    let piece: Option<(String, String, String)> = tx
        .prepare_cached(
            "SELECT s.id, s.epc, p.place_id FROM inventory_projection p
               JOIN inventory_subject s ON s.id = p.subject_id
              WHERE s.sku_code = ?1 AND p.place_id IN (?2, ?3) AND p.quantity > 0
              ORDER BY (s.epc = ?4) DESC, (p.place_id = ?2) DESC, s.epc
              LIMIT 1",
        )
        .map_err(db)?
        .query_row(
            params![sku_code, floor.id(), stockroom.id(), preferred],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)?;
    let record = |outcome: &str, epc: Option<&str>, group: Option<String>| -> Result<(), EdgeError> {
        tx.prepare_cached(
            "INSERT INTO unmatched_sale_take
                 (take_id, command_id, sku_code, epc, outcome, movement_group_id, applied_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(db)?
        .execute(params![
            payload.take_id.to_string(),
            command_id.to_string(),
            sku_code,
            epc,
            outcome,
            group,
            stamp(Utc::now())
        ])
        .map(|_| ())
        .map_err(db)
    };
    let Some((subject_id, epc, place_id)) = piece else {
        return record("NOT_HELD", None, None);
    };
    let from = if place_id == floor.id() { floor } else { stockroom };
    let subject_id = SubjectId(
        Uuid::parse_str(&subject_id).map_err(|error| EdgeError::Persistence(error.to_string()))?,
    );
    let actor = payload.matched_by.trim();
    let command = crate::edge::MovementCommand {
        movement_group_id: crate::edge::MovementGroupId::new(),
        lines: vec![crate::edge::MovementLine {
            subject_id,
            quantity: 1,
            from,
            to: Place::External {
                place: crate::edge::ExternalPlace::Customer,
            },
        }],
        cause: crate::edge::MovementCause::Sale,
        reference_type: Some(crate::sync::unmatched::UNMATCHED_SALE_REFERENCE.into()),
        reference_id: Some(payload.take_id.to_string()),
        reason: format!(
            "Sold at {} on receipt {}; matched by head office",
            payload.sold_at_site_id,
            payload.receipt_no.as_deref().unwrap_or("not recorded")
        ),
        actor_id: if actor.is_empty() {
            "system:unmatched-sale".into()
        } else {
            actor.to_string()
        },
        occurred_at: Utc::now(),
    };
    let result = crate::edge::SqliteEdge::append_movement(
        node,
        tx,
        &format!("unmatched-sale-take-{}", payload.take_id),
        &command,
    )?;
    record(
        "TAKEN",
        Some(epc.as_str()),
        Some(result.movement_group_id.to_string()),
    )?;
    crate::edge::SqliteEdge::enqueue_pool_snapshot(tx, node, Uuid::new_v4()).map(|_| ())
}
