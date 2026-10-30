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
    /// The chart's name for that account, read with it (never stored here).
    /// Absent on a read that did not join the chart.
    #[serde(default)]
    pub expense_account_name: Option<String>,
    /// What we buy from them, one of [`SUPPLIER_KINDS`] (0981). Set by a
    /// person, or taken from the account's kind when nobody said; absent on
    /// a merchandise supplier, whose bills debit stock.
    #[serde(default)]
    pub kind: Option<String>,
    /// Nomor Pokok Wajib Pajak, as printed on the faktur — punctuation and
    /// all. Stored as typed because it is copied onto documents rather than
    /// matched on, and one company has exactly one. See migration 0302.
    pub npwp: Option<String>,
    /// Whether this supplier is a Pengusaha Kena Pajak, and so whether their
    /// bills carry PPN and a faktur number.
    ///
    /// A separate fact from holding an NPWP, deliberately: a supplier can hold
    /// one and not be a taxable enterprise, and a form that infers one from
    /// the other cannot record that.
    pub is_pkp: bool,
    /// The `payment_terms_template` an order to this supplier is raised with
    /// unless the buyer says otherwise.
    ///
    /// A DEFAULT and only that. The composer copies it onto the order the
    /// moment a supplier is chosen; from there it is the order's own schedule.
    pub default_payment_terms_code: Option<String>,
    /// `PT`, `CV` or `UD` — what kind of company this is, printed after the
    /// name ("Sepatu Sejahtera, CV"). Absent on suppliers nobody has asked.
    /// See migration 0392.
    pub legal_form: Option<String>,
    /// Free text the buyer keeps on the record.
    pub notes: Option<String>,
    pub version: i64,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

/// What a non-merchandise supplier is for, the way GA says it. The CHECK on
/// `supplier.kind` says the same.
pub const SUPPLIER_KINDS: [&str; 8] = [
    "UTILITIES",
    "CLEANING",
    "WORKSHOP",
    "AC",
    "LOGISTICS",
    "OFFICE",
    "LANDLORD",
    "OTHER",
];

/// The legal forms a supplier may name. The CHECK on `supplier.legal_form`
/// says the same; this says it before the row is written, with a sentence.
pub const SUPPLIER_LEGAL_FORMS: [&str; 3] = ["PT", "CV", "UD"];

/// A legal form as typed, uppercased and checked, or None for a blank one.
pub fn normalize_legal_form(value: Option<String>) -> Result<Option<String>, SupplierCatalogError> {
    let Some(text) = optional_supplier_text(value) else {
        return Ok(None);
    };
    let upper = text.to_uppercase();
    if SUPPLIER_LEGAL_FORMS.contains(&upper.as_str()) {
        Ok(Some(upper))
    } else {
        Err(SupplierCatalogError::UnknownLegalForm(text))
    }
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
    /// Read from the linked article (`internal_article_code`), never kept
    /// here: units belong to the goods, not to who sells them (0653). Empty
    /// and null while the item is linked to no article yet.
    #[serde(default)]
    pub article_units: Vec<crate::cloud::domain::uom::ItemUnit>,
    #[serde(default)]
    pub stock_unit_code: Option<String>,
    /// What a new order line for it starts in (ERPNext `purchase_uom`).
    #[serde(default)]
    pub purchase_unit_code: Option<String>,
    pub status: SupplierStatus,
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

/// A supplier's telephone numbers, as the one `phone` column keeps them: each
/// number on its own, joined by ", ". The form offers a row a number; a pasted
/// "0812 3456 7890; 021-555-1234" or one number a line reads the same way.
///
/// Shape, not existence — the same rule the form applies: a run of digits
/// shorter than 8 or longer than 15 is no phone number, and is refused with the
/// number named. The same number twice is the same statement made twice, so it
/// is kept once. Blank means none: `Ok(None)`.
pub fn normalize_supplier_phones(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = optional_supplier_text(value) else {
        return Ok(None);
    };
    let mut kept: Vec<String> = Vec::new();
    for part in raw.split([',', ';', '\n']) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let digits = part.chars().filter(char::is_ascii_digit).count();
        if digits < 8 {
            return Err(format!("phone number '{part}' is too short"));
        }
        if digits > 15 {
            return Err(format!("phone number '{part}' is too long"));
        }
        let only_digits = |text: &str| {
            text.chars()
                .filter(char::is_ascii_digit)
                .collect::<String>()
        };
        if !kept.iter().any(|one| only_digits(one) == only_digits(part)) {
            kept.push(part.to_owned());
        }
    }
    Ok((!kept.is_empty()).then(|| kept.join(", ")))
}

#[cfg(test)]
mod phone_tests {
    use super::normalize_supplier_phones as phones;

    #[test]
    fn several_numbers_become_one_clean_list() {
        assert_eq!(
            phones(Some("0812 3456 7890;021-555-1234\n 0812 3456 7890".into())),
            Ok(Some("0812 3456 7890, 021-555-1234".into()))
        );
    }

    #[test]
    fn blank_is_none_and_nonsense_is_refused() {
        assert_eq!(phones(Some("  ,; ".into())), Ok(None));
        assert_eq!(phones(None), Ok(None));
        assert!(phones(Some("0812 3456 7890, 12".into())).is_err());
        assert!(phones(Some("1234567890123456".into())).is_err());
    }
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
    #[error("legal form must be PT, CV or UD, not {0}")]
    UnknownLegalForm(String),
}
