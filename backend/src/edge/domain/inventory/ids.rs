use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;
use uuid::Uuid;

macro_rules! uuid_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
        #[serde(transparent)]
        // A UUID on the wire, and a string once it reaches a browser. The
        // distinctions these ids draw are the server's business: a screen that
        // could tell a SubjectId from a MovementId would be a screen deciding
        // something it has no standing to decide.
        #[cfg_attr(
            feature = "ts",
            derive(ts_rs::TS),
            ts(export, export_to = "contract/", type = "string")
        )]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

uuid_id!(ArticleId);
uuid_id!(SkuId);
uuid_id!(SubjectId);
uuid_id!(MovementId);
uuid_id!(MovementGroupId);
uuid_id!(ObservationId);
uuid_id!(CountId);

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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SiteKind {
    Dc,
    Store,
}

#[derive(Debug, Error, PartialEq)]
pub enum SiteIdError {
    #[error(
        "site id must be 'dc', start with 'dc-', or start with 'store-' and contain a non-empty lowercase identifier"
    )]
    Invalid,
}

impl SiteId {
    pub fn new(value: impl Into<String>) -> Result<Self, SiteIdError> {
        let value = value.into().trim().to_ascii_lowercase();
        if value == "dc" {
            return Ok(Self(value));
        }
        let suffix = value
            .strip_prefix("dc-")
            .or_else(|| value.strip_prefix("store-"))
            .ok_or(SiteIdError::Invalid)?;
        if suffix.is_empty()
            || !suffix.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
            })
        {
            return Err(SiteIdError::Invalid);
        }
        Ok(Self(value))
    }

    pub fn kind(&self) -> SiteKind {
        if self.0 == "dc" || self.0.starts_with("dc-") {
            SiteKind::Dc
        } else {
            SiteKind::Store
        }
    }

    pub fn is_dc(&self) -> bool {
        self.kind() == SiteKind::Dc
    }

    pub fn is_store(&self) -> bool {
        self.kind() == SiteKind::Store
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_identity_supports_multiple_dc_and_store_nodes() {
        assert_eq!(SiteId::new("dc-01").map(|id| id.kind()), Ok(SiteKind::Dc));
        assert_eq!(
            SiteId::new("dc-jakarta").map(|id| id.kind()),
            Ok(SiteKind::Dc)
        );
        assert_eq!(
            SiteId::new("store-13").map(|id| id.kind()),
            Ok(SiteKind::Store)
        );
        assert_eq!(SiteId::new("dc").map(|id| id.kind()), Ok(SiteKind::Dc));
        assert!(SiteId::new("store").is_err());
    }
}
