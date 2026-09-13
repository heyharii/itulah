use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum SupplierStatus {
    /// A supplier is usable until somebody says otherwise.
    #[default]
    Active,
    Inactive,
}

impl SupplierStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Inactive => "INACTIVE",
        }
    }
}

impl fmt::Display for SupplierStatus {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for SupplierStatus {
    type Err = SupplierCatalogError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_uppercase().as_str() {
            "ACTIVE" => Ok(Self::Active),
            "INACTIVE" => Ok(Self::Inactive),
            _ => Err(SupplierCatalogError::InvalidStatus(value.to_owned())),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Supplier {
    pub supplier_id: Uuid,
    pub supplier_code: String,
    pub supplier_code_normalized: String,
    pub name: String,
    pub contact_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub status: SupplierStatus,
    /// Which book this party is in: `MERCHANDISE`, `EXPENSE` or `AFFILIATE`.
    ///
    /// A word rather than an enum, and that is a deliberate limit on how much
    /// this knows: the categories are a business distinction the client's
    /// chart of accounts drew (see migration 0212), and the one place they are
    /// checked is the CHECK constraint that stores them.
    pub category: String,
    /// The account this party's bills usually debit. Only a non-merchandise
    /// party has one — merchandise debits inventory by rule.
    pub expense_account_code: Option<String>,
    pub version: i64,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierItem {
    pub supplier_item_id: Uuid,
    pub supplier_id: Uuid,
    pub supplier_item_code: String,
    pub supplier_item_code_normalized: String,
    pub name: String,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub unit_price_minor: i64,
    pub currency: String,
    pub internal_article_code: Option<String>,
    /// Which part of the range this belongs to, in the same vocabulary our own
    /// articles use — so a supplier's shirt and our shirt are the same word.
    /// `None` means nobody has classified it, which is a real state.
    #[serde(default)]
    pub division_code: Option<String>,
    /// What kind of thing it is. Empty means unclassified, not untagged-on-
    /// purpose.
    #[serde(default)]
    pub tags: Vec<String>,
    /// What it comes in. Empty means nobody has broken this item down into
    /// variants — most of a scraped supplier feed is exactly that — and never
    /// "comes in no colour".
    ///
    /// Carried with the label and the hex rather than as bare codes, because
    /// every reader of this draws a swatch beside a word and would otherwise
    /// have to fetch the colour master to do it. Tags stay bare codes for the
    /// opposite reason: a tag is read out loud from a vocabulary the screen
    /// already holds, and there is nothing to draw.
    #[serde(default)]
    pub colours: Vec<SupplierItemColour>,
    /// Size codes from the `size_code` master, in size order — so the ends of
    /// the list are the ends of the range, and "S–XXL" is the first and the
    /// last rather than a sort every reader has to redo.
    #[serde(default)]
    pub size_codes: Vec<String>,
    pub status: SupplierStatus,
    /// Which book this party is in: `MERCHANDISE`, `EXPENSE` or `AFFILIATE`.
    ///
    /// A word rather than an enum, and that is a deliberate limit on how much
    /// this knows: the categories are a business distinction the client's
    /// chart of accounts drew (see migration 0212), and the one place they are
    /// checked is the CHECK constraint that stores them.
    pub category: String,
    /// The account this party's bills usually debit. Only a non-merchandise
    /// party has one — merchandise debits inventory by rule.
    pub expense_account_code: Option<String>,
    pub version: i64,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

/// One colour a supplier offers an item in, named from the colour master.
///
/// The same three fields an article's colourway carries, and deliberately so:
/// a buyer comparing what a supplier sells against what we already stock is
/// looking at two rows of dots, and two shapes for one idea would be two
/// components drawing them slightly differently.
///
/// `hex_code` stays optional. A colour can be named and used long before
/// anybody decides which pixel value stands for it, and a screen draws an
/// empty ring for that rather than inventing a grey.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierItemColour {
    pub colour_code: String,
    pub label: String,
    pub hex_code: Option<String>,
}

pub fn required_supplier_text(
    field: &'static str,
    value: impl Into<String>,
) -> Result<String, SupplierCatalogError> {
    let value = value.into().trim().to_owned();
    if value.is_empty() {
        return Err(SupplierCatalogError::BlankField(field));
    }
    Ok(value)
}

pub fn optional_supplier_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_owned();
        (!value.is_empty()).then_some(value)
    })
}

/// Tag codes, uppercased and de-duplicated, order preserved.
///
/// De-duplication matters because `supplier_item_tag` is keyed on
/// `(supplier_item_id, tag_code)`: the same tag twice in one request is not a
/// conflict the caller should have to hear about, it is the same statement
/// made twice. Blanks are dropped rather than refused for the same reason —
/// a trailing comma in a feed is not a validation event.
///
/// Unknown codes are NOT filtered here. Whether a code exists is a question
/// for the database, and answering it by silently dropping the tag would turn
/// a typo into a row that quietly fails to appear under its own filter.
pub fn normalize_tag_codes(tags: Vec<String>) -> Result<Vec<String>, SupplierCatalogError> {
    let mut seen = Vec::with_capacity(tags.len());
    for tag in tags {
        let tag = tag.trim().to_uppercase();
        if tag.is_empty() || seen.contains(&tag) {
            continue;
        }
        seen.push(tag);
    }
    Ok(seen)
}

pub fn normalize_supplier_code(
    field: &'static str,
    value: &str,
) -> Result<String, SupplierCatalogError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(SupplierCatalogError::BlankField(field));
    }
    Ok(value.to_uppercase())
}

pub fn validate_supplier_item_price(
    unit_price_minor: i64,
    currency: &str,
) -> Result<String, SupplierCatalogError> {
    if unit_price_minor < 0 {
        return Err(SupplierCatalogError::NegativePrice);
    }
    let currency = currency.trim().to_ascii_uppercase();
    if currency != "IDR" {
        return Err(SupplierCatalogError::UnsupportedCurrency(currency));
    }
    Ok(currency)
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum SupplierCatalogError {
    #[error("{0} cannot be blank")]
    BlankField(&'static str),
    #[error("invalid Supplier Catalog status: {0}")]
    InvalidStatus(String),
    #[error("unit price cannot be negative")]
    NegativePrice,
    #[error("Supplier Catalog V1 only supports IDR, not {0}")]
    UnsupportedCurrency(String),
}
