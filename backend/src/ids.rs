//! The ids both nodes use, in one place.
//!
//! `SiteId` used to exist twice — once under `cloud::domain`, once under
//! `edge::domain` — and each copy decided what a site WAS from how its id was
//! spelled: `dc` and `dc-…` were the warehouse, `store-…` a shop. The two
//! copies disagreed (the centre refused `dc-01`, the edge accepted it), and
//! both were wrong in the same way: an id is a label. Owner's ruling of
//! 2026-09-27 — everything is read from data, and no code may derive meaning
//! from an id.
//!
//! So an id here knows only its SHAPE. What kind of site it names is read
//! from the row it names: the centre's `site.kind`, and on an edge node what
//! head office told it about its own site (`edge::site_profile`) and the role
//! it was enrolled with. The organisational unit id and the node id belong in
//! this module too when they become types of their own.

use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

/// The longest site id admitted. Generous for a label, short enough that it
/// fits in a pool id, a log line and a URL without anybody truncating it.
pub const SITE_ID_MAX_LEN: usize = 64;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
// A site id is a string on the wire and must stay one in TypeScript: the
// browser has no business reconstructing the rules that make it valid.
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "contract/", type = "string")
)]
pub struct SiteId(String);

#[derive(Debug, Error, PartialEq)]
pub enum SiteIdError {
    #[error(
        "a site id is 1 to 64 lowercase letters, digits, '-' or '_', and starts with a letter or digit"
    )]
    Invalid,
}

impl SiteId {
    /// Trimmed and lower-cased, then checked for shape and nothing else.
    ///
    /// The characters are the ones a pool id can carry without ambiguity: a
    /// pool is `{site}.{stage}` and a place `{pool}:{state}`, so `.`, `:` and
    /// `/` can never appear in the site half.
    pub fn new(value: impl Into<String>) -> Result<Self, SiteIdError> {
        let value = value.into().trim().to_ascii_lowercase();
        let starts_well = value
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit());
        if !starts_well
            || value.len() > SITE_ID_MAX_LEN
            || !value.chars().all(|character| {
                character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || character == '-'
                    || character == '_'
            })
        {
            return Err(SiteIdError::Invalid);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SiteId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for SiteId {
    type Err = SiteIdError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

/// What a site is, as its row says — never as its id is spelled.
///
/// The centre reads it from `site.kind` (`HO`, `STORE`); an edge node reads it
/// from what head office sent it about its own site, or, before it has heard,
/// from the role it was enrolled with. There is deliberately no way to get one
/// from a `SiteId`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SiteKind {
    /// Head office: its office and the Gudang. Exactly one site has it.
    HeadOffice,
    Store,
}

impl SiteKind {
    /// The spelling `site.kind` stores.
    pub const fn code(self) -> &'static str {
        match self {
            Self::HeadOffice => "HO",
            Self::Store => "STORE",
        }
    }

    /// Reads `site.kind`. Anything else is not a kind this build knows, and
    /// `None` says so rather than guessing.
    pub fn from_code(code: &str) -> Option<Self> {
        match code.trim().to_ascii_uppercase().as_str() {
            "HO" => Some(Self::HeadOffice),
            "STORE" => Some(Self::Store),
            _ => None,
        }
    }
}
