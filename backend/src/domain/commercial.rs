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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LineTotals {
    pub net_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
}

pub fn calculate_line_totals(
    unit_price_minor: i64,
    quantity: i64,
    tax_rate_bps: i32,
    tax_inclusive: bool,
) -> Result<LineTotals, CommercialError> {
    if unit_price_minor < 0 {
        return Err(CommercialError::NegativePrice);
    }
    if quantity <= 0 {
        return Err(CommercialError::NonPositiveQuantity);
    }
    if !(0..=100_000).contains(&tax_rate_bps) {
        return Err(CommercialError::InvalidTaxRate);
    }
    let base = i128::from(unit_price_minor)
        .checked_mul(i128::from(quantity))
        .ok_or(CommercialError::MoneyOverflow)?;
    let rate = i128::from(tax_rate_bps);
    let (net, tax, total) = if tax_inclusive {
        let tax = base
            .checked_mul(rate)
            .ok_or(CommercialError::MoneyOverflow)?
            / (10_000 + rate);
        (base - tax, tax, base)
    } else {
        let tax = base
            .checked_mul(rate)
            .ok_or(CommercialError::MoneyOverflow)?
            / 10_000;
        (base, tax, base + tax)
    };
    Ok(LineTotals {
        net_minor: i64::try_from(net).map_err(|_| CommercialError::MoneyOverflow)?,
        tax_minor: i64::try_from(tax).map_err(|_| CommercialError::MoneyOverflow)?,
        total_minor: i64::try_from(total).map_err(|_| CommercialError::MoneyOverflow)?,
    })
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CommercialError {
    #[error("invalid commercial channel: {0}")]
    InvalidChannel(String),
    #[error("invalid ISO-style currency code: {0}")]
    InvalidCurrency(String),
    #[error("unit price cannot be negative")]
    NegativePrice,
    #[error("quantity must be positive")]
    NonPositiveQuantity,
    #[error("tax rate basis points are outside the supported range")]
    InvalidTaxRate,
    #[error("money arithmetic overflow")]
    MoneyOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inclusive_tax_is_deterministic_integer_math() {
        let totals = calculate_line_totals(111_000, 2, 1_100, true)
            .unwrap_or_else(|e| panic!("totals: {e}"));
        assert_eq!(totals.total_minor, 222_000);
        assert_eq!(totals.tax_minor, 22_000);
        assert_eq!(totals.net_minor, 200_000);
    }

    #[test]
    fn exclusive_tax_adds_to_payable_total() {
        let totals = calculate_line_totals(100_000, 2, 1_100, false)
            .unwrap_or_else(|e| panic!("totals: {e}"));
        assert_eq!(
            totals,
            LineTotals {
                net_minor: 200_000,
                tax_minor: 22_000,
                total_minor: 222_000
            }
        );
    }
}
