//! Head office matched a sale the till could not take from its own stock, to a
//! piece held by a site whose ledger a node keeps.
//!
//! Owner, 23 Oct 2026: a piece the till cannot take from its own store's stock
//! still sells, and the sale belongs to the store where the shopper paid. Head
//! office later matches it to a piece at a store or at HO, and that piece
//! leaves that place's stock. When the place is a shop with its own server the
//! centre cannot write that ledger — the node's ledger is its own to write — so
//! it tells the node which piece to let go of, and the node writes the SALE
//! movement itself. The movement then travels up like any other.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// SKU typed off the label, and the selling shop holds one on hand.
pub const KIND_NO_TAG: &str = "NO_TAG";
/// SKU typed off the label, and the selling shop holds none.
pub const KIND_NOT_IN_STOCK: &str = "NOT_IN_STOCK";
/// A tag read that the selling shop does not hold.
pub const KIND_OTHER: &str = "OTHER";
/// No tag and no SKU: the Kepala toko named and priced it.
pub const KIND_UNKNOWN: &str = "UNKNOWN";
pub const KINDS: [&str; 4] = [KIND_NO_TAG, KIND_NOT_IN_STOCK, KIND_OTHER, KIND_UNKNOWN];

/// One unmatched line of a sale, as it travels on `sales.completed`
/// (`unmatched`, `#[serde(default)]` — a fact from an older build has none).
///
/// Nothing moved for it at the shop: the sale's `lines` are the pieces that
/// left its stock, and these are the rest of what the shopper paid for. The
/// sale's total is both — `lines` + `unmatched` + charges — and the centre
/// re-sums them the same way.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SaleFactUnmatched {
    /// Minted by the shop, and the line's id at head office too: a resent fact
    /// lands on the same row.
    pub id: Uuid,
    /// Its position on the sale, from nought.
    pub line_no: i32,
    /// One of [`KINDS`].
    pub kind: String,
    /// Absent only on an UNKNOWN line.
    #[serde(default)]
    pub sku_code: Option<String>,
    /// The tag that was read, on an OTHER line (and on a typed line when the
    /// till had one).
    #[serde(default)]
    pub epc: Option<String>,
    /// UNKNOWN only: what the Kepala toko called it.
    #[serde(default)]
    pub name: Option<String>,
    /// Where an OTHER tag stood, when the shop knew ("In transit" for a piece
    /// of a delivery on its way to it). Absent is "not this shop's".
    #[serde(default)]
    pub from_place: Option<String>,
    /// What one came to before any promotion.
    pub unit_price_minor: i64,
    /// What the line was charged, promotions included. An UNKNOWN line is
    /// charged its given price, outside promotions and points.
    pub line_total_minor: i64,
    /// Absent is NOT RECORDED, never nought — as on a sold line.
    #[serde(default)]
    pub net_ex_tax_minor: Option<i64>,
    #[serde(default)]
    pub tax_minor: Option<i64>,
    #[serde(default)]
    pub points_earned: Option<i64>,
    /// `PRICE_BOOK`, `INTAKE_PRICE`, `CATALOGUE_PRICE`, `GIVEN_PRICE`, or
    /// whatever the engine said.
    #[serde(default)]
    pub price_source: Option<String>,
    /// UNKNOWN only: the Kepala toko who approved the name and the price.
    #[serde(default)]
    pub priced_by: Option<String>,
    /// The receipt number as the till printed it (`till::receipt_number`).
    #[serde(default)]
    pub receipt_no: Option<String>,
    /// The seat's label — `Kasir 1` — when the cashier had a shift open.
    #[serde(default)]
    pub till: Option<String>,
}

impl SaleFactUnmatched {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_nil() {
            return Err("an unmatched sale line needs its id".into());
        }
        if self.line_no < 0 {
            return Err(format!(
                "unmatched line {} has a negative position",
                self.id
            ));
        }
        if !KINDS.contains(&self.kind.as_str()) {
            return Err(format!(
                "unmatched line {} has unknown kind {}",
                self.id, self.kind
            ));
        }
        let blank = |value: Option<&str>| value.map(str::trim).is_none_or(str::is_empty);
        if self.kind == KIND_UNKNOWN {
            if blank(self.name.as_deref()) || blank(self.priced_by.as_deref()) {
                return Err(format!(
                    "unknown item {} needs the name and the Kepala toko who priced it",
                    self.id
                ));
            }
        } else if blank(self.sku_code.as_deref()) {
            return Err(format!("unmatched line {} names no SKU", self.id));
        }
        if self.unit_price_minor < 0 || self.line_total_minor < 0 {
            return Err(format!("unmatched line {} has a negative price", self.id));
        }
        Ok(())
    }
}

/// Every unmatched line of a sale checked, and what they come to together —
/// the figure the centre adds to the sold lines before comparing with the
/// sale's total.
pub fn unmatched_total(lines: &[SaleFactUnmatched]) -> Result<i64, String> {
    let mut positions = std::collections::BTreeSet::new();
    let mut ids = std::collections::BTreeSet::new();
    let mut total = 0_i64;
    for line in lines {
        line.validate()?;
        if !positions.insert(line.line_no) || !ids.insert(line.id) {
            return Err("two unmatched lines of a sale share a position or an id".into());
        }
        total = total
            .checked_add(line.line_total_minor)
            .ok_or_else(|| "unmatched lines overflow".to_string())?;
    }
    Ok(total)
}

/// Cloud → the node that keeps the matched place's stock: one piece of this
/// SKU leaves for the customer.
///
/// Sent only to a node whose heartbeat carries
/// [`UNMATCHED_SALE_TAKE_CAPABILITY`]: an unknown command blocks a node's whole
/// stream, so a shop on an older build is told once it has updated.
pub const INVENTORY_UNMATCHED_SALE_TAKE_V1: &str = "inventory.unmatched_sale.take.v1";

/// What a node's heartbeat carries once its build takes
/// [`INVENTORY_UNMATCHED_SALE_TAKE_V1`].
pub const UNMATCHED_SALE_TAKE_CAPABILITY: &str = "inventory.unmatched_sale_take.v1";

/// The reference a matched piece's SALE movement carries, at the centre and at
/// a node: `UNMATCHED_SALE` / the unmatched line's id.
pub const UNMATCHED_SALE_REFERENCE: &str = "UNMATCHED_SALE";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UnmatchedSaleTakePayload {
    /// The unmatched line's id: one take per line, and the key a replay is
    /// recognised by.
    pub take_id: Uuid,
    /// The site whose stock gives the piece. A node addressed for another site
    /// ignores the command rather than taking from its own shelves.
    pub site_id: String,
    pub sku_code: String,
    /// The piece head office saw on hand there, when it saw one. The node takes
    /// that one if it still holds it, and any piece of the SKU otherwise: the
    /// centre's view of a shop's shelf is only as fresh as its last upload.
    #[serde(default)]
    pub epc: Option<String>,
    /// The sale it was matched to, for the movement's reason.
    pub sale_id: Uuid,
    pub sold_at_site_id: String,
    #[serde(default)]
    pub receipt_no: Option<String>,
    /// Who at head office matched it.
    pub matched_by: String,
}

impl UnmatchedSaleTakePayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.take_id.is_nil() || self.sale_id.is_nil() {
            return Err("an unmatched sale take names its line and its sale".into());
        }
        for (field, value) in [
            ("site_id", self.site_id.as_str()),
            ("sku_code", self.sku_code.as_str()),
            ("sold_at_site_id", self.sold_at_site_id.as_str()),
            ("matched_by", self.matched_by.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(format!("an unmatched sale take needs {field}"));
            }
        }
        if self.epc.as_deref().is_some_and(|epc| epc.trim().is_empty()) {
            return Err("an unmatched sale take's EPC cannot be blank".into());
        }
        Ok(())
    }
}

pub fn parse_unmatched_sale_take(
    value: &serde_json::Value,
) -> Result<UnmatchedSaleTakePayload, String> {
    let payload: UnmatchedSaleTakePayload =
        serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    payload.validate()?;
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_take_without_its_line_is_refused() {
        let payload = serde_json::json!({
            "take_id": Uuid::nil(),
            "site_id": "store-07",
            "sku_code": "00011020453",
            "sale_id": Uuid::new_v4(),
            "sold_at_site_id": "store-03",
            "matched_by": "hq-admin",
        });
        assert!(parse_unmatched_sale_take(&payload).is_err());
    }

    #[test]
    fn a_take_reads_back_what_it_said() {
        let take_id = Uuid::new_v4();
        let payload = serde_json::json!({
            "take_id": take_id,
            "site_id": "store-07",
            "sku_code": "00011020453",
            "epc": "A00011020453000000000001",
            "sale_id": Uuid::new_v4(),
            "sold_at_site_id": "store-03",
            "receipt_no": "STORE-03-20261023-ABC123",
            "matched_by": "hq-admin",
        });
        let parsed = parse_unmatched_sale_take(&payload).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(parsed.take_id, take_id);
        assert_eq!(parsed.epc.as_deref(), Some("A00011020453000000000001"));
    }
}
