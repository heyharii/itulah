//! **At the store** — MD's review of a trip whose stores counted something
//! else than was sent (allotment-review-flow.html, owner 17–18 Oct 2026).
//!
//! A store counts a delivery blind. A count that matches its surat jalan is
//! booked into its stock at once and its allotment lines complete; one that
//! differs books nothing until MD answers (owner, 18 Oct 2026). A trip is
//! in the review once any of its stores has counted and what it counted
//! differs from what its koli held, until MD answers (`allotment_store_review`,
//! 0977).
//!
//! # What the review says
//!
//! Per SKU and store of the trip, **sent** is what the trip's koli held for
//! the store (`dc_koli_unit`), **counted** what the store counted
//! (`edge_goods_step.payload.counted`, store node 0080; a receipt from a
//! sweep or an older node counted what it booked). Differences are worked out
//! across the stores of ONE trip, SKU by SKU:
//!
//! - a store short of a SKU another store of the trip has too many of: the
//!   pieces went to the **wrong store** (paired, `pairs`);
//! - short with no store to pair with: **not received**;
//! - too many with no store to pair with, or a SKU the trip did not carry:
//!   **extra**.
//!
//! A store of the trip that has not counted yet is `waiting_for`: MD cannot
//! answer until every store has, because its count may be where a missing
//! piece is.
//!
//! The cloud-run Gudang's trips only: a DC server keeps its koli and truck
//! runs in its own SQLite.

use crate::cloud::application::AppError;
use crate::sync::flow::InboundReceivedPayload;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

/// How far back a trip can still be in review, by when it left.
const REVIEW_WINDOW_DAYS: i64 = 60;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewList {
    /// Newest trip first.
    pub reviews: Vec<StoreReview>,
}

/// One trip in MD's review.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReview {
    pub dispatch_id: Uuid,
    pub dispatch_number: String,
    pub departed_at: Option<DateTime<Utc>>,
    /// The allotments whose pieces the trip carried.
    pub allotments: Vec<StoreReviewAllotment>,
    /// Every store of the trip, by id.
    pub stores: Vec<StoreReviewStore>,
    /// Every SKU of the trip, and every SKU a store of it counted.
    pub skus: Vec<StoreReviewSku>,
    pub wrong_store: Vec<StoreReviewPair>,
    pub not_received: Vec<StoreReviewPieces>,
    pub extra: Vec<StoreReviewPieces>,
    /// Stores of the trip that have not counted yet.
    pub waiting_for: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewAllotment {
    pub allotment_id: Uuid,
    pub allotment_number: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewStore {
    pub store_id: String,
    pub store_name: Option<String>,
    /// Its surat jalan on this trip.
    pub shipment_number: String,
    pub sent: i64,
    /// `None` until the store has counted.
    pub counted: Option<i64>,
    pub counted_by: Option<String>,
    pub counted_at: Option<DateTime<Utc>>,
    /// Its count differs from what was sent: MD answers it.
    pub in_review: bool,
    /// The stores still to count that this store's answer waits for (owner,
    /// 20 Oct 2026): a short waits for every store still to count, an extra
    /// only for those sent the same SKU.
    pub waiting_for: Vec<String>,
    /// MD's answer for this store, once given.
    pub decision: Option<String>,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewSku {
    pub sku_code: String,
    /// `None` for a code the catalogue does not know.
    pub article_id: Option<Uuid>,
    pub article_code: Option<String>,
    pub article_name: Option<String>,
    pub image_url: Option<String>,
    pub colour: Option<String>,
    pub size: Option<String>,
    /// One cell per store of the trip, in the stores' order.
    pub stores: Vec<StoreReviewCell>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewCell {
    pub store_id: String,
    pub sent: i64,
    /// `None` until the store has counted.
    pub counted: Option<i64>,
    /// What the count could book into the store's stock: at most what was
    /// sent. The rest of `counted` is on hold.
    pub booked: Option<i64>,
}

/// Pieces of a SKU meant for one store that arrived at another of the trip.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewPair {
    pub sku_code: String,
    pub pieces: i64,
    pub meant_for: String,
    pub arrived_at: String,
}

/// Pieces of a SKU at one store: not received, or extra.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewPieces {
    pub sku_code: String,
    pub store_id: String,
    pub pieces: i64,
}

/// What one store's receipt says: who, when, and per SKU what it counted and
/// what it booked.
struct Receipt {
    by: String,
    at: DateTime<Utc>,
    counted: BTreeMap<String, i64>,
    booked: BTreeMap<String, i64>,
}

/// The differences of one trip, SKU by SKU: `counted` holds only the stores
/// that have counted.
fn differences(
    sent: &BTreeMap<(String, String), i64>,
    counted: &BTreeMap<(String, String), i64>,
    counted_stores: &BTreeSet<String>,
) -> (
    Vec<StoreReviewPair>,
    Vec<StoreReviewPieces>,
    Vec<StoreReviewPieces>,
) {
    let skus: BTreeSet<&String> = sent
        .keys()
        .chain(counted.keys())
        .map(|(sku, _)| sku)
        .collect();
    let (mut pairs, mut short, mut extra) = (Vec::new(), Vec::new(), Vec::new());
    for sku in skus {
        // Only a store that has counted can be short or over.
        let mut minus: Vec<(String, i64)> = Vec::new();
        let mut plus: Vec<(String, i64)> = Vec::new();
        for store in counted_stores {
            let key = (sku.clone(), store.clone());
            let d = counted.get(&key).copied().unwrap_or(0) - sent.get(&key).copied().unwrap_or(0);
            if d < 0 {
                minus.push((store.clone(), -d));
            } else if d > 0 {
                plus.push((store.clone(), d));
            }
        }
        for (from, owed) in minus.iter_mut() {
            for (to, over) in plus.iter_mut() {
                let n = (*owed).min(*over);
                if n > 0 {
                    pairs.push(StoreReviewPair {
                        sku_code: sku.clone(),
                        pieces: n,
                        meant_for: from.clone(),
                        arrived_at: to.clone(),
                    });
                    *owed -= n;
                    *over -= n;
                }
            }
        }
        for (store, n) in minus.into_iter().filter(|(_, n)| *n > 0) {
            short.push(StoreReviewPieces {
                sku_code: sku.clone(),
                store_id: store,
                pieces: n,
            });
        }
        for (store, n) in plus.into_iter().filter(|(_, n)| *n > 0) {
            extra.push(StoreReviewPieces {
                sku_code: sku.clone(),
                store_id: store,
                pieces: n,
            });
        }
    }
    (pairs, short, extra)
}

/// Every trip of the last [`REVIEW_WINDOW_DAYS`] whose stores counted
/// something else than was sent and that MD has not answered, newest first.
pub async fn list_store_reviews(
    pool: &PgPool,
    now: DateTime<Utc>,
) -> Result<StoreReviewList, AppError> {
    let since = now - Duration::days(REVIEW_WINDOW_DAYS);
    // The trips a store of which has counted, not yet answered.
    let shipments = sqlx::query(
        "SELECT d.dispatch_id, d.dispatch_number, d.departed_at,
                s.shipment_id, s.shipment_number, s.destination_store_id,
                site.name AS store_name
           FROM dc_dispatch d
           JOIN dc_shipment s ON s.dispatch_id = d.dispatch_id
           LEFT JOIN site ON site.id = s.destination_store_id
          WHERE d.departed_at >= $1
            AND NOT EXISTS (SELECT 1 FROM allotment_store_review r
                             WHERE r.dispatch_id = d.dispatch_id)
            AND EXISTS (SELECT 1
                          FROM dc_shipment counted
                          JOIN edge_goods_step step
                            ON step.kind = 'RECEIVED'
                           AND step.shipment_reference = counted.shipment_number
                         WHERE counted.dispatch_id = d.dispatch_id)
          ORDER BY d.departed_at DESC, d.dispatch_number, s.destination_store_id",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;
    if shipments.is_empty() {
        return Ok(StoreReviewList {
            reviews: Vec::new(),
        });
    }
    let shipment_ids: Vec<Uuid> = shipments
        .iter()
        .map(|row| row.try_get("shipment_id"))
        .collect::<Result<_, _>>()?;
    let shipment_numbers: Vec<String> = shipments
        .iter()
        .map(|row| row.try_get("shipment_number"))
        .collect::<Result<_, _>>()?;
    let dispatch_ids: Vec<Uuid> = shipments
        .iter()
        .map(|row| row.try_get("dispatch_id"))
        .collect::<Result<_, _>>()?;
    // MD's answers store by store (0983).
    let mut answers: BTreeMap<(Uuid, String), (String, String, DateTime<Utc>)> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT dispatch_id, store_id, decision, decided_by, decided_at
           FROM allotment_store_review_store WHERE dispatch_id = ANY($1)",
    )
    .bind(&dispatch_ids)
    .fetch_all(pool)
    .await?
    {
        answers.insert(
            (row.try_get("dispatch_id")?, row.try_get("store_id")?),
            (
                row.try_get("decision")?,
                row.try_get("decided_by")?,
                row.try_get("decided_at")?,
            ),
        );
    }

    // What the koli of each surat jalan held, per SKU, and for which
    // allotments.
    let units = sqlx::query(
        "SELECT k.shipment_id, u.sku_code, u.allotment_id, a.allotment_number,
                COUNT(*)::bigint AS pieces
           FROM dc_koli_unit u
           JOIN dc_koli k ON k.koli_id = u.koli_id
           JOIN allotment a ON a.id = u.allotment_id
          WHERE k.shipment_id = ANY($1)
          GROUP BY k.shipment_id, u.sku_code, u.allotment_id, a.allotment_number",
    )
    .bind(&shipment_ids)
    .fetch_all(pool)
    .await?;

    // Each surat jalan's receipt: the newest, should a store have sent two.
    let steps = sqlx::query(
        "SELECT DISTINCT ON (shipment_reference)
                shipment_reference, actor_id, occurred_at, payload
           FROM edge_goods_step
          WHERE kind = 'RECEIVED' AND shipment_reference = ANY($1)
          ORDER BY shipment_reference, occurred_at DESC",
    )
    .bind(&shipment_numbers)
    .fetch_all(pool)
    .await?;
    let mut receipts: BTreeMap<String, Receipt> = BTreeMap::new();
    for row in &steps {
        let number: String = row.try_get("shipment_reference")?;
        let payload: serde_json::Value = row.try_get("payload")?;
        // A payload the centre cannot read is a receipt with nothing known
        // of it; the trip still shows the store as counted.
        let parsed: Option<InboundReceivedPayload> = serde_json::from_value(payload).ok();
        let mut booked: BTreeMap<String, i64> = BTreeMap::new();
        let mut counted: BTreeMap<String, i64> = BTreeMap::new();
        if let Some(receipt) = parsed {
            for line in &receipt.lines {
                *booked
                    .entry(line.sku_code.trim().to_ascii_uppercase())
                    .or_default() += line.received;
            }
            for line in &receipt.counted {
                *counted
                    .entry(line.sku_code.trim().to_ascii_uppercase())
                    .or_default() += line.quantity;
            }
            // A sweep, or a node older than the count: what it booked is all
            // it is known to have counted.
            if receipt.counted.is_empty() {
                counted = booked.clone();
            }
        }
        receipts.insert(
            number,
            Receipt {
                by: row.try_get("actor_id")?,
                at: row.try_get("occurred_at")?,
                counted,
                booked,
            },
        );
    }

    // The trips, in the order read.
    struct Trip {
        dispatch_id: Uuid,
        dispatch_number: String,
        departed_at: Option<DateTime<Utc>>,
        /// (store, shipment id, shipment number, name)
        stores: Vec<(String, Uuid, String, Option<String>)>,
    }
    let mut trips: Vec<Trip> = Vec::new();
    for row in &shipments {
        let dispatch_id: Uuid = row.try_get("dispatch_id")?;
        if trips.last().map(|trip| trip.dispatch_id) != Some(dispatch_id) {
            trips.push(Trip {
                dispatch_id,
                dispatch_number: row.try_get("dispatch_number")?,
                departed_at: row.try_get("departed_at")?,
                stores: Vec::new(),
            });
        }
        if let Some(trip) = trips.last_mut() {
            trip.stores.push((
                row.try_get("destination_store_id")?,
                row.try_get("shipment_id")?,
                row.try_get("shipment_number")?,
                row.try_get("store_name")?,
            ));
        }
    }

    let mut every_sku: BTreeSet<String> = BTreeSet::new();
    let mut reviews: Vec<(
        StoreReview,
        BTreeMap<(String, String), (i64, Option<i64>, Option<i64>)>,
    )> = Vec::new();
    for trip in trips {
        let mut sent: BTreeMap<(String, String), i64> = BTreeMap::new();
        let mut counted: BTreeMap<(String, String), i64> = BTreeMap::new();
        let mut booked: BTreeMap<(String, String), i64> = BTreeMap::new();
        let mut allotments: BTreeMap<Uuid, String> = BTreeMap::new();
        let mut counted_stores: BTreeSet<String> = BTreeSet::new();
        let mut stores = Vec::with_capacity(trip.stores.len());
        for (store, shipment_id, number, name) in &trip.stores {
            let mut store_sent = 0;
            for row in units
                .iter()
                .filter(|row| row.try_get::<Uuid, _>("shipment_id").ok() == Some(*shipment_id))
            {
                let sku: String = row.try_get::<String, _>("sku_code")?.to_ascii_uppercase();
                let pieces: i64 = row.try_get("pieces")?;
                *sent.entry((sku, store.clone())).or_default() += pieces;
                store_sent += pieces;
                allotments.insert(
                    row.try_get("allotment_id")?,
                    row.try_get("allotment_number")?,
                );
            }
            let receipt = receipts.get(number);
            if let Some(receipt) = receipt {
                counted_stores.insert(store.clone());
                for (sku, n) in &receipt.counted {
                    *counted.entry((sku.clone(), store.clone())).or_default() += n;
                }
                for (sku, n) in &receipt.booked {
                    *booked.entry((sku.clone(), store.clone())).or_default() += n;
                }
            }
            let answer = answers.get(&(trip.dispatch_id, store.clone()));
            stores.push(StoreReviewStore {
                store_id: store.clone(),
                store_name: name.clone(),
                shipment_number: number.clone(),
                sent: store_sent,
                counted: receipt.map(|one| one.counted.values().sum()),
                counted_by: receipt.map(|one| one.by.clone()),
                counted_at: receipt.map(|one| one.at),
                in_review: false,
                waiting_for: Vec::new(),
                decision: answer.map(|one| one.0.clone()),
                decided_by: answer.map(|one| one.1.clone()),
                decided_at: answer.map(|one| one.2),
            });
        }
        let (wrong_store, not_received, extra) = differences(&sent, &counted, &counted_stores);
        if wrong_store.is_empty() && not_received.is_empty() && extra.is_empty() {
            continue;
        }
        // Store by store: whether its count differs, and whom its answer
        // waits for.
        let not_counted: Vec<String> = stores
            .iter()
            .filter(|store| store.counted.is_none())
            .map(|store| store.store_id.clone())
            .collect();
        for store in stores.iter_mut() {
            if store.counted.is_none() {
                continue;
            }
            let skus: BTreeSet<&String> = sent
                .keys()
                .chain(counted.keys())
                .filter(|(_, at)| *at == store.store_id)
                .map(|(sku, _)| sku)
                .collect();
            let mut waits: BTreeSet<String> = BTreeSet::new();
            for sku in skus {
                let key = (sku.clone(), store.store_id.clone());
                let d = counted.get(&key).copied().unwrap_or(0)
                    - sent.get(&key).copied().unwrap_or(0);
                if d == 0 {
                    continue;
                }
                store.in_review = true;
                for other in &not_counted {
                    // A short piece may be in any count still to come; an
                    // extra is another's only if that store was sent the SKU.
                    if d < 0 || sent.get(&(sku.clone(), other.clone())).copied().unwrap_or(0) > 0 {
                        waits.insert(other.clone());
                    }
                }
            }
            store.waiting_for = waits.into_iter().collect();
        }
        // Answered store by store, every store counted: the trip is done.
        if not_counted.is_empty()
            && stores
                .iter()
                .all(|store| !store.in_review || store.decision.is_some())
        {
            continue;
        }
        let mut cells: BTreeMap<(String, String), (i64, Option<i64>, Option<i64>)> =
            BTreeMap::new();
        for store in &stores {
            let did_count = counted_stores.contains(&store.store_id);
            for (sku, _) in sent.keys().chain(counted.keys()) {
                let key = (sku.clone(), store.store_id.clone());
                cells.insert(
                    key.clone(),
                    (
                        sent.get(&key).copied().unwrap_or(0),
                        did_count.then(|| counted.get(&key).copied().unwrap_or(0)),
                        did_count.then(|| booked.get(&key).copied().unwrap_or(0)),
                    ),
                );
                every_sku.insert(sku.clone());
            }
        }
        let waiting_for = stores
            .iter()
            .filter(|store| store.counted.is_none())
            .map(|store| store.store_id.clone())
            .collect();
        reviews.push((
            StoreReview {
                dispatch_id: trip.dispatch_id,
                dispatch_number: trip.dispatch_number,
                departed_at: trip.departed_at,
                allotments: allotments
                    .into_iter()
                    .map(|(allotment_id, allotment_number)| StoreReviewAllotment {
                        allotment_id,
                        allotment_number,
                    })
                    .collect(),
                stores,
                skus: Vec::new(),
                wrong_store,
                not_received,
                extra,
                waiting_for,
            },
            cells,
        ));
    }

    // What the catalogue says of every SKU in any review, read once.
    let codes: Vec<String> = every_sku.into_iter().collect();
    let catalogue = sqlx::query(
        "SELECT upper(sk.sku_code) AS sku_code, ar.id AS article_id, ar.article_code,
                ar.name AS article_name, ar.image_url, sk.color AS colour, sk.size
           FROM sku sk
           JOIN article ar ON ar.id = sk.article_id
          WHERE upper(sk.sku_code) = ANY($1)",
    )
    .bind(&codes)
    .fetch_all(pool)
    .await?;
    let mut known: BTreeMap<String, &sqlx::postgres::PgRow> = BTreeMap::new();
    for row in &catalogue {
        known.insert(row.try_get("sku_code")?, row);
    }

    let mut out = Vec::with_capacity(reviews.len());
    for (mut review, cells) in reviews {
        let skus: BTreeSet<&String> = cells.keys().map(|(sku, _)| sku).collect();
        for sku in skus {
            let row = known.get(sku);
            review.skus.push(StoreReviewSku {
                sku_code: sku.clone(),
                article_id: row.map(|row| row.try_get("article_id")).transpose()?,
                article_code: row.map(|row| row.try_get("article_code")).transpose()?,
                article_name: row.map(|row| row.try_get("article_name")).transpose()?,
                image_url: row
                    .map(|row| row.try_get::<Option<String>, _>("image_url"))
                    .transpose()?
                    .flatten(),
                colour: row
                    .map(|row| row.try_get::<Option<String>, _>("colour"))
                    .transpose()?
                    .flatten(),
                size: row
                    .map(|row| row.try_get::<Option<String>, _>("size"))
                    .transpose()?
                    .flatten(),
                stores: review
                    .stores
                    .iter()
                    .map(|store| {
                        let (sent, counted, booked) = cells
                            .get(&(sku.clone(), store.store_id.clone()))
                            .copied()
                            .unwrap_or((0, None, None));
                        StoreReviewCell {
                            store_id: store.store_id.clone(),
                            sent,
                            counted,
                            booked,
                        }
                    })
                    .collect(),
            });
        }
        out.push(review);
    }
    Ok(StoreReviewList { reviews: out })
}

// ---------------------------------------------------------------------------
// MD's answer (owner, 17–18 Oct 2026)
// ---------------------------------------------------------------------------

/// MD answers a trip's review.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DecideStoreReviewRequest {
    /// `AS_DELIVERED` or `RETURN_REALLOT`.
    pub decision: String,
    pub idempotency_key: String,
    /// One store of the trip (owner, 20 Oct 2026); none answers the trip
    /// whole, as before.
    #[serde(default)]
    pub store_id: Option<String>,
}

/// Pieces of a SKU at one store, in what an answer does.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewMove {
    pub store_id: String,
    pub sku_code: String,
    pub pieces: i64,
}

/// One line of the new allotment Return & reallot makes: what HO sends
/// again, and what the DC could not.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewReallot {
    pub store_id: String,
    pub sku_code: String,
    /// Asked for again: the pieces the store did not get.
    pub pieces: i64,
    /// What the DC holds free of the SKU, before this line.
    pub dc_has: i64,
    /// Sent again: the smaller of the two. The rest is closed short.
    pub sent: i64,
}

/// What an answer does, worked out before it is done — the dialog shows it —
/// and kept with the answer.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewPlan {
    /// Accept as delivered: another store's pieces booked where they arrived.
    pub keep: Vec<StoreReviewMove>,
    /// Back to HO, from where each piece is.
    pub send_back: Vec<StoreReviewMove>,
    /// Not received, and no store has them: Missing at Inventory.
    pub missing: Vec<StoreReviewMove>,
    /// Return & reallot: what HO sends again on a new allotment.
    pub reallot: Vec<StoreReviewReallot>,
    /// Filled in once the answer is given.
    pub reallot_allotment_id: Option<Uuid>,
    pub reallot_allotment_number: Option<String>,
    /// Stores whose node could not be told (an older build): their hold is
    /// answered at head office, the shop sees it on its next update.
    #[serde(default)]
    pub not_told: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreReviewDecision {
    pub dispatch_id: Uuid,
    pub dispatch_number: String,
    /// The store answered, or none when the trip was answered whole.
    pub store_id: Option<String>,
    pub decision: String,
    pub decided_by: String,
    pub decided_at: DateTime<Utc>,
    pub plan: StoreReviewPlan,
}

fn decision_of(text: &str) -> Result<&'static str, AppError> {
    match text.trim().to_ascii_uppercase().as_str() {
        "AS_DELIVERED" => Ok("AS_DELIVERED"),
        "RETURN_REALLOT" => Ok("RETURN_REALLOT"),
        other => Err(AppError::Validation(format!(
            "decision must be AS_DELIVERED or RETURN_REALLOT, not {other}"
        ))),
    }
}

/// The trip's review as it stands, or why there is none to answer.
async fn review_of(
    pool: &PgPool,
    dispatch_id: Uuid,
    now: DateTime<Utc>,
) -> Result<StoreReview, AppError> {
    list_store_reviews(pool, now)
        .await?
        .reviews
        .into_iter()
        .find(|review| review.dispatch_id == dispatch_id)
        .ok_or_else(|| {
            AppError::NotFound(format!("trip {dispatch_id} has nothing for MD to review"))
        })
}

/// Where a store's line of a SKU on the trip came from: the allotment line's
/// source, read off a piece the trip carried for it.
async fn source_of(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    dispatch_id: Uuid,
    store_id: &str,
    sku_code: &str,
) -> Result<Option<(String, String, Uuid)>, AppError> {
    let row = sqlx::query(
        "SELECT line.source_site_id, line.source_pool_id, line.sku_id
           FROM dc_koli_unit u
           JOIN dc_koli k ON k.koli_id = u.koli_id
           JOIN dc_shipment s ON s.shipment_id = k.shipment_id
           JOIN allotment_line line ON line.id = u.allotment_line_id
          WHERE s.dispatch_id = $1 AND s.destination_store_id = $2
            AND upper(u.sku_code) = $3
          LIMIT 1",
    )
    .bind(dispatch_id)
    .bind(store_id)
    .bind(sku_code)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok::<_, AppError>((
            row.try_get("source_site_id")?,
            row.try_get("source_pool_id")?,
            row.try_get("sku_id")?,
        ))
    })
    .transpose()
}

/// What the source pool holds free of a SKU: its normal balance less what
/// every allotment still has to pack of it there.
async fn free_of(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    source_pool_id: &str,
    sku_id: Uuid,
) -> Result<i64, AppError> {
    let on_hand = super::allotments::normal_balance_tx(tx, source_pool_id, sku_id).await?;
    let owed: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(c.to_pack_qty), 0)::bigint
           FROM allotment_line_commitment c
          WHERE c.source_pool_id = $1 AND c.sku_id = $2",
    )
    .bind(source_pool_id)
    .bind(sku_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok((on_hand - owed).max(0))
}

/// What an answer would do to a trip's review (Return & reallot reads the
/// DC's free stock), without doing it.
async fn plan_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    review: &StoreReview,
    decision: &str,
    only: Option<&str>,
) -> Result<StoreReviewPlan, AppError> {
    // One store's answer (owner, 20 Oct 2026) does what concerns that store:
    // the pieces that arrived there, what it did not get, what it has extra.
    let mine = |store: &str| only.is_none_or(|one| one == store);
    let mut plan = StoreReviewPlan::default();
    let extras = review.extra.iter().filter(|one| mine(&one.store_id)).map(|one| StoreReviewMove {
        store_id: one.store_id.clone(),
        sku_code: one.sku_code.clone(),
        pieces: one.pieces,
    });
    if decision == "AS_DELIVERED" {
        // The allotment follows the pieces: another store's stay where they
        // arrived; what no store has is Missing; what nobody sent goes back.
        plan.keep = review
            .wrong_store
            .iter()
            .filter(|pair| mine(&pair.arrived_at))
            .map(|pair| StoreReviewMove {
                store_id: pair.arrived_at.clone(),
                sku_code: pair.sku_code.clone(),
                pieces: pair.pieces,
            })
            .collect();
        plan.missing = review
            .not_received
            .iter()
            .filter(|short| mine(&short.store_id))
            .map(|short| StoreReviewMove {
                store_id: short.store_id.clone(),
                sku_code: short.sku_code.clone(),
                pieces: short.pieces,
            })
            .collect();
        plan.send_back = extras.collect();
        return Ok(plan);
    }
    // Return & reallot: what is wrong goes back; what a store did not get HO
    // sends again on a new allotment, only what the DC still holds.
    plan.send_back = review
        .wrong_store
        .iter()
        .filter(|pair| mine(&pair.arrived_at))
        .map(|pair| StoreReviewMove {
            store_id: pair.arrived_at.clone(),
            sku_code: pair.sku_code.clone(),
            pieces: pair.pieces,
        })
        .chain(extras)
        .collect();
    plan.missing = review
        .not_received
        .iter()
        .filter(|short| mine(&short.store_id))
        .map(|short| StoreReviewMove {
            store_id: short.store_id.clone(),
            sku_code: short.sku_code.clone(),
            pieces: short.pieces,
        })
        .collect();
    let asked: Vec<(String, String, i64)> = review
        .wrong_store
        .iter()
        .filter(|pair| mine(&pair.meant_for))
        .map(|pair| (pair.meant_for.clone(), pair.sku_code.clone(), pair.pieces))
        .chain(
            review
                .not_received
                .iter()
                .filter(|short| mine(&short.store_id))
                .map(|short| (short.store_id.clone(), short.sku_code.clone(), short.pieces)),
        )
        .collect();
    // Free stock is spent line by line: two stores asking for the last piece
    // do not both get it.
    let mut spent: BTreeMap<(String, Uuid), i64> = BTreeMap::new();
    for (store_id, sku_code, pieces) in asked {
        let Some((_, source_pool_id, sku_id)) =
            source_of(tx, review.dispatch_id, &store_id, &sku_code).await?
        else {
            plan.reallot.push(StoreReviewReallot {
                store_id,
                sku_code,
                pieces,
                dc_has: 0,
                sent: 0,
            });
            continue;
        };
        let key = (source_pool_id.clone(), sku_id);
        let free =
            free_of(tx, &source_pool_id, sku_id).await? - spent.get(&key).copied().unwrap_or(0);
        let free = free.max(0);
        let sent = pieces.min(free);
        *spent.entry(key).or_default() += sent;
        plan.reallot.push(StoreReviewReallot {
            store_id,
            sku_code,
            pieces,
            dc_has: free,
            sent,
        });
    }
    Ok(plan)
}

/// What an answer would do, for the dialog that asks for it.
pub async fn plan_store_review(
    pool: &PgPool,
    dispatch_id: Uuid,
    decision: &str,
    store_id: Option<&str>,
    now: DateTime<Utc>,
) -> Result<StoreReviewPlan, AppError> {
    let decision = decision_of(decision)?;
    let review = review_of(pool, dispatch_id, now).await?;
    let mut tx = pool.begin().await?;
    let plan = plan_tx(&mut tx, &review, decision, store_id).await?;
    tx.rollback().await?;
    Ok(plan)
}

/// The answer already given for a trip, if any.
async fn answered(
    pool: &PgPool,
    dispatch_id: Uuid,
) -> Result<Option<(String, StoreReviewDecision)>, AppError> {
    let Some(row) = sqlx::query(
        "SELECT r.decision, r.decided_by, r.decided_at, r.idempotency_key, r.result,
                d.dispatch_number
           FROM allotment_store_review r
           JOIN dc_dispatch d ON d.dispatch_id = r.dispatch_id
          WHERE r.dispatch_id = $1",
    )
    .bind(dispatch_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let plan: StoreReviewPlan =
        serde_json::from_value(row.try_get::<serde_json::Value, _>("result")?).unwrap_or_default();
    Ok(Some((
        row.try_get("idempotency_key")?,
        StoreReviewDecision {
            dispatch_id,
            dispatch_number: row.try_get("dispatch_number")?,
            store_id: None,
            decision: row.try_get("decision")?,
            decided_by: row.try_get("decided_by")?,
            decided_at: row.try_get("decided_at")?,
            plan,
        },
    )))
}

/// The answer already given for one store of a trip, if any.
async fn answered_store(
    pool: &PgPool,
    dispatch_id: Uuid,
    store_id: &str,
) -> Result<Option<(String, StoreReviewDecision)>, AppError> {
    let Some(row) = sqlx::query(
        "SELECT r.decision, r.decided_by, r.decided_at, r.idempotency_key, r.result,
                d.dispatch_number
           FROM allotment_store_review_store r
           JOIN dc_dispatch d ON d.dispatch_id = r.dispatch_id
          WHERE r.dispatch_id = $1 AND r.store_id = $2",
    )
    .bind(dispatch_id)
    .bind(store_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let plan: StoreReviewPlan =
        serde_json::from_value(row.try_get::<serde_json::Value, _>("result")?).unwrap_or_default();
    Ok(Some((
        row.try_get("idempotency_key")?,
        StoreReviewDecision {
            dispatch_id,
            dispatch_number: row.try_get("dispatch_number")?,
            store_id: Some(store_id.to_owned()),
            decision: row.try_get("decision")?,
            decided_by: row.try_get("decided_by")?,
            decided_at: row.try_get("decided_at")?,
            plan,
        },
    )))
}

/// MD answers a trip's review, once — whole, or one store at a time (owner,
/// 20 Oct 2026: a store need not wait for the trip once the stores its
/// difference could pair with have counted).
///
/// Every store of the trip must have counted: a missing piece may be in the
/// count still to come. Return & reallot raises the new allotment first —
/// under a key made from the answer's own, so a retry finds the same one.
/// Then, in one transaction: each store whose count differed is told which
/// pieces it books, by EPC, and what goes back
/// (`inventory.store_inbound.on_hold.v1`); a piece accepted as delivered at
/// another store than its own is redirected for the centre's pairing
/// (`edge_transfer_redirect`); what a store did not get is given up on its
/// allotment line — Missing in the Gudang's In Transit pool when no store has
/// it — and the allotment's status follows; the answer is written.
pub async fn decide_store_review(
    pool: &PgPool,
    dispatch_id: Uuid,
    request: DecideStoreReviewRequest,
    actor: &crate::cloud::domain::flow::Actor,
    now: DateTime<Utc>,
) -> Result<StoreReviewDecision, AppError> {
    let decision = decision_of(&request.decision)?;
    let key = request.idempotency_key.trim().to_owned();
    if key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    let decided_by = actor.id.trim().to_owned();
    if decided_by.is_empty() {
        return Err(AppError::Unauthorized(
            "MD's review is answered by somebody signed in".into(),
        ));
    }
    let only: Option<String> = request
        .store_id
        .as_deref()
        .map(str::trim)
        .filter(|one| !one.is_empty())
        .map(str::to_owned);
    if let Some(store) = &only {
        if let Some((their_key, done)) = answered_store(pool, dispatch_id, store).await? {
            if their_key == key {
                return Ok(done);
            }
            return Err(AppError::Conflict(format!(
                "{store} on {} was already answered by {}",
                done.dispatch_number, done.decided_by
            )));
        }
    }
    if let Some((their_key, done)) = answered(pool, dispatch_id).await? {
        if their_key == key && only.is_none() {
            return Ok(done);
        }
        return Err(AppError::Conflict(format!(
            "{} was already answered by {}",
            done.dispatch_number, done.decided_by
        )));
    }
    let review = review_of(pool, dispatch_id, now).await?;
    match &only {
        Some(store) => {
            let Some(one) = review.stores.iter().find(|one| &one.store_id == store) else {
                return Err(AppError::NotFound(format!(
                    "{store} is not a store of {}",
                    review.dispatch_number
                )));
            };
            if !one.in_review {
                return Err(AppError::Conflict(format!(
                    "{store} counted what was sent: there is nothing to answer"
                )));
            }
            if !one.waiting_for.is_empty() {
                return Err(AppError::Conflict(format!(
                    "Waiting for {} to count: a missing piece may be in that count.",
                    one.waiting_for.join(", ")
                )));
            }
        }
        None => {
            if !review.waiting_for.is_empty() {
                return Err(AppError::Conflict(format!(
                    "Waiting for {} to count: a missing piece may be in that count.",
                    review.waiting_for.join(", ")
                )));
            }
            if review.stores.iter().any(|one| one.decision.is_some()) {
                return Err(AppError::Conflict(format!(
                    "{} is being answered store by store",
                    review.dispatch_number
                )));
            }
        }
    }
    // The stores this answer acts for.
    let acts = |store: &str| only.as_deref().is_none_or(|one| one == store);

    let mut tx = pool.begin().await?;
    let mut plan = plan_tx(&mut tx, &review, decision, only.as_deref()).await?;
    tx.rollback().await?;

    // The new allotment, before anything else is written.
    let mut lines = Vec::new();
    {
        let mut tx = pool.begin().await?;
        for line in plan.reallot.iter().filter(|line| line.sent > 0) {
            if let Some((source_site_id, source_pool_id, sku_id)) =
                source_of(&mut tx, dispatch_id, &line.store_id, &line.sku_code).await?
            {
                lines.push(crate::cloud::application::CreateAllotmentLineInput {
                    source_site_id,
                    source_pool_id,
                    destination_type: crate::cloud::domain::DestinationType::Store,
                    destination_id: line.store_id.clone(),
                    sku_id,
                    quantity: line.sent,
                });
            }
        }
        tx.rollback().await?;
    }
    if !lines.is_empty() {
        let numbers: Vec<&str> = review
            .allotments
            .iter()
            .map(|one| one.allotment_number.as_str())
            .collect();
        let created = super::allotments::create_allotment_as(
            pool,
            crate::cloud::application::CreateAllotmentRequest {
                allotment_type: crate::cloud::domain::AllotmentType::ToSite,
                lines,
                notes: Some(format!(
                    "Reallot of {} ({})",
                    numbers.join(", "),
                    review.dispatch_number
                )),
                actor_id: decided_by.clone(),
                idempotency_key: format!("{key}:reallot"),
            },
            Some(actor),
        )
        .await?;
        plan.reallot_allotment_id = created
            .get("id")
            .and_then(|id| id.as_str())
            .and_then(|id| Uuid::parse_str(id).ok());
        plan.reallot_allotment_number = created
            .get("allotment_number")
            .and_then(|number| number.as_str())
            .map(str::to_owned);
    }

    let mut tx = pool.begin().await?;
    // The trip's pieces per store × SKU, in EPC order (byte order, as the
    // stores spell them).
    struct Unit {
        epc: String,
        subject_id: Uuid,
        line: Uuid,
    }
    let mut units: BTreeMap<(String, String), Vec<Unit>> = BTreeMap::new();
    let mut source_dc: Option<String> = None;
    for row in sqlx::query(
        "SELECT s.destination_store_id, s.site_id, upper(u.sku_code) AS sku_code,
                u.epc, u.subject_id, u.allotment_line_id
           FROM dc_koli_unit u
           JOIN dc_koli k ON k.koli_id = u.koli_id
           JOIN dc_shipment s ON s.shipment_id = k.shipment_id
          WHERE s.dispatch_id = $1
          ORDER BY s.destination_store_id, upper(u.sku_code), u.epc COLLATE \"C\"",
    )
    .bind(dispatch_id)
    .fetch_all(&mut *tx)
    .await?
    {
        source_dc.get_or_insert(row.try_get("site_id")?);
        units
            .entry((
                row.try_get("destination_store_id")?,
                row.try_get("sku_code")?,
            ))
            .or_default()
            .push(Unit {
                epc: row.try_get("epc")?,
                subject_id: row.try_get("subject_id")?,
                line: row.try_get("allotment_line_id")?,
            });
    }
    let source_dc = source_dc.unwrap_or_default();
    let cell = |store: &str, sku: &str| -> (i64, i64) {
        review
            .skus
            .iter()
            .find(|one| one.sku_code == sku)
            .and_then(|one| one.stores.iter().find(|cell| cell.store_id == store))
            .map(|cell| (cell.sent, cell.counted.unwrap_or(0)))
            .unwrap_or((0, 0))
    };
    // A store whose count matched booked its delivery when it counted; the
    // others booked nothing and book now what MD's answer gives them.
    let in_review: BTreeSet<String> = review
        .stores
        .iter()
        .filter(|store| {
            review.skus.iter().any(|sku| {
                sku.stores.iter().any(|one| {
                    one.store_id == store.store_id && one.counted != Some(one.sent)
                })
            })
        })
        .map(|store| store.store_id.clone())
        .collect();
    // What each store books: its own pieces first, as many of a SKU as it
    // counted up to what was sent.
    let mut book: BTreeMap<String, Vec<crate::sync::workflow::StoreInboundBook>> =
        BTreeMap::new();
    // What a store did not get of its own, per store × SKU, in order.
    let mut rest: BTreeMap<(String, String), Vec<&Unit>> = BTreeMap::new();
    for ((store, sku), pieces) in &units {
        if !in_review.contains(store) {
            continue;
        }
        let (sent, counted) = cell(store, sku);
        let own = counted.min(sent).max(0) as usize;
        for unit in pieces.iter().take(if acts(store) { own } else { 0 }) {
            book.entry(store.clone())
                .or_default()
                .push(crate::sync::workflow::StoreInboundBook {
                    epc: unit.epc.clone(),
                    sku_code: sku.clone(),
                });
        }
        rest.insert((store.clone(), sku.clone()), pieces.iter().skip(own).collect());
    }
    // Another store's pieces that arrived at this one: accepted as delivered
    // they are booked here and the centre pairs them through MD's answer;
    // on Return & reallot they stay in transit, on their way back to HO.
    let mut not_received: Vec<(Uuid, String, Uuid, bool)> = Vec::new();
    for pair in &review.wrong_store {
        let Some(pieces) = rest.get_mut(&(pair.meant_for.clone(), pair.sku_code.clone())) else {
            continue;
        };
        let n = (pair.pieces.max(0) as usize).min(pieces.len());
        let taken: Vec<&Unit> = pieces.drain(..n).collect();
        // A pair is the answer of the store the pieces arrived at; the store
        // they were meant for only gives them up from its Missing.
        if !acts(&pair.arrived_at) {
            continue;
        }
        let arrived = review
            .stores
            .iter()
            .find(|store| store.store_id == pair.arrived_at);
        let meant = review
            .stores
            .iter()
            .find(|store| store.store_id == pair.meant_for);
        for unit in taken {
            if decision == "AS_DELIVERED" {
                book.entry(pair.arrived_at.clone())
                    .or_default()
                    .push(crate::sync::workflow::StoreInboundBook {
                        epc: unit.epc.clone(),
                        sku_code: pair.sku_code.clone(),
                    });
                if let (Some(arrived), Some(meant)) = (arrived, meant) {
                    sqlx::query(
                        "INSERT INTO edge_transfer_redirect
                             (source_dc_id, destination_store_id, shipment_reference, epc,
                              meant_destination_id, meant_shipment_reference,
                              dispatch_id, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                         ON CONFLICT DO NOTHING",
                    )
                    .bind(&source_dc)
                    .bind(&arrived.store_id)
                    .bind(&arrived.shipment_number)
                    .bind(&unit.epc)
                    .bind(&meant.store_id)
                    .bind(&meant.shipment_number)
                    .bind(dispatch_id)
                    .bind(now)
                    .execute(&mut *tx)
                    .await?;
                }
            } else {
                not_received.push((unit.subject_id, unit.epc.clone(), unit.line, false));
            }
        }
    }
    // What no store of the trip has: Missing.
    for ((store, _), pieces) in &rest {
        if !acts(store) {
            continue;
        }
        for unit in pieces {
            not_received.push((unit.subject_id, unit.epc.clone(), unit.line, true));
        }
    }
    crate::cloud::dc::packing::not_received_in_tx(
        &mut tx,
        &not_received,
        &format!("store-review:{key}"),
        &decided_by,
        now,
    )
    .await?;

    // Each store in review is told what it books and what goes back.
    for store in review
        .stores
        .iter()
        .filter(|store| in_review.contains(&store.store_id) && acts(&store.store_id))
    {
        let send_back: Vec<crate::sync::workflow::StoreInboundSendBack> = plan
            .send_back
            .iter()
            .filter(|one| one.store_id == store.store_id)
            .map(|one| crate::sync::workflow::StoreInboundSendBack {
                sku_code: one.sku_code.clone(),
                pieces: one.pieces,
            })
            .collect();
        let book = book.remove(&store.store_id).unwrap_or_default();
        let site = super::sync::canonical_site_id_tx(&mut tx, &store.store_id).await?;
        let origin = super::sync::inventory_owner_tx(&mut tx, &site).await?;
        let takes = match origin.as_deref() {
            Some(origin_id) => {
                super::sync::origin_takes_tx(
                    &mut tx,
                    origin_id,
                    crate::sync::workflow::STORE_ON_HOLD_CAPABILITY,
                )
                .await?
            }
            None => false,
        };
        let told = match origin {
            Some(origin_id) if takes => {
                let payload = crate::sync::workflow::StoreInboundOnHoldPayload {
                    schema_version: crate::sync::workflow::STORE_INBOUND_ON_HOLD_SCHEMA_VERSION,
                    dispatch_number: review.dispatch_number.clone(),
                    decision: decision.to_owned(),
                    shipment_reference: store.shipment_number.clone(),
                    book,
                    send_back,
                    decided_by: decided_by.clone(),
                    decided_at: now,
                };
                super::sync::issue_command_tx(
                    &mut tx,
                    crate::sync::workflow::INVENTORY_STORE_INBOUND_ON_HOLD_V1,
                    &serde_json::to_value(&payload)?,
                    &decided_by,
                    None,
                    &[origin_id],
                )
                .await?;
                true
            }
            _ => false,
        };
        if !told {
            plan.not_told.push(store.store_id.clone());
        }
    }
    match &only {
        Some(store) => {
            sqlx::query(
                "INSERT INTO allotment_store_review_store
                     (dispatch_id, store_id, decision, decided_by, decided_at,
                      idempotency_key, result)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(dispatch_id)
            .bind(store)
            .bind(decision)
            .bind(&decided_by)
            .bind(now)
            .bind(&key)
            .bind(serde_json::to_value(&plan)?)
            .execute(&mut *tx)
            .await?;
        }
        None => {
            sqlx::query(
                "INSERT INTO allotment_store_review
                     (dispatch_id, decision, decided_by, decided_at, idempotency_key, result)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(dispatch_id)
            .bind(decision)
            .bind(&decided_by)
            .bind(now)
            .bind(&key)
            .bind(serde_json::to_value(&plan)?)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(StoreReviewDecision {
        dispatch_id,
        dispatch_number: review.dispatch_number,
        store_id: only,
        decision: decision.to_owned(),
        decided_by,
        decided_at: now,
        plan,
    })
}

#[cfg(test)]
mod tests {
    use super::{differences, StoreReviewPair, StoreReviewPieces};
    use std::collections::{BTreeMap, BTreeSet};

    fn key(sku: &str, store: &str) -> (String, String) {
        (sku.to_owned(), store.to_owned())
    }

    /// The story of the prototype: one Light Blue M meant for C002 went into
    /// C001's koli, one White XL is gone, and C001 found a Blus nobody sent.
    #[test]
    fn a_trip_says_wrong_store_not_received_and_extra() {
        let sent = BTreeMap::from([
            (key("LB-M", "C001"), 1),
            (key("LB-M", "C002"), 1),
            (key("W-XL", "C001"), 1),
            (key("W-XL", "C002"), 1),
        ]);
        let counted = BTreeMap::from([
            (key("LB-M", "C001"), 2),
            (key("W-XL", "C001"), 1),
            (key("BLUS", "C001"), 1),
        ]);
        let stores = BTreeSet::from(["C001".to_owned(), "C002".to_owned()]);
        let (pairs, short, extra) = differences(&sent, &counted, &stores);
        assert_eq!(
            pairs,
            vec![StoreReviewPair {
                sku_code: "LB-M".into(),
                pieces: 1,
                meant_for: "C002".into(),
                arrived_at: "C001".into(),
            }]
        );
        assert_eq!(
            short,
            vec![StoreReviewPieces {
                sku_code: "W-XL".into(),
                store_id: "C002".into(),
                pieces: 1,
            }]
        );
        assert_eq!(
            extra,
            vec![StoreReviewPieces {
                sku_code: "BLUS".into(),
                store_id: "C001".into(),
                pieces: 1,
            }]
        );
    }

    /// A store that has not counted is neither short nor over: its count may
    /// be where the missing piece is.
    #[test]
    fn a_store_not_counted_yet_is_not_short() {
        let sent = BTreeMap::from([(key("LB-M", "C001"), 1), (key("LB-M", "C002"), 1)]);
        let counted = BTreeMap::from([(key("LB-M", "C001"), 2)]);
        let stores = BTreeSet::from(["C001".to_owned()]);
        let (pairs, short, extra) = differences(&sent, &counted, &stores);
        assert!(pairs.is_empty());
        assert!(short.is_empty());
        assert_eq!(extra.len(), 1);
    }
}
