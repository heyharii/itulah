//! One place grammar for both nodes — the edge's.
//!
//! The centre used to keep its own: exactly one warehouse, spelled `dc` into
//! the ids (`dc.warehouse`, `dc.outbound.packed.store-07`), and a shop told
//! apart by the `store-` in front of its id. The edge parameterised the same
//! grammar by its site, so one warehouse had two spellings and every new site
//! was a code change (inventory-fleet G1). Since 0610 a pool's ROLE is its
//! role path and the site half is a label, so both nodes read one grammar —
//! the edge's — and every pool the centre already holds reads in it unchanged:
//! `dc.warehouse` is the stockroom of site `dc`, which is what its
//! `operational_pool` row has always said.
//!
//! What is left here is the re-export, and it is the whole model: the place,
//! the state, the external and system counterparts, and the parse error. This
//! module used to declare its own copies of all of them beside the shared pool,
//! and the copies had already drifted — `system/identification` and
//! `system/handed_over` existed only on the edge, so a movement fact naming one
//! of them could not be read by the centre's own parser, and `Place::is_saleable`
//! asked a different question on each side.
//!
//! `Place` is on the wire (a movement line names two of them), and the two
//! copies happened to agree on its shape — same `type` tag, same spellings —
//! which is exactly why nothing noticed they were two.

pub use crate::edge::{ExternalPlace, InventoryState, Place, PlaceError, SystemPlace};
pub use crate::edge::{GroupCode, OperationalPool};
pub use crate::pool_role::{OutboundStage, PoolRole};
