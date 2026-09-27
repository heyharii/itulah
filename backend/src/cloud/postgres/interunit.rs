//! The two-way check: what head office says a store owes, and what the store says.
//!
//! # Why a screen for this at all
//!
//! An inter-unit balance is the one figure in these books that two people have
//! to agree about. Every other account is one unit's own arithmetic; this one is
//! a claim by head office and an admission by a shop, and the only thing that
//! makes it worth anything is that the two are the same number. In the client's
//! current system they are not — reconciling affiliate balances is a monthly
//! argument conducted in a spreadsheet, because nothing shows both sides at once.
//!
//! Here they cannot drift, because both legs are written by one rule in one
//! transaction (`domain::interunit`, applied in `poster::post`). So the honest
//! description of this module is: it proves a thing that is already true, and it
//! is worth having for exactly that reason. A difference here is not a
//! bookkeeping backlog to chase; it is a bug, or a hand-written journal entry
//! somebody posted into an affiliate account, and both are things a person
//! wants to be told about on the day rather than at the month end.
//!
//! # Reading the two sides
//!
//! Head office's leg is an asset — `Piutang Affiliasi`, debit when a shop owes
//! more. The shop's is a liability — `Hutang Affiliasi`, credit when it owes
//! more. So the raw sums are equal and opposite, and both are reported here as
//! POSITIVE-WHEN-OWED, which is how the two are spoken about ("store 03 owes
//! head office eleven million") and the only form in which comparing them means
//! anything.
//!
//! # Why the sums come through `account_resolution`
//!
//! The link says which leaf is an affiliate account in a unit's books, per
//! family (`PEMBIAYAAN`, `BARANG`, `LAIN`), and summing that leaf is what a
//! trial balance does. Since 0380 a leaf is no longer a pair — a store is
//! always on its family's hutang leaf and head office always on its piutang
//! leaf, whoever is on the other side (I7) — so the pair comes off the journal
//! line's `counter_unit_id`, and the link keeps only the family (0460, 0606).
//!
//! # Units, not sites
//!
//! Both sides are units (0605): head office is the unit of kind `HO`, read
//! from data, and every other unit is a store. The Gudang is one of head
//! office's premises and never appears here on its own.
//!
//! Reads only. The journal is written in `poster.rs` and nowhere else.

use crate::cloud::application::AppError;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// One pair, one column: what each side says, and whether they agree.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InterunitPair {
    /// The store unit. Internal; screens show `store_code` and `store_name`.
    pub store_unit_id: String,
    /// The client's code for it: `C004`.
    pub store_code: String,
    pub store_name: String,
    /// `BARANG` or `PEMBIAYAAN`. The client reconciles the two separately, so a
    /// figure that merged them would be one neither side could agree.
    pub kind: String,
    /// What head office's books say the shop owes it.
    pub head_office_receivable_minor: i64,
    /// What the shop's books say it owes head office.
    pub store_payable_minor: i64,
    /// Receivable less payable. Zero, always, unless something is wrong — see
    /// the module header for why that is a bug report and not a workload.
    pub difference_minor: i64,
    /// The client's own codes for the two legs, so somebody who wants to check
    /// this against their existing system can go straight to the account.
    /// Absent means the pair is unmapped and a leg would be refused.
    pub head_office_account_code: Option<String>,
    pub store_account_code: Option<String>,
}

/// One inter-unit line, with the document behind it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InterunitMovement {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub posting_date: NaiveDate,
    /// What caused it — `SUPPLIER_INVOICE`, `PAYMENT`, `ASSET_TRANSFER` — and
    /// the document's own id, so a movement links back to the paper.
    pub source_kind: String,
    pub source_id: Option<String>,
    /// Which step of that document, from migration 0140. `MAIN` for nearly all.
    pub purpose: String,
    /// Whose books the line is in, and the unit on the other side.
    pub unit_id: String,
    pub counter_unit_id: String,
    /// `BARANG` or `PEMBIAYAAN`, from the account the leg landed in. Absent for
    /// a line in an affiliate account that the map does not claim — a
    /// hand-written journal entry, which is exactly what somebody looking at an
    /// unexplained difference needs to see.
    pub kind: Option<String>,
    pub account_code: String,
    pub account_name: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub memo: Option<String>,
}

/// Every pair, both columns, and what has been moving.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InterunitReport {
    /// Head office's unit, found by its kind.
    pub head_office_unit_id: String,
    pub pairs: Vec<InterunitPair>,
    pub movements: Vec<InterunitMovement>,
    /// Pairs whose two sides disagree, as `store-03 BARANG`. Empty is the
    /// answer, and a screen should say so rather than showing an empty list.
    pub disagreeing: Vec<String>,
    /// Pairs with no mapping, as `store-07 PEMBIAYAAN`. A posting that needed
    /// one of these would be refused by `resolve_account_code`, so this is a list of
    /// entries that cannot be written yet — worth seeing before somebody tries.
    pub unmapped: Vec<String>,
}

/// The number of recent movements a screen opens with.
///
/// Twenty rather than a page: this is a check, not a ledger. Somebody who wants
/// the ledger has `/finance/accounts/{code}/ledger?unit=<head office>&counter=store-03`,
/// which is the same rows with an opening balance and a running total.
const RECENT: i64 = 20;

/// The affiliate links, one row per role, unit and family.
///
/// The link's source is the family alone (0460); the counterparty is on the
/// journal line, and the queries below take it from there.
const AFFILIATE: &str = "SELECT r.role AS semantic_key,
            r.unit_id,
            r.source_id AS kind,
            r.account_code
       FROM account_resolution r
      WHERE r.role IN ('affiliate_receivable', 'affiliate_payable')
        AND r.source_type = 'COMPANY'";

/// One side of one pair, as the sums come back.
struct Side {
    unit_id: String,
    counter_unit_id: String,
    kind: String,
    account_code: String,
    /// Debits less credits over the account. Positive on head office's asset
    /// when the store owes; negative on the store's liability for the same fact.
    net_minor: i64,
}

async fn affiliate_sides(pool: &PgPool, semantic_key: &str) -> Result<Vec<Side>, AppError> {
    // Every other unit is a possible counterparty of a linked family, and the
    // LEFT JOIN means a pair that is linked and has never been posted to comes
    // back as zero rather than not coming back. "Nothing has moved between head
    // office and store 09" and "store 09 is not set up" are different answers,
    // and a screen that showed one for the other would hide the second.
    let sql = format!(
        "WITH affiliate AS ({AFFILIATE})
         SELECT a.unit_id, c.id AS counter_unit_id, a.kind, a.account_code,
                COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS net_minor
           FROM affiliate a
           JOIN unit c ON c.id <> a.unit_id
           LEFT JOIN journal_line l
                  ON l.account_code = a.account_code AND l.unit_id = a.unit_id
                 AND l.counter_unit_id = c.id
          WHERE a.semantic_key = $1
          GROUP BY a.unit_id, c.id, a.kind, a.account_code"
    );
    let rows = sqlx::query(&sql).bind(semantic_key).fetch_all(pool).await?;
    rows.iter()
        .map(|row| {
            Ok(Side {
                unit_id: row.try_get("unit_id")?,
                counter_unit_id: row.try_get("counter_unit_id")?,
                kind: row.try_get("kind")?,
                account_code: row.try_get("account_code")?,
                net_minor: row.try_get("net_minor")?,
            })
        })
        .collect()
}

/// Every unit's id, code and name — what a pair is labelled with.
async fn unit_names(pool: &PgPool) -> Result<Vec<(String, String, String)>, AppError> {
    let rows = sqlx::query("SELECT id, code, name FROM unit")
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| Ok((row.try_get("id")?, row.try_get("code")?, row.try_get("name")?)))
        .collect()
}

/// The recent inter-unit lines, optionally narrowed to one unit.
///
/// `store` (a unit id) matches either side of the line, because a movement
/// between head office and store 03 is store 03's movement whichever leg you
/// are reading.
async fn recent_movements(
    pool: &PgPool,
    store: Option<&str>,
    limit: i64,
) -> Result<Vec<InterunitMovement>, AppError> {
    // The kind comes off the links rather than off the account code's shape. A
    // LEFT JOIN so a line in an affiliate account that no link claims still
    // appears — with no kind, which is the flag. DISTINCT because a unit's
    // receivable and payable roles land on the same leaf, and joining both
    // would list every line twice.
    let sql = format!(
        "WITH affiliate AS ({AFFILIATE})
         SELECT e.entry_id, e.entry_number, e.posting_date, e.source_kind, e.source_id,
                e.purpose, l.unit_id, l.counter_unit_id, l.account_code,
                acc.name AS account_name, af.kind,
                l.debit_minor, l.credit_minor, COALESCE(l.memo, e.memo) AS memo
           FROM journal_line l
           JOIN journal_entry e USING (entry_id)
           JOIN ledger_account acc ON acc.account_code = l.account_code
           LEFT JOIN (SELECT DISTINCT unit_id, account_code, kind FROM affiliate) af
                  ON af.account_code = l.account_code AND af.unit_id = l.unit_id
          WHERE l.counter_unit_id IS NOT NULL
            AND ($1::text IS NULL OR l.unit_id = $1 OR l.counter_unit_id = $1)
          ORDER BY e.posting_date DESC, e.entry_number DESC, l.line_number
          LIMIT $2"
    );
    let rows = sqlx::query(&sql)
        .bind(store)
        .bind(limit)
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok(InterunitMovement {
                entry_id: row.try_get("entry_id")?,
                entry_number: row.try_get("entry_number")?,
                posting_date: row.try_get("posting_date")?,
                source_kind: row.try_get("source_kind")?,
                source_id: row.try_get("source_id")?,
                purpose: row.try_get("purpose")?,
                unit_id: row.try_get("unit_id")?,
                counter_unit_id: row.try_get("counter_unit_id")?,
                kind: row.try_get("kind")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                debit_minor: row.try_get("debit_minor")?,
                credit_minor: row.try_get("credit_minor")?,
                memo: row.try_get("memo")?,
            })
        })
        .collect()
}

/// Fold the two sides into one row per (store, column).
///
/// Driven from the union of both sides rather than from either: a pair mapped
/// on head office's side and not on the shop's is precisely the setup mistake
/// this is meant to surface, and starting from one side would hide half of them.
fn pair_up(
    receivables: &[Side],
    payables: &[Side],
    names: &[(String, String, String)],
    only: Option<&str>,
    head_office: &str,
) -> Vec<InterunitPair> {
    let label_of = |id: &str| {
        names
            .iter()
            .find(|(unit, _, _)| unit == id)
            .map(|(_, code, name)| (code.clone(), name.clone()))
            .unwrap_or_else(|| (id.to_string(), id.to_string()))
    };

    let mut keys: Vec<(String, String)> = Vec::new();
    for side in receivables
        .iter()
        .filter(|s| s.unit_id == head_office)
        .map(|s| (s.counter_unit_id.clone(), s.kind.clone()))
        .chain(
            payables
                .iter()
                .filter(|s| s.counter_unit_id == head_office)
                .map(|s| (s.unit_id.clone(), s.kind.clone())),
        )
    {
        if only.is_some_and(|store| store != side.0) {
            continue;
        }
        if !keys.contains(&side) {
            keys.push(side);
        }
    }
    keys.sort();

    keys.into_iter()
        .map(|(store, kind)| {
            let receivable = receivables.iter().find(|s| {
                s.unit_id == head_office && s.counter_unit_id == store && s.kind == kind
            });
            let payable = payables.iter().find(|s| {
                s.unit_id == store && s.counter_unit_id == head_office && s.kind == kind
            });
            // Both reported positive-when-owed. The asset is already that way
            // round; the liability is negated, because a credit balance on
            // `Hutang Affiliasi` IS what the store owes.
            let receivable_minor = receivable.map(|s| s.net_minor).unwrap_or_default();
            let payable_minor = payable.map(|s| -s.net_minor).unwrap_or_default();
            let (store_code, store_name) = label_of(&store);
            InterunitPair {
                store_code,
                store_name,
                store_unit_id: store,
                kind,
                head_office_receivable_minor: receivable_minor,
                store_payable_minor: payable_minor,
                difference_minor: receivable_minor - payable_minor,
                head_office_account_code: receivable.map(|s| s.account_code.clone()),
                store_account_code: payable.map(|s| s.account_code.clone()),
            }
        })
        .collect()
}

fn flagged(pairs: &[InterunitPair]) -> (Vec<String>, Vec<String>) {
    let mut disagreeing = Vec::new();
    let mut unmapped = Vec::new();
    for pair in pairs {
        if pair.difference_minor != 0 {
            disagreeing.push(format!("{} {}", pair.store_code, pair.kind));
        }
        if pair.head_office_account_code.is_none() || pair.store_account_code.is_none() {
            unmapped.push(format!("{} {}", pair.store_code, pair.kind));
        }
    }
    (disagreeing, unmapped)
}

/// Every head-office/store pair, in both columns, with what has been moving.
pub async fn interunit_pairs(pool: &PgPool) -> Result<InterunitReport, AppError> {
    let receivables = affiliate_sides(pool, "affiliate_receivable").await?;
    let payables = affiliate_sides(pool, "affiliate_payable").await?;
    let names = unit_names(pool).await?;
    let head_office = super::sites::head_office_unit_id(pool).await?;
    let pairs = pair_up(&receivables, &payables, &names, None, &head_office);
    let (disagreeing, unmapped) = flagged(&pairs);
    Ok(InterunitReport {
        head_office_unit_id: head_office.clone(),
        movements: recent_movements(pool, None, RECENT).await?,
        pairs,
        disagreeing,
        unmapped,
    })
}

/// One store's side of it, from the store's own point of view.
///
/// The same two rows and the same two figures, narrowed — deliberately the same
/// shape rather than a smaller one, so a manager reading their own balance and
/// head office reading all thirteen are reading the same thing and cannot come
/// to different conclusions from differently-shaped numbers.
///
/// `unit` is the store's unit id. Head office is refused by its kind, not by
/// its spelling: it is the other side of every pair.
pub async fn interunit_store_view(pool: &PgPool, unit: &str) -> Result<InterunitReport, AppError> {
    let unit = unit.trim();
    let head_office = super::sites::head_office_unit_id(pool).await?;
    if unit == head_office {
        return Err(AppError::Validation(
            "head office is the other side of every pair; ask for a store, \
             or for the pairs themselves"
                .into(),
        ));
    }
    if !super::sites::unit_exists(pool, unit).await? {
        return Err(AppError::NotFound(format!("unit {unit}")));
    }

    let receivables = affiliate_sides(pool, "affiliate_receivable").await?;
    let payables = affiliate_sides(pool, "affiliate_payable").await?;
    let names = unit_names(pool).await?;
    let pairs = pair_up(&receivables, &payables, &names, Some(unit), &head_office);
    let (disagreeing, unmapped) = flagged(&pairs);
    Ok(InterunitReport {
        head_office_unit_id: head_office.clone(),
        movements: recent_movements(pool, Some(unit), RECENT).await?,
        pairs,
        disagreeing,
        unmapped,
    })
}
