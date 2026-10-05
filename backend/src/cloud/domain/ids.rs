//! The inventory ids both nodes mint — the Edge's definitions, re-exported.
//!
//! The same seven ids (`ArticleId` … `CountId`), by the same macro, one line
//! apart: this module used to declare a second copy beside the shared pool and
//! the shared place, and the copies were identical except that the Edge's
//! carries the browser contract's `ts` derive. Two structurally identical
//! newtypes with different names is not a harmless duplication: a movement line
//! built here could not be handed to a writer that took the Edge's, which is
//! exactly what happened the moment the movement model was made one.
//!
//! What a node holds and what the centre holds are the same ids; only the
//! store that keeps them differs.

pub use crate::edge::{
    ArticleId, CountId, MovementGroupId, MovementId, ObservationId, SkuId, SubjectId,
};

// `SiteId` and `SiteKind` live in `crate::ids`, shared with the edge. There
// used to be a copy here that accepted only `dc` and `store-NN` and read the
// kind off the spelling; the id now knows its shape and nothing else, and
// what a site IS comes from its row (`postgres::sites`). There is no
// head-office constant any more: head office is the one site of kind HO.
pub use crate::ids::{SiteId, SiteIdError, SiteKind};
