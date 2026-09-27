use serde::{Deserialize, Serialize};
use std::fmt;
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

// `SiteId` and `SiteKind` live in `crate::ids`, shared with the centre.
// The copy that stood here decided a site was a warehouse because its id
// was `dc` or began `dc-`, and a shop because it began `store-`. The id now
// knows its shape and nothing else; a node learns what its site is from
// head office (`edge::site_profile`) and from the role it was enrolled with.
pub use crate::ids::{SiteId, SiteIdError, SiteKind};
