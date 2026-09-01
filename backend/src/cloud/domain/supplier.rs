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
    pub status: SupplierStatus,
    pub version: i64,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
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
