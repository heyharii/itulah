//! Central Gudang: what a warehouse PC moves, written down as numbered moves
//! (client, 25 Oct 2026; sqlite 0094).
//!
//! The warehouse edition of the POS (`pos-desktop`, `vite --mode gudang`)
//! runs on a PC in the store's back room, joined to this node as a
//! `WAREHOUSE` device (`edge::devices`). Its keys are the store's own stock
//! work — F1 receive a delivery from the DC, F2 Gudang → Toko, F3 Toko →
//! Gudang, F4 set pieces aside as Reject with a reason, F5 send to head
//! office — and F10 lists what was done as **moves**: one numbered thing each
//! (PB-0042), with its lines, who did it, at which PC, and a surat jalan to
//! print.
//!
//! # A move is the ledger's, numbered here
//!
//! The ledger keeps one movement group per write and no number. A move here is
//! one write of the warehouse PC's: every line of it in one transaction, its
//! movement groups carrying the move's number (`reference_type =
//! 'STOCK_MOVE'`, `reference_id = 'PB-0042'`), and one movement group per
//! reason, so head office's ledger reads "Rusak" or "Cacat" on the pieces a
//! reject set aside. Which pieces go is the node's to choose, oldest in the
//! room first — the rule `POST /api/v1/store/movements/by-sku` already
//! follows — so a move names SKUs and counts, never an EPC.
//!
//! A receipt and a send are made by the routes that already make them
//! (`inbound::receive_store_inbound_by_count`, the store's Send of a return)
//! and written down here once they are done ([`record_receipt`],
//! [`record_send`]). A send from Gudang or Toko is first a move into To be
//! returned · Return HO ([`move_stock`] with `to: "ho"`), the pocket a return
//! is raised on; the send then fills in that move's shipment.
//!
//! # Who may
//!
//! At a warehouse PC a person on the cashier rung may receive and move goods
//! between Gudang and Toko (Hari, 25 Oct 2026); everywhere else the rungs are
//! as they were. A Reject and a send to head office need the Kepala toko's
//! yes — her finger or password, the `supervisor` a dropped held basket
//! carries (`till::verify_supervisor`) — unless the person is a supervisor
//! themselves. The grant is single-use, so the move spends it and records it
//! ([`Approval`], `approved_by`), and a send's later steps — raising the
//! return, sending it — lean on the move's recorded yes for
//! [`APPROVAL_MINUTES`] instead of asking again ([`confirm_approval`]).
//!
//! Refusals are in Indonesian: they are read in Central Gudang.

use std::collections::{BTreeMap, HashMap};
use std::str::FromStr;

use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::edge::contracts::{EdgeError, NodeContext};
use crate::edge::inbound::{StoreInboundCountLine, StoreInboundDetail};
use crate::edge::store_returns::{StoreReturnAsk, StoreReturnLine};
use crate::edge::till::Supervisor;
use crate::edge::{
    MovementCause, MovementCommand, MovementGroupId, MovementLine, OperationalPool, Place, SiteId,
    SqliteEdge, SubjectId, ToReturnPocket,
};
use crate::security;

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// Why a piece goes to Reject: one tap on the screen, never typed.
pub const REASONS: [&str; 4] = ["Rusak", "Cacat", "Kotor", "Salah kirim"];

/// Most lines one move carries.
const MAX_LINES: usize = 500;

/// The longest list Riwayat is answered with.
const MAX_LIST: usize = 500;

/// How long a Kepala toko's recorded yes covers the rest of a send to head
/// office: the return raised, its activation waited for, the send.
pub const APPROVAL_MINUTES: i64 = 15;

/// What a cashier at a warehouse PC is told without the Kepala toko's yes.
pub const NEEDS_HEAD: &str = "Reject dan kirim HO perlu jari Kepala toko.";

/// What a Reject without a finger is told, whoever is signed in.
pub const REJECT_NEEDS_FINGER: &str = "Reject perlu jari Kepala toko.";

// ════════════════════════════════════════════════════════════════════════════
// The places a move names
// ════════════════════════════════════════════════════════════════════════════

/// A room of the shop as the store app names it (`warehouse` is Gudang,
/// `floor` is Toko), and the two ends outside it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Room {
    Dc,
    Warehouse,
    Floor,
    Reject,
    /// To be returned · Return HO: where goods wait for the return head
    /// office raises, and leave on it.
    Ho,
}

impl Room {
    fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "dc" => Some(Self::Dc),
            "warehouse" | "gudang" => Some(Self::Warehouse),
            "floor" | "toko" => Some(Self::Floor),
            "reject" => Some(Self::Reject),
            "ho" | "return_ho" => Some(Self::Ho),
            _ => None,
        }
    }

    const fn code(self) -> &'static str {
        match self {
            Self::Dc => "dc",
            Self::Warehouse => "warehouse",
            Self::Floor => "floor",
            Self::Reject => "reject",
            Self::Ho => "ho",
        }
    }

    /// As the screen and the surat jalan say it.
    const fn word(self) -> &'static str {
        match self {
            Self::Dc => "DC",
            Self::Warehouse => "Gudang",
            Self::Floor => "Toko",
            Self::Reject => "Reject",
            Self::Ho => "HO",
        }
    }

    /// The room on hand at this site, as the ledger spells it.
    fn place(self, site_id: &SiteId) -> Result<Place, EdgeError> {
        let spelled = match self {
            Self::Warehouse | Self::Floor | Self::Reject => {
                format!("{site_id}.{}:on_hand", self.code())
            }
            Self::Ho => format!(
                "{}:on_hand",
                OperationalPool::ToReturn {
                    site_id: site_id.clone(),
                    pocket: ToReturnPocket::ReturnHo,
                }
                .id()
            ),
            Self::Dc => {
                return Err(EdgeError::Validation(
                    "Barang dari DC diterima lewat surat jalannya, bukan dipindah.".into(),
                ))
            }
        };
        Place::from_str(&spelled).map_err(|error| EdgeError::Validation(error.to_string()))
    }
}

fn room(value: &str, end: &str) -> Result<Room, EdgeError> {
    Room::parse(value).ok_or_else(|| {
        EdgeError::Validation(format!(
            "{end}: say warehouse, floor, reject or ho, not {:?}",
            value.trim()
        ))
    })
}

/// One of [`REASONS`], however it was spelt: `RUSAK`, `rusak`, `SALAH_KIRIM`.
fn reason_of(value: Option<&str>) -> Result<Option<&'static str>, EdgeError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let said = value.replace('_', " ").to_lowercase();
    REASONS
        .iter()
        .find(|reason| reason.to_lowercase() == said)
        .copied()
        .map(Some)
        .ok_or_else(|| {
            EdgeError::Validation(format!(
                "Alasan {value} tidak dikenal. Pilih Rusak, Cacat, Kotor atau Salah kirim."
            ))
        })
}

// ════════════════════════════════════════════════════════════════════════════
// On the wire
// ════════════════════════════════════════════════════════════════════════════

/// `POST /api/v1/store/warehouse/moves`: F2, F3, F4, and the first half of F5
/// from Gudang or Toko.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StockMoveRequest {
    /// `warehouse`, `floor` or `reject`.
    pub from: String,
    /// `warehouse`, `floor`, `reject`, or `ho` (To be returned · Return HO).
    pub to: String,
    pub lines: Vec<StockMoveLine>,
    pub idempotency_key: String,
    /// The Kepala toko's yes, for a Reject or a send by a cashier at a
    /// warehouse PC: the shape a dropped held basket carries.
    #[serde(default)]
    pub supervisor: Option<Supervisor>,
}

/// On whose word a Reject or a send is made.
pub enum Approval<'a> {
    /// The person's own rung allows it, or the move needs nobody's yes.
    Own,
    /// A cashier at a warehouse PC, with the Kepala toko's yes if one came.
    Cashier(Option<&'a Supervisor>),
}

/// The Kepala toko who said yes, as a move records her.
#[derive(Clone, Debug)]
pub struct Approved {
    pub username: String,
    pub name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StockMoveLine {
    pub sku_code: String,
    pub quantity: i64,
    /// Required into Reject: `Rusak`, `Cacat`, `Kotor` or `Salah kirim`.
    /// Ignored anywhere else.
    #[serde(default)]
    pub reason: Option<String>,
}

/// Who moved, and at which PC — the name the shell gives it ("Gudang 1").
#[derive(Clone, Debug)]
pub struct Actor {
    pub id: String,
    pub name: Option<String>,
    pub device: Option<String>,
}

/// One move, as Riwayat lists it and opens it.
#[derive(Clone, Debug, Serialize)]
pub struct StockMove {
    pub move_id: String,
    /// `PB-0042`.
    pub number: String,
    /// `RECEIVE` (F1), `MOVE` (F2, F3), `REJECT` (F4) or `SEND_HO` (F5).
    pub kind: String,
    /// `dc`, `warehouse`, `floor` or `reject`.
    pub from: String,
    /// `warehouse`, `floor`, `reject` or `ho`.
    pub to: String,
    /// The surat jalan a receipt came on; the shipment a send left as.
    pub reference: Option<String>,
    pub delivery_id: Option<String>,
    pub allotment_id: Option<String>,
    pub pieces: i64,
    pub line_count: i64,
    pub actor_id: String,
    /// The person's full name, when the node knows it.
    pub actor_name: Option<String>,
    pub device: Option<String>,
    pub occurred_at: String,
    /// A send: when its shipment left. Null while its goods wait in To be
    /// returned for the return to be raised.
    pub sent_at: Option<String>,
    /// The Kepala toko who said yes to a Reject or a send made by a cashier;
    /// null when the person moving could say it themselves.
    pub approved_by: Option<String>,
    pub approved_by_name: Option<String>,
    /// Every line, in a move opened; left out of a list.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<StockMoveLineView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StockMoveLineView {
    pub line_no: i64,
    pub sku_code: String,
    pub name: Option<String>,
    pub quantity: i64,
    /// What the surat jalan said was sent, on a receipt.
    pub sent: Option<i64>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StockMoveList {
    pub items: Vec<StockMove>,
}

/// A send to head office as it left, for [`record_send`].
pub struct Sent<'a> {
    /// The return it left on, read before it was sent.
    pub ask: &'a StoreReturnAsk,
    /// `reject` (the default), `warehouse` or `floor`.
    pub from: Option<&'a str>,
    /// The move that put the goods in Return HO, when they came from Gudang
    /// or Toko: the send is that move's, not another.
    pub move_number: Option<&'a str>,
    pub shipment_number: &'a str,
}

// ════════════════════════════════════════════════════════════════════════════
// Writing a move down
// ════════════════════════════════════════════════════════════════════════════

/// One line as it is written down.
struct Line {
    sku_code: String,
    quantity: i64,
    sent: Option<i64>,
    reason: Option<&'static str>,
}

/// The move's head, as it is written down.
struct Head<'a> {
    kind: &'a str,
    from: Room,
    to: Room,
    reference: Option<&'a str>,
    delivery_id: Option<&'a str>,
    allotment_id: Option<&'a str>,
    sent_at: Option<DateTime<Utc>>,
    approved: Option<&'a Approved>,
}

/// The next number, inside the writer's transaction.
fn next_number(tx: &Connection) -> Result<(i64, String), EdgeError> {
    let seq: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM edge_stock_move",
            [],
            |row| row.get(0),
        )
        .map_err(db)?;
    Ok((seq, format!("PB-{seq:04}")))
}

/// The move written under `idempotency_key`, with the digest of what it was
/// written for.
fn written_under(
    tx: &Connection,
    idempotency_key: &str,
) -> Result<Option<(String, String)>, EdgeError> {
    tx.query_row(
        "SELECT number, request_sha256 FROM edge_stock_move WHERE idempotency_key=?1",
        params![idempotency_key],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(db)
}

#[allow(clippy::too_many_arguments)]
fn write(
    tx: &Transaction<'_>,
    seq: i64,
    number: &str,
    head: &Head<'_>,
    lines: &[Line],
    actor: &Actor,
    idempotency_key: &str,
    request_sha256: &str,
    now: DateTime<Utc>,
) -> Result<String, EdgeError> {
    let move_id = Uuid::new_v4().to_string();
    let pieces: i64 = lines.iter().map(|line| line.quantity).sum();
    tx.execute(
        "INSERT INTO edge_stock_move
           (move_id,seq,number,kind,from_place,to_place,reference,delivery_id,allotment_id,
            pieces,actor_id,actor_name,device,idempotency_key,request_sha256,occurred_at,sent_at,
            approved_by,approved_by_name,approved_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
        params![
            move_id,
            seq,
            number,
            head.kind,
            head.from.code(),
            head.to.code(),
            head.reference,
            head.delivery_id,
            head.allotment_id,
            pieces,
            actor.id,
            actor.name,
            actor.device,
            idempotency_key,
            request_sha256,
            stamp(now),
            head.sent_at.map(stamp),
            head.approved.map(|approved| approved.username.as_str()),
            head.approved.and_then(|approved| approved.name.as_deref()),
            head.approved.map(|_| stamp(now))
        ],
    )
    .map_err(db)?;
    for (index, line) in lines.iter().enumerate() {
        tx.execute(
            "INSERT INTO edge_stock_move_line (move_id,line_no,sku_code,quantity,sent,reason)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                move_id,
                i64::try_from(index + 1).unwrap_or(i64::MAX),
                line.sku_code,
                line.quantity,
                line.sent,
                line.reason
            ],
        )
        .map_err(db)?;
    }
    Ok(move_id)
}

/// The Kepala toko's yes, verified and spent inside the caller's
/// transaction — so a move refused after it does not burn her grant — with
/// her name as this node knows it. `own_finger`: the person signed in is a
/// Kepala toko and may approve her own Reject with her finger.
fn approve(
    tx: &Transaction<'_>,
    supervisor: &Supervisor,
    actor: &Actor,
    own_finger: bool,
) -> Result<Approved, EdgeError> {
    let asking: &[&str] = if own_finger {
        &[]
    } else {
        &[actor.id.as_str()]
    };
    let username = crate::edge::till::verify_supervisor(tx, Some(supervisor), asking)?;
    let name: Option<String> = tx
        .query_row(
            "SELECT display_name FROM edge_user WHERE username=?1",
            params![username],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    Ok(Approved {
        username,
        name: name.filter(|name| !name.trim().is_empty()),
    })
}

/// Move goods between the shop's rooms as one numbered move.
///
/// Gudang ⇄ Toko (F2, F3), Gudang or Toko → Reject with a reason on every line
/// (F4), and the first step of a send to head office (F5): Gudang or Toko → HO
/// puts the goods in To be returned · Return HO, the pocket the return is
/// raised on; Reject → HO moves nothing — the goods leave the reject room when
/// the send picks them — and writes the send down, checked against what the
/// room holds. Goods from the DC are received ([`record_receipt`]).
///
/// A Reject or a send by a cashier at a warehouse PC carries the Kepala
/// toko's yes, which is spent and recorded here ([`Approval`]).
///
/// The same key and the same lines answer the move already made; the same key
/// with other lines is refused.
pub fn move_stock(
    connection: &mut Connection,
    node: &NodeContext,
    request: StockMoveRequest,
    approval: Approval<'_>,
    actor: &Actor,
    now: DateTime<Utc>,
) -> Result<StockMove, EdgeError> {
    let key = request.idempotency_key.trim().to_owned();
    if key.is_empty() {
        return Err(EdgeError::Validation("idempotency_key is required".into()));
    }
    let from = room(&request.from, "from")?;
    let to = room(&request.to, "to")?;
    let kind = match (from, to) {
        (Room::Warehouse, Room::Floor) | (Room::Floor, Room::Warehouse) => "MOVE",
        (Room::Warehouse | Room::Floor, Room::Reject) => "REJECT",
        (Room::Warehouse | Room::Floor | Room::Reject, Room::Ho) => "SEND_HO",
        _ => {
            return Err(EdgeError::Validation(format!(
                "{} → {} bukan pindahan gudang.",
                from.word(),
                to.word()
            )))
        }
    };
    // The Kepala toko's yes, verified and spent with the move below. A Reject
    // always takes her finger (Hari, 30 Oct 2026) — her own when she is the
    // one signed in, so it may be the actor's. A send by a cashier at a
    // warehouse PC takes it too, from somebody other than the cashier.
    let asked = match (approval, kind) {
        (_, "MOVE") => None,
        (Approval::Own, "REJECT") => Some((
            request
                .supervisor
                .as_ref()
                .ok_or_else(|| EdgeError::Forbidden(REJECT_NEEDS_FINGER.into()))?,
            true,
        )),
        (Approval::Own, _) => None,
        (Approval::Cashier(Some(supervisor)), _) => Some((supervisor, false)),
        (Approval::Cashier(None), _) => return Err(EdgeError::Forbidden(NEEDS_HEAD.into())),
    };
    if kind == "REJECT" {
        let by_finger = asked.is_some_and(|(supervisor, _)| {
            supervisor
                .authorization
                .as_deref()
                .is_some_and(|token| !token.trim().is_empty())
        });
        if !by_finger {
            return Err(EdgeError::Forbidden(REJECT_NEEDS_FINGER.into()));
        }
    }
    let moves_goods = !(from == Room::Reject && to == Room::Ho);
    if request.lines.is_empty() {
        return Err(EdgeError::Validation(
            "Belum ada barang untuk dipindah.".into(),
        ));
    }
    if request.lines.len() > MAX_LINES {
        return Err(EdgeError::Validation(format!(
            "Satu pindahan paling banyak {MAX_LINES} baris."
        )));
    }
    // One line per SKU and reason, in the order they were scanned.
    let mut lines: Vec<Line> = Vec::new();
    for line in &request.lines {
        let sku_code = line.sku_code.trim().to_owned();
        if sku_code.is_empty() {
            return Err(EdgeError::Validation("sku_code is required".into()));
        }
        if line.quantity < 1 {
            return Err(EdgeError::Validation(format!(
                "Jumlah {sku_code} paling sedikit 1."
            )));
        }
        let reason = if to == Room::Reject {
            match reason_of(line.reason.as_deref())? {
                Some(reason) => Some(reason),
                None => {
                    return Err(EdgeError::Validation(format!(
                        "Pilih alasan untuk {sku_code}: Rusak, Cacat, Kotor atau Salah kirim."
                    )))
                }
            }
        } else {
            None
        };
        match lines
            .iter_mut()
            .find(|seen| seen.sku_code == sku_code && seen.reason == reason)
        {
            Some(seen) => seen.quantity += line.quantity,
            None => lines.push(Line {
                sku_code,
                quantity: line.quantity,
                sent: None,
                reason,
            }),
        }
    }
    let digest = security::sha256_hex(
        serde_json::to_string(&serde_json::json!({
            "from": from.code(),
            "to": to.code(),
            "lines": lines
                .iter()
                .map(|line| serde_json::json!([line.sku_code, line.quantity, line.reason]))
                .collect::<Vec<_>>(),
        }))
        .map_err(|error| EdgeError::Persistence(error.to_string()))?,
    );
    let from_place = from.place(&node.site_id)?;
    let to_place = to.place(&node.site_id)?;

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    if let Some((number, written)) = written_under(&tx, &key)? {
        if written != digest {
            return Err(EdgeError::Conflict(format!(
                "{key} sudah dipakai untuk pindahan {number} yang lain."
            )));
        }
        tx.commit().map_err(db)?;
        return find(connection, &number);
    }
    let approved = match asked {
        Some((supervisor, own_finger)) => Some(approve(&tx, supervisor, actor, own_finger)?),
        None => None,
    };
    let (seq, number) = next_number(&tx)?;

    // Oldest in the room first, as a move by SKU chooses; a piece taken for
    // one line is not offered to the next.
    let mut taken: HashMap<SubjectId, i64> = HashMap::new();
    let mut groups: BTreeMap<Option<&'static str>, Vec<MovementLine>> = BTreeMap::new();
    for line in &lines {
        let rows: Vec<(String, i64)> = tx
            .prepare_cached(
                "SELECT projection.subject_id,projection.quantity
                 FROM inventory_projection projection
                 JOIN inventory_subject subject ON subject.id=projection.subject_id
                 WHERE projection.place_id=?1 AND subject.sku_code=?2
                 ORDER BY projection.updated_at,subject.created_at,subject.id",
            )
            .map_err(db)?
            .query_map(params![from_place.id(), line.sku_code], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(db)?
            .collect::<Result<_, _>>()
            .map_err(db)?;
        let mut free = Vec::new();
        for (subject_id, quantity) in rows {
            let subject_id = SubjectId(
                Uuid::parse_str(&subject_id)
                    .map_err(|error| EdgeError::Persistence(error.to_string()))?,
            );
            let left = quantity.max(0) - taken.get(&subject_id).copied().unwrap_or(0);
            if left > 0 {
                free.push((subject_id, left));
            }
        }
        let available: i64 = free.iter().map(|(_, left)| *left).sum();
        if available < line.quantity {
            return Err(EdgeError::Conflict(format!(
                "Stok {} {} tinggal {available}, tidak cukup untuk {}.",
                from.word().to_lowercase(),
                line.sku_code,
                line.quantity
            )));
        }
        let mut remaining = line.quantity;
        for (subject_id, left) in free {
            if remaining == 0 {
                break;
            }
            let take = left.min(remaining);
            *taken.entry(subject_id).or_insert(0) += take;
            groups.entry(line.reason).or_default().push(MovementLine {
                subject_id,
                quantity: take,
                from: from_place.clone(),
                to: to_place.clone(),
            });
            remaining -= take;
        }
    }
    // From the reject room the pieces stay where they are, counted, until the
    // send picks them.
    if !moves_goods {
        groups.clear();
    }
    for (index, (reason, movement_lines)) in groups.into_iter().enumerate() {
        let said = match reason {
            Some(reason) => format!("{number} {} ke {} · {reason}", from.word(), to.word()),
            None => format!("{number} {} ke {}", from.word(), to.word()),
        };
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: movement_lines,
            cause: MovementCause::NormalMove,
            reference_type: Some("STOCK_MOVE".into()),
            reference_id: Some(number.clone()),
            reason: said,
            actor_id: actor.id.clone(),
            occurred_at: now,
        };
        SqliteEdge::append_movement(node, &tx, &format!("stock-move:{key}:{index}"), &command)?;
    }
    let head = Head {
        kind,
        from,
        to,
        reference: None,
        delivery_id: None,
        allotment_id: None,
        sent_at: None,
        approved: approved.as_ref(),
    };
    write(&tx, seq, &number, &head, &lines, actor, &key, &digest, now)?;
    tx.commit().map_err(db)?;
    find(connection, &number)
}

/// A delivery received (F1), written down as a move from the DC to Gudang:
/// every SKU the surat jalan carried with what was counted of it, and any
/// counted that it did not carry. The receipt itself is the inbound route's
/// (`receive_store_inbound_by_count`); this runs once it is done, under the
/// same key, and answers the move already written when it is asked again.
pub fn record_receipt(
    connection: &mut Connection,
    delivery: &StoreInboundDetail,
    counts: &[StoreInboundCountLine],
    idempotency_key: &str,
    actor: &Actor,
    now: DateTime<Utc>,
) -> Result<StockMove, EdgeError> {
    let key = format!("receipt:{}", idempotency_key.trim());
    let mut counted: BTreeMap<String, i64> = BTreeMap::new();
    for line in counts {
        *counted.entry(line.sku_code.trim().to_owned()).or_insert(0) += line.quantity.max(0);
    }
    let mut lines: Vec<Line> = delivery
        .lines
        .iter()
        .map(|line| Line {
            sku_code: line.sku_code.clone(),
            quantity: counted.remove(&line.sku_code).unwrap_or(0),
            sent: Some(line.expected),
            reason: None,
        })
        .collect();
    lines.extend(
        counted
            .into_iter()
            .filter(|(_, quantity)| *quantity > 0)
            .map(|(sku_code, quantity)| Line {
                sku_code,
                quantity,
                sent: Some(0),
                reason: None,
            }),
    );
    // Sorted, so a replayed delivery listing its lines in another order still matches.
    let mut counted_lines: Vec<String> = lines
        .iter()
        .map(|line| format!("{}={}", line.sku_code, line.quantity))
        .collect();
    counted_lines.sort();
    let digest = security::sha256_hex(format!(
        "{}\n{}",
        delivery.delivery.delivery_id,
        counted_lines.join(",")
    ));
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    if let Some((number, written)) = written_under(&tx, &key)? {
        if written != digest {
            return Err(EdgeError::Conflict(format!(
                "{} sudah dipakai untuk penerimaan {number} yang lain.",
                idempotency_key.trim()
            )));
        }
        tx.commit().map_err(db)?;
        return find(connection, &number);
    }
    let (seq, number) = next_number(&tx)?;
    let head = Head {
        kind: "RECEIVE",
        from: Room::Dc,
        to: Room::Warehouse,
        reference: delivery.delivery.shipment_reference.as_deref(),
        delivery_id: Some(delivery.delivery.delivery_id.as_str()),
        allotment_id: None,
        sent_at: None,
        approved: None,
    };
    write(&tx, seq, &number, &head, &lines, actor, &key, &digest, now)?;
    tx.commit().map_err(db)?;
    find(connection, &number)
}

/// A send to head office (F5), written down once its shipment has left.
///
/// From Gudang or Toko the goods were first moved into Return HO under a
/// number of their own ([`move_stock`] with `to: "ho"`), and the send fills in
/// that move's shipment. From Reject they leave the reject room on the return
/// head office raised for them, and the send is a move of its own.
pub fn record_send(
    connection: &mut Connection,
    sent: Sent<'_>,
    idempotency_key: &str,
    actor: &Actor,
    now: DateTime<Utc>,
) -> Result<StockMove, EdgeError> {
    let key = format!("send:{}", idempotency_key.trim());
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    if let Some(number) = sent
        .move_number
        .map(str::trim)
        .filter(|number| !number.is_empty())
    {
        let number = number_of(number);
        let row: Option<(String, Option<String>, Option<String>)> = tx
            .query_row(
                "SELECT kind, sent_at, allotment_id FROM edge_stock_move WHERE number=?1",
                params![number],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?;
        let Some((kind, sent_at, allotment_id)) = row else {
            return Err(EdgeError::NotFound(format!("pindahan {number}")));
        };
        if kind != "SEND_HO" {
            return Err(EdgeError::Validation(format!(
                "{number} bukan kiriman ke HO."
            )));
        }
        let same = allotment_id.as_deref() == Some(sent.ask.allotment_id.as_str());
        if sent_at.is_some() && !same {
            return Err(EdgeError::Conflict(format!("{number} sudah dikirim.")));
        }
        if sent_at.is_none() {
            tx.execute(
                "UPDATE edge_stock_move SET reference=?2, allotment_id=?3, sent_at=?4
                  WHERE number=?1 AND sent_at IS NULL",
                params![
                    number,
                    sent.shipment_number,
                    sent.ask.allotment_id,
                    stamp(now)
                ],
            )
            .map_err(db)?;
        }
        tx.commit().map_err(db)?;
        return find(connection, &number);
    }
    let digest = security::sha256_hex(format!(
        "{}\n{}",
        sent.ask.allotment_id, sent.shipment_number
    ));
    if let Some((number, written)) = written_under(&tx, &key)? {
        if written != digest {
            return Err(EdgeError::Conflict(format!(
                "{} sudah dipakai untuk kiriman {number} yang lain.",
                idempotency_key.trim()
            )));
        }
        tx.commit().map_err(db)?;
        return find(connection, &number);
    }
    let from = match sent.from {
        None => Room::Reject,
        Some(value) => room(value, "from")?,
    };
    if !matches!(from, Room::Reject | Room::Warehouse | Room::Floor) {
        return Err(EdgeError::Validation(format!(
            "Kirim HO dari Reject, Gudang atau Toko, bukan dari {}.",
            from.word()
        )));
    }
    let lines: Vec<Line> = sent
        .ask
        .lines
        .iter()
        .map(|line| Line {
            sku_code: line.sku_code.clone(),
            quantity: line.quantity,
            sent: None,
            reason: None,
        })
        .collect();
    let (seq, number) = next_number(&tx)?;
    let head = Head {
        kind: "SEND_HO",
        from,
        to: Room::Ho,
        reference: Some(sent.shipment_number),
        delivery_id: None,
        allotment_id: Some(sent.ask.allotment_id.as_str()),
        sent_at: Some(now),
        approved: None,
    };
    write(&tx, seq, &number, &head, &lines, actor, &key, &digest, now)?;
    tx.commit().map_err(db)?;
    find(connection, &number)
}

/// The send already written down — under `idempotency_key`, or on the move
/// into Return HO it was the send of (`move_number`, already sent on
/// `allotment_id`) — so a send asked again is answered without sending
/// anything twice.
pub fn sent_under(
    connection: &Connection,
    idempotency_key: &str,
    move_number: Option<&str>,
    allotment_id: &str,
) -> Result<Option<StockMove>, EdgeError> {
    if let Some(number) = move_number
        .map(str::trim)
        .filter(|number| !number.is_empty())
    {
        let number = number_of(number);
        let sent: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM edge_stock_move
                                WHERE number=?1 AND sent_at IS NOT NULL AND allotment_id=?2)",
                params![number, allotment_id.trim()],
                |row| row.get(0),
            )
            .map_err(db)?;
        return if sent {
            find(connection, &number).map(Some)
        } else {
            Ok(None)
        };
    }
    match written_under(connection, &format!("send:{}", idempotency_key.trim()))? {
        Some((number, _)) => find(connection, &number).map(Some),
        None => Ok(None),
    }
}

/// A send that left and was not written down, read back from its trip.
pub struct LeftOnTrip {
    /// The return as it left: what the trip carried of it.
    pub ask: StoreReturnAsk,
    pub shipment_number: String,
}

/// The trip a send under `idempotency_key` put `allotment_id`'s goods on,
/// when the send left but was never written down (the store's Send runs its
/// trip under `{key}:trip`). Its return asks for nothing any more, so what
/// went is read off the trip's koli. `None` when nothing left under the key.
pub fn left_on_trip(
    connection: &Connection,
    idempotency_key: &str,
    allotment_id: &str,
) -> Result<Option<LeftOnTrip>, EdgeError> {
    let key = idempotency_key.trim();
    let allotment_id = allotment_id.trim();
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT operation, response_json FROM idempotency_response WHERE idempotency_key=?1",
            params![format!("{key}:trip")],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((operation, response_json)) = row else {
        return Ok(None);
    };
    if operation != "DC_DISPATCH_TRIP" {
        return Err(EdgeError::Conflict(format!(
            "{key} sudah dipakai untuk yang lain."
        )));
    }
    let dispatch_id: String = serde_json::from_str(&response_json)
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
    // The surat jalan that carries this return's pieces, not the trip's first.
    let shipment_number: Option<String> = connection
        .query_row(
            "SELECT s.shipment_number
               FROM shipment s
               JOIN koli k ON k.shipment_id = s.shipment_id
               JOIN koli_unit u ON u.koli_id = k.koli_id
              WHERE s.dispatch_id = ?1 AND u.allotment_id = ?2 AND u.released_at IS NULL
              ORDER BY s.shipment_number LIMIT 1",
            params![dispatch_id, allotment_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    let Some(shipment_number) = shipment_number else {
        return Err(EdgeError::Conflict(format!(
            "{key} sudah dipakai untuk retur lain, bukan {allotment_id}."
        )));
    };
    if shipment_number.is_empty() {
        return Err(EdgeError::Persistence(format!(
            "Perjalanan {dispatch_id} tidak punya surat jalan."
        )));
    }
    let rows: Vec<(String, i64, String, Option<String>)> = connection
        .prepare(
            "SELECT u.sku_code, COUNT(*), k.destination_store_id,
                    (SELECT c.name FROM catalog_item c WHERE c.sku_code = u.sku_code)
               FROM koli_unit u
               JOIN koli k ON k.koli_id = u.koli_id
               JOIN shipment s ON s.shipment_id = k.shipment_id
              WHERE s.dispatch_id = ?1 AND u.allotment_id = ?2 AND u.released_at IS NULL
              GROUP BY u.sku_code, k.destination_store_id
              ORDER BY u.sku_code",
        )
        .map_err(db)?
        .query_map(params![dispatch_id, allotment_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<_, _>>()
        .map_err(db)?;
    let Some(destination_id) = rows
        .first()
        .map(|(_, _, destination, _)| destination.clone())
    else {
        return Err(EdgeError::Conflict(format!(
            "{key} sudah dipakai untuk retur lain, bukan {allotment_id}."
        )));
    };
    let (allotment_number, requested_at): (String, String) = connection
        .query_row(
            "SELECT allotment_number, created_at FROM dc_allotment_work WHERE allotment_id=?1",
            params![allotment_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?
        .unwrap_or_else(|| (allotment_id.to_owned(), String::new()));
    let lines: Vec<StoreReturnLine> = rows
        .into_iter()
        .map(|(sku_code, quantity, _, name)| StoreReturnLine {
            sku_code,
            name,
            quantity,
            source_pool_id: String::new(),
        })
        .collect();
    Ok(Some(LeftOnTrip {
        ask: StoreReturnAsk {
            allotment_id: allotment_id.to_owned(),
            allotment_number,
            requested_at,
            quantity: lines.iter().map(|line| line.quantity).sum(),
            lines,
            destination_id,
        },
        shipment_number,
    }))
}

/// The yes a cashier's later step of a send leans on — raising the return,
/// sending it: the move's recorded yes while it is under
/// [`APPROVAL_MINUTES`] old; else the Kepala toko's yes given now, verified,
/// spent and recorded on the move; else refused with [`NEEDS_HEAD`]. The UI
/// sends the same `supervisor` on every step, and a grant already spent by
/// the move is never asked to pay twice.
pub fn confirm_approval(
    connection: &mut Connection,
    number: &str,
    supervisor: Option<&Supervisor>,
    actor: &Actor,
    now: DateTime<Utc>,
) -> Result<Approved, EdgeError> {
    let number = number_of(number);
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let row: Option<(String, Option<String>, Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT kind, approved_by, approved_by_name, approved_at
               FROM edge_stock_move WHERE number=?1",
            params![number],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((kind, approved_by, approved_by_name, approved_at)) = row else {
        return Err(EdgeError::NotFound(format!("pindahan {number}")));
    };
    if kind != "SEND_HO" {
        return Err(EdgeError::Validation(format!(
            "{number} bukan kiriman ke HO."
        )));
    }
    let fresh = approved_at
        .as_deref()
        .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
        .is_some_and(|at| {
            now.signed_duration_since(at.with_timezone(&Utc))
                <= chrono::Duration::minutes(APPROVAL_MINUTES)
        });
    if let (true, Some(username)) = (fresh, approved_by) {
        tx.commit().map_err(db)?;
        return Ok(Approved {
            username,
            name: approved_by_name,
        });
    }
    let Some(supervisor) = supervisor else {
        return Err(EdgeError::Forbidden(NEEDS_HEAD.into()));
    };
    let approved = approve(&tx, supervisor, actor, false)?;
    tx.execute(
        "UPDATE edge_stock_move SET approved_by=?2, approved_by_name=?3, approved_at=?4
          WHERE number=?1",
        params![number, approved.username, approved.name, stamp(now)],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(approved)
}

/// The To be returned pocket a send's goods wait in, as head office names it
/// when the return is raised: `reject` from the reject room, `return_ho` from
/// Gudang or Toko. Refused for a move that is not an unsent send.
pub fn raise_pocket(found: &StockMove) -> Result<&'static str, EdgeError> {
    if found.kind != "SEND_HO" {
        return Err(EdgeError::Validation(format!(
            "{} bukan kiriman ke HO.",
            found.number
        )));
    }
    if found.sent_at.is_some() {
        return Err(EdgeError::Conflict(format!(
            "{} sudah dikirim.",
            found.number
        )));
    }
    Ok(if found.from == Room::Reject.code() {
        "reject"
    } else {
        "return_ho"
    })
}

/// The return head office raised for a send, kept on its move so the send
/// can be made by the move's number alone.
pub fn note_raised(
    connection: &Connection,
    number: &str,
    allotment_id: &str,
) -> Result<(), EdgeError> {
    connection
        .execute(
            "UPDATE edge_stock_move SET allotment_id=?2 WHERE number=?1 AND sent_at IS NULL",
            params![number_of(number), allotment_id.trim()],
        )
        .map_err(db)?;
    Ok(())
}

/// The head-office id of an account this node signs in, for a call relayed
/// to head office as that person — `None` for an account of this shop only
/// (`LOCAL`), which head office has never heard of.
pub fn head_office_id(connection: &Connection, username: &str) -> Result<Option<Uuid>, EdgeError> {
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT id, source FROM edge_user WHERE username=?1 AND active=1",
            params![username.trim()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    Ok(row
        .filter(|(_, source)| source == "CLOUD")
        .and_then(|(id, _)| Uuid::parse_str(&id).ok()))
}

// ════════════════════════════════════════════════════════════════════════════
// Reading moves back
// ════════════════════════════════════════════════════════════════════════════

/// `PB-0042` however it was typed: `pb-0042`, `0042`, `42`.
fn number_of(value: &str) -> String {
    let value = value.trim().to_ascii_uppercase();
    match value.parse::<i64>() {
        Ok(seq) if seq > 0 => format!("PB-{seq:04}"),
        _ => value,
    }
}

const SELECT_MOVE: &str = "SELECT m.move_id, m.number, m.kind, m.from_place, m.to_place,
        m.reference, m.delivery_id, m.allotment_id, m.pieces,
        (SELECT count(*) FROM edge_stock_move_line l WHERE l.move_id = m.move_id),
        m.actor_id, m.actor_name, m.device, m.occurred_at, m.sent_at,
        m.approved_by, m.approved_by_name
   FROM edge_stock_move m";

fn move_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StockMove> {
    Ok(StockMove {
        move_id: row.get(0)?,
        number: row.get(1)?,
        kind: row.get(2)?,
        from: row.get(3)?,
        to: row.get(4)?,
        reference: row.get(5)?,
        delivery_id: row.get(6)?,
        allotment_id: row.get(7)?,
        pieces: row.get(8)?,
        line_count: row.get(9)?,
        actor_id: row.get(10)?,
        actor_name: row.get(11)?,
        device: row.get(12)?,
        occurred_at: row.get(13)?,
        sent_at: row.get(14)?,
        approved_by: row.get(15)?,
        approved_by_name: row.get(16)?,
        lines: Vec::new(),
    })
}

/// Riwayat (F10): the newest moves first. `query` finds a number, a surat
/// jalan or shipment, a SKU or an article's name.
pub fn list(
    connection: &Connection,
    query: Option<&str>,
    limit: usize,
) -> Result<StockMoveList, EdgeError> {
    let query = query.map(str::trim).filter(|query| !query.is_empty());
    let pattern = query.map(|query| format!("%{}%", query.to_uppercase()));
    // `10021345·104` as it is printed is `10021345104` as it is kept.
    let digits = query
        .map(|query| {
            query
                .chars()
                .filter(char::is_ascii_digit)
                .collect::<String>()
        })
        .filter(|digits| digits.len() >= 3)
        .map(|digits| format!("%{digits}%"));
    let limit = i64::try_from(limit.clamp(1, MAX_LIST)).unwrap_or(100);
    let mut statement = connection
        .prepare(&format!(
            "{SELECT_MOVE}
              WHERE ?1 IS NULL
                 OR upper(m.number) LIKE ?1
                 OR upper(COALESCE(m.reference, '')) LIKE ?1
                 OR EXISTS (SELECT 1 FROM edge_stock_move_line l
                              LEFT JOIN catalog_item c ON c.sku_code = l.sku_code
                             WHERE l.move_id = m.move_id
                               AND (l.sku_code LIKE COALESCE(?2, ?1)
                                    OR upper(COALESCE(c.name, '')) LIKE ?1))
              ORDER BY m.seq DESC
              LIMIT ?3"
        ))
        .map_err(db)?;
    let rows = statement
        .query_map(params![pattern, digits, limit], move_row)
        .map_err(db)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(db)?);
    }
    Ok(StockMoveList { items })
}

/// One move with every line, the article's name beside each SKU.
pub fn find(connection: &Connection, number: &str) -> Result<StockMove, EdgeError> {
    let number = number_of(number);
    let found = connection
        .query_row(
            &format!("{SELECT_MOVE} WHERE m.number = ?1"),
            params![number],
            move_row,
        )
        .optional()
        .map_err(db)?;
    let Some(mut found) = found else {
        return Err(EdgeError::NotFound(format!("pindahan {number}")));
    };
    let mut statement = connection
        .prepare(
            "SELECT l.line_no, l.sku_code,
                    (SELECT c.name FROM catalog_item c WHERE c.sku_code = l.sku_code),
                    l.quantity, l.sent, l.reason
               FROM edge_stock_move_line l
              WHERE l.move_id = ?1
              ORDER BY l.line_no",
        )
        .map_err(db)?;
    let rows = statement
        .query_map(params![found.move_id], |row| {
            Ok(StockMoveLineView {
                line_no: row.get(0)?,
                sku_code: row.get(1)?,
                name: row.get(2)?,
                quantity: row.get(3)?,
                sent: row.get(4)?,
                reason: row.get(5)?,
            })
        })
        .map_err(db)?;
    for row in rows {
        found.lines.push(row.map_err(db)?);
    }
    Ok(found)
}

// ════════════════════════════════════════════════════════════════════════════
// The surat jalan
// ════════════════════════════════════════════════════════════════════════════

/// Text a receipt printer's first code page can print: the few marks the
/// screen uses are given their plain spelling, anything else a `?`.
fn printable(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '·' | '•' => '.',
            '–' | '—' | '→' => '-',
            character if character.is_ascii() && !character.is_ascii_control() => character,
            _ => '?',
        })
        .collect()
}

/// `10021345104` as the shop reads it: `10021345.104`.
fn sku_text(sku: &str) -> String {
    if sku.len() == 11 && sku.bytes().all(|byte| byte.is_ascii_digit()) {
        format!("{}.{}", &sku[..8], &sku[8..])
    } else {
        printable(sku)
    }
}

/// `left` and `right` on one line of `columns`, `right` against the edge.
fn spread(left: &str, right: &str, columns: usize) -> String {
    let room = columns.saturating_sub(right.chars().count() + 1);
    let left: String = left.chars().take(room).collect();
    let gap = columns.saturating_sub(left.chars().count() + right.chars().count());
    format!("{left}{}{right}\n", " ".repeat(gap.max(1)))
}

/// One move's surat jalan in ESC/POS, for the receipt printer at the warehouse
/// PC or one the node recorded: the move's number, the shop, when, from and
/// to, who, every line, the total, and two places to sign. `paper` is
/// `NARROW` (58 mm, 32 columns, the default) or `WIDE` (80 mm, 48). In
/// Indonesian, like every paper the shop reads.
pub fn slip(
    connection: &Connection,
    number: &str,
    paper: Option<&str>,
    copy: bool,
) -> Result<(StockMove, Vec<u8>), EdgeError> {
    let found = find(connection, number)?;
    let columns = match paper
        .map(|paper| paper.trim().to_ascii_uppercase())
        .as_deref()
    {
        Some("WIDE" | "80" | "80MM") => 48,
        _ => 32,
    };
    let rule = format!("{}\n", "-".repeat(columns));
    let shop = crate::edge::site_profile::own(connection)
        .map(|site| format!("{} {}", site.display_code(), site.name))
        .unwrap_or_default();
    let offset = crate::edge::site_profile::utc_offset_minutes(connection);
    let when = DateTime::parse_from_rfc3339(&found.occurred_at)
        .ok()
        .and_then(|at| {
            let zone = FixedOffset::east_opt(offset * 60)?;
            Some(at.with_timezone(&zone).format("%d/%m/%Y %H:%M").to_string())
        })
        .unwrap_or_else(|| found.occurred_at.clone());
    let word = |code: &str| Room::parse(code).map(Room::word).unwrap_or("-");

    let mut text = String::new();
    let fact = |label: &str, value: &str| format!("{label:<9}: {}\n", printable(value));
    text.push_str(&fact("Tanggal", &when));
    text.push_str(&fact("Dari", word(&found.from)));
    text.push_str(&fact("Ke", word(&found.to)));
    if let Some(reference) = found.reference.as_deref() {
        let label = if found.kind == "RECEIVE" {
            "No. SJ"
        } else {
            "Kiriman"
        };
        text.push_str(&fact(label, reference));
    } else if found.kind == "SEND_HO" {
        text.push_str(&fact("Kiriman", "belum dikirim"));
    }
    if let Some(device) = found.device.as_deref() {
        text.push_str(&fact("Komputer", device));
    }
    text.push_str(&fact(
        "Oleh",
        found.actor_name.as_deref().unwrap_or(&found.actor_id),
    ));
    text.push_str(&rule);
    for line in &found.lines {
        text.push_str(&spread(
            &format!("{}. {}", line.line_no, sku_text(&line.sku_code)),
            &line.quantity.to_string(),
            columns,
        ));
        if let Some(name) = line.name.as_deref() {
            let name: String = printable(name).chars().take(columns - 3).collect();
            text.push_str(&format!("   {name}\n"));
        }
        if let Some(sent) = line.sent {
            text.push_str(&format!("   Dikirim {sent} . Diterima {}\n", line.quantity));
        }
        if let Some(reason) = line.reason.as_deref() {
            text.push_str(&format!("   Alasan: {}\n", printable(reason)));
        }
    }
    text.push_str(&rule);
    text.push_str(&spread("Jumlah", &format!("{} pcs", found.pieces), columns));
    text.push('\n');
    let half = columns / 2;
    text.push_str(&format!("{:<half$}{}\n", "Diserahkan", "Diterima"));
    text.push_str("\n\n\n");
    text.push_str(&format!("{:<half$}{}\n", "(          )", "(          )"));
    text.push_str("\n\n\n");

    // Reset, centre, bold on; the title and the number; bold off, left.
    let mut bytes: Vec<u8> = vec![0x1b, b'@', 0x1b, b'a', 1, 0x1b, b'E', 1];
    bytes.extend_from_slice(b"SURAT JALAN\n");
    bytes.extend_from_slice(format!("{}\n", printable(&found.number)).as_bytes());
    bytes.extend_from_slice(&[0x1b, b'E', 0]);
    if copy {
        bytes.extend_from_slice(b"** SALINAN **\n");
    }
    if !shop.is_empty() {
        bytes.extend_from_slice(format!("{}\n", printable(&shop)).as_bytes());
    }
    bytes.extend_from_slice(&[0x1b, b'a', 0]);
    bytes.extend_from_slice(rule.as_bytes());
    bytes.extend_from_slice(text.as_bytes());
    // Feed and cut.
    bytes.extend_from_slice(&[0x1d, b'V', 66, 0x50]);
    Ok((found, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reason_is_one_of_four_however_it_is_spelt() {
        assert_eq!(reason_of(Some("RUSAK")).ok().flatten(), Some("Rusak"));
        assert_eq!(
            reason_of(Some("salah_kirim")).ok().flatten(),
            Some("Salah kirim")
        );
        assert_eq!(reason_of(None).ok().flatten(), None);
        assert!(reason_of(Some("Bagus")).is_err());
    }

    #[test]
    fn a_number_is_read_however_it_is_typed() {
        assert_eq!(number_of("42"), "PB-0042");
        assert_eq!(number_of(" pb-0042 "), "PB-0042");
    }

    #[test]
    fn a_slip_line_keeps_its_figure_against_the_edge() {
        let line = spread("1. 10021345.104", "12", 32);
        assert_eq!(line.chars().count(), 33);
        assert!(line.ends_with("12\n"));
        assert_eq!(sku_text("10021345104"), "10021345.104");
        assert_eq!(printable("Gudang → Toko · 2"), "Gudang - Toko . 2");
    }
}
