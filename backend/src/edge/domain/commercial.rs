use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CommercialChannel {
    Store,
    Online,
    Marketplace,
}

impl CommercialChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Store => "STORE",
            Self::Online => "ONLINE",
            Self::Marketplace => "MARKETPLACE",
        }
    }
}

impl fmt::Display for CommercialChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for CommercialChannel {
    type Err = CommercialError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_uppercase().as_str() {
            "STORE" => Ok(Self::Store),
            "ONLINE" => Ok(Self::Online),
            "MARKETPLACE" => Ok(Self::Marketplace),
            _ => Err(CommercialError::InvalidChannel(value.into())),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CurrencyCode(String);

impl CurrencyCode {
    pub fn new(value: impl Into<String>) -> Result<Self, CommercialError> {
        let value = value.into().to_ascii_uppercase();
        if value.len() != 3 || !value.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(CommercialError::InvalidCurrency(value));
        }
        Ok(Self(value))
    }

    pub fn idr() -> Self {
        Self("IDR".into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CurrencyCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PublicationStatus {
    Draft,
    Published,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ResolvedOffer {
    pub publication_id: Uuid,
    pub version: i64,
    pub sku_id: Uuid,
    pub site_id: String,
    pub channel: CommercialChannel,
    pub sellable: bool,
    pub currency: CurrencyCode,
    pub unit_price_minor: i64,
    pub tax_category: String,
    pub tax_rate_bps: i32,
    pub tax_inclusive: bool,
    pub effective_from: DateTime<Utc>,
    pub effective_to: Option<DateTime<Utc>>,
}

/// What a line comes to, once tax has had its say.
///
/// Re-exported rather than implemented. This function and its tests stood here
/// and in the other node's `domain::commercial`, character for character — two
/// copies of one rounding rule, which agree until somebody fixes one of them.
pub use crate::tax::{calculate_line_totals, LineTotals, TaxError};

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CommercialError {
    #[error("invalid commercial channel: {0}")]
    InvalidChannel(String),
    #[error("invalid ISO-style currency code: {0}")]
    InvalidCurrency(String),
}
