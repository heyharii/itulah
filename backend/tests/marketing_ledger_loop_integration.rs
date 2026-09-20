//! The marketing circle, closed — and read in one place.
//!
//! Five links, and until this file existed each of them was tested on its own:
//! a price book reaching a till (`store_pricing_integration`), a sale fact
//! reaching the centre (`sales_money_sync_integration`), a day of takings
//! reaching the ledger (`sales_posting_integration`). Every one of those passes
//! with the others broken. What none of them asks is the question this file
//! asks: **does the number the merchandiser typed into a promotion come out the
//! other end as the number in the discount account, without anybody re-typing
//! it anywhere in between?**
//!
//! ```text
//!   Marketing (centre)  ──price book──▶  POS at a shop
//!         ▲                                    │
//!         │                            a sale, with the promotion on it
//!         │                                    │
//!   the count the till's sales earned ◀──sync──┘
//!         │
//!         └──usage counts back to the till
//!                                              │
//!                                              ▼
//!                                        Sales (centre)
//!                                              │
//!                                              ▼
//!                                     Accounting: SALE_DAY
//!                                     Dr 4201  the promotion
//!                                     Cr 4101  the price before it
//! ```
//!
//! Two properties are asserted over and over, because they are the two that
//! make the circle a circle rather than five straight lines:
//!
//!   * **the benefit the till took IS the discount the ledger books** — not a
//!     recomputed figure, not a rounded one, the same rupiah, carried on the
//!     sale fact and landed on `4201` by `domain::sales_posting`;
//!   * **the limit a shop enforces comes back from the centre** — coupons work
//!     with the line down (evaluated from the shop's own copy), and the count
//!     that stops the third use is the centre's, published back to the till.
//!
//! The last test closes the voucher half: a card issued by the marketing screen
//! creates `2401`, a till settles it, and the account ends at zero — which it
//! could not do before 0298, when nothing ever credited it.
//!
//! # Why the tax rate is nought here
//!
//! The book every test delivers declares `rate_bps: 0`. VAT has its own
//! thorough home in `sales_posting_integration` (the recorded-tax tests, the
//! rounding pair, the refund pair); repeating it here would bury the arithmetic
//! that is the point of this file in arithmetic that is not. A day priced at a
//! nought rate is a day where the discount and the grossed-up revenue are the
//! only two numbers moving, so an assertion on them cannot pass by coincidence.

use chrono::{DateTime, NaiveDate, Utc};
use inventory_backend::cloud::domain::{
    catalog_content_hash, parse_sales_completed, sign_command, CatalogItem, IngestBatch,
    PushedCommand, SyncFact, COMMAND_ACTIVATE_PUBLICATION, COMMAND_CATALOG_CHUNK,
    COMMAND_COMMERCIAL_USAGE, FACT_SALES_COMPLETED,
};
use inventory_backend::cloud::postgres::{
    self as cloud, command_signing_key, GenerateSalesPostingRequest, IssueVoucherRequest,
};
use inventory_backend::edge::{
    EdgeInventory, EdgeRole, MoveRequest, MovementCause, NodeContext, ReceiveRequest, SaleRequest,
    SaleResult, SiteId, SqliteEdge, SqliteSyncStore,
};
use inventory_backend::sync::port::SyncStore;
use inventory_backend::tender::{PaymentMethod, SaleTender};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// A shop the fixtures know: one of the seeded sites, so `sales_posting` finds a
/// `site` row without a fixture inventing one.
const SHOP: &str = "store-07";
/// The key the centre signs commands with in this file. The shop verifies with
/// the same one, which is the whole of the trust story these tests need.
const KEY: &str = "marketing-loop-key";
const ACTOR: &str = "ana";

const SKU: &str = "KEM001";
/// What the shirt costs before any promotion. Chosen so a quarter off it is a
/// round fifty thousand: an assertion that cannot be satisfied by a wrong
/// rounding rule as well as by the right one.
const PRICE: i64 = 200_000;
const RULE: &str = "R1";
const COUPON: &str = "LEBARAN";
const PERCENT_BPS: i64 = 2_500;
const BENEFIT: i64 = 50_000;
