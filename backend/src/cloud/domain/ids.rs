use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;
use uuid::Uuid;

macro_rules! uuid_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
        #[serde(transparent)]
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
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
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

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SiteId(String);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SiteKind {
    Dc,
    Store,
}

#[derive(Debug, Error, PartialEq)]
pub enum SiteIdError {
    #[error("site id must be 'dc' or 'store-NN'")]
    Invalid,
}

impl SiteId {
    pub fn new(value: impl Into<String>) -> Result<Self, SiteIdError> {
        let value = value.into().to_ascii_lowercase();
        if value == "dc" {
            return Ok(Self(value));
        }
        let Some(number) = value.strip_prefix("store-") else {
            return Err(SiteIdError::Invalid);
        };
        if number.len() < 2 || number.parse::<u32>().ok().filter(|v| *v > 0).is_none() {
            return Err(SiteIdError::Invalid);
        }
        Ok(Self(value))
    }

    pub fn dc() -> Self {
        Self("dc".to_owned())
    }
    pub fn kind(&self) -> SiteKind {
        if self.0 == "dc" {
            SiteKind::Dc
        } else {
            SiteKind::Store
        }
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SiteId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for SiteId {
    type Err = SiteIdError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s)
    }
}
