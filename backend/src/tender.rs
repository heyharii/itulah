//! How a sale is paid for: the tenders, the arithmetic, and what may go wrong.
//!
//! One implementation, because it was two. `cloud::domain::sales` and
//! `edge::domain::sales` held this file byte for byte identical — the third
//! such pair found in this domain, after the line totals and the money
//! formatter. Payment arithmetic copied twice is the same hazard as rounding
//! copied twice: the two agree until one is fixed, and then a till and the
//! centre disagree about whether a basket was paid for.
//!
//! It sits above both nodes because both need exactly it, and outside
//! `pricing-engine` because what a thing costs and how it was paid for are
//! different questions — the engine says so itself.
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum PaymentMethod {
    Cash,
    Card,
    Qris,
    /// Value the shopper already held, spent against this basket.
    ///
    /// It is here rather than under `Other` because it is not a payment at
    /// all in the way the other three are: no money arrives when a voucher is
    /// presented. The money arrived when the card was sold — possibly at
    /// another shop, possibly last year — and this is the liability being
    /// settled. A takings report that cannot tell the two apart reports cash
    /// the shop never took.
    ///
    /// It buckets as non-cash below, which is the rule that matters at the
    /// counter: only cash can produce change, so a 200,000 card against a
    /// 150,000 basket leaves 50,000 on the card and nothing in the shopper's
    /// hand.
    Voucher,
    Other,
}

impl PaymentMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cash => "CASH",
            Self::Card => "CARD",
            Self::Qris => "QRIS",
            Self::Voucher => "VOUCHER",
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
            "VOUCHER" => Ok(Self::Voucher),
            "OTHER" => Ok(Self::Other),
            _ => Err(SalesError::InvalidPaymentMethod(value.into())),
        }
    }
}

/// One way a shopper handed money over.
///
/// A sale is paid by a LIST of these, not by one number. Somebody paying half
/// on a card and half in cash is ordinary, and a till that could only record
/// one of them either refuses the sale or lies about how it was settled — and
/// the lie is the one that reaches the bank reconciliation.
///
/// There is no natural id here. A tender's identity is its position in the
/// list, which is why the tables that store it key on an ordinal: a fact
/// delivered twice then overwrites the same row instead of appending a second
/// copy of one payment. That idea is taken from the reference implementations,
/// which both arrived at it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleTender {
    pub method: PaymentMethod,
    pub amount_minor: i64,
    /// A label for whoever reconciles this against a bank statement: the
    /// acquirer, the issuing bank, the wallet. An approval code belongs here
    /// too.
    ///
    /// Never an account number, never an instrument. `screen_reference`
    /// refuses anything that looks like one, and it refuses at the door rather
    /// than trusting a caller — a card number that reaches a database is a
    /// card number that has to be erased from backups.
    #[serde(default)]
    pub reference: Option<String>,
    /// The hold the centre granted against a voucher, for a `Voucher` tender.
    ///
    /// **Required for that method and refused on every other.** A voucher is
    /// scarce stored value held in one place, and a till that takes one on its
    /// own word cannot know another till is spending the same card at the same
    /// moment. Until this field existed, `complete_sale` accepted any string at
    /// all as a voucher reference: no balance read, no code checked, nobody
    /// asked. Two shops could settle two baskets against one card and neither
    /// would find out until the sales synced.
    ///
    /// Its presence is what makes the tender online-only, which is the locked
    /// V1 rule. A shop with the line down cannot obtain one and therefore
    /// cannot offer the tender — the same answer Shopify POS gives for gift
    /// cards, and for the same reason.
    ///
    /// `#[serde(default)]` so that a message written before this field existed
    /// still parses. It then fails the check below, which is the right way
    /// round: an old till is refused the tender, not trusted with it.
    #[serde(default)]
    pub voucher_authorization_id: Option<String>,
    /// Which bank's EDC — or which QRIS acquirer — took the money: `BCA`,
    /// `MANDIRI`, `BRI`, `BNI`. A name, never an instrument, screened exactly as
    /// `reference` is.
    ///
    /// The centre has had the column since migration 0106 and has been
    /// guessing it from `reference`; a card receivable cannot be cleared
    /// against the acquirer's settlement, nor a wrong-EDC swipe found, without
    /// it. Card and QRIS only — cash has no acquirer.
    #[serde(default)]
    pub acquirer: Option<String>,
    /// `DEBIT` or `CREDIT`, on a card tender only. Not read off the acquirer:
    /// BCA issues debit cards and acquires VISA credit through the same
    /// terminal, and the chart posts the two to different receivables.
    #[serde(default)]
    pub card_kind: Option<String>,
}

/// What a reference may not be.
///
/// The reference exists for reconciliation, so it holds names and approval
/// codes. A long run of digits is what a card number looks like, and there is
/// no legitimate reason for one to arrive here — an acquirer's name has
/// letters, an approval code is short.
///
/// Both reference implementations say in a comment that their contract screens
/// for this. A comment does not screen anything; this does, at the boundary
/// every sale crosses.
pub fn screen_reference(reference: &str) -> Result<(), SalesError> {
    let digits = reference.chars().filter(char::is_ascii_digit).count();
    if digits >= 12 {
        return Err(SalesError::ReferenceLooksLikeAnInstrument);
    }
    Ok(())
}

/// Validate a whole list of tenders against what is owed.
///
/// The rules are the ones [`validate_tender`] already held, applied to a list:
/// only cash may exceed the total, because only cash can produce change. A card
/// charged for more than the basket is not generosity, it is a mistake nobody
/// notices until a statement arrives.
///
/// Neither reference implementation models that distinction at all — both store
/// a list of payments and leave the arithmetic to whatever wrote it.
pub fn validate_tenders(
    total_minor: i64,
    tenders: &[SaleTender],
) -> Result<PaymentSummary, SalesError> {
    if tenders.is_empty() {
        return Err(SalesError::NoTender);
    }
    let mut cash_minor: i64 = 0;
    let mut non_cash_minor: i64 = 0;
    for tender in tenders {
        if tender.amount_minor <= 0 {
            return Err(SalesError::NegativeTender);
        }
        if let Some(reference) = tender.reference.as_deref() {
            screen_reference(reference)?;
        }
        if let Some(acquirer) = tender.acquirer.as_deref() {
            if !matches!(tender.method, PaymentMethod::Card | PaymentMethod::Qris) {
                return Err(SalesError::AcquirerOnWrongTender);
            }
            let acquirer = acquirer.trim();
            if acquirer.is_empty() || acquirer.chars().count() > 40 {
                return Err(SalesError::InvalidAcquirer);
            }
            screen_reference(acquirer)?;
        }
        if let Some(kind) = tender.card_kind.as_deref() {
            if tender.method != PaymentMethod::Card {
                return Err(SalesError::CardKindOnWrongTender);
            }
            if !matches!(kind.trim().to_ascii_uppercase().as_str(), "DEBIT" | "CREDIT") {
                return Err(SalesError::InvalidCardKind(kind.into()));
            }
        }
        // Stored value needs the centre's word, and only stored value does.
        match tender.method {
            PaymentMethod::Voucher => {
                let held = tender
                    .voucher_authorization_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|one| !one.is_empty());
                if held.is_none() {
                    return Err(SalesError::VoucherNotAuthorised);
                }
            }
            // Carrying a hold on a cash tender is not a harmless extra field:
            // it is a basket whose author believed a voucher was being taken.
            _ if tender.voucher_authorization_id.is_some() => {
                return Err(SalesError::AuthorisationOnWrongTender);
            }
            _ => {}
        }
        let bucket = match tender.method {
            PaymentMethod::Cash => &mut cash_minor,
            _ => &mut non_cash_minor,
        };
        *bucket = bucket
            .checked_add(tender.amount_minor)
            .ok_or(SalesError::TenderOverflow)?;
    }
    validate_tender(total_minor, cash_minor, non_cash_minor)
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
/// whether the cashier keyed CASH before CARD or after: every non-cash tender
/// (CARD/QRIS/VOUCHER/OTHER) may never exceed the sale total, so any change
/// owed is covered by physical cash in the drawer.
///
/// VOUCHER sits on that side for a reason of its own rather than by analogy to
/// a card. A gift card over-presented against a smaller basket must leave the
/// remainder ON THE CARD, which is what a shopper expects and what the balance
/// in `voucher` is for; paying it out of the drawer would turn stored value
/// into cash the shop never took, and it is how a gift card becomes a way to
/// launder a refund.
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
    #[error("a sale must say how it was paid for")]
    NoTender,
    #[error("the tenders add up to more than can be counted")]
    TenderOverflow,
    #[error("a payment reference must not look like a card number")]
    ReferenceLooksLikeAnInstrument,
    #[error(
        "non-cash tender {non_cash} exceeds sale total {total}; change can only be given from cash"
    )]
    NonCashOverpayment { total: i64, non_cash: i64 },
    #[error("refund total {attempted} would exceed sale total {sale_total}")]
    RefundExceedsSale { sale_total: i64, attempted: i64 },
    #[error(
        "a voucher has to be authorised by the centre before it can settle a basket — \
         the tender is unavailable while this shop is offline"
    )]
    VoucherNotAuthorised,
    #[error("only a voucher tender carries an authorisation")]
    AuthorisationOnWrongTender,
    #[error("only a card or QRIS tender names an acquirer")]
    AcquirerOnWrongTender,
    #[error("an acquirer is a short name such as BCA or MANDIRI")]
    InvalidAcquirer,
    #[error("only a card tender says whether it was debit or credit")]
    CardKindOnWrongTender,
    #[error("card kind must be DEBIT or CREDIT, not {0}")]
    InvalidCardKind(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tender(method: PaymentMethod, acquirer: Option<&str>, kind: Option<&str>) -> SaleTender {
        SaleTender {
            method,
            amount_minor: 100_000,
            reference: None,
            voucher_authorization_id: None,
            acquirer: acquirer.map(Into::into),
            card_kind: kind.map(Into::into),
        }
    }

    #[test]
    fn an_acquirer_and_a_card_kind_ride_only_where_they_mean_something() {
        assert!(validate_tenders(100_000, &[tender(PaymentMethod::Card, Some("BCA"), Some("DEBIT"))]).is_ok());
        assert!(validate_tenders(100_000, &[tender(PaymentMethod::Qris, Some("MANDIRI"), None)]).is_ok());
        assert_eq!(
            validate_tenders(100_000, &[tender(PaymentMethod::Cash, Some("BCA"), None)]),
            Err(SalesError::AcquirerOnWrongTender)
        );
        assert_eq!(
            validate_tenders(100_000, &[tender(PaymentMethod::Qris, Some("BCA"), Some("DEBIT"))]),
            Err(SalesError::CardKindOnWrongTender)
        );
        assert_eq!(
            validate_tenders(100_000, &[tender(PaymentMethod::Card, Some("BCA"), Some("PREPAID"))]),
            Err(SalesError::InvalidCardKind("PREPAID".into()))
        );
        assert_eq!(
            validate_tenders(100_000, &[tender(PaymentMethod::Card, Some("4111 1111 1111 1111"), None)]),
            Err(SalesError::ReferenceLooksLikeAnInstrument),
            "an acquirer is screened like a reference"
        );
    }

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
