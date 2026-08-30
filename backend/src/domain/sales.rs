use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SaleStatus {
    Open,
    Completed,
    Voided,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentMethod {
    Cash,
    Card,
    Qris,
    Other,
}

impl PaymentMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cash => "CASH",
            Self::Card => "CARD",
            Self::Qris => "QRIS",
            Self::Other => "OTHER",
        }
    }
}

impl fmt::Display for PaymentMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for PaymentMethod {
    type Err = SalesError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_uppercase().as_str() {
            "CASH" => Ok(Self::Cash),
            "CARD" => Ok(Self::Card),
            "QRIS" => Ok(Self::Qris),
            "OTHER" => Ok(Self::Other),
            _ => Err(SalesError::InvalidPaymentMethod(value.into())),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PaymentSummary {
    pub total_minor: i64,
    pub paid_minor: i64,
    pub change_minor: i64,
}

pub fn validate_payment(total_minor: i64, paid_minor: i64) -> Result<PaymentSummary, SalesError> {
    if total_minor <= 0 {
        return Err(SalesError::EmptyOrZeroSale);
    }
    if paid_minor < total_minor {
        return Err(SalesError::InsufficientPayment {
            required: total_minor,
            paid: paid_minor,
        });
    }
    Ok(PaymentSummary {
        total_minor,
        paid_minor,
        change_minor: paid_minor - total_minor,
    })
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum SalesError {
    #[error("invalid payment method: {0}")]
    InvalidPaymentMethod(String),
    #[error("sale must have a positive payable total")]
    EmptyOrZeroSale,
    #[error("insufficient payment: required {required}, paid {paid}")]
    InsufficientPayment { required: i64, paid: i64 },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_requires_full_payment() {
        assert!(matches!(
            validate_payment(150_000, 100_000),
            Err(SalesError::InsufficientPayment { .. })
        ));
        assert_eq!(
            validate_payment(150_000, 200_000).unwrap_or_else(|e| panic!("payment: {e}")),
            PaymentSummary {
                total_minor: 150_000,
                paid_minor: 200_000,
                change_minor: 50_000
            }
        );
    }
}
