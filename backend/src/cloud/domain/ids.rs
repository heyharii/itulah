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

/// Which of the two kinds of place a `site` row is.
///
/// `HeadOffice` is the warehouse, and the two words mean one building: since
/// 0256 the distribution centre and head office are a single `site` row, `ho`,
/// of kind `HO`. The pool grammar still spells that building's shelves `dc.…`
/// — a separate id space, deliberately left alone — so the kind is the thing
/// to branch on, never the first segment of a pool id.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SiteKind {
    HeadOffice,
    Store,
}

#[derive(Debug, Error, PartialEq)]
pub enum SiteIdError {
    #[error("site id must be 'dc' or 'store-NN'")]
    Invalid,
}

/// The one site that is not a shop, as `site.id` spells it **today**.
///
/// `dc`, and not `ho`. The rename that folds the distribution centre and head
/// office into one `ho` site is migration 0256, and `9b273f83` set that lane
/// aside unlanded because it refuses `dc` — which every demo rig still uses.
/// `ho` is real, but it is an `org_place.id`: 0236 records the place `ho` as
/// sitting at site `dc`.
///
/// This constant said `ho` for a while and nothing in the database did. The
/// cost was not theoretical: `postgres::allotments` gates `RETURN_TO_DC` and
/// `RETURN_TO_SUPPLIER` on it, so both were asking for a site id that does not
/// exist while checking a pool id (`dc.reject.dc`) that does — two allotment
/// types that could not be created at all. Kept in step with
/// `postgres::poster::HEAD_OFFICE_SITE`, which is what the posting engine and
/// 0122's affiliate map have always used.
///
/// When 0256 lands, this and `poster`'s constant flip together, and the pool
/// ids move with them. Not before: one of the two moving alone is exactly the
/// state this comment exists because of.
pub const HEAD_OFFICE_SITE_ID: &str = "dc";

impl SiteId {
    pub fn new(value: impl Into<String>) -> Result<Self, SiteIdError> {
        let value = value.into().to_ascii_lowercase();
        // `ho` is refused rather than aliased, for the reason the previous
        // spelling of this function refused `dc`: two live spellings of one
        // building is what 0256 exists to end, and a validation error names the
        // caller holding the wrong one. Today the wrong one is `ho`.
        if value == HEAD_OFFICE_SITE_ID {
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

    pub fn head_office() -> Self {
        Self(HEAD_OFFICE_SITE_ID.to_owned())
    }
    pub fn kind(&self) -> SiteKind {
        if self.0 == HEAD_OFFICE_SITE_ID {
            SiteKind::HeadOffice
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
