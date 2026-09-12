use chrono::{DateTime, Utc};
use pricing_engine::rule::{Applicability, Rule};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
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

// ---------------------------------------------------------------------------
// What a started promotion covers.

/// The products a rule resolved to when its window opened.
///
/// See `COMMAND_COMMERCIAL_ELIGIBILITY` for how it reaches a shop and
/// `postgres::eligibility` for how the centre works it out.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FrozenEligibility {
    /// What `scope.applicability` resolved to.
    pub applies_to: BTreeSet<String>,
    /// What `scope.effect_on` resolved to, when the rule had one. `None` and
    /// an empty set are different: the first means the rule never had a second
    /// scope, the second means it had one that matched nothing.
    pub effect_on: Option<BTreeSet<String>>,
}

/// Replace a rule's product scopes with the set it resolved to when it started.
///
/// **This is the single definition of "a started promotion's membership does
/// not move".** The centre calls it while building its own snapshot and a shop
/// calls it while building the till's, so there is one answer to who is in an
/// offer rather than two that agree until somebody edits an article.
///
/// It amends a COPY of the rule as the snapshot is built. Nothing is written:
/// the document the shop holds is the one that was published, and the frozen
/// set is a separate fact applied over it — the same shape `caps` already uses
/// to fold in usage counts at the same moment.
///
/// # What it deliberately leaves alone
///
/// [`Applicability::WholeCart`] and a rule with no applicability at all: the
/// basket is their subject and no product is "in" or "out" of them, so there is
/// nothing a SKU set could say. Forcing one into a snapshot would invent a
/// membership the rule never had.
///
/// `excluded_sku_codes` is untouched. It is a carve-out the author made, not a
/// membership the catalogue decided, and a hole that could be closed by a
/// freeze would be a hole that healed itself.
pub fn narrow_to_frozen(rule: &mut Rule, frozen: &FrozenEligibility) {
    if let Some(applicability) = rule.scope.applicability.as_mut() {
        if is_product_scope(applicability) {
            *applicability = Applicability::Sku {
                sku_codes: frozen.applies_to.clone(),
            };
        }
    }
    if let (Some(effect_on), Some(codes)) = (rule.scope.effect_on.as_mut(), &frozen.effect_on) {
        if is_product_scope(effect_on) {
            *effect_on = Applicability::Sku {
                sku_codes: codes.clone(),
            };
        }
    }
}

/// Whether a selector names products at all — the question of whether there is
/// anything to freeze.
pub fn is_product_scope(applicability: &Applicability) -> bool {
    !matches!(applicability, Applicability::WholeCart)
}
