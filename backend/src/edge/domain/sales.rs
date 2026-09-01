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

/// Tender-aware completion rule: change can only ever be given from CASH.
///
/// The rule is aggregate and therefore order-independent — it does not matter
/// whether the cashier keyed CASH before CARD or after: electronic tenders
/// (CARD/QRIS/OTHER) may never exceed the sale total, so any change owed is
/// covered by physical cash in the drawer.
pub fn validate_tender(
    total_minor: i64,
    cash_minor: i64,
    non_cash_minor: i64,
) -> Result<PaymentSummary, SalesError> {
    if total_minor <= 0 {
        return Err(SalesError::EmptyOrZeroSale);
    }
    if cash_minor < 0 || non_cash_minor < 0 {
        return Err(SalesError::NegativeTender);
    }
    if non_cash_minor > total_minor {
        return Err(SalesError::NonCashOverpayment {
            total: total_minor,
            non_cash: non_cash_minor,
        });
    }
    let paid_minor = cash_minor + non_cash_minor;
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

/// A refund may never exceed what the customer actually paid for the returned
/// goods, and the running refund total for a sale may never exceed the sale
/// total.
pub fn validate_refund(
    sale_total_minor: i64,
    already_refunded_minor: i64,
    refund_minor: i64,
) -> Result<(), SalesError> {
    if refund_minor < 0 || already_refunded_minor < 0 {
        return Err(SalesError::NegativeTender);
    }
    if already_refunded_minor + refund_minor > sale_total_minor {
        return Err(SalesError::RefundExceedsSale {
            sale_total: sale_total_minor,
            attempted: already_refunded_minor + refund_minor,
        });
    }
    Ok(())
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum SalesError {
    #[error("invalid payment method: {0}")]
    InvalidPaymentMethod(String),
    #[error("sale must have a positive payable total")]
    EmptyOrZeroSale,
    #[error("insufficient payment: required {required}, paid {paid}")]
    InsufficientPayment { required: i64, paid: i64 },
    #[error("tender amounts cannot be negative")]
    NegativeTender,
    #[error(
        "non-cash tender {non_cash} exceeds sale total {total}; change can only be given from cash"
    )]
    NonCashOverpayment { total: i64, non_cash: i64 },
    #[error("refund total {attempted} would exceed sale total {sale_total}")]
    RefundExceedsSale { sale_total: i64, attempted: i64 },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn change_is_only_given_from_cash() {
        // Pure cash overpay: fine, change owed.
        assert_eq!(
            validate_tender(150_000, 200_000, 0).unwrap_or_else(|e| panic!("tender: {e}")),
            PaymentSummary {
                total_minor: 150_000,
                paid_minor: 200_000,
                change_minor: 50_000
            }
        );
        // Mixed tender where non-cash stays within the total: fine.
        assert_eq!(
            validate_tender(150_000, 60_000, 100_000).unwrap_or_else(|e| panic!("tender: {e}")),
            PaymentSummary {
                total_minor: 150_000,
                paid_minor: 160_000,
                change_minor: 10_000
            }
        );
        // Electronic overpayment is refused outright.
        assert!(matches!(
            validate_tender(150_000, 0, 160_000),
            Err(SalesError::NonCashOverpayment { .. })
        ));
        // Underpayment still fails.
        assert!(matches!(
            validate_tender(150_000, 50_000, 50_000),
            Err(SalesError::InsufficientPayment { .. })
        ));
    }

    #[test]
    fn refunds_cannot_exceed_the_sale_total() {
        assert!(validate_refund(150_000, 0, 150_000).is_ok());
        assert!(validate_refund(150_000, 100_000, 50_000).is_ok());
        assert!(matches!(
            validate_refund(150_000, 100_000, 50_001),
            Err(SalesError::RefundExceedsSale { .. })
        ));
        assert!(matches!(
            validate_refund(150_000, 0, -1),
            Err(SalesError::NegativeTender)
        ));
    }

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
