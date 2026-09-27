use serde::{Deserialize, Serialize};
use std::fmt;
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

// `SiteId` and `SiteKind` live in `crate::ids`, shared with the edge. There
// used to be a copy here that accepted only `dc` and `store-NN` and read the
// kind off the spelling; the id now knows its shape and nothing else, and
// what a site IS comes from its row (`postgres::sites`). There is no
// head-office constant any more: head office is the one site of kind HO.
pub use crate::ids::{SiteId, SiteIdError, SiteKind};
