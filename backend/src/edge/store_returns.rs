//! The returns Merchandise asked this shop for, and how the shop sends them.
//!
//! Head office raises a RETURN_TO_DC allotment and the shop's node files it in
//! `dc_allotment_work`. The shop works it the way the Gudang works an
//! allotment (owner, 25 Oct 2026): **Picklist → Picked → Packed → In transit**,
//! on the outbound path every site already has — a picklist per request off
//! its return pool, a sealed koli, a trip. Two things differ from the Gudang:
//! the shop sees goods, never a request (every open request is summed by
//! article), and it may send part of what it was asked — an article whole or
//! not at all; what it does not pick stays on the Picklist until it is picked
//! or MD closes it short.
//!
//! [`asks`] and `store_return_send` (the one-tap send of a whole request) stay
//! for Stock › To be returned. Each command below keeps the steps it worked
//! out under the caller's key and runs each under a key derived from it, so
//! a retried press finishes what the first one started instead of reading
//! the board again or doing it twice.

use super::contracts::{
    CreatePicklistRequest, DispatchTripRequest, PackLine, PackRequest, PickLine,
};
use super::outbound::{
    self, Dispatch, Koli, KoliManifest, MoveBackFrom, MoveBackLine, MoveBackRequest, MoveBackTo,
    WAITING_PICK_UNITS,
};
use super::sqlite::db;
use super::{EdgeError, EdgeInventory};
use rusqlite::{params, Connection};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize)]
pub struct StoreReturnLine {
    pub sku_code: String,
    pub name: Option<String>,
    /// Still to send: accepted, less what is packed and what was cancelled.
    pub quantity: i64,
    /// Where the pieces come off.
    #[serde(skip)]
    pub source_pool_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct StoreReturnAsk {
    pub allotment_id: String,
    pub allotment_number: String,
    pub requested_at: String,
    pub quantity: i64,
    pub lines: Vec<StoreReturnLine>,
    /// The site the goods go to.
    #[serde(skip)]
    pub destination_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct StoreReturnList {
    pub items: Vec<StoreReturnAsk>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SendReturnRequest {
    pub idempotency_key: String,
    /// Who carries it — courier, plate, driver — as one note, the way the
    /// Gudang writes a trip (owner, 23 Oct 2026: the shop dispatches itself).
    #[serde(default)]
    pub trip_note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SendReturnResult {
    pub shipment_number: String,
    pub quantity: i64,
}

/// Every return Merchandise asked this shop for that still has something to send.
pub fn asks(connection: &Connection) -> Result<StoreReturnList, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT w.allotment_id, w.allotment_number, w.created_at,
                    l.sku_code, l.source_pool_id, l.destination_id,
                    l.accepted_quantity - l.packed_quantity - l.cancelled_quantity AS left,
                    (SELECT c.name FROM catalog_item c WHERE c.sku_code = l.sku_code) AS name
               FROM dc_allotment_work w
               JOIN dc_allotment_work_line l ON l.allotment_id = w.allotment_id
              WHERE w.allotment_type = 'RETURN_TO_DC'
                AND w.application_status = 'ACCEPTED'
                AND w.fulfillment_status IN ('OPEN', 'IN_PROGRESS')
                AND l.accepted_quantity - l.packed_quantity - l.cancelled_quantity > 0
              ORDER BY w.created_at, w.allotment_id, l.sku_code",
        )
        .map_err(db)?;
    let rows = statement
        .query_map(params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let mut by: BTreeMap<String, StoreReturnAsk> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    for (id, number, at, sku, pool, destination, left, name) in rows {
        let ask = by.entry(id.clone()).or_insert_with(|| {
            order.push(id.clone());
            StoreReturnAsk {
                allotment_id: id.clone(),
                allotment_number: number,
                requested_at: at,
                quantity: 0,
                lines: Vec::new(),
                destination_id: destination,
            }
        });
        ask.quantity += left;
        ask.lines.push(StoreReturnLine {
            sku_code: sku,
            name,
            quantity: left,
            source_pool_id: pool,
        });
    }
    Ok(StoreReturnList {
        items: order.into_iter().filter_map(|id| by.remove(&id)).collect(),
    })
}

// ---------------------------------------------------------------------------
// Return to HO, step by step (owner, 25 Oct 2026)
// ---------------------------------------------------------------------------

/// One SKU on the board: what it is and how many pieces stand at this step.
#[derive(Clone, Debug, Serialize)]
pub struct ReturnPiece {
    pub sku_code: String,
    pub article_code: String,
    pub name: Option<String>,
    pub image_url: Option<String>,
    pub quantity: i64,
    /// Which request, where it goes and where it comes off — the node's to
    /// act on, never the shop's to read (it sees goods, not requests).
    #[serde(skip)]
    pub allotment_id: String,
    #[serde(skip)]
    pub destination_id: String,
    #[serde(skip)]
    pub source_pool_id: String,
}

/// A sealed koli on its way to HO and not yet on a trip, with what is in it.
#[derive(Debug, Serialize)]
pub struct ReturnKoli {
    pub koli: Koli,
    pub lines: Vec<ReturnPiece>,
}

/// The Return to HO screen in one read: what is still to pick, what is
/// picked and in no koli, the sealed koli, and the trips that carried them.
#[derive(Debug, Serialize)]
pub struct ReturnBoard {
    pub to_pick: Vec<ReturnPiece>,
    pub picked: Vec<ReturnPiece>,
    pub packed: Vec<ReturnKoli>,
    pub trips: Vec<Dispatch>,
}

/// The articles a press acts on, as the shop chose them.
#[derive(Clone, Debug, Deserialize)]
pub struct ReturnArticlesRequest {
    pub idempotency_key: String,
    pub article_codes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ReturnUnpackRequest {
    pub idempotency_key: String,
    pub koli_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ReturnDispatchRequest {
    pub idempotency_key: String,
    pub koli_ids: Vec<String>,
    #[serde(default)]
    pub trip_note: Option<String>,
}

/// What a Pick press came back with: pieces now in Picked, and the lines the
/// shelf could not answer, in the node's own words.
#[derive(Debug, Deserialize, Serialize)]
pub struct ReturnPicked {
    pub picked: i64,
    pub refused: Vec<String>,
}

/// The koli a Pack press sealed — one per destination, which is one: HO.
#[derive(Debug, Serialize)]
pub struct ReturnPacked {
    pub koli: Vec<KoliManifest>,
}

/// A trip's number and how many pieces went on it.
#[derive(Debug, Serialize)]
pub struct ReturnDispatched {
    pub dispatch_number: String,
    pub quantity: i64,
}

/// The board for `site_id`'s node.
pub fn board(connection: &Connection, site_id: &str) -> Result<ReturnBoard, EdgeError> {
    // To pick: every open return line's pieces not yet in a koli, less what
    // was picked for that request and waits in the pick area.
    let mut statement = connection
        .prepare(
            "SELECT x.allotment_id, x.destination_id, x.source_pool_id, x.sku_code,
                    SUM(x.accepted_quantity - x.picked_quantity - x.cancelled_quantity),
                    COALESCE(c.article_code, substr(x.sku_code, 1, 8)), c.name, c.image_url
               FROM dc_allotment_work w
               JOIN dc_allotment_work_line x ON x.allotment_id = w.allotment_id
               LEFT JOIN catalog_item c ON c.sku_code = x.sku_code
              WHERE w.allotment_type = 'RETURN_TO_DC'
                AND w.application_status = 'ACCEPTED'
                AND w.fulfillment_status IN ('OPEN', 'IN_PROGRESS')
              GROUP BY x.allotment_id, x.destination_id, x.source_pool_id, x.sku_code
             HAVING SUM(x.accepted_quantity - x.picked_quantity - x.cancelled_quantity) > 0
              ORDER BY w.created_at, x.allotment_id, x.sku_code",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok(ReturnPiece {
                allotment_id: row.get(0)?,
                destination_id: row.get(1)?,
                source_pool_id: row.get(2)?,
                sku_code: row.get(3)?,
                quantity: row.get(4)?,
                article_code: row.get(5)?,
                name: row.get(6)?,
                image_url: row.get(7)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let mut to_pick = Vec::with_capacity(rows.len());
    for mut piece in rows {
        piece.quantity = outbound::still_to_pick(
            connection,
            site_id,
            &piece.allotment_id,
            &piece.destination_id,
            &piece.sku_code,
        )?;
        if piece.quantity > 0 {
            to_pick.push(piece);
        }
    }

    // Picked: what a return's picklist moved into the pick area and no koli
    // holds yet.
    let mut statement = connection
        .prepare(&format!(
            "SELECT s.allotment_id, s.destination_id, u.sku_code, COUNT(*),
                    COALESCE((SELECT c.article_code FROM catalog_item c
                               WHERE c.sku_code = u.sku_code), substr(u.sku_code, 1, 8)),
                    (SELECT c.name FROM catalog_item c WHERE c.sku_code = u.sku_code),
                    (SELECT c.image_url FROM catalog_item c WHERE c.sku_code = u.sku_code)
               {WAITING_PICK_UNITS}
                AND s.allotment_id IN (SELECT allotment_id FROM dc_allotment_work
                                        WHERE allotment_type = 'RETURN_TO_DC')
              GROUP BY s.allotment_id, s.destination_id, u.sku_code
              ORDER BY u.sku_code"
        ))
        .map_err(db)?;
    let picked = statement
        .query_map(params![outbound::picking_place(site_id)], |row| {
            Ok(ReturnPiece {
                allotment_id: row.get(0)?,
                destination_id: row.get(1)?,
                source_pool_id: String::new(),
                sku_code: row.get(2)?,
                quantity: row.get(3)?,
                article_code: row.get(4)?,
                name: row.get(5)?,
                image_url: row.get(6)?,
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    // Packed: sealed koli holding a return's pieces, on no trip yet.
    let koli_ids: Vec<String> = connection
        .prepare(
            "SELECT k.koli_id FROM koli k
              WHERE k.sealed_at IS NOT NULL AND k.shipment_id IS NULL
                AND EXISTS (SELECT 1 FROM koli_unit u
                              JOIN dc_allotment_work w ON w.allotment_id = u.allotment_id
                             WHERE u.koli_id = k.koli_id AND u.released_at IS NULL
                               AND u.current_stage = 'PACKED'
                               AND w.allotment_type = 'RETURN_TO_DC')
              ORDER BY k.sealed_at, k.koli_number",
        )
        .map_err(db)?
        .query_map([], |row| row.get(0))
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let mut packed = Vec::with_capacity(koli_ids.len());
    for koli_id in koli_ids {
        let koli = outbound::load_koli(connection, &koli_id)?;
        let lines = koli_lines(connection, &koli_id)?;
        packed.push(ReturnKoli { koli, lines });
    }

    // Trips: every run that carried a return, newest first.
    let trip_ids: Vec<String> = connection
        .prepare(
            "SELECT DISTINCT s.dispatch_id
               FROM shipment s
               JOIN koli k ON k.shipment_id = s.shipment_id
               JOIN koli_unit u ON u.koli_id = k.koli_id
               JOIN dc_allotment_work w ON w.allotment_id = u.allotment_id
              WHERE s.dispatch_id IS NOT NULL AND w.allotment_type = 'RETURN_TO_DC'",
        )
        .map_err(db)?
        .query_map([], |row| row.get(0))
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let mut trips = Vec::with_capacity(trip_ids.len());
    for dispatch_id in trip_ids {
        trips.push(outbound::load_dispatch(connection, &dispatch_id)?);
    }
    trips.sort_by(|left, right| right.dispatch_number.cmp(&left.dispatch_number));
    trips.truncate(100);

    Ok(ReturnBoard {
        to_pick,
        picked,
        packed,
        trips,
    })
}

/// What a koli still holds, SKU by SKU.
fn koli_lines(connection: &Connection, koli_id: &str) -> Result<Vec<ReturnPiece>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT u.sku_code, COUNT(*), k.destination_store_id,
                    COALESCE(c.article_code, substr(u.sku_code, 1, 8)), c.name, c.image_url
               FROM koli_unit u
               JOIN koli k ON k.koli_id = u.koli_id
               LEFT JOIN catalog_item c ON c.sku_code = u.sku_code
              WHERE u.koli_id = ?1 AND u.released_at IS NULL AND u.current_stage = 'PACKED'
              GROUP BY u.sku_code
              ORDER BY u.sku_code",
        )
        .map_err(db)?;
    let lines = statement
        .query_map(params![koli_id], |row| {
            Ok(ReturnPiece {
                sku_code: row.get(0)?,
                quantity: row.get(1)?,
                destination_id: row.get(2)?,
                article_code: row.get(3)?,
                name: row.get(4)?,
                image_url: row.get(5)?,
                allotment_id: String::new(),
                source_pool_id: String::new(),
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    Ok(lines)
}

fn chosen(article_codes: &[String]) -> Result<BTreeSet<String>, EdgeError> {
    let chosen: BTreeSet<String> = article_codes
        .iter()
        .map(|code| code.trim().to_owned())
        .filter(|code| !code.is_empty())
        .collect();
    if chosen.is_empty() {
        return Err(EdgeError::Validation("choose at least one article".into()));
    }
    Ok(chosen)
}

fn key_of(key: &str) -> Result<String, EdgeError> {
    let key = key.trim().to_owned();
    if key.is_empty() {
        return Err(EdgeError::Validation("idempotency_key is required".into()));
    }
    Ok(key)
}

/// `make`'s answer the first time `key` is pressed, and that same answer on
/// every retry — so a retry runs the steps the first press planned, not
/// what the board shows now.
pub(crate) fn kept<T: Serialize + DeserializeOwned>(
    inventory: &dyn EdgeInventory,
    key: &str,
    operation: &str,
    request: &impl Serialize,
    make: impl Fn() -> Result<T, EdgeError>,
) -> Result<T, EdgeError> {
    let persistence = |error: serde_json::Error| EdgeError::Persistence(error.to_string());
    let request_json = serde_json::to_string(request).map_err(persistence)?;
    let value = inventory.store_return_kept(key, operation, &request_json, &|| {
        serde_json::to_value(make()?).map_err(persistence)
    })?;
    serde_json::from_value(value).map_err(persistence)
}

/// One picklist a Pick press raises: a request's lines off one shelf.
#[derive(Debug, Deserialize, Serialize)]
struct PickRound {
    allotment_id: String,
    destination_id: String,
    source_pool_id: String,
    lines: Vec<PickLine>,
}

/// What an Unpack press moves back: the koli's shop and what it held.
#[derive(Debug, Deserialize, Serialize)]
struct UnpackPlan {
    destination_id: String,
    lines: Vec<MoveBackLine>,
}

/// **Pick**: every piece still to pick of the chosen articles, whole — one
/// picklist per request × shelf, the way the Gudang raises one per allotment
/// × shop. What the shelf could not answer is said, not swallowed.
pub fn pick_articles(
    inventory: &dyn EdgeInventory,
    request: ReturnArticlesRequest,
    actor_id: &str,
) -> Result<ReturnPicked, EdgeError> {
    let key = key_of(&request.idempotency_key)?;
    let chosen = chosen(&request.article_codes)?;
    // The answer is kept too: a picklist answering a retry has forgotten
    // what the shelf refused the first time.
    kept(
        inventory,
        &format!("{key}:result"),
        "STORE_RETURN_PICK",
        &chosen,
        || {
            let rounds = kept(
                inventory,
                &format!("{key}:plan"),
                "STORE_RETURN_PICK_PLAN",
                &chosen,
                || pick_rounds(inventory, &chosen),
            )?;
            let mut picked = 0;
            let mut refused = Vec::new();
            for round in rounds {
                let result = inventory.create_picklist(CreatePicklistRequest {
                    idempotency_key: format!(
                        "{key}:pick:{}:{}:{}",
                        round.allotment_id, round.destination_id, round.source_pool_id
                    ),
                    source_pool_id: round.source_pool_id,
                    lines: round.lines,
                    actor_id: actor_id.to_owned(),
                    note: Some("Return to HO".into()),
                    destination_id: Some(round.destination_id),
                    allotment_id: Some(round.allotment_id),
                })?;
                picked += result.summary.total_picked;
                refused.extend(
                    result.refused.into_iter().map(|line| {
                        format!("{} · {}: {}", line.sku_code, line.quantity, line.reason)
                    }),
                );
            }
            Ok(ReturnPicked { picked, refused })
        },
    )
}

/// The picklists a Pick press raises, off the board as it is now.
fn pick_rounds(
    inventory: &dyn EdgeInventory,
    chosen: &BTreeSet<String>,
) -> Result<Vec<PickRound>, EdgeError> {
    let board = inventory.store_return_board()?;
    // (request, shop, shelf) → its lines, so each picklist is one walk.
    let mut rounds: BTreeMap<(String, String, String), Vec<PickLine>> = BTreeMap::new();
    for piece in board.to_pick {
        if !chosen.contains(&piece.article_code) {
            continue;
        }
        let lines = rounds
            .entry((
                piece.allotment_id,
                piece.destination_id,
                piece.source_pool_id,
            ))
            .or_default();
        match lines
            .iter_mut()
            .find(|line| line.sku_code == piece.sku_code)
        {
            Some(line) => line.quantity += piece.quantity,
            None => lines.push(PickLine {
                sku_code: piece.sku_code,
                quantity: piece.quantity,
            }),
        }
    }
    if rounds.is_empty() {
        return Err(EdgeError::Conflict(
            "nothing of these articles is left to pick".into(),
        ));
    }
    Ok(rounds
        .into_iter()
        .map(
            |((allotment_id, destination_id, source_pool_id), lines)| PickRound {
                allotment_id,
                destination_id,
                source_pool_id,
                lines,
            },
        )
        .collect())
}

/// **Unpick**: an article's picked pieces go back to the shelf they came off,
/// and the article is on the Picklist again.
pub fn unpick_article(
    inventory: &dyn EdgeInventory,
    request: ReturnArticlesRequest,
    actor_id: &str,
) -> Result<outbound::MoveBackResult, EdgeError> {
    let key = key_of(&request.idempotency_key)?;
    let chosen = chosen(&request.article_codes)?;
    let by_shop = kept(
        inventory,
        &format!("{key}:plan"),
        "STORE_RETURN_UNPICK_PLAN",
        &chosen,
        || {
            let board = inventory.store_return_board()?;
            let mut by_shop: BTreeMap<String, BTreeMap<String, i64>> = BTreeMap::new();
            for piece in board.picked {
                if chosen.contains(&piece.article_code) {
                    *by_shop
                        .entry(piece.destination_id)
                        .or_default()
                        .entry(piece.sku_code)
                        .or_insert(0) += piece.quantity;
                }
            }
            if by_shop.is_empty() {
                return Err(EdgeError::Conflict(
                    "nothing of this article is picked".into(),
                ));
            }
            Ok(by_shop)
        },
    )?;
    let mut last = None;
    for (destination_id, lines) in by_shop {
        last = Some(
            inventory.move_back(MoveBackRequest {
                idempotency_key: format!("{key}:unpick:{destination_id}"),
                destination_id,
                allotment_id: None,
                from: MoveBackFrom::Picked,
                to: MoveBackTo::Pick,
                koli_id: None,
                lines: lines
                    .into_iter()
                    .map(|(sku_code, quantity)| MoveBackLine { sku_code, quantity })
                    .collect(),
                reason: Some("Return to HO · Unpick".into()),
                actor_id: actor_id.to_owned(),
            })?,
        );
    }
    last.ok_or_else(|| EdgeError::Conflict("nothing of this article is picked".into()))
}

/// **Pack**: the chosen articles' picked pieces into one koli, sealed — only
/// a sealed koli is made, as at the Gudang.
pub fn pack_articles(
    inventory: &dyn EdgeInventory,
    request: ReturnArticlesRequest,
    actor_id: &str,
) -> Result<ReturnPacked, EdgeError> {
    let key = key_of(&request.idempotency_key)?;
    let chosen = chosen(&request.article_codes)?;
    let by_shop = kept(
        inventory,
        &format!("{key}:plan"),
        "STORE_RETURN_PACK_PLAN",
        &chosen,
        || {
            let board = inventory.store_return_board()?;
            let mut by_shop: BTreeMap<String, BTreeMap<String, i64>> = BTreeMap::new();
            for piece in board.picked {
                if chosen.contains(&piece.article_code) {
                    *by_shop
                        .entry(piece.destination_id)
                        .or_default()
                        .entry(piece.sku_code)
                        .or_insert(0) += piece.quantity;
                }
            }
            if by_shop.is_empty() {
                return Err(EdgeError::Conflict(
                    "nothing of these articles is picked".into(),
                ));
            }
            Ok(by_shop)
        },
    )?;
    let mut koli = Vec::with_capacity(by_shop.len());
    for (destination_id, lines) in by_shop {
        koli.push(
            inventory.pack_by_quantity(PackRequest {
                idempotency_key: format!("{key}:pack:{destination_id}"),
                destination_store_id: destination_id,
                lines: lines
                    .into_iter()
                    .map(|(sku_code, quantity)| PackLine { sku_code, quantity })
                    .collect(),
                actor_id: actor_id.to_owned(),
                seal: true,
                pick_session_ids: Vec::new(),
            })?,
        );
    }
    Ok(ReturnPacked { koli })
}

/// **Unpack**: a sealed koli not yet on a trip is opened, and what it held is
/// back in Picked.
pub fn unpack_koli(
    inventory: &dyn EdgeInventory,
    request: ReturnUnpackRequest,
    actor_id: &str,
) -> Result<outbound::MoveBackResult, EdgeError> {
    let key = key_of(&request.idempotency_key)?;
    let koli_id = request.koli_id.trim().to_owned();
    let plan = kept(
        inventory,
        &format!("{key}:plan"),
        "STORE_RETURN_UNPACK_PLAN",
        &koli_id,
        || {
            let board = inventory.store_return_board()?;
            let koli = board
                .packed
                .into_iter()
                .find(|koli| koli.koli.koli_id == koli_id)
                .ok_or_else(|| {
                    EdgeError::Conflict(format!("koli {koli_id} is not waiting to go"))
                })?;
            Ok(UnpackPlan {
                destination_id: koli.koli.destination_store_id,
                lines: koli
                    .lines
                    .into_iter()
                    .map(|line| MoveBackLine {
                        sku_code: line.sku_code,
                        quantity: line.quantity,
                    })
                    .collect(),
            })
        },
    )?;
    inventory.move_back(MoveBackRequest {
        idempotency_key: format!("{key}:unpack"),
        destination_id: plan.destination_id,
        allotment_id: None,
        from: MoveBackFrom::Packed,
        to: MoveBackTo::Picked,
        koli_id: Some(koli_id),
        lines: plan.lines,
        reason: Some("Return to HO · Unpack".into()),
        actor_id: actor_id.to_owned(),
    })
}

/// **Dispatch**: the ticked koli onto one trip to HO, with what the shop
/// knows about who carries it.
pub fn dispatch_koli(
    inventory: &dyn EdgeInventory,
    request: ReturnDispatchRequest,
    actor_id: &str,
) -> Result<ReturnDispatched, EdgeError> {
    let key = key_of(&request.idempotency_key)?;
    let koli_ids: Vec<String> = request
        .koli_ids
        .iter()
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
        .collect();
    if koli_ids.is_empty() {
        return Err(EdgeError::Validation("choose at least one koli".into()));
    }
    let trip = inventory.dispatch_trip(DispatchTripRequest {
        koli_ids,
        trip_note: Some(match request.trip_note.as_deref().map(str::trim) {
            Some(note) if !note.is_empty() => format!("Return to HO · {note}"),
            _ => "Return to HO".to_owned(),
        }),
        actor_id: actor_id.to_owned(),
        idempotency_key: format!("{key}:trip"),
    })?;
    Ok(ReturnDispatched {
        quantity: trip.dispatch.unit_count,
        dispatch_number: trip.dispatch.dispatch_number,
    })
}
