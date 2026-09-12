#![allow(clippy::items_after_test_module)]

use crate::edge::pricing;
use crate::edge::{
    derive_allotment_status, validate_command, AdvanceKoliRequest, CatalogIdentity, CommandResult,
    CreateKoliShipmentRequest, CreatePicklistRequest, EdgeError, EdgeInventory,
    EdgeOfficialCountDetail, EdgeOfficialCountLine, EdgeOfficialCountSummary, EdgeRole,
    FulfillmentProgressResult, GoodsReceiptView, IntakeRequest, InventoryState, InvoiceDocument,
    InvoiceDocumentView, MoveRequest, MovementCause, MovementCommand, MovementGroupId, MovementId,
    MovementLine, MovementView, NodeContext, OfficialCountEntriesRequest,
    OfficialCountSubmitRequest, OfficialCountSubmitResult, OpenGoodsReceiptRequest,
    OperationalPool, PackKoliRequest, PackRequest, PickRequest, PickResult, PicklistRefusal,
    PicklistResult, Place, PoolBalance, PurchaseCountAwaitingVerification, PurchaseCountRequest,
    PurchaseCountResult, PurchaseVerifyDecision, PurchaseVerifyRequest, PurchaseVerifyResult,
    PurchaseWorkLine, ReceiveBatchRequest, ReceiveRequest, RecordInvoiceRequest, SaleRequest,
    SaleResult, SegregationPolicy, SiteId, SiteKind, StoreInvoiceDocumentRequest, SubjectId,
    SystemPlace, TaggingConfirmRequest, TaggingConfirmResult, TaggingWorkJob, TaggingWorkLine,
};
use crate::sync::workflow::{
    FulfillmentProgressPayload, FulfillmentStage, OfficialCountResultLine,
    OfficialCountResultPayload, PackageUnitAllocation, PickPayload,
    INVENTORY_FULFILLMENT_PROGRESS_V1, INVENTORY_OFFICIAL_COUNT_RESULT_V1, INVENTORY_PICK_V1,
    INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use crate::sync::{
    PoolSnapshotBalance, PoolSnapshotPayload, TransferClaimKind, TransferClaimPayload,
    INVENTORY_POOL_SNAPSHOT_V1, INVENTORY_TRANSFER_CLAIM_V1,
};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    collections::{BTreeSet, HashSet},
    path::Path,
    str::FromStr,
    sync::{Arc, Mutex, MutexGuard},
};
use uuid::Uuid;

const SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0001_edge_inventory.sql"
));

/// The edge half of the sync engine's schema, applied beside the inventory
/// one so a node is never half-provisioned.
const PURCHASE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0005_edge_purchase_orders.sql"
));

const CATALOG_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0003_edge_catalog.sql"
));

const WORK_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0004_edge_inventory_work.sql"
));

const SYNC_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0002_edge_sync.sql"
));

const AUTH_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0004_edge_auth.sql"
));

const TAGGING_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0006_edge_tagging.sql"
));

const OFFICIAL_COUNT_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0007_official_count_workflow.sql"
));

const PRINTING_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0008_edge_printing.sql"
));

/// Renames the fulfillment package into a koli and adds the containment around
/// it. Applied once, guarded on the rename having happened, because ALTER TABLE
/// RENAME is not idempotent the way CREATE TABLE IF NOT EXISTS is.
const OUTBOUND_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0009_edge_outbound_containment.sql"
));

/// Links each pick to the round it belongs to. Guarded on the column, because
/// ALTER TABLE ADD COLUMN fails rather than shrugging on a second run.
const PICK_SESSION_LINK_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0010_edge_pick_session_link.sql"
));

/// Turns a packing session into one box with a target, and makes the sweep the
/// thing that closes it.
const PACKING_CAPTURE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0011_edge_packing_capture.sql"
));

/// Drops "allotment" from the pick event's name, now that fetching consumes
/// none. Guarded on the new table, because RENAME is not idempotent.
const PICK_EVENT_RENAME_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0012_edge_pick_event_rename.sql"
));

/// Renames the stage a carton is in from DISPATCHED to LOADED, and repairs two
/// foreign keys that 0009's rename left pointing at a table it had renamed
/// away. Rebuilds three tables to do it, because SQLite cannot alter a CHECK.
const LOADED_STAGE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0013_edge_loaded_stage.sql"
));

/// The last column still calling a koli a package.
const KOLI_ID_COLUMN_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0014_koli_id_column.sql"
));

/// Gives a price rule the SKU code the rest of this database names products by,
/// so a delivered price can finally be matched to a catalogue row.
const PRICE_RULE_SKU_CODE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0015_price_rule_sku_code.sql"
));

/// Markdowns, promotion rules, and the coupons that unlock them.
pub(crate) const PROMOTIONS_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0016_edge_promotions.sql"
));

/// Group and tier price levels, campaigns, and what a sale records about how it
/// was priced.
pub(crate) const PRICE_LEVELS_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0017_price_levels_and_campaigns.sql"
));

/// What promotions have already given away, as the centre last counted it.
pub(crate) const COMMERCIAL_USAGE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0018_commercial_usage.sql"
));

/// The style, division and tags a range-wide markdown matches on.
pub(crate) const CATALOG_MERCHANDISE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0019_catalog_merchandise_facts.sql"
));

/// How a sale was paid for, and not only how much.
pub(crate) const SALE_TENDER_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0020_sale_tenders.sql"
));

/// The fifth tender: a gift card. See the migration for why a basket settled
/// by one was being recorded as OTHER, and why that overstates the day's cash.
///
/// Registered here because `migration_hygiene` found it on disk with nothing
/// applying it — the same fault, and the same remedy, as `0023` below. Its
/// cost was higher. `PaymentMethod::Voucher` has existed since the centre's
/// `0090`, and `as_str` renders it `VOUCHER`, so a till offering it produced a
/// row the CHECK did not list; the constraint failed and took the whole sale
/// down with it. Every layer above this file was ready.
pub(crate) const VOUCHER_TENDER_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0028_a_till_can_be_paid_with_a_voucher.sql"
));

/// The tier, removed. See the migration for why a level nothing can match is
/// worse than no level at all.
pub(crate) const RETIRE_TIER_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0021_retire_what_no_customer_carries.sql"
));

/// The counters a book used to freeze into itself. See the migration: a count
/// with two sources is one this system has been bitten by before.
pub(crate) const ONE_SOURCE_FOR_A_COUNT_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0022_a_count_has_one_source.sql"
));

/// The colourway and size a hang tag has to carry to be shoppable.
/// The till's day: a shift, a sale the shop can take back, and the list price
/// a receipt needs to explain a markdown.
/// Printed at the foot of every receipt.
///
/// A return has to be refused after the window, and the window is only
/// enforceable if the customer was told at the counter. It is a constant
/// rather than a setting because no shop in this fleet has a different one
/// yet, and a settings table nobody has a screen for is a value nobody can
/// change anyway.
const RECEIPT_FOOTER: &str = "Terima kasih. Penukaran maksimal 7 hari dengan struk ini.";

/// The photograph, delivered with the catalogue. See the migration: a shop
/// holds neither of the two tables the image lookup used to read.
pub(crate) const CATALOGUE_PHOTOGRAPH_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0025_the_photograph_the_shop_sells_from.sql"
));

/// Where the die-cut tag sits on the liner. See the migration: ink at x=0
/// lands on the backing paper, and the tag prints with its left column gone.
///
/// Registered here because `migration_hygiene` found it on disk with nothing
/// applying it, which means the column was absent from every database built
/// from scratch — the printing tests passed because their inline schema had
/// been patched to include it, and only theirs.
pub(crate) const LABEL_OFFSET_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0023_where_the_label_sits_on_the_liner.sql"
));

/// A clearance that runs on chosen days, between chosen hours. See the
/// migration: this is what makes a flash sale one markdown rather than one per
/// slot — and what makes a shelf price change at two in the afternoon.
pub(crate) const CLEARANCE_HOURS_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0027_a_clearance_may_run_by_the_hour.sql"
));

/// A run of price drops under one banner, and the banner. See the migration
/// for why a markdown's campaign gate is the opposite way round from a rule's.
pub(crate) const MARKDOWN_CAMPAIGN_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0026_a_campaign_may_hold_markdowns.sql"
));

/// The supplier's invoice as a page rather than a number. See the migration:
/// the centre's file vault is reachable only through the conversation a file
/// was posted in, and a DC has to take a delivery with that line down.
const INVOICE_DOCUMENT_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0029_the_verifier_keeps_the_invoice.sql"
));

/// What a started promotion covers, as the centre resolved it. See the
/// migration's own header, and `COMMAND_COMMERCIAL_ELIGIBILITY` for the lane
/// it arrives on.
const RULE_ELIGIBILITY_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0037_a_shop_holds_what_a_started_promotion_covers.sql"
));

pub(crate) const TILL_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0024_a_sale_the_shop_can_take_back.sql"
));

pub(crate) const PRINT_ITEM_COLOUR_SIZE_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0020_print_item_colour_and_size.sql"
));

#[derive(Clone)]
pub struct SqliteEdge {
    connection: Arc<Mutex<Connection>>,
    node: NodeContext,
    /// Whether one person may both count and approve a delivery. Read once at
    /// open so a site's decision cannot change mid-transaction.
    segregation: SegregationPolicy,
}

#[derive(Clone)]
struct SubjectRow {
    id: SubjectId,
    epc: String,
    sku_code: String,
    unit_price_minor: i64,
}

#[derive(Clone)]
struct FulfillmentUnitRow {
    subject: SubjectRow,
    allocation: PackageUnitAllocation,
}

impl SqliteEdge {
    pub fn open(path: impl AsRef<Path>, node: NodeContext) -> Result<Self, EdgeError> {
        Self::from_connection(Connection::open(path).map_err(db)?, node)
    }

    /// The node's connection, shared with [`crate::edge::SqliteSyncStore`].
    ///
    /// Deliberately the SAME handle: a fact and the movement that produced it
    /// must commit in one transaction, which is only possible on one
    /// connection.
    pub fn connection(&self) -> std::sync::Arc<std::sync::Mutex<Connection>> {
        self.connection.clone()
    }

    /// Select the durable generation used by this edge's fixed origin.
    ///
    /// Repeating the active generation is a no-op. A forward rollover is
    /// allowed only after every fact in the old generation is acknowledged;
    /// it atomically starts a dense new stream with a full bootstrap snapshot.
    pub fn configure_sync_generation(&self, generation: i64) -> Result<(), EdgeError> {
        if generation < 1 {
            return Err(EdgeError::Configuration(
                "INVENTORY_ORIGIN_GENERATION must be at least 1".into(),
            ));
        }
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let origin: Option<(String, i64, i64)> = tx
            .query_row(
                "SELECT origin_id, generation, next_seq FROM sync_origin WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?;
        let Some((origin_id, current_generation, next_seq)) = origin else {
            return Err(EdgeError::Persistence(
                "edge sync origin was not initialized".into(),
            ));
        };
        if origin_id != self.node.node_id {
            return Err(EdgeError::Configuration(format!(
                "database sync origin is {origin_id}, not {}",
                self.node.node_id
            )));
        }
        if generation < current_generation {
            return Err(EdgeError::Configuration(format!(
                "sync generation cannot regress from {current_generation} to {generation}"
            )));
        }
        if generation == current_generation {
            tx.execute(
                "UPDATE sync_origin SET enqueue_enabled=1 WHERE singleton=1",
                [],
            )
            .map_err(db)?;
            Self::enqueue_bootstrap_if_missing(&tx, &self.node)?;
            tx.commit().map_err(db)?;
            return Ok(());
        }

        let durable_seq: i64 = tx
            .query_row(
                "SELECT durable_seq FROM sync_watermark WHERE origin_id=?1 AND generation=?2",
                params![origin_id, current_generation],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?
            .unwrap_or(0);
        if next_seq > durable_seq {
            return Err(EdgeError::Conflict(format!(
                "cannot advance sync generation: generation {current_generation} has {} unacknowledged fact(s)",
                next_seq - durable_seq
            )));
        }

        tx.execute(
            "UPDATE sync_origin
             SET generation=?1, next_seq=0, enqueue_enabled=1, provisioned_at=?2
             WHERE singleton=1",
            params![generation, now_text()],
        )
        .map_err(db)?;
        Self::enqueue_bootstrap_if_missing(&tx, &self.node)?;
        tx.commit().map_err(db)?;
        Ok(())
    }

    pub fn open_in_memory(node: NodeContext) -> Result<Self, EdgeError> {
        Self::from_connection(Connection::open_in_memory().map_err(db)?, node)
    }

    fn from_connection(mut connection: Connection, node: NodeContext) -> Result<Self, EdgeError> {
        connection.execute_batch(SCHEMA).map_err(db)?;
        connection.execute_batch(SYNC_SCHEMA).map_err(db)?;
        connection.execute_batch(CATALOG_SCHEMA).map_err(db)?;
        connection.execute_batch(PURCHASE_SCHEMA).map_err(db)?;
        connection
            .execute_batch(INVOICE_DOCUMENT_SCHEMA)
            .map_err(db)?;
        connection.execute_batch(AUTH_SCHEMA).map_err(db)?;
        connection.execute_batch(WORK_SCHEMA).map_err(db)?;
        connection.execute_batch(TAGGING_SCHEMA).map_err(db)?;
        connection.execute_batch(PRINTING_SCHEMA).map_err(db)?;
        // Asks after what this migration ADDS, not after the box itself: the
        // box is created under its own name in 0004, so its presence says
        // nothing about whether containment has been applied.
        let has_containment: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='shipment'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if has_containment == 0 {
            connection.execute_batch(OUTBOUND_SCHEMA).map_err(db)?;
        }
        let picks_know_their_round: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('dc_pick_event')
                  WHERE name='pick_session_id'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if picks_know_their_round == 0 {
            connection
                .execute_batch(PICK_SESSION_LINK_SCHEMA)
                .map_err(db)?;
        }
        let boxes_have_targets: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('packing_session') WHERE name='koli_id'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if boxes_have_targets == 0 {
            connection
                .execute_batch(PACKING_CAPTURE_SCHEMA)
                .map_err(db)?;
        }
        let picks_renamed: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='dc_pick_event'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if picks_renamed == 0 {
            connection
                .execute_batch(PICK_EVENT_RENAME_SCHEMA)
                .map_err(db)?;
        }
        let stage_is_loaded: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='koli' AND sql LIKE '%LOADED%'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if stage_is_loaded == 0 {
            connection.execute_batch(LOADED_STAGE_SCHEMA).map_err(db)?;
        }
        let progress_names_the_koli: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('dc_fulfillment_progress_event')
                  WHERE name='koli_id'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if progress_names_the_koli == 0 {
            connection
                .execute_batch(KOLI_ID_COLUMN_SCHEMA)
                .map_err(db)?;
        }
        let price_rule_names_the_sku: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('commercial_price_rule')
                  WHERE name='sku_code'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if price_rule_names_the_sku == 0 {
            connection
                .execute_batch(PRICE_RULE_SKU_CODE_SCHEMA)
                .map_err(db)?;
        }
        let holds_promotions: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='commercial_rule'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if holds_promotions == 0 {
            connection.execute_batch(PROMOTIONS_SCHEMA).map_err(db)?;
        }
        let holds_campaigns: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='commercial_campaign'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if holds_campaigns == 0 {
            connection.execute_batch(PRICE_LEVELS_SCHEMA).map_err(db)?;
        }
        let holds_usage: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='commercial_usage'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if holds_usage == 0 {
            connection
                .execute_batch(COMMERCIAL_USAGE_SCHEMA)
                .map_err(db)?;
        }
        // Asks after the style, which is the column the engine actually reads.
        // A catalogue without it prices every product correctly and quietly
        // ignores every markdown written against a range.
        let catalogue_knows_its_styles: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('catalog_item')
                  WHERE name='article_code'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if catalogue_knows_its_styles == 0 {
            connection
                .execute_batch(CATALOG_MERCHANDISE_SCHEMA)
                .map_err(db)?;
        }
        let records_how_it_was_paid: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='sale_tender'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if records_how_it_was_paid == 0 {
            connection.execute_batch(SALE_TENDER_SCHEMA).map_err(db)?;
        }
        // Asks whether the column is still there, which is the only way to
        // tell a database that predates the removal from one that has had it.
        let still_offers_a_tier: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('commercial_price_rule')
                  WHERE name='tier'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if still_offers_a_tier > 0 {
            connection.execute_batch(RETIRE_TIER_SCHEMA).map_err(db)?;
        }
        let still_counts_in_the_book: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('commercial_coupon')
                  WHERE name='used'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if still_counts_in_the_book > 0 {
            connection
                .execute_batch(ONE_SOURCE_FOR_A_COUNT_SCHEMA)
                .map_err(db)?;
        }
        // Asks after the size, because that is the line a rail is shopped by.
        // A tag without it prices the garment correctly and never says whether
        // it fits.
        let label_knows_its_size: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('print_item')
                  WHERE name='size_label'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if label_knows_its_size == 0 {
            connection
                .execute_batch(PRINT_ITEM_COLOUR_SIZE_SCHEMA)
                .map_err(db)?;
        }
        let has_count_movement_groups: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('dc_official_count_adjustment') WHERE name='movement_group_ids_json'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        let has_catalog_base_price: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('catalog_item') WHERE name='base_price_minor'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        match (has_count_movement_groups, has_catalog_base_price) {
            (0, 0) => connection
                .execute_batch(OFFICIAL_COUNT_SCHEMA)
                .map_err(db)?,
            (1, 1) => {}
            _ => {
                return Err(EdgeError::Configuration(
                    "partial Official Count SQLite migration detected".into(),
                ));
            }
        }
        // Goods enter the system for the first time when they land in the
        // `unidentified` pool — after a delivery has been counted and
        // verified, and before anyone has worked out what they are. By
        // definition they have no SKU yet and no RFID tag yet, so the two
        // columns that name those things must be allowed to be absent.
        //
        // The original table required both. SQLite cannot drop a NOT NULL, so
        // the table is rebuilt once, in place, guarded by a check for the new
        // shape. Existing rows are all EPC-tagged units and are carried across
        // as such; nothing is inferred and nothing is lost.
        let has_subject_type: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('inventory_subject') WHERE name='subject_type'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if has_subject_type == 0 {
            connection
                .execute_batch(
                    "PRAGMA foreign_keys=OFF;
                     BEGIN IMMEDIATE;
                     CREATE TABLE inventory_subject_rebuilt (
                         id               TEXT PRIMARY KEY,
                         subject_type     TEXT NOT NULL DEFAULT 'UNIT'
                                          CHECK (subject_type IN ('UNIT','QUANTITY')),
                         article_code     TEXT,
                         epc              TEXT UNIQUE,
                         sku_code         TEXT,
                         quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
                         unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
                         created_at       TEXT NOT NULL,
                         -- A tagged unit is exactly one item and must carry its
                         -- tag; anything else is a quantity of untagged goods.
                         CHECK (
                             (subject_type='UNIT' AND quantity=1 AND epc IS NOT NULL)
                             OR subject_type='QUANTITY'
                         )
                     );
                     INSERT INTO inventory_subject_rebuilt
                         (id, subject_type, article_code, epc, sku_code, quantity,
                          unit_price_minor, created_at)
                     SELECT id, 'UNIT', NULL, epc, sku_code, 1, unit_price_minor, created_at
                     FROM inventory_subject;
                     DROP TABLE inventory_subject;
                     ALTER TABLE inventory_subject_rebuilt RENAME TO inventory_subject;
                     CREATE INDEX IF NOT EXISTS ix_subject_article
                         ON inventory_subject(article_code) WHERE article_code IS NOT NULL;
                     COMMIT;
                     PRAGMA foreign_keys=ON;",
                )
                .map_err(db)?;
        }
        // Asks whether a sale can be anything but COMPLETED. That CHECK is
        // what this migration opens, and its absence is the only way to tell a
        // database that predates the till's day from one that has had it.
        let a_sale_can_be_taken_back: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='cash_shift'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if a_sale_can_be_taken_back == 0 {
            connection.execute_batch(TILL_SCHEMA).map_err(db)?;
        }
        // Asks the constraint itself, because that is the only place the
        // answer is written: SQLite cannot alter a CHECK, so `0028` rebuilds
        // the table, and a database's own DDL is what says which of the two
        // versions it holds.
        //
        // After the till's day rather than in numeric order beside `0020`,
        // because `0024` above drops and renames `sale`, and `sale_tender`
        // points at it. Rebuilding the child either side of a parent rebuild
        // resolves, but only one order needs the reader to prove that.
        let a_voucher_may_settle_a_basket: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                  WHERE type='table' AND name='sale_tender' AND sql LIKE '%VOUCHER%'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if a_voucher_may_settle_a_basket == 0 {
            connection
                .execute_batch(VOUCHER_TENDER_SCHEMA)
                .map_err(db)?;
        }
        let catalogue_carries_its_photograph: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('catalog_item') WHERE name='image_url'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if catalogue_carries_its_photograph == 0 {
            connection
                .execute_batch(CATALOGUE_PHOTOGRAPH_SCHEMA)
                .map_err(db)?;
        }
        let a_markdown_may_name_a_campaign: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('commercial_markdown') WHERE name='campaign_id'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if a_markdown_may_name_a_campaign == 0 {
            connection
                .execute_batch(MARKDOWN_CAMPAIGN_SCHEMA)
                .map_err(db)?;
        }
        let a_reel_states_its_offset: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('print_session') WHERE name='label_offset_mm'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if a_reel_states_its_offset == 0 {
            connection.execute_batch(LABEL_OFFSET_SCHEMA).map_err(db)?;
        }
        let a_clearance_may_be_scheduled: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('commercial_markdown') WHERE name='from_minute'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if a_clearance_may_be_scheduled == 0 {
            connection
                .execute_batch(CLEARANCE_HOURS_SCHEMA)
                .map_err(db)?;
        }
        let request_json_columns: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('idempotency_response') WHERE name='request_json'",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;
        if request_json_columns == 0 {
            connection
                .execute(
                    "ALTER TABLE idempotency_response ADD COLUMN request_json TEXT",
                    [],
                )
                .map_err(db)?;
        }
        // Idempotent on its own — every statement in it is `IF NOT EXISTS` —
        // so it needs no probe of its own the way the rebuilds above do.
        connection
            .execute_batch(RULE_ELIGIBILITY_SCHEMA)
            .map_err(db)?;
        let existing: Option<(String, String, String)> = connection
            .query_row(
                "SELECT node_id,role,site_id FROM node_metadata WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?;
        match existing {
            Some((node_id, role, site_id))
                if node_id != node.node_id
                    || role != node.role.to_string()
                    || site_id != node.site_id.as_str() =>
            {
                return Err(EdgeError::Configuration(format!(
                    "database belongs to {role}/{site_id}/{node_id}, not {}/{}/{}",
                    node.role, node.site_id, node.node_id
                )));
            }
            Some(_) => {}
            None => {
                connection
                    .execute(
                        "INSERT INTO node_metadata(singleton,node_id,role,site_id,created_at) VALUES(1,?1,?2,?3,?4)",
                        params![
                            &node.node_id,
                            node.role.to_string(),
                            node.site_id.as_str(),
                            now_text()
                        ],
                    )
                    .map_err(db)?;
            }
        }
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        Self::ensure_capture_origin(&tx, &node)?;
        tx.commit().map_err(db)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            node,
            segregation: SegregationPolicy::from_env(),
        })
    }

    fn ensure_capture_origin(tx: &Transaction<'_>, node: &NodeContext) -> Result<(), EdgeError> {
        let origin: Option<String> = tx
            .query_row(
                "SELECT origin_id FROM sync_origin WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?;
        match origin {
            Some(origin_id) if origin_id != node.node_id => {
                return Err(EdgeError::Configuration(format!(
                    "database sync origin is {origin_id}, not {}",
                    node.node_id
                )));
            }
            Some(_) => {
                tx.execute(
                    "UPDATE sync_origin SET enqueue_enabled=1 WHERE singleton=1",
                    [],
                )
                .map_err(db)?;
            }
            None => {
                tx.execute(
                    "INSERT INTO sync_origin
                         (singleton, origin_id, generation, next_seq, enqueue_enabled, provisioned_at)
                     VALUES (1, ?1, 1, 0, 1, ?2)",
                    params![node.node_id, now_text()],
                )
                .map_err(db)?;
                tx.execute(
                    "INSERT INTO sync_sender_state (singleton, updated_at) VALUES (1, ?1)
                     ON CONFLICT(singleton) DO NOTHING",
                    params![now_text()],
                )
                .map_err(db)?;
            }
        }
        Self::enqueue_bootstrap_if_missing(tx, node)
    }

    fn enqueue_bootstrap_if_missing(
        tx: &Transaction<'_>,
        node: &NodeContext,
    ) -> Result<(), EdgeError> {
        let (origin_id, generation): (String, i64) = tx
            .query_row(
                "SELECT origin_id,generation FROM sync_origin WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(db)?;
        let marked: bool = tx
            .query_row(
                "SELECT EXISTS(
                     SELECT 1 FROM sync_generation_bootstrap
                     WHERE origin_id=?1 AND generation=?2
                 )",
                params![&origin_id, generation],
                |row| row.get(0),
            )
            .map_err(db)?;
        if marked {
            return Ok(());
        }

        // Compatibility for databases opened by a version that emitted a
        // bootstrap before the durable marker existed: adopt the retained
        // snapshot rather than appending another one.
        let retained_snapshot_seq: Option<i64> = tx
            .query_row(
                "SELECT seq FROM sync_fact_log
                 WHERE origin_id=?1 AND generation=?2 AND event_type=?3
                 ORDER BY seq LIMIT 1",
                params![&origin_id, generation, INVENTORY_POOL_SNAPSHOT_V1],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?;
        let snapshot_seq = match retained_snapshot_seq {
            Some(seq) => seq,
            None => Self::enqueue_pool_snapshot(tx, node, Uuid::new_v4())?,
        };
        tx.execute(
            "INSERT INTO sync_generation_bootstrap
                 (origin_id,generation,snapshot_seq,captured_at)
             VALUES (?1,?2,?3,?4)",
            params![origin_id, generation, snapshot_seq, now_text()],
        )
        .map_err(db)?;
        Ok(())
    }

    /// Publish this node's observed stock position as a cross-check.
    ///
    /// # Why this is not emitted with every movement
    ///
    /// A snapshot is not history — it is this node's own claim about where it
    /// currently stands. Its value is that the centre derives the same number
    /// independently, from the movement facts, so a disagreement exposes a bug
    /// in either derivation, a projection that has drifted from its own
    /// ledger, or a hand-edited database. None of that is detectable from
    /// facts alone, because facts record only what the system believes it did.
    ///
    /// But a cross-check that arrives with every fact it is meant to check
    /// costs a fact per movement and proves nothing the previous one did not.
    /// So it goes out on its own cadence: at day close, while a discrepancy
    /// can still be investigated by the people who were there, and on demand.
    ///
    /// It needs no clock agreement to be comparable. It IS a fact, so it holds
    /// a sequence position and by construction accounts for every fact before
    /// it; the centre simply waits until it has applied that far.
    pub fn capture_pool_snapshot(&self) -> Result<i64, EdgeError> {
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let seq = Self::enqueue_pool_snapshot(&tx, &self.node, Uuid::new_v4())?;
        tx.commit().map_err(db)?;
        Ok(seq)
    }

    pub(crate) fn enqueue_pool_snapshot(
        tx: &Transaction<'_>,
        node: &NodeContext,
        event_id: Uuid,
    ) -> Result<i64, EdgeError> {
        let pools = Self::collect_pool_balances(tx, node)?
            .into_iter()
            .map(|pool| PoolSnapshotBalance {
                pool_id: pool.pool_id,
                stock: pool.stock,
                allotted: pool.allotted,
                on_hand: pool.on_hand,
                missing: pool.missing,
            })
            .collect();
        let payload = PoolSnapshotPayload::new(
            node.node_id.clone(),
            node.role.to_string(),
            node.site_id.to_string(),
            Utc::now(),
            pools,
        )
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        crate::edge::sync::enqueue_fact(tx, event_id, INVENTORY_POOL_SNAPSHOT_V1, &payload)
            .map_err(db)?
            .ok_or_else(|| EdgeError::Persistence("edge snapshot capture is disabled".into()))
    }

    fn enqueue_transfer_claim(
        tx: &Transaction<'_>,
        payload: &TransferClaimPayload,
    ) -> Result<i64, EdgeError> {
        crate::edge::sync::enqueue_fact(tx, Uuid::new_v4(), INVENTORY_TRANSFER_CLAIM_V1, payload)
            .map_err(db)?
            .ok_or_else(|| EdgeError::Persistence("edge transfer capture is disabled".into()))
    }

    fn require_dc(&self, reason: &str) -> Result<(), EdgeError> {
        if self.node.role == EdgeRole::Dc {
            Ok(())
        } else {
            Err(EdgeError::Forbidden(reason.into()))
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, EdgeError> {
        self.connection
            .lock()
            .map_err(|_| EdgeError::Persistence("SQLite connection lock poisoned".into()))
    }

    fn encode_idempotent_request<T: Serialize>(request: &T) -> Result<String, EdgeError> {
        serde_json::to_string(request).map_err(|error| EdgeError::Persistence(error.to_string()))
    }

    fn load_idempotent<T: DeserializeOwned>(
        tx: &Transaction<'_>,
        key: &str,
        operation: &str,
        request_json: &str,
    ) -> Result<Option<T>, EdgeError> {
        let row: Option<(String, Option<String>, String)> = tx
            .query_row(
                "SELECT operation,request_json,response_json FROM idempotency_response WHERE idempotency_key=?1",
                [key],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?;
        let Some((stored_operation, stored_request_json, response_json)) = row else {
            return Ok(None);
        };
        if stored_operation != operation {
            return Err(EdgeError::Conflict(format!(
                "idempotency key already belongs to {stored_operation}"
            )));
        }
        if stored_request_json.as_deref() != Some(request_json) {
            return Err(EdgeError::Conflict(
                "idempotency key was already used with a different request payload".into(),
            ));
        }
        serde_json::from_str(&response_json)
            .map(Some)
            .map_err(|error| EdgeError::Persistence(error.to_string()))
    }

    fn save_idempotent<T: Serialize>(
        tx: &Transaction<'_>,
        key: &str,
        operation: &str,
        request_json: &str,
        response: &T,
    ) -> Result<(), EdgeError> {
        let response_json = serde_json::to_string(response)
            .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        tx.execute(
            "INSERT INTO idempotency_response(idempotency_key,operation,request_json,response_json,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![key, operation, request_json, response_json, now_text()],
        )
        .map_err(db)?;
        Ok(())
    }

    /// Refuse a till operation on a node that is not a shop.
    ///
    /// A DC has no drawer, no customer and no receipt printer. Naming the
    /// operation in the message matters: "not available on DC Edge" sends
    /// somebody to the wrong config file.
    fn require_store(&self, operation: &str) -> Result<(), EdgeError> {
        if self.node.role == EdgeRole::Store {
            return Ok(());
        }
        Err(EdgeError::Forbidden(format!(
            "{operation} is only available on Store Edge"
        )))
    }

    fn validate_command_identity(idempotency_key: &str, actor_id: &str) -> Result<(), EdgeError> {
        if idempotency_key.trim().is_empty() {
            return Err(EdgeError::Validation("idempotency_key is required".into()));
        }
        if actor_id.trim().is_empty() {
            return Err(EdgeError::Validation("actor_id is required".into()));
        }
        Ok(())
    }

    fn normalized_epc(value: &str) -> Result<String, EdgeError> {
        let value = value.trim().to_ascii_uppercase();
        if value.is_empty() {
            return Err(EdgeError::Validation("EPC is required".into()));
        }
        Ok(value)
    }

    fn validate_subject_fields(sku_code: &str, unit_price_minor: i64) -> Result<(), EdgeError> {
        if sku_code.trim().is_empty() {
            return Err(EdgeError::Validation("sku_code is required".into()));
        }
        if unit_price_minor < 0 {
            return Err(EdgeError::Validation(
                "unit_price_minor cannot be negative".into(),
            ));
        }
        Ok(())
    }

    fn insert_subject(
        tx: &Transaction<'_>,
        epc: &str,
        sku_code: &str,
        unit_price_minor: i64,
    ) -> Result<SubjectRow, EdgeError> {
        Self::validate_subject_fields(sku_code, unit_price_minor)?;
        let subject = SubjectRow {
            id: SubjectId::new(),
            epc: epc.to_owned(),
            sku_code: sku_code.trim().to_ascii_uppercase(),
            unit_price_minor,
        };
        tx.execute(
            "INSERT INTO inventory_subject(id,epc,sku_code,unit_price_minor,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![
                subject.id.to_string(),
                subject.epc,
                subject.sku_code,
                subject.unit_price_minor,
                now_text()
            ],
        )
        .map_err(|error| match error {
            rusqlite::Error::SqliteFailure(_, Some(message)) if message.contains("inventory_subject.epc") => {
                EdgeError::Conflict(format!("EPC {epc} already exists on this edge"))
            }
            other => db(other),
        })?;
        Ok(subject)
    }

    fn subject_by_epc(tx: &Transaction<'_>, epc: &str) -> Result<SubjectRow, EdgeError> {
        tx.query_row(
            "SELECT id,epc,sku_code,unit_price_minor FROM inventory_subject WHERE epc=?1",
            [epc],
            |row| {
                let id: String = row.get(0)?;
                Ok((id, row.get(1)?, row.get(2)?, row.get(3)?))
            },
        )
        .optional()
        .map_err(db)?
        .map(|(id, epc, sku_code, unit_price_minor)| {
            Uuid::parse_str(&id)
                .map(|id| SubjectRow {
                    id: SubjectId(id),
                    epc,
                    sku_code,
                    unit_price_minor,
                })
                .map_err(|error| EdgeError::Persistence(error.to_string()))
        })
        .transpose()?
        .ok_or_else(|| EdgeError::NotFound(format!("EPC {epc}")))
    }

    fn operational_balance(
        tx: &Transaction<'_>,
        subject_id: SubjectId,
        place_id: &str,
    ) -> Result<i64, EdgeError> {
        tx.query_row(
            "SELECT quantity FROM inventory_projection WHERE subject_id=?1 AND place_id=?2",
            params![subject_id.to_string(), place_id],
            |row| row.get(0),
        )
        .optional()
        .map(|quantity| quantity.unwrap_or(0))
        .map_err(db)
    }

    fn decrement_projection(
        tx: &Transaction<'_>,
        subject_id: SubjectId,
        place_id: &str,
        quantity: i64,
    ) -> Result<(), EdgeError> {
        let balance = Self::operational_balance(tx, subject_id, place_id)?;
        if balance < quantity {
            return Err(EdgeError::Conflict(format!(
                "insufficient quantity at {place_id}: have {balance}, need {quantity}"
            )));
        }
        if balance == quantity {
            tx.execute(
                "DELETE FROM inventory_projection WHERE subject_id=?1 AND place_id=?2",
                params![subject_id.to_string(), place_id],
            )
            .map_err(db)?;
        } else {
            tx.execute(
                "UPDATE inventory_projection SET quantity=quantity-?3,updated_at=?4 WHERE subject_id=?1 AND place_id=?2",
                params![subject_id.to_string(), place_id, quantity, now_text()],
            )
            .map_err(db)?;
        }
        Ok(())
    }

    fn increment_projection(
        tx: &Transaction<'_>,
        subject_id: SubjectId,
        place_id: &str,
        quantity: i64,
    ) -> Result<(), EdgeError> {
        tx.execute(
            "INSERT INTO inventory_projection(subject_id,place_id,quantity,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(subject_id,place_id) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=excluded.updated_at",
            params![subject_id.to_string(), place_id, quantity, now_text()],
        )
        .map_err(db)?;
        Ok(())
    }

    fn append_command(
        &self,
        tx: &Transaction<'_>,
        idempotency_key: &str,
        command: &MovementCommand,
    ) -> Result<CommandResult, EdgeError> {
        Self::append_movement(&self.node, tx, idempotency_key, command)
    }

    /// The movement funnel itself, needing only the node's identity rather
    /// than a whole open edge.
    ///
    /// Almost every movement originates in someone at the site doing
    /// something, and goes through `append_command`. One does not: when head
    /// office settles what a delivery actually IS, the goods stop being
    /// unidentified at that moment, and the instruction arrives down the
    /// command lane rather than from a pair of hands on site. That applier
    /// has a transaction and the node's own metadata, but no `SqliteEdge`, so
    /// the funnel is reachable without one.
    pub(crate) fn append_movement(
        node: &NodeContext,
        tx: &Transaction<'_>,
        idempotency_key: &str,
        command: &MovementCommand,
    ) -> Result<CommandResult, EdgeError> {
        validate_command(command)?;
        for line in &command.lines {
            node.authorize_line(command.cause, line)?;
            if line.from.is_company() {
                Self::decrement_projection(tx, line.subject_id, &line.from.id(), line.quantity)?;
            }
        }
        tx.execute(
            "INSERT INTO movement_group(id,idempotency_key,cause,reason,reference_type,reference_id,actor_id,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                command.movement_group_id.to_string(),
                idempotency_key,
                command.cause.as_str(),
                command.reason,
                command.reference_type,
                command.reference_id,
                command.actor_id,
                time_text(command.occurred_at)
            ],
        )
        .map_err(db)?;
        for line in &command.lines {
            let movement_id = MovementId::new();
            tx.execute(
                "INSERT INTO movement(id,movement_group_id,subject_id,quantity,from_place_id,to_place_id,cause,reference_type,reference_id,actor_id,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    movement_id.to_string(),
                    command.movement_group_id.to_string(),
                    line.subject_id.to_string(),
                    line.quantity,
                    line.from.id(),
                    line.to.id(),
                    command.cause.as_str(),
                    command.reference_type,
                    command.reference_id,
                    command.actor_id,
                    time_text(command.occurred_at)
                ],
            )
            .map_err(db)?;
            if line.to.is_company() {
                Self::increment_projection(tx, line.subject_id, &line.to.id(), line.quantity)?;
            }
        }
        // The movement itself travels, in the SAME transaction as the ledger
        // write. This is the history: which item, from where to where, under
        // what cause, by whom. The centre cannot reconstruct any of that from
        // a position — a balance that fell by one says nothing about whether
        // the unit was sold, written off or stolen, and that distinction is
        // the whole of shrinkage.
        //
        // The observed position travels too, but on its own cadence (see
        // `capture_pool_snapshot`), because its job is different: it is the
        // independent cross-check against what the centre computes from these
        // facts, and a cross-check that arrives with every fact it is meant to
        // check costs full price and proves nothing extra.
        let mut subject_identity: std::collections::HashMap<Uuid, (String, String)> =
            std::collections::HashMap::new();
        for line in &command.lines {
            if let Ok((epc, sku)) = tx.query_row(
                "SELECT epc, sku_code FROM inventory_subject WHERE id = ?1",
                params![line.subject_id.0.to_string()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            ) {
                subject_identity.insert(line.subject_id.0, (epc, sku));
            }
        }
        let lines: Vec<serde_json::Value> = command
            .lines
            .iter()
            .map(|line| {
                serde_json::json!({
                    "subject_id": line.subject_id.0,
                    "quantity": line.quantity,
                    "from_place_id": line.from.id(),
                    "to_place_id": line.to.id(),
                    // The item's own identity travels with the movement. A
                    // fact that names a subject the reader has never seen is
                    // not interpretable on its own, and the centre would have
                    // to be told about every EPC by some other route first.
                    // Carrying it here is also what lets the centre hold ONE
                    // row per physical item across DC and shop, which is the
                    // precondition for a fleet total that does not double
                    // count goods in transit.
                    "epc": subject_identity.get(&line.subject_id.0)
                        .map(|(epc, _)| epc.clone()),
                    "sku_code": subject_identity.get(&line.subject_id.0)
                        .map(|(_, sku)| sku.clone()),
                })
            })
            .collect();
        crate::edge::sync::enqueue_fact(
            tx,
            command.movement_group_id.0,
            "inventory.movement",
            &serde_json::json!({
                "movement_group_id": command.movement_group_id.0,
                "cause": command.cause.as_str(),
                "reason": command.reason,
                "reference_type": command.reference_type,
                "reference_id": command.reference_id,
                "actor_id": command.actor_id,
                "occurred_at": command.occurred_at,
                "lines": lines,
            }),
        )
        .map_err(db)?;
        Ok(CommandResult {
            movement_group_id: command.movement_group_id.0,
            movement_count: command.lines.len(),
            occurred_at: command.occurred_at,
        })
    }

    fn normalized_store_id(value: &str) -> Result<SiteId, EdgeError> {
        let site = SiteId::new(value).map_err(|error| EdgeError::Validation(error.to_string()))?;
        if site.kind() != SiteKind::Store {
            return Err(EdgeError::Validation(
                "destination_store_id must identify a Store site".into(),
            ));
        }
        Ok(site)
    }

    fn normal_place(pool: OperationalPool) -> Place {
        Place::Operational {
            pool,
            state: InventoryState::Normal,
        }
    }

    fn fulfillment_pool(
        source_dc_id: &SiteId,
        destination_store_id: &SiteId,
        stage: FulfillmentStage,
    ) -> OperationalPool {
        match stage {
            FulfillmentStage::Packed => OperationalPool::DcOutboundPacked {
                dc_id: source_dc_id.clone(),
                store_id: destination_store_id.clone(),
            },
            FulfillmentStage::Shipment => OperationalPool::DcOutboundShipment {
                dc_id: source_dc_id.clone(),
                store_id: destination_store_id.clone(),
            },
            FulfillmentStage::Loaded => OperationalPool::DcOutboundLoaded {
                dc_id: source_dc_id.clone(),
                store_id: destination_store_id.clone(),
            },
            FulfillmentStage::InTransit => OperationalPool::DcOutboundInTransit {
                dc_id: source_dc_id.clone(),
                store_id: destination_store_id.clone(),
            },
        }
    }

    fn load_fulfillment_units(
        tx: &Transaction<'_>,
        koli_id: Uuid,
    ) -> Result<Vec<FulfillmentUnitRow>, EdgeError> {
        let mut statement = tx
            .prepare(
                "SELECT unit.subject_id,unit.epc,unit.sku_code,unit.allotment_id,
                        unit.allotment_line_id,subject.unit_price_minor
                 FROM koli_unit unit
                 JOIN inventory_subject subject ON subject.id=unit.subject_id
                 WHERE unit.koli_id=?1 AND unit.released_at IS NULL
                 ORDER BY unit.epc",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([koli_id.to_string()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        rows.into_iter()
            .map(
                |(subject_id, epc, sku_code, allotment_id, line_id, unit_price_minor)| {
                    Ok(FulfillmentUnitRow {
                        subject: SubjectRow {
                            id: SubjectId(parse_uuid(&subject_id)?),
                            epc: epc.clone(),
                            sku_code: sku_code.clone(),
                            unit_price_minor,
                        },
                        allocation: PackageUnitAllocation {
                            allotment_id: parse_uuid(&allotment_id)?,
                            allotment_line_id: parse_uuid(&line_id)?,
                            sku_code,
                            epc,
                        },
                    })
                },
            )
            .collect()
    }

    fn refresh_allotment_statuses(
        tx: &Transaction<'_>,
        allotment_ids: &BTreeSet<Uuid>,
        updated_at: &str,
    ) -> Result<(), EdgeError> {
        for allotment_id in allotment_ids {
            let (accepted, picked, dispatched, cancelled): (i64, i64, i64, i64) = tx
                .query_row(
                    "SELECT COALESCE(SUM(accepted_quantity),0),
                            COALESCE(SUM(picked_quantity),0),
                            COALESCE(SUM(dispatched_quantity),0),
                            COALESCE(SUM(cancelled_quantity),0)
                     FROM dc_allotment_work_line WHERE allotment_id=?1",
                    [allotment_id.to_string()],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(db)?;
            let status = derive_allotment_status(accepted, picked, dispatched, cancelled, false)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?;
            let updated = tx
                .execute(
                    "UPDATE dc_allotment_work SET fulfillment_status=?2,updated_at=?3
                     WHERE allotment_id=?1 AND application_status='ACCEPTED'",
                    params![allotment_id.to_string(), status.as_str(), updated_at],
                )
                .map_err(db)?;
            if updated != 1 {
                return Err(EdgeError::Conflict(format!(
                    "Allotment {allotment_id} is no longer active"
                )));
            }
        }
        Ok(())
    }

    fn enqueue_fulfillment_progress(
        tx: &Transaction<'_>,
        payload: &FulfillmentProgressPayload,
    ) -> Result<i64, EdgeError> {
        payload.validate().map_err(EdgeError::Validation)?;
        let fact_seq = crate::edge::sync::enqueue_fact(
            tx,
            payload.progress_id,
            INVENTORY_FULFILLMENT_PROGRESS_V1,
            payload,
        )
        .map_err(db)?
        .ok_or_else(|| {
            EdgeError::Persistence("edge fulfillment progress capture is disabled".into())
        })?;
        tx.execute(
            "INSERT INTO dc_fulfillment_progress_event
                 (progress_id,koli_id,source_site_id,destination_store_id,stage,
                  shipment_reference,movement_group_id,actor_id,occurred_at,units_json,fact_seq)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                payload.progress_id.to_string(),
                payload.koli_id.to_string(),
                payload.source_site_id,
                payload.destination_store_id,
                payload.stage.as_str(),
                payload.shipment_reference,
                payload.movement_group_id.to_string(),
                payload.actor_id,
                time_text(payload.occurred_at),
                serde_json::to_string(&payload.units)
                    .map_err(|error| EdgeError::Persistence(error.to_string()))?,
                fact_seq
            ],
        )
        .map_err(db)?;
        Ok(fact_seq)
    }

    fn fulfillment_result(payload: FulfillmentProgressPayload) -> FulfillmentProgressResult {
        FulfillmentProgressResult {
            progress_id: payload.progress_id,
            koli_id: payload.koli_id,
            source_site_id: payload.source_site_id,
            destination_store_id: payload.destination_store_id,
            stage: payload.stage,
            shipment_reference: payload.shipment_reference,
            movement_group_id: payload.movement_group_id,
            actor_id: payload.actor_id,
            occurred_at: payload.occurred_at,
            units: payload.units,
        }
    }

    fn advance_fulfillment_package_impl(
        &self,
        koli_id: Uuid,
        stage: FulfillmentStage,
        shipment_reference: Option<String>,
        actor_id: String,
        idempotency_key: String,
        request_json: String,
    ) -> Result<FulfillmentProgressResult, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "only DC Edge can advance fulfillment packages".into(),
            ));
        }
        Self::validate_command_identity(&idempotency_key, &actor_id)?;
        let expected_previous = stage.previous().ok_or_else(|| {
            EdgeError::Validation("PACKED must be created through the Pack endpoint".into())
        })?;
        let operation = format!("DC_FULFILLMENT_{}", stage.as_str());
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) =
            Self::load_idempotent(&tx, &idempotency_key, &operation, &request_json)?
        {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        let (destination_store_id, current_status, stored_reference): (
            String,
            String,
            Option<String>,
        ) = tx
            .query_row(
                "SELECT destination_store_id,status,shipment_reference
                 FROM koli WHERE koli_id=?1",
                [koli_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?
            .ok_or_else(|| EdgeError::NotFound(format!("koli {koli_id}")))?;
        if current_status != expected_previous.as_str() {
            return Err(EdgeError::Conflict(format!(
                "package {koli_id} is {current_status}, expected {} before {}",
                expected_previous.as_str(),
                stage.as_str()
            )));
        }
        let destination_store = Self::normalized_store_id(&destination_store_id)?;
        let shipment_reference = match stage {
            FulfillmentStage::Shipment => {
                let reference = shipment_reference
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        EdgeError::Validation(
                            "shipment_reference is required when creating Shipment".into(),
                        )
                    })?;
                Some(reference.to_owned())
            }
            FulfillmentStage::Loaded | FulfillmentStage::InTransit => {
                if shipment_reference.is_some() {
                    return Err(EdgeError::Validation(
                        "shipment_reference is established only at Shipment".into(),
                    ));
                }
                Some(stored_reference.ok_or_else(|| {
                    EdgeError::Persistence(format!(
                        "package {koli_id} has no persisted shipment_reference"
                    ))
                })?)
            }
            FulfillmentStage::Packed => unreachable!(),
        };

        let units = Self::load_fulfillment_units(&tx, koli_id)?;
        if units.is_empty() {
            return Err(EdgeError::Persistence(format!(
                "package {koli_id} has no active units"
            )));
        }
        let from_pool =
            Self::fulfillment_pool(&self.node.site_id, &destination_store, expected_previous);
        let to_pool = Self::fulfillment_pool(&self.node.site_id, &destination_store, stage);
        let from = Self::normal_place(from_pool);
        let to = Self::normal_place(to_pool);
        for unit in &units {
            let quantity = Self::operational_balance(&tx, unit.subject.id, &from.id())?;
            if quantity != 1 {
                return Err(EdgeError::Conflict(format!(
                    "package EPC {} has quantity {quantity} at {}, expected exactly one",
                    unit.subject.epc,
                    from.id()
                )));
            }
        }

        let occurred_at = Utc::now();
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: units
                .iter()
                .map(|unit| MovementLine {
                    subject_id: unit.subject.id,
                    quantity: 1,
                    from: from.clone(),
                    to: to.clone(),
                })
                .collect(),
            cause: MovementCause::NormalMove,
            reference_type: Some("FULFILLMENT_PACKAGE".into()),
            reference_id: Some(koli_id.to_string()),
            reason: format!("Package {} entered {}", koli_id, stage.as_str()),
            actor_id: actor_id.clone(),
            occurred_at,
        };
        let movement = self.append_command(&tx, &idempotency_key, &command)?;
        let updated_at = time_text(occurred_at);
        let mut touched_allotments = BTreeSet::new();
        for unit in &units {
            let (unit_sql, line_sql) = match stage {
                FulfillmentStage::Shipment => (
                    "UPDATE koli_unit
                     SET current_stage='SHIPMENT',stage_rank=3,shipment_at=?3,updated_at=?3
                     WHERE koli_id=?1 AND epc=?2 AND current_stage='PACKED' AND stage_rank=2",
                    "UPDATE dc_allotment_work_line
                     SET shipment_quantity=shipment_quantity+1,updated_at=?2
                     WHERE allotment_line_id=?1 AND packed_quantity-shipment_quantity>=1",
                ),
                FulfillmentStage::Loaded => (
                    "UPDATE koli_unit
                     SET current_stage='LOADED',stage_rank=4,dispatched_at=?3,updated_at=?3
                     WHERE koli_id=?1 AND epc=?2 AND current_stage='SHIPMENT' AND stage_rank=3",
                    "UPDATE dc_allotment_work_line
                     SET dispatched_quantity=dispatched_quantity+1,updated_at=?2
                     WHERE allotment_line_id=?1 AND shipment_quantity-dispatched_quantity>=1",
                ),
                FulfillmentStage::InTransit => (
                    "UPDATE koli_unit
                     SET current_stage='IN_TRANSIT',stage_rank=5,in_transit_at=?3,updated_at=?3
                     WHERE koli_id=?1 AND epc=?2 AND current_stage='LOADED' AND stage_rank=4",
                    "UPDATE dc_allotment_work_line
                     SET in_transit_quantity=in_transit_quantity+1,updated_at=?2
                     WHERE allotment_line_id=?1 AND dispatched_quantity-in_transit_quantity>=1",
                ),
                FulfillmentStage::Packed => unreachable!(),
            };
            if tx
                .execute(
                    unit_sql,
                    params![koli_id.to_string(), unit.subject.epc, updated_at],
                )
                .map_err(db)?
                != 1
            {
                return Err(EdgeError::Conflict(format!(
                    "package EPC {} cannot advance to {}",
                    unit.subject.epc,
                    stage.as_str()
                )));
            }
            if tx
                .execute(
                    line_sql,
                    params![unit.allocation.allotment_line_id.to_string(), updated_at],
                )
                .map_err(db)?
                != 1
            {
                return Err(EdgeError::Conflict(format!(
                    "Allotment line {} cannot advance to {}",
                    unit.allocation.allotment_line_id,
                    stage.as_str()
                )));
            }
            touched_allotments.insert(unit.allocation.allotment_id);
        }
        if tx
            .execute(
                "UPDATE koli
                 SET status=?2,shipment_reference=?3,updated_at=?4
                 WHERE koli_id=?1 AND status=?5",
                params![
                    koli_id.to_string(),
                    stage.as_str(),
                    shipment_reference,
                    updated_at,
                    expected_previous.as_str()
                ],
            )
            .map_err(db)?
            != 1
        {
            return Err(EdgeError::Conflict(format!(
                "package {koli_id} cannot advance to {}",
                stage.as_str()
            )));
        }
        Self::refresh_allotment_statuses(&tx, &touched_allotments, &updated_at)?;

        let payload = FulfillmentProgressPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            progress_id: Uuid::new_v4(),
            koli_id,
            source_site_id: self.node.site_id.to_string(),
            destination_store_id: destination_store.to_string(),
            stage,
            shipment_reference: shipment_reference.clone(),
            movement_group_id: movement.movement_group_id,
            actor_id: actor_id.clone(),
            occurred_at,
            units: units.iter().map(|unit| unit.allocation.clone()).collect(),
        };
        Self::enqueue_fulfillment_progress(&tx, &payload)?;
        if stage == FulfillmentStage::InTransit {
            for unit in &units {
                let claim = TransferClaimPayload::new(
                    TransferClaimKind::InTransit,
                    Some(self.node.site_id.to_string()),
                    destination_store.to_string(),
                    shipment_reference.clone(),
                    unit.subject.epc.clone(),
                    unit.subject.sku_code.clone(),
                    movement.movement_group_id,
                    None,
                    occurred_at,
                )
                .map_err(|error| EdgeError::Validation(error.to_string()))?;
                Self::enqueue_transfer_claim(&tx, &claim)?;
            }
        }
        Self::enqueue_pool_snapshot(&tx, &self.node, Uuid::new_v4())?;
        let response = Self::fulfillment_result(payload);
        Self::save_idempotent(&tx, &idempotency_key, &operation, &request_json, &response)?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn official_count_lines(
        connection: &Connection,
        count_id: Uuid,
    ) -> Result<Vec<EdgeOfficialCountLine>, EdgeError> {
        let mut statement = connection
            .prepare(
                "WITH epcs AS (
                     SELECT epc FROM dc_official_count_expected WHERE count_id=?1
                     UNION
                     SELECT epc FROM dc_official_count_entry WHERE count_id=?1
                 )
                 SELECT epcs.epc,COALESCE(expected.sku_code,entry.sku_code),
                        COALESCE(expected.expected_quantity,0),
                        COALESCE(entry.found_quantity,0)
                 FROM epcs
                 LEFT JOIN dc_official_count_expected expected
                   ON expected.count_id=?1 AND expected.epc=epcs.epc
                 LEFT JOIN dc_official_count_entry entry
                   ON entry.count_id=?1 AND entry.epc=epcs.epc
                 ORDER BY epcs.epc",
            )
            .map_err(db)?;
        let lines = statement
            .query_map([count_id.to_string()], |row| {
                let expected_quantity = row.get::<_, i64>(2)?;
                let found_quantity = row.get::<_, i64>(3)?;
                Ok(EdgeOfficialCountLine {
                    epc: row.get(0)?,
                    sku_code: row.get(1)?,
                    expected_quantity,
                    found_quantity,
                    adjustment_quantity: found_quantity - expected_quantity,
                })
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        Ok(lines)
    }

    fn official_count_summary(
        connection: &Connection,
        count_id: Uuid,
    ) -> Result<EdgeOfficialCountSummary, EdgeError> {
        let row = connection
            .query_row(
                "SELECT work.site_id,work.pool_id,work.kind,work.status,work.reason,
                        work.created_by,work.created_at,work.activated_at,work.submitted_at,
                        work.closed_at,work.scope_json,work.result_id,work.adjustment_id,
                        work.adjustment_completion_id,adjustment.status,
                        adjustment.movement_group_ids_json
                 FROM dc_official_count_work work
                 LEFT JOIN dc_official_count_adjustment adjustment
                   ON adjustment.count_id=work.count_id
                 WHERE work.count_id=?1",
                [count_id.to_string()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, Option<String>>(11)?,
                        row.get::<_, Option<String>>(12)?,
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, Option<String>>(14)?,
                        row.get::<_, Option<String>>(15)?,
                    ))
                },
            )
            .optional()
            .map_err(db)?
            .ok_or_else(|| EdgeError::NotFound(format!("Official Count {count_id}")))?;
        let lines = Self::official_count_lines(connection, count_id)?;
        let mut expected = 0_i64;
        let mut found = 0_i64;
        let mut match_epcs = 0_i64;
        let mut shortage_epcs = 0_i64;
        let mut gain_epcs = 0_i64;
        for line in &lines {
            expected = expected
                .checked_add(line.expected_quantity)
                .ok_or_else(|| EdgeError::Persistence("count expected total overflow".into()))?;
            found = found
                .checked_add(line.found_quantity)
                .ok_or_else(|| EdgeError::Persistence("count found total overflow".into()))?;
            match line.adjustment_quantity.cmp(&0) {
                std::cmp::Ordering::Less => shortage_epcs += 1,
                std::cmp::Ordering::Equal => match_epcs += 1,
                std::cmp::Ordering::Greater => gain_epcs += 1,
            }
        }
        let movement_group_ids = row
            .15
            .as_deref()
            .map(serde_json::from_str::<Vec<Uuid>>)
            .transpose()
            .map_err(|error| EdgeError::Persistence(error.to_string()))?
            .unwrap_or_default();
        Ok(EdgeOfficialCountSummary {
            count_id,
            site_id: row.0,
            pool_id: row.1,
            kind: row.2,
            status: row.3,
            reason: row.4,
            created_by: row.5,
            created_at: parse_time(&row.6)?,
            activated_at: parse_time(&row.7)?,
            submitted_at: row.8.as_deref().map(parse_time).transpose()?,
            closed_at: row.9.as_deref().map(parse_time).transpose()?,
            scope: serde_json::from_str(&row.10)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?,
            result_id: row.11.as_deref().map(parse_uuid).transpose()?,
            adjustment_id: row.12.as_deref().map(parse_uuid).transpose()?,
            adjustment_completion_id: row.13.as_deref().map(parse_uuid).transpose()?,
            adjustment_status: row.14,
            movement_group_ids,
            expected,
            found,
            match_epcs,
            shortage_epcs,
            gain_epcs,
        })
    }

    fn official_count_detail(
        connection: &Connection,
        count_id: Uuid,
    ) -> Result<EdgeOfficialCountDetail, EdgeError> {
        Ok(EdgeOfficialCountDetail {
            summary: Self::official_count_summary(connection, count_id)?,
            lines: Self::official_count_lines(connection, count_id)?,
        })
    }

    fn record_official_count_entries_impl(
        &self,
        count_id: Uuid,
        mut request: OfficialCountEntriesRequest,
    ) -> Result<EdgeOfficialCountDetail, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "only a DC Edge can execute an Official Count".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        if request.entries.is_empty() {
            return Err(EdgeError::Validation(
                "Official Count entries cannot be empty".into(),
            ));
        }
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        let mut epcs = HashSet::new();
        for entry in &mut request.entries {
            entry.epc = Self::normalized_epc(&entry.epc)?;
            entry.sku_code = entry.sku_code.trim().to_ascii_uppercase();
            if entry.sku_code.is_empty() {
                return Err(EdgeError::Validation("sku_code is required".into()));
            }
            if !(0..=1).contains(&entry.found_quantity) {
                return Err(EdgeError::Validation(
                    "EPC found_quantity must be zero or one".into(),
                ));
            }
            if !epcs.insert(entry.epc.clone()) {
                return Err(EdgeError::Validation(format!(
                    "duplicate Official Count EPC {}",
                    entry.epc
                )));
            }
        }
        request
            .entries
            .sort_by(|left, right| left.epc.cmp(&right.epc));
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_OFFICIAL_COUNT_ENTRIES",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let (site_id, status, scope_json): (String, String, String) = tx
            .query_row(
                "SELECT site_id,status,scope_json FROM dc_official_count_work WHERE count_id=?1",
                [count_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?
            .ok_or_else(|| EdgeError::NotFound(format!("Official Count {count_id}")))?;
        if site_id != self.node.site_id.as_str() {
            return Err(EdgeError::Forbidden(
                "Official Count belongs to a different DC".into(),
            ));
        }
        if status != "ACTIVE" {
            return Err(EdgeError::Conflict(format!(
                "Official Count entries require ACTIVE status, currently {status}"
            )));
        }
        let scope: crate::sync::workflow::OfficialCountScope = serde_json::from_str(&scope_json)
            .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        for entry in &request.entries {
            if (!scope.sku_codes.is_empty() && !scope.sku_codes.contains(&entry.sku_code))
                || (!scope.epcs.is_empty() && !scope.epcs.contains(&entry.epc))
            {
                return Err(EdgeError::Validation(format!(
                    "EPC {} / SKU {} is outside the Official Count scope",
                    entry.epc, entry.sku_code
                )));
            }
            let expected: Option<(String, String)> = tx
                .query_row(
                    "SELECT subject_id,sku_code FROM dc_official_count_expected
                     WHERE count_id=?1 AND epc=?2",
                    params![count_id.to_string(), entry.epc],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(db)?;
            let existing_subject: Option<(String, String)> = tx
                .query_row(
                    "SELECT id,sku_code FROM inventory_subject WHERE epc=?1",
                    [entry.epc.as_str()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(db)?;
            let subject_id = if let Some((expected_subject_id, expected_sku)) = expected {
                if expected_sku != entry.sku_code {
                    return Err(EdgeError::Conflict(format!(
                        "EPC {} is expected as SKU {}, not {}",
                        entry.epc, expected_sku, entry.sku_code
                    )));
                }
                if existing_subject.as_ref().is_none_or(|(subject_id, sku)| {
                    subject_id != &expected_subject_id || sku != &entry.sku_code
                }) {
                    return Err(EdgeError::Persistence(format!(
                        "expected EPC {} has inconsistent local subject identity",
                        entry.epc
                    )));
                }
                expected_subject_id
            } else {
                if entry.found_quantity == 0 {
                    return Err(EdgeError::Validation(format!(
                        "entry-only EPC {} must be physically found",
                        entry.epc
                    )));
                }
                match existing_subject {
                    Some((subject_id, sku_code)) => {
                        if sku_code != entry.sku_code {
                            return Err(EdgeError::Conflict(format!(
                                "EPC {} already identifies SKU {}",
                                entry.epc, sku_code
                            )));
                        }
                        let positioned: i64 = tx
                            .query_row(
                                "SELECT COALESCE(SUM(quantity),0) FROM inventory_projection WHERE subject_id=?1",
                                [subject_id.as_str()],
                                |row| row.get(0),
                            )
                            .map_err(db)?;
                        if positioned != 0 {
                            return Err(EdgeError::Conflict(format!(
                                "entry-only EPC {} already has an inventory position",
                                entry.epc
                            )));
                        }
                        subject_id
                    }
                    None => {
                        let base_price_minor: i64 = tx
                            .query_row(
                                "SELECT base_price_minor FROM catalog_item
                                 WHERE sku_code=?1 AND active=1 AND base_price_minor IS NOT NULL",
                                [entry.sku_code.as_str()],
                                |row| row.get(0),
                            )
                            .optional()
                            .map_err(db)?
                            .ok_or_else(|| {
                                EdgeError::Validation(format!(
                                    "SKU {} has no active canonical catalogue price for count gain",
                                    entry.sku_code
                                ))
                            })?;
                        Self::insert_subject(&tx, &entry.epc, &entry.sku_code, base_price_minor)?
                            .id
                            .to_string()
                    }
                }
            };
            tx.execute(
                "INSERT INTO dc_official_count_entry
                     (count_id,subject_id,epc,sku_code,found_quantity,actor_id,recorded_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(count_id,subject_id) DO UPDATE SET
                     epc=excluded.epc,sku_code=excluded.sku_code,
                     found_quantity=excluded.found_quantity,
                     actor_id=excluded.actor_id,recorded_at=excluded.recorded_at",
                params![
                    count_id.to_string(),
                    subject_id,
                    entry.epc,
                    entry.sku_code,
                    entry.found_quantity,
                    request.actor_id,
                    now_text(),
                ],
            )
            .map_err(db)?;
        }
        let response = Self::official_count_detail(&tx, count_id)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_OFFICIAL_COUNT_ENTRIES",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn submit_official_count_impl(
        &self,
        count_id: Uuid,
        mut request: OfficialCountSubmitRequest,
    ) -> Result<OfficialCountSubmitResult, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "only a DC Edge can submit an Official Count".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_OFFICIAL_COUNT_SUBMIT",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let (site_id, pool_id, status): (String, String, String) = tx
            .query_row(
                "SELECT site_id,pool_id,status FROM dc_official_count_work WHERE count_id=?1",
                [count_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(db)?
            .ok_or_else(|| EdgeError::NotFound(format!("Official Count {count_id}")))?;
        if site_id != self.node.site_id.as_str() {
            return Err(EdgeError::Forbidden(
                "Official Count belongs to a different DC".into(),
            ));
        }
        if status != "ACTIVE" {
            return Err(EdgeError::Conflict(format!(
                "Official Count submission requires ACTIVE status, currently {status}"
            )));
        }
        let lines = Self::official_count_lines(&tx, count_id)?;
        let submitted_at = Utc::now();
        let result_id = Uuid::new_v4();
        let payload = OfficialCountResultPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            result_id,
            count_id,
            site_id,
            pool_id,
            actor_id: request.actor_id.clone(),
            submitted_at,
            lines: lines
                .iter()
                .map(|line| OfficialCountResultLine {
                    epc: line.epc.clone(),
                    sku_code: line.sku_code.clone(),
                    expected_quantity: line.expected_quantity,
                    found_quantity: line.found_quantity,
                })
                .collect(),
        };
        payload.validate().map_err(EdgeError::Validation)?;
        let fact_seq = crate::edge::sync::enqueue_fact(
            &tx,
            result_id,
            INVENTORY_OFFICIAL_COUNT_RESULT_V1,
            &payload,
        )
        .map_err(db)?
        .ok_or_else(|| EdgeError::Persistence("edge count fact capture is disabled".into()))?;
        let updated = tx
            .execute(
                "UPDATE dc_official_count_work
                 SET status='SUBMITTED',submitted_at=?2,result_id=?3,result_fact_seq=?4
                 WHERE count_id=?1 AND status='ACTIVE' AND result_id IS NULL",
                params![
                    count_id.to_string(),
                    time_text(submitted_at),
                    result_id.to_string(),
                    fact_seq,
                ],
            )
            .map_err(db)?;
        if updated != 1 {
            return Err(EdgeError::Conflict(
                "Official Count stopped being ACTIVE during submission".into(),
            ));
        }
        let response = OfficialCountSubmitResult {
            count_id,
            result_id,
            status: "SUBMITTED".into(),
            submitted_at,
            lines,
        };
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_OFFICIAL_COUNT_SUBMIT",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn base_pools(node: &NodeContext) -> Vec<OperationalPool> {
        match node.role {
            EdgeRole::Dc => vec![
                OperationalPool::DcPendingUnidentified {
                    dc_id: node.site_id.clone(),
                },
                OperationalPool::DcPendingUntagged {
                    dc_id: node.site_id.clone(),
                },
                OperationalPool::DcWarehouse {
                    dc_id: node.site_id.clone(),
                },
                OperationalPool::DcRejectDc {
                    dc_id: node.site_id.clone(),
                },
            ],
            EdgeRole::Store => vec![
                OperationalPool::StoreWarehouse {
                    store_id: node.site_id.clone(),
                },
                OperationalPool::StoreFloor {
                    store_id: node.site_id.clone(),
                },
                OperationalPool::StoreReject {
                    store_id: node.site_id.clone(),
                },
            ],
        }
    }

    pub(crate) fn collect_pool_balances(
        connection: &Connection,
        node: &NodeContext,
    ) -> Result<Vec<PoolBalance>, EdgeError> {
        let mut ids: BTreeSet<String> = Self::base_pools(node)
            .into_iter()
            .map(|pool| pool.id())
            .collect();
        let mut statement = connection
            .prepare("SELECT DISTINCT place_id FROM inventory_projection")
            .map_err(db)?;
        let place_ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(db)?;
        for place_id in place_ids {
            let place_id = place_id.map_err(db)?;
            if let Ok(place) = Place::from_str(&place_id) {
                if let Some(pool) = place.pool() {
                    if node.owns_pool(pool) {
                        ids.insert(pool.id());
                    }
                }
            }
        }
        ids.into_iter()
            .map(|pool_id| {
                let normal: i64 = connection
                    .query_row(
                        "SELECT COALESCE(SUM(quantity),0) FROM inventory_projection WHERE place_id=?1",
                        [format!("{pool_id}:on_hand")],
                        |row| row.get(0),
                    )
                    .map_err(db)?;
                let missing: i64 = connection
                    .query_row(
                        "SELECT COALESCE(SUM(quantity),0) FROM inventory_projection WHERE place_id=?1",
                        [format!("{pool_id}:missing")],
                        |row| row.get(0),
                    )
                    .map_err(db)?;
                let allotted = if node.role == EdgeRole::Dc {
                    let planned: i64 = connection
                        .query_row(
                            // What is still RESERVED in this pool. Pick is a
                            // quantity-only fulfillment fact and releases that
                            // reservation; exact EPC movement begins at Pack.
                            "SELECT COALESCE(SUM(line.accepted_quantity-line.picked_quantity-line.cancelled_quantity),0)
                             FROM dc_allotment_work_line line
                             JOIN dc_allotment_work work ON work.allotment_id=line.allotment_id
                             WHERE line.source_pool_id=?1
                               AND work.application_status='ACCEPTED'",
                            [&pool_id],
                            |row| row.get(0),
                        )
                        .map_err(db)?;
                    if planned < 0 || planned > normal {
                        return Err(EdgeError::Persistence(format!(
                            "pool {pool_id} reservation {planned} is outside physical normal quantity {normal}"
                        )));
                    }
                    Some(planned)
                } else {
                    None
                };
                Ok(PoolBalance {
                    pool_id,
                    site_id: node.site_id.clone(),
                    stock: normal + missing,
                    allotted,
                    on_hand: normal - allotted.unwrap_or_default(),
                    missing,
                })
            })
            .collect()
    }
}

/// One priced line, on its way from the engine into the ledger and the fact.
///
/// A named struct rather than a tuple because it is destructured three lines
/// apart from where it is built, and a tuple whose second element changed
/// meaning between the two branches is how `line_total_minor` came to be stored
/// in a column called `unit_price_minor` without anybody noticing.
struct PricedLine {
    /// What this unit was actually charged, after markdown and promotions.
    charged_minor: i64,
    /// What it would have been before a clearance replaced the price, when a
    /// book was in force to say so.
    base_minor: Option<i64>,
    /// Which clearance set it, when one did. Named rather than reconstructed:
    /// joining back by sku and version and date guesses at which markdown
    /// covered that instant, and a guess is not what a margin report should be
    /// built on.
    markdown_id: Option<String>,
    price_source: String,
    publication_version: Option<i64>,
}

impl EdgeInventory for SqliteEdge {
    fn open_print_session(
        &self,
        request: crate::edge::printing::OpenPrintSessionRequest,
    ) -> Result<crate::edge::printing::PrintSessionSummary, EdgeError> {
        self.require_dc("printing happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::printing::open_session(&mut connection, request)
    }

    fn run_print_chunk(
        &self,
        session_id: &str,
    ) -> Result<crate::edge::printing::PrintChunkReport, EdgeError> {
        use crate::edge::printing;
        self.require_dc("printing happens at a DC")?;

        // The lock is taken to claim, released for the socket, and taken again
        // to record. A printer that has jammed must not stop every other
        // request on this node while it decides.
        let chunk = {
            let mut connection = self.lock()?;
            printing::claim_chunk(&mut connection, session_id)?
        };
        if chunk.labels.is_empty() {
            let connection = self.lock()?;
            return Ok(printing::PrintChunkReport {
                attempted: 0,
                printed: 0,
                failed: 0,
                session: printing::summarise(&connection, session_id)?,
            });
        }

        let outcomes =
            printing::dispatch_chunk(&chunk.printer_host, chunk.printer_port, &chunk.labels);
        let printed = outcomes.iter().filter(|o| o.error.is_none()).count();

        let mut connection = self.lock()?;
        let session = printing::record_outcomes(&mut connection, session_id, &outcomes)?;
        Ok(printing::PrintChunkReport {
            attempted: outcomes.len(),
            printed,
            failed: outcomes.len() - printed,
            session,
        })
    }

    fn print_session(
        &self,
        session_id: &str,
    ) -> Result<crate::edge::printing::PrintSessionSummary, EdgeError> {
        let connection = self.lock()?;
        crate::edge::printing::summarise(&connection, session_id)
    }

    fn job_print_session(
        &self,
        job_id: &str,
    ) -> Result<Option<crate::edge::printing::PrintSessionSummary>, EdgeError> {
        let connection = self.lock()?;
        crate::edge::printing::session_for_job(&connection, job_id)
    }

    fn preview_job_label(
        &self,
        job_id: &str,
        request: &crate::edge::printing::LabelPreviewRequest,
    ) -> Result<crate::edge::printing::LabelPreview, EdgeError> {
        let connection = self.lock()?;
        crate::edge::printing::preview_job_label(&connection, job_id, request)
    }

    fn repoint_print_session(
        &self,
        session_id: &str,
        request: crate::edge::printing::RepointPrinterRequest,
    ) -> Result<crate::edge::printing::PrintSessionSummary, EdgeError> {
        self.require_dc("printing happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::printing::repoint(&mut connection, session_id, request)
    }

    fn reprint_labels(
        &self,
        session_id: &str,
        request: crate::edge::printing::ReprintRequest,
    ) -> Result<crate::edge::printing::PrintSessionSummary, EdgeError> {
        self.require_dc("printing happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::printing::reprint(&mut connection, session_id, request)
    }

    fn open_outbound_session(
        &self,
        kind: crate::edge::outbound::SessionKind,
        request: crate::edge::outbound::OpenSessionRequest,
    ) -> Result<crate::edge::outbound::Session, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::outbound::open_session(&mut connection, kind, request)
    }

    fn close_outbound_session(
        &self,
        kind: crate::edge::outbound::SessionKind,
        session_id: &str,
    ) -> Result<crate::edge::outbound::Session, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::outbound::close_session(&mut connection, kind, session_id)
    }

    fn assign_koli_to_session(
        &self,
        koli_id: &str,
        session_id: &str,
    ) -> Result<crate::edge::outbound::Koli, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::outbound::assign_koli_to_session(&mut connection, koli_id, session_id)
    }

    fn open_packing_box(
        &self,
        request: crate::edge::outbound::OpenPackingBoxRequest,
    ) -> Result<crate::edge::outbound::PackingBox, EdgeError> {
        self.require_dc("packing happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::outbound::open_packing_box(&mut connection, request)
    }

    fn packing_box(
        &self,
        session_id: &str,
    ) -> Result<crate::edge::outbound::PackingBox, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::load_packing_box(&connection, session_id)
    }

    fn outstanding_for_destination(
        &self,
        destination_store_id: &str,
    ) -> Result<Vec<crate::edge::outbound::OutstandingLine>, EdgeError> {
        let site = self.node.site_id.to_string();
        let connection = self.lock()?;
        crate::edge::outbound::outstanding_for_destination(&connection, &site, destination_store_id)
    }

    /// The sweep, and what follows from it.
    ///
    /// A mismatch is an ordinary answer, not an error: the packer is told what
    /// is wrong and sweeps again. Only agreement fills the box, and filling it
    /// goes through the same Pack path everything else uses — that is where the
    /// allotment attribution for each unit is worked out, and a second
    /// implementation of it would be a second thing to keep in step.
    fn capture_packing_box(
        &self,
        session_id: &str,
        reader_session_id: &str,
        actor_id: &str,
    ) -> Result<crate::edge::outbound::CaptureOutcome, EdgeError> {
        use crate::edge::outbound;
        self.require_dc("packing happens at a DC")?;

        let outcome = {
            let mut connection = self.lock()?;
            outbound::capture_box(&mut connection, session_id, reader_session_id)?
        };
        if !outcome.matched {
            return Ok(outcome);
        }

        let destination = {
            let connection = self.lock()?;
            outbound::load_packing_box(&connection, session_id)?.destination_store_id
        };
        let packed = self.pack_koli(PackKoliRequest {
            destination_store_id: destination,
            epcs: outcome.epcs.clone(),
            actor_id: actor_id.to_string(),
            idempotency_key: format!("pack-capture-{}", outcome.capture_id),
        })?;

        let koli_id = packed.koli_id.to_string();
        {
            let mut connection = self.lock()?;
            outbound::freeze_box(&mut connection, session_id, &koli_id, &outcome.capture_id)?;
        }
        // Agreement is the seal: a box whose sweep matches its target has
        // nothing left to decide, so it freezes here rather than waiting for a
        // button somebody has to remember to press.
        self.seal_koli(&koli_id, actor_id)?;
        Ok(outcome)
    }

    fn seal_koli(
        &self,
        koli_id: &str,
        sealed_by: &str,
    ) -> Result<crate::edge::outbound::KoliManifest, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::outbound::seal_koli(&mut connection, koli_id, sealed_by)
    }

    fn koli_manifest(
        &self,
        koli_id: &str,
    ) -> Result<crate::edge::outbound::KoliManifest, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::koli_manifest(&connection, koli_id)
    }

    fn print_koli_label(
        &self,
        koli_id: &str,
        request: crate::edge::outbound::PrintKoliLabelRequest,
    ) -> Result<crate::edge::outbound::KoliManifest, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        // The sticker is rendered from a read; the socket is opened without the
        // connection lock in hand, same as the label queue does.
        let manifest = {
            let connection = self.lock()?;
            crate::edge::outbound::koli_manifest_on(&connection, koli_id, request.label_size())?
        };
        crate::edge::printing::send_document(
            &request.printer_host,
            request.printer_port,
            &manifest.label_zpl,
        )?;
        Ok(manifest)
    }

    fn create_shipment(
        &self,
        request: crate::edge::outbound::CreateShipmentRequest,
    ) -> Result<crate::edge::outbound::Shipment, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        let site = self.node.site_id.to_string();
        let mut connection = self.lock()?;
        crate::edge::outbound::create_shipment(&mut connection, &site, request)
    }

    fn create_dispatch(
        &self,
        request: crate::edge::outbound::CreateDispatchRequest,
    ) -> Result<crate::edge::outbound::Dispatch, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        let site = self.node.site_id.to_string();
        let mut connection = self.lock()?;
        crate::edge::outbound::create_dispatch(&mut connection, &site, request)
    }

    fn depart_dispatch(
        &self,
        dispatch_id: &str,
    ) -> Result<crate::edge::outbound::Dispatch, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        let mut connection = self.lock()?;
        crate::edge::outbound::depart_dispatch(&mut connection, dispatch_id)
    }

    fn picklist(&self) -> Result<Vec<crate::edge::outbound::PicklistLine>, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::picklist(&connection)
    }

    fn destinations_owed(
        &self,
    ) -> Result<Vec<crate::edge::outbound::DestinationDemand>, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::destinations_owed(&connection, &self.node.site_id.to_string())
    }

    fn list_picklists(&self) -> Result<Vec<crate::edge::outbound::PicklistSummary>, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::list_picklists(&connection)
    }

    fn list_koli(
        &self,
        filter: crate::edge::outbound::ListFilter,
    ) -> Result<Vec<crate::edge::outbound::Koli>, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::list_koli(&connection, filter)
    }

    fn list_shipments(
        &self,
        filter: crate::edge::outbound::ListFilter,
    ) -> Result<Vec<crate::edge::outbound::Shipment>, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::list_shipments(&connection, filter)
    }

    fn list_dispatches(
        &self,
        filter: crate::edge::outbound::ListFilter,
    ) -> Result<Vec<crate::edge::outbound::Dispatch>, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::list_dispatches(&connection, filter)
    }

    fn list_outbound_sessions(
        &self,
        kind: crate::edge::outbound::SessionKind,
        filter: crate::edge::outbound::ListFilter,
    ) -> Result<Vec<crate::edge::outbound::Session>, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::list_sessions(&connection, kind, filter)
    }

    fn shipment_detail(
        &self,
        shipment_id: &str,
    ) -> Result<crate::edge::outbound::ShipmentDetail, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::shipment_detail(&connection, shipment_id)
    }

    fn dispatch_detail(
        &self,
        dispatch_id: &str,
    ) -> Result<crate::edge::outbound::DispatchDetail, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::dispatch_detail(&connection, dispatch_id)
    }

    fn packing_session_summary(
        &self,
        session_id: &str,
    ) -> Result<crate::edge::outbound::PackingSessionSummary, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::packing_session_summary(&connection, session_id)
    }

    fn pick_session_summary(
        &self,
        session_id: &str,
    ) -> Result<crate::edge::outbound::PickSessionSummary, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::pick_session_summary(&connection, session_id)
    }

    fn allotment_line_position(
        &self,
        allotment_line_id: &str,
    ) -> Result<crate::edge::outbound::LinePosition, EdgeError> {
        let connection = self.lock()?;
        crate::edge::outbound::allotment_line_position(&connection, allotment_line_id)
    }

    fn node(&self) -> &NodeContext {
        &self.node
    }

    fn intake_dc(&self, request: IntakeRequest) -> Result<CommandResult, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "only DC Edge can intake unidentified stock".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let epc = Self::normalized_epc(&request.epc)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) =
            Self::load_idempotent(&tx, &request.idempotency_key, "DC_INTAKE", &request_json)?
        {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let subject = Self::insert_subject(&tx, &epc, &request.sku_code, request.unit_price_minor)?;
        let occurred_at = Utc::now();
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: vec![MovementLine {
                subject_id: subject.id,
                quantity: 1,
                from: Place::System {
                    place: SystemPlace::Opening,
                },
                to: Place::Operational {
                    pool: OperationalPool::DcPendingUnidentified {
                        dc_id: self.node.site_id.clone(),
                    },
                    state: InventoryState::Normal,
                },
            }],
            cause: MovementCause::Opening,
            reference_type: Some("DC_INTAKE".into()),
            reference_id: Some(epc),
            reason: "Physical intake at DC Edge".into(),
            actor_id: request.actor_id,
            occurred_at,
        };
        let response = self.append_command(&tx, &request.idempotency_key, &command)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_INTAKE",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn pick_stock(&self, mut request: PickRequest) -> Result<PickResult, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "only DC Edge can Pick Allotment quantities".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        if request.quantity <= 0 {
            return Err(EdgeError::Validation(
                "Pick quantity must be positive".into(),
            ));
        }
        let pool = OperationalPool::from_str(request.source_pool_id.trim())
            .map_err(|error| EdgeError::Validation(error.to_string()))?;
        if !pool.is_dc_fulfillment_source_for(&self.node.site_id) {
            return Err(EdgeError::Forbidden(format!(
                "node {} cannot Pick from non-source pool {}",
                self.node.node_id,
                pool.id()
            )));
        }
        request.source_pool_id = pool.id();
        request.sku_code = request.sku_code.trim().to_ascii_uppercase();
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        if request.sku_code.is_empty() {
            return Err(EdgeError::Validation("sku_code is required".into()));
        }
        let request_json = Self::encode_idempotent_request(&request)?;

        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_ALLOTMENT_PICK",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        // Which garments come off the racks. FIFO by when they were created, so
        // the oldest stock leaves first and nothing quietly ages at the back.
        //
        // No allotment is consulted here. Picking fetches a SKU and a number;
        // which piece serves which shop is settled when it goes into a carton,
        // and a pick that had already chosen would be making that decision
        // invisibly, on the strength of nothing but an allotment's age.
        let warehouse = Place::Operational {
            pool: OperationalPool::DcWarehouse {
                dc_id: self.node.site_id.clone(),
            },
            state: InventoryState::Normal,
        };
        let picking = Place::Operational {
            pool: OperationalPool::DcOutboundPicking {
                dc_id: self.node.site_id.clone(),
            },
            state: InventoryState::Normal,
        };

        let found = {
            let mut statement = tx
                .prepare(
                    "SELECT subject.id
                     FROM inventory_projection projection
                     JOIN inventory_subject subject ON subject.id=projection.subject_id
                     WHERE projection.place_id=?1 AND projection.quantity>0
                       AND subject.sku_code=?2 AND subject.subject_type='UNIT'
                     ORDER BY subject.created_at,subject.id
                     LIMIT ?3",
                )
                .map_err(db)?;
            let rows = statement
                .query_map(
                    params![warehouse.id(), request.sku_code, request.quantity],
                    |row| row.get::<_, String>(0),
                )
                .map_err(db)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(db)?;
            rows
        };

        // A short pick is an ordinary outcome, not a failure. "Asked for 300,
        // found 200" is a statement a picker makes about the racks, and it has
        // to survive: absence of rows cannot tell it apart from a round nobody
        // has finished yet.
        let picked_quantity = i64::try_from(found.len()).unwrap_or(0);
        if picked_quantity == 0 {
            return Err(EdgeError::Conflict(format!(
                "no {} is on the racks at {}",
                request.sku_code,
                warehouse.id()
            )));
        }

        let pick_id = Uuid::new_v4();
        let occurred_at = Utc::now();
        if let Some(session_id) = request.pick_session_id.as_deref() {
            let open: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM pick_session WHERE session_id=?1 AND status='OPEN'",
                    params![session_id],
                    |row| row.get(0),
                )
                .map_err(db)?;
            if open == 0 {
                return Err(EdgeError::Conflict(format!(
                    "pick session {session_id} is not open"
                )));
            }
        }

        // Picking moves goods. Someone carries them off a rack into the
        // outbound area, and a stock count of the racks that still expected
        // them there would be looking for garments sitting in a trolley.
        let mut lines = Vec::with_capacity(found.len());
        for subject_id in &found {
            lines.push(MovementLine {
                subject_id: SubjectId(parse_uuid(subject_id)?),
                quantity: 1,
                from: warehouse.clone(),
                to: picking.clone(),
            });
        }
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines,
            cause: MovementCause::NormalMove,
            reference_type: Some("DC_PICK".into()),
            reference_id: Some(pick_id.to_string()),
            reason: format!("Pick {} of {}", picked_quantity, request.sku_code),
            actor_id: request.actor_id.clone(),
            occurred_at,
        };
        self.append_command(&tx, &request.idempotency_key, &command)?;

        let payload = PickPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            pick_id,
            source_site_id: self.node.site_id.to_string(),
            source_pool_id: request.source_pool_id.clone(),
            sku_code: request.sku_code.clone(),
            quantity: picked_quantity,
            actor_id: request.actor_id.clone(),
            occurred_at,
        };
        let fact_seq = crate::edge::sync::enqueue_fact(&tx, pick_id, INVENTORY_PICK_V1, &payload)
            .map_err(db)?
            .ok_or_else(|| EdgeError::Persistence("edge Pick capture is disabled".into()))?;

        let updated_at = time_text(occurred_at);
        let touched_allotments: BTreeSet<Uuid> = BTreeSet::new();
        for allotment_id in touched_allotments {
            let (accepted, picked, dispatched, cancelled): (i64, i64, i64, i64) = tx
                .query_row(
                    "SELECT COALESCE(SUM(accepted_quantity),0),
                            COALESCE(SUM(picked_quantity),0),
                            COALESCE(SUM(dispatched_quantity),0),
                            COALESCE(SUM(cancelled_quantity),0)
                     FROM dc_allotment_work_line WHERE allotment_id=?1",
                    [allotment_id.to_string()],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(db)?;
            let status = derive_allotment_status(accepted, picked, dispatched, cancelled, false)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?;
            tx.execute(
                "UPDATE dc_allotment_work SET fulfillment_status=?2,updated_at=?3
                 WHERE allotment_id=?1",
                params![allotment_id.to_string(), status.as_str(), updated_at],
            )
            .map_err(db)?;
        }
        tx.execute(
            "INSERT INTO dc_pick_event
                 (pick_id,source_site_id,source_pool_id,sku_code,quantity,actor_id,
                  occurred_at,allocations_json,fact_seq,pick_session_id)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                pick_id.to_string(),
                payload.source_site_id,
                payload.source_pool_id,
                payload.sku_code,
                payload.quantity,
                payload.actor_id,
                updated_at,
                // The column predates picking committing to nobody. Kept so
                // old rows still read, written empty so new ones say the truth.
                "[]",
                fact_seq,
                request.pick_session_id
            ],
        )
        .map_err(db)?;
        Self::enqueue_pool_snapshot(&tx, &self.node, Uuid::new_v4())?;

        let response = PickResult {
            pick_id,
            source_site_id: payload.source_site_id,
            source_pool_id: payload.source_pool_id,
            sku_code: payload.sku_code,
            quantity: payload.quantity,
            actor_id: payload.actor_id,
            occurred_at,
        };
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_ALLOTMENT_PICK",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn pack_koli(
        &self,
        mut request: PackKoliRequest,
    ) -> Result<FulfillmentProgressResult, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "only DC Edge can Pack fulfillment packages".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let destination_store = Self::normalized_store_id(&request.destination_store_id)?;
        if request.epcs.is_empty() {
            return Err(EdgeError::Validation(
                "Pack requires at least one scanned EPC".into(),
            ));
        }
        request.epcs = request
            .epcs
            .iter()
            .map(|epc| Self::normalized_epc(epc))
            .collect::<Result<Vec<_>, _>>()?;
        request.epcs.sort();
        if request.epcs.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(EdgeError::Validation(
                "Pack cannot contain duplicate EPCs".into(),
            ));
        }
        request.destination_store_id = destination_store.to_string();
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        let request_json = Self::encode_idempotent_request(&request)?;

        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_FULFILLMENT_PACKED",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        let koli_id = Uuid::new_v4();
        let occurred_at = Utc::now();
        let updated_at = time_text(occurred_at);
        let packed_pool = Self::fulfillment_pool(
            &self.node.site_id,
            &destination_store,
            FulfillmentStage::Packed,
        );
        let packed_place = Self::normal_place(packed_pool);
        let mut units = Vec::with_capacity(request.epcs.len());
        let mut movement_lines = Vec::with_capacity(request.epcs.len());
        let mut touched_allotments = BTreeSet::new();

        for epc in &request.epcs {
            let active_package: Option<String> = tx
                .query_row(
                    "SELECT koli_id FROM koli_unit
                     WHERE epc=?1 AND released_at IS NULL",
                    [epc],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db)?;
            if let Some(active_package) = active_package {
                return Err(EdgeError::Conflict(format!(
                    "EPC {epc} already belongs to active package {active_package}"
                )));
            }
            let subject = Self::subject_by_epc(&tx, epc)?;
            let positions = {
                let mut statement = tx
                    .prepare(
                        "SELECT place_id,quantity FROM inventory_projection
                         WHERE subject_id=?1 AND quantity>0 ORDER BY place_id",
                    )
                    .map_err(db)?;
                let rows = statement
                    .query_map([subject.id.to_string()], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    })
                    .map_err(db)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(db)?;
                rows
            };
            if positions.len() != 1 || positions[0].1 != 1 {
                return Err(EdgeError::Conflict(format!(
                    "EPC {epc} must have exactly one unambiguous on-hand position"
                )));
            }
            let source_place = Place::from_str(&positions[0].0)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?;
            let source_pool = match &source_place {
                Place::Operational {
                    pool,
                    state: InventoryState::Normal,
                } if pool.is_dc_fulfillment_source_for(&self.node.site_id) => pool,
                _ => {
                    return Err(EdgeError::Conflict(format!(
                        "EPC {epc} is not in an allowed normal source pool for this DC"
                    )));
                }
            };

            let candidate: (String, String) = tx
                .query_row(
                    // FIFO among the lines of THIS box's store. The packer has
                    // already chosen the destination by opening the carton, so
                    // all that is left is which of that store's outstanding
                    // lines to draw down first — a matter of bookkeeping, not a
                    // commercial decision anyone needs to see.
                    //
                    // Matched on the line's own declared source, not on where
                    // the garment is standing: it has been picked, so it is in
                    // the outbound area rather than on the rack the allotment
                    // named.
                    "SELECT work.allotment_id,line.allotment_line_id
                     FROM dc_allotment_work_line line
                     JOIN dc_allotment_work work ON work.allotment_id=line.allotment_id
                     WHERE work.application_status='ACCEPTED'
                       AND work.fulfillment_status IN ('OPEN','IN_PROGRESS')
                       AND line.destination_type='STORE' AND line.destination_id=?1
                       AND line.sku_code=?2
                       AND line.accepted_quantity-line.packed_quantity-line.cancelled_quantity>0
                     ORDER BY work.created_at,work.allotment_id,line.allotment_line_id
                     LIMIT 1",
                    params![destination_store.to_string(), subject.sku_code],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(db)?
                .ok_or_else(|| {
                    EdgeError::Conflict(format!(
                        "no open allotment for EPC {epc}, SKU {}, destination {} (it came from {})",
                        subject.sku_code,
                        destination_store,
                        source_pool.id()
                    ))
                })?;
            let allotment_id = parse_uuid(&candidate.0)?;
            let allotment_line_id = parse_uuid(&candidate.1)?;
            if tx
                .execute(
                    // Picked and packed rise together. From an allotment's
                    // point of view a garment is picked FOR IT at the moment it
                    // goes into its box, because that is the moment it became
                    // this store's rather than anyone's.
                    "UPDATE dc_allotment_work_line
                     SET picked_quantity=picked_quantity+1,
                         packed_quantity=packed_quantity+1,updated_at=?2
                     WHERE allotment_line_id=?1
                       AND accepted_quantity-packed_quantity-cancelled_quantity>=1",
                    params![allotment_line_id.to_string(), updated_at],
                )
                .map_err(db)?
                != 1
            {
                return Err(EdgeError::Conflict(format!(
                    "Allotment line {allotment_line_id} no longer wants goods"
                )));
            }
            let allocation = PackageUnitAllocation {
                allotment_id,
                allotment_line_id,
                sku_code: subject.sku_code.clone(),
                epc: subject.epc.clone(),
            };
            movement_lines.push(MovementLine {
                subject_id: subject.id,
                quantity: 1,
                from: source_place,
                to: packed_place.clone(),
            });
            touched_allotments.insert(allotment_id);
            units.push(FulfillmentUnitRow {
                subject,
                allocation,
            });
        }

        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: movement_lines,
            cause: MovementCause::NormalMove,
            reference_type: Some("FULFILLMENT_PACKAGE".into()),
            reference_id: Some(koli_id.to_string()),
            reason: format!("RFID Pack for destination {destination_store}"),
            actor_id: request.actor_id.clone(),
            occurred_at,
        };
        let movement = self.append_command(&tx, &request.idempotency_key, &command)?;
        let koli_number = crate::edge::outbound::next_number(
            &tx,
            crate::edge::outbound::NumberKind::Koli,
            &self.node.site_id.to_string(),
        )?;
        tx.execute(
            "INSERT INTO koli
                 (koli_id,koli_number,destination_store_id,status,shipment_reference,
                  created_by,created_at,updated_at)
             VALUES(?1,?2,?3,'PACKED',NULL,?4,?5,?5)",
            params![
                koli_id.to_string(),
                koli_number,
                destination_store.to_string(),
                request.actor_id,
                updated_at
            ],
        )
        .map_err(db)?;
        for unit in &units {
            tx.execute(
                "INSERT INTO koli_unit
                     (koli_id,subject_id,epc,sku_code,allotment_id,allotment_line_id,
                      current_stage,stage_rank,packed_at,updated_at)
                 VALUES(?1,?2,?3,?4,?5,?6,'PACKED',2,?7,?7)",
                params![
                    koli_id.to_string(),
                    unit.subject.id.to_string(),
                    unit.subject.epc,
                    unit.subject.sku_code,
                    unit.allocation.allotment_id.to_string(),
                    unit.allocation.allotment_line_id.to_string(),
                    updated_at
                ],
            )
            .map_err(db)?;
        }
        Self::refresh_allotment_statuses(&tx, &touched_allotments, &updated_at)?;
        let payload = FulfillmentProgressPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            progress_id: Uuid::new_v4(),
            koli_id,
            source_site_id: self.node.site_id.to_string(),
            destination_store_id: destination_store.to_string(),
            stage: FulfillmentStage::Packed,
            shipment_reference: None,
            movement_group_id: movement.movement_group_id,
            actor_id: request.actor_id.clone(),
            occurred_at,
            units: units.iter().map(|unit| unit.allocation.clone()).collect(),
        };
        Self::enqueue_fulfillment_progress(&tx, &payload)?;
        Self::enqueue_pool_snapshot(&tx, &self.node, Uuid::new_v4())?;
        let response = Self::fulfillment_result(payload);
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_FULFILLMENT_PACKED",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    /// Raise a picklist. See [`CreatePicklistRequest`].
    ///
    /// The round is opened, walked and closed in one act, because that is what
    /// the composer describes: somebody has read what is owed and decided what
    /// this trip fetches. Leaving it open would be leaving it open for a
    /// second person to add to a round they were not on.
    ///
    /// Each line is an ordinary pick — same event, same movement, same FIFO
    /// off the rack — so nothing here reimplements picking. What it adds is a
    /// document, and its own idempotency record over the top: a retry would
    /// otherwise open a SECOND round, and the picks inside it would be written
    /// against a session id the first attempt never saw.
    fn create_picklist(
        &self,
        mut request: CreatePicklistRequest,
    ) -> Result<PicklistResult, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let pool = OperationalPool::from_str(request.source_pool_id.trim())
            .map_err(|error| EdgeError::Validation(error.to_string()))?;
        request.source_pool_id = pool.id();
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        for line in &mut request.lines {
            line.sku_code = line.sku_code.trim().to_ascii_uppercase();
            if line.sku_code.is_empty() {
                return Err(EdgeError::Validation("sku_code is required".into()));
            }
            if line.quantity <= 0 {
                return Err(EdgeError::Validation(format!(
                    "quantity for {} must be positive",
                    line.sku_code
                )));
            }
        }
        request
            .lines
            .sort_by(|left, right| left.sku_code.cmp(&right.sku_code));
        if request.lines.is_empty() {
            return Err(EdgeError::Validation(
                "a picklist needs at least one line; a round fetching nothing is a walk".into(),
            ));
        }
        if request
            .lines
            .windows(2)
            .any(|pair| pair[0].sku_code == pair[1].sku_code)
        {
            return Err(EdgeError::Validation(
                "one SKU cannot appear on two lines of the same picklist".into(),
            ));
        }
        let request_json = Self::encode_idempotent_request(&request)?;

        // Already raised? Answer with the round it raised, rather than opening
        // a second one that fetches the same garments again.
        let existing: Option<(String, Option<String>, String)> = {
            let connection = self.lock()?;
            connection
                .query_row(
                    "SELECT operation,request_json,response_json FROM idempotency_response
                      WHERE idempotency_key=?1",
                    [&request.idempotency_key],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(db)?
        };
        if let Some((operation, stored_request, stored_response)) = existing {
            if operation != "DC_PICKLIST" {
                return Err(EdgeError::Conflict(format!(
                    "idempotency key already belongs to {operation}"
                )));
            }
            if stored_request.as_deref() != Some(request_json.as_str()) {
                return Err(EdgeError::Conflict(
                    "idempotency key was already used with a different request payload".into(),
                ));
            }
            let session_id: String = serde_json::from_str(&stored_response)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?;
            let connection = self.lock()?;
            return Ok(PicklistResult {
                summary: crate::edge::outbound::pick_session_summary(&connection, &session_id)?,
                refused: Vec::new(),
            });
        }

        let session = {
            let mut connection = self.lock()?;
            crate::edge::outbound::open_session(
                &mut connection,
                crate::edge::outbound::SessionKind::Pick,
                crate::edge::outbound::OpenSessionRequest {
                    actor_id: request.actor_id.clone(),
                    note: request.note.clone(),
                },
            )?
        };

        let mut refused = Vec::new();
        for line in &request.lines {
            // A line the racks cannot answer is a fact about the racks, not a
            // failed request: the other thirty-nine lines are still worth
            // fetching, and the round says which one came back empty.
            if let Err(error) = self.pick_stock(PickRequest {
                source_pool_id: request.source_pool_id.clone(),
                sku_code: line.sku_code.clone(),
                quantity: line.quantity,
                actor_id: request.actor_id.clone(),
                idempotency_key: format!("{}:{}", request.idempotency_key, line.sku_code),
                pick_session_id: Some(session.session_id.clone()),
            }) {
                refused.push(PicklistRefusal {
                    sku_code: line.sku_code.clone(),
                    quantity: line.quantity,
                    reason: error.to_string(),
                });
            }
        }

        let mut connection = self.lock()?;
        crate::edge::outbound::close_session(
            &mut connection,
            crate::edge::outbound::SessionKind::Pick,
            &session.session_id,
        )?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_PICKLIST",
            &request_json,
            &session.session_id,
        )?;
        tx.commit().map_err(db)?;
        Ok(PicklistResult {
            summary: crate::edge::outbound::pick_session_summary(&connection, &session.session_id)?,
            refused,
        })
    }

    /// Pack a carton from quantities. See [`PackRequest`].
    ///
    /// The pieces are chosen the way picking chooses them — oldest first, out
    /// of the picking area — and then handed to `pack_koli`, which is where
    /// packing actually happens. Nothing about the movement, the allotment
    /// draw-down or the ledger differs from a swept box: this resolves a
    /// sentence into EPCs and stops.
    ///
    /// Its own idempotency record sits over the top of `pack_koli`'s, and it
    /// has to: a second attempt after a successful first would resolve
    /// DIFFERENT pieces (the first box now holds the ones it took), so the
    /// inner key would see a request it does not recognise and refuse. Here the
    /// second attempt never gets that far — it is answered with the carton the
    /// first one packed.
    fn pack_by_quantity(
        &self,
        mut request: PackRequest,
    ) -> Result<crate::edge::outbound::KoliManifest, EdgeError> {
        self.require_dc("outbound work happens at a DC")?;
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let destination_store = Self::normalized_store_id(&request.destination_store_id)?;
        request.destination_store_id = destination_store.to_string();
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        for line in &mut request.lines {
            line.sku_code = line.sku_code.trim().to_ascii_uppercase();
            if line.sku_code.is_empty() {
                return Err(EdgeError::Validation("sku_code is required".into()));
            }
            if line.quantity <= 0 {
                return Err(EdgeError::Validation(format!(
                    "quantity for {} must be positive",
                    line.sku_code
                )));
            }
        }
        request
            .lines
            .sort_by(|left, right| left.sku_code.cmp(&right.sku_code));
        if request.lines.is_empty() {
            return Err(EdgeError::Validation(
                "a pack needs at least one line; a carton holding nothing is a number nobody can explain".into(),
            ));
        }
        if request
            .lines
            .windows(2)
            .any(|pair| pair[0].sku_code == pair[1].sku_code)
        {
            return Err(EdgeError::Validation(
                "one SKU cannot appear on two lines of the same pack".into(),
            ));
        }
        let request_json = Self::encode_idempotent_request(&request)?;

        // The picking area, which is where everything packable is standing.
        // Picking put it there for nobody in particular; this is the moment it
        // becomes a shop's.
        let picking = Self::normal_place(OperationalPool::DcOutboundPicking {
            dc_id: self.node.site_id.clone(),
        });

        let epcs = {
            let connection = self.lock()?;
            if let Some(response) = connection
                .query_row(
                    "SELECT operation,request_json,response_json FROM idempotency_response
                      WHERE idempotency_key=?1",
                    [&request.idempotency_key],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()
                .map_err(db)?
            {
                let (operation, stored_request, stored_response) = response;
                if operation != "DC_PACK_BY_QUANTITY" {
                    return Err(EdgeError::Conflict(format!(
                        "idempotency key already belongs to {operation}"
                    )));
                }
                if stored_request.as_deref() != Some(request_json.as_str()) {
                    return Err(EdgeError::Conflict(
                        "idempotency key was already used with a different request payload".into(),
                    ));
                }
                let koli_id: String = serde_json::from_str(&stored_response)
                    .map_err(|error| EdgeError::Persistence(error.to_string()))?;
                return crate::edge::outbound::koli_manifest(&connection, &koli_id);
            }

            let mut statement = connection
                .prepare(
                    // Oldest first, and never a piece already in a live carton:
                    // the ledger would allow it and `pack_koli` would refuse it
                    // one EPC later, which is a worse way to find out.
                    "SELECT subject.epc
                       FROM inventory_projection projection
                       JOIN inventory_subject subject ON subject.id=projection.subject_id
                      WHERE projection.place_id=?1 AND projection.quantity>0
                        AND subject.sku_code=?2 AND subject.subject_type='UNIT'
                        AND subject.epc IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM koli_unit
                                         WHERE koli_unit.epc=subject.epc
                                           AND koli_unit.released_at IS NULL)
                      ORDER BY subject.created_at,subject.id
                      LIMIT ?3",
                )
                .map_err(db)?;
            let mut epcs = Vec::new();
            for line in &request.lines {
                let found = statement
                    .query_map(params![picking.id(), line.sku_code, line.quantity], |row| {
                        row.get::<_, String>(0)
                    })
                    .map_err(db)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(db)?;
                // A short pack is not an ordinary outcome the way a short pick
                // is. The sheet a packer works from already says how many are
                // standing in the picking area, so asking for more than that is
                // a mistake worth refusing rather than a fact worth recording.
                if i64::try_from(found.len()).unwrap_or(0) < line.quantity {
                    return Err(EdgeError::Conflict(format!(
                        "only {} of {} is in the picking area; {} was asked for",
                        found.len(),
                        line.sku_code,
                        line.quantity
                    )));
                }
                epcs.extend(found);
            }
            epcs
        };

        let packed = self.pack_koli(PackKoliRequest {
            destination_store_id: request.destination_store_id.clone(),
            epcs,
            actor_id: request.actor_id.clone(),
            // Derived rather than shared: the two records describe two
            // different requests, and one key cannot honestly stand for both.
            idempotency_key: format!("{}:units", request.idempotency_key),
        })?;
        let koli_id = packed.koli_id.to_string();
        if request.seal {
            self.seal_koli(&koli_id, &request.actor_id)?;
        }

        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "DC_PACK_BY_QUANTITY",
            &request_json,
            &koli_id,
        )?;
        tx.commit().map_err(db)?;
        crate::edge::outbound::koli_manifest(&connection, &koli_id)
    }

    fn create_fulfillment_shipment(
        &self,
        koli_id: Uuid,
        mut request: CreateKoliShipmentRequest,
    ) -> Result<FulfillmentProgressResult, EdgeError> {
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        request.shipment_reference = request.shipment_reference.trim().to_owned();
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        if request.shipment_reference.is_empty() {
            return Err(EdgeError::Validation(
                "shipment_reference is required".into(),
            ));
        }
        let request_json = Self::encode_idempotent_request(&serde_json::json!({
            "koli_id": koli_id,
            "request": request,
        }))?;
        self.advance_fulfillment_package_impl(
            koli_id,
            FulfillmentStage::Shipment,
            Some(request.shipment_reference),
            request.actor_id,
            request.idempotency_key,
            request_json,
        )
    }

    fn dispatch_koli(
        &self,
        koli_id: Uuid,
        mut request: AdvanceKoliRequest,
    ) -> Result<FulfillmentProgressResult, EdgeError> {
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        let request_json = Self::encode_idempotent_request(&serde_json::json!({
            "koli_id": koli_id,
            "request": request,
        }))?;
        self.advance_fulfillment_package_impl(
            koli_id,
            FulfillmentStage::Loaded,
            None,
            request.actor_id,
            request.idempotency_key,
            request_json,
        )
    }

    fn mark_fulfillment_in_transit(
        &self,
        koli_id: Uuid,
        mut request: AdvanceKoliRequest,
    ) -> Result<FulfillmentProgressResult, EdgeError> {
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        request.actor_id = request.actor_id.trim().to_owned();
        request.idempotency_key = request.idempotency_key.trim().to_owned();
        let request_json = Self::encode_idempotent_request(&serde_json::json!({
            "koli_id": koli_id,
            "request": request,
        }))?;
        self.advance_fulfillment_package_impl(
            koli_id,
            FulfillmentStage::InTransit,
            None,
            request.actor_id,
            request.idempotency_key,
            request_json,
        )
    }

    fn receive_store(&self, request: ReceiveRequest) -> Result<CommandResult, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "only Store Edge can receive Store stock".into(),
            ));
        }
        if request
            .source_dc_id
            .as_ref()
            .is_some_and(|source_dc_id| source_dc_id.kind() != SiteKind::Dc)
        {
            return Err(EdgeError::Validation(
                "source_dc_id must identify a DC site".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let epc = Self::normalized_epc(&request.epc)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "STORE_RECEIVE",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let subject = Self::insert_subject(&tx, &epc, &request.sku_code, request.unit_price_minor)?;
        let receipt_id = Uuid::new_v4();
        let occurred_at = Utc::now();
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: vec![MovementLine {
                subject_id: subject.id,
                quantity: 1,
                from: Place::System {
                    place: SystemPlace::Opening,
                },
                to: Place::Operational {
                    pool: OperationalPool::StoreWarehouse {
                        store_id: self.node.site_id.clone(),
                    },
                    state: InventoryState::Normal,
                },
            }],
            cause: MovementCause::StoreReceive,
            reference_type: Some("STORE_RECEIPT".into()),
            reference_id: Some(receipt_id.to_string()),
            reason: "Physical receipt recorded locally at Store Edge".into(),
            actor_id: request.actor_id,
            occurred_at,
        };
        let response = self.append_command(&tx, &request.idempotency_key, &command)?;
        let transfer_claim = TransferClaimPayload::new(
            TransferClaimKind::Received,
            request.source_dc_id.as_ref().map(ToString::to_string),
            self.node.site_id.to_string(),
            request.shipment_reference.clone(),
            subject.epc.clone(),
            subject.sku_code.clone(),
            response.movement_group_id,
            Some(receipt_id),
            occurred_at,
        )
        .map_err(|error| EdgeError::Validation(error.to_string()))?;
        tx.execute(
            "INSERT INTO store_receipt(id,idempotency_key,subject_id,source_dc_id,shipment_reference,movement_group_id,received_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                receipt_id.to_string(),
                request.idempotency_key,
                subject.id.to_string(),
                request.source_dc_id.as_ref().map(ToString::to_string),
                request.shipment_reference.as_deref(),
                response.movement_group_id.to_string(),
                time_text(occurred_at)
            ],
        )
        .map_err(db)?;
        Self::enqueue_transfer_claim(&tx, &transfer_claim)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "STORE_RECEIVE",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn receive_store_batch(
        &self,
        request: ReceiveBatchRequest,
    ) -> Result<CommandResult, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "only Store Edge can receive Store stock".into(),
            ));
        }
        if request.lines.is_empty() {
            return Err(EdgeError::Validation(
                "a delivery of nothing is not a delivery".into(),
            ));
        }
        const MAX_LINES: usize = 1000;
        if request.lines.len() > MAX_LINES {
            return Err(EdgeError::Validation(format!(
                "receive at most {MAX_LINES} units per batch, not {}",
                request.lines.len()
            )));
        }
        if request
            .source_dc_id
            .as_ref()
            .is_some_and(|source_dc_id| source_dc_id.kind() != SiteKind::Dc)
        {
            return Err(EdgeError::Validation(
                "source_dc_id must identify a DC site".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;

        // Normalise and reject duplicates BEFORE opening the transaction: one
        // EPC twice in a sweep is a double read, and receiving it twice would
        // put two units of one garment on the shelf. Validating here rather
        // than inside the write also means a malformed line never takes the
        // immediate lock away from a till trying to sell something.
        //
        // A tag the shop has ALREADY received fails the whole batch, by design.
        // The delivery is one event, so it commits as one; and a garment that
        // is already on the shelf cannot arrive again. The error names the EPC
        // so the receiver can lift that one tag out and re-sweep, which is a
        // ten-second fix — quietly receiving the other forty-eight and leaving
        // an unexplained gap is not.
        let mut normalised = Vec::with_capacity(request.lines.len());
        let mut seen = std::collections::BTreeSet::new();
        for line in &request.lines {
            let epc = Self::normalized_epc(&line.epc)?;
            Self::validate_subject_fields(&line.sku_code, line.unit_price_minor)?;
            if !seen.insert(epc.clone()) {
                return Err(EdgeError::Validation(format!(
                    "EPC {epc} appears twice in one delivery"
                )));
            }
            normalised.push((epc, line.sku_code.clone(), line.unit_price_minor));
        }

        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "STORE_RECEIVE_BATCH",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        let occurred_at = Utc::now();
        let receipt_id = Uuid::new_v4();
        let mut lines = Vec::with_capacity(normalised.len());
        let mut subjects = Vec::with_capacity(normalised.len());
        for (epc, sku_code, unit_price_minor) in normalised {
            let subject = Self::insert_subject(&tx, &epc, &sku_code, unit_price_minor)?;
            lines.push(MovementLine {
                subject_id: subject.id,
                quantity: 1,
                from: Place::System {
                    place: SystemPlace::Opening,
                },
                to: Place::Operational {
                    pool: OperationalPool::StoreWarehouse {
                        store_id: self.node.site_id.clone(),
                    },
                    state: InventoryState::Normal,
                },
            });
            subjects.push(subject);
        }

        // One arrival, one movement group. The ledger reads the way the lorry
        // actually turned up.
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines,
            cause: MovementCause::StoreReceive,
            reference_type: Some("STORE_RECEIPT".into()),
            reference_id: Some(receipt_id.to_string()),
            reason: "Physical receipt recorded locally at Store Edge".into(),
            actor_id: request.actor_id.clone(),
            occurred_at,
        };
        let response = self.append_command(&tx, &request.idempotency_key, &command)?;

        for subject in &subjects {
            let claim = TransferClaimPayload::new(
                TransferClaimKind::Received,
                request.source_dc_id.as_ref().map(ToString::to_string),
                self.node.site_id.to_string(),
                request.shipment_reference.clone(),
                subject.epc.clone(),
                subject.sku_code.clone(),
                response.movement_group_id,
                Some(receipt_id),
                occurred_at,
            )
            .map_err(|error| EdgeError::Validation(error.to_string()))?;
            tx.execute(
                "INSERT INTO store_receipt(id,idempotency_key,subject_id,source_dc_id,shipment_reference,movement_group_id,received_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![
                    Uuid::new_v4().to_string(),
                    format!("{}:{}", request.idempotency_key, subject.epc),
                    subject.id.to_string(),
                    request.source_dc_id.as_ref().map(ToString::to_string),
                    request.shipment_reference.as_deref(),
                    response.movement_group_id.to_string(),
                    time_text(occurred_at)
                ],
            )
            .map_err(db)?;
            Self::enqueue_transfer_claim(&tx, &claim)?;
        }

        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "STORE_RECEIVE_BATCH",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn move_stock(&self, request: MoveRequest) -> Result<CommandResult, EdgeError> {
        if request.cause != MovementCause::NormalMove {
            return Err(EdgeError::Validation(
                "movement endpoint only accepts NORMAL_MOVE; use the dedicated intake, receive, or sale endpoint for lifecycle-specific causes".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let epc = Self::normalized_epc(&request.epc)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) =
            Self::load_idempotent(&tx, &request.idempotency_key, "MOVE", &request_json)?
        {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let subject = Self::subject_by_epc(&tx, &epc)?;
        let from = Place::from_str(&request.from)
            .map_err(|error| EdgeError::Validation(error.to_string()))?;
        let to = Place::from_str(&request.to)
            .map_err(|error| EdgeError::Validation(error.to_string()))?;
        let is_fulfillment_pool = |place: &Place| {
            matches!(
                place.pool(),
                Some(
                    OperationalPool::DcOutboundPicked { .. }
                        | OperationalPool::DcOutboundPacked { .. }
                        | OperationalPool::DcOutboundShipment { .. }
                        | OperationalPool::DcOutboundLoaded { .. }
                        | OperationalPool::DcOutboundInTransit { .. }
                )
            )
        };
        if is_fulfillment_pool(&from) || is_fulfillment_pool(&to) {
            return Err(EdgeError::Validation(
                "outbound fulfillment pools may only be changed through Pick/Pack/package lifecycle endpoints".into(),
            ));
        }
        let occurred_at = Utc::now();
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: vec![MovementLine {
                subject_id: subject.id,
                quantity: request.quantity,
                from,
                to,
            }],
            cause: request.cause,
            reference_type: request.reference_type,
            reference_id: request.reference_id,
            reason: request.reason,
            actor_id: request.actor_id,
            occurred_at,
        };
        let response = self.append_command(&tx, &request.idempotency_key, &command)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "MOVE",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn complete_sale(&self, request: SaleRequest) -> Result<SaleResult, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "sales are only available on Store Edge".into(),
            ));
        }
        if request.epcs.is_empty() {
            return Err(EdgeError::Validation(
                "sale requires at least one EPC".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut seen = HashSet::new();
        let epcs = request
            .epcs
            .iter()
            .map(|epc| Self::normalized_epc(epc))
            .collect::<Result<Vec<_>, _>>()?;
        if epcs.iter().any(|epc| !seen.insert(epc.clone())) {
            return Err(EdgeError::Validation(
                "sale cannot contain duplicate EPCs".into(),
            ));
        }
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) =
            Self::load_idempotent(&tx, &request.idempotency_key, "SALE", &request_json)?
        {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let subjects = epcs
            .iter()
            .map(|epc| Self::subject_by_epc(&tx, epc))
            .collect::<Result<Vec<_>, _>>()?;
        let sale_id = Uuid::new_v4();
        let occurred_at = Utc::now();

        // What to charge.
        //
        // The published price book governs. Until now this summed the price
        // stamped on each unit when it was received, which meant a price
        // change published at the centre reached the shop, was stored, and
        // never made it onto a receipt.
        //
        // The intake price remains the fallback for exactly one situation: a
        // shop that has never received a publication. Refusing to sell there
        // would brick a till over a condition the cashier cannot fix, and the
        // intake price is what that shop has always charged. Every line records
        // which of the two applied, so this is visible at the centre and not a
        // silent substitution.
        let sku_codes: Vec<String> = subjects
            .iter()
            .map(|subject| subject.sku_code.clone())
            .collect();
        let quoted = pricing::quote(
            &tx,
            self.node.site_id.as_str(),
            pricing::STORE_CHANNEL,
            occurred_at,
            &sku_codes,
            &request.coupon_codes,
            request.customer_id.as_deref(),
        )?;
        // A promotion acts on a line, not on a unit, so what a line comes to is
        // not always a whole number of unit prices. The line total is what is
        // charged and what is recorded.
        //
        // Line total and unit price are the same number here, and only because
        // a till builds one line per scanned EPC with a quantity of one. That
        // is what makes it safe to put this in a column called
        // `unit_price_minor` — and it is the invariant to check first if a
        // till ever learns to ring "three of these" as one line, because on
        // that day this silently starts storing three shirts' money against
        // one shirt.
        //
        // `base` is what the line would have cost before any clearance
        // replaced the price. The centre cannot derive it: it receives the
        // charged price and the source that set it, so without this it can say
        // a markdown applied and never what the markdown cost.
        let priced: Vec<PricedLine> = match &quoted {
            Some(quote) => quote
                .lines
                .iter()
                .map(|line| PricedLine {
                    charged_minor: line.line_total_minor,
                    base_minor: Some(line.base_unit_price_minor),
                    markdown_id: line.markdown_id.clone(),
                    price_source: line.price_source.clone(),
                    publication_version: Some(line.publication_version),
                })
                .collect(),
            None => subjects
                .iter()
                .map(|subject| PricedLine {
                    charged_minor: subject.unit_price_minor,
                    markdown_id: None,
                    // No book, so no list price was ever quoted — the intake
                    // price is not one, it is what the shop paid.
                    base_minor: None,
                    price_source: "INTAKE_PRICE".to_string(),
                    publication_version: None,
                })
                .collect(),
        };
        let total_minor = match &quoted {
            // Trust the engine's own total rather than re-summing the lines.
            // Two additions of the same numbers is one addition too many: they
            // can drift, and then the receipt and the drawer disagree.
            Some(quote) => quote.total_minor,
            None => priced.iter().try_fold(0_i64, |total, line| {
                total
                    .checked_add(line.charged_minor)
                    .ok_or_else(|| EdgeError::Validation("sale total overflow".into()))
            })?,
        };
        // Every tender, checked together: only cash may exceed the total,
        // because only cash can produce change. A card charged for more than
        // the basket is not generosity, it is a mistake nobody notices until a
        // statement arrives.
        let payment = crate::tender::validate_tenders(total_minor, &request.tenders)
            .map_err(|error| EdgeError::Validation(error.to_string()))?;
        let from = Place::Operational {
            pool: OperationalPool::StoreFloor {
                store_id: self.node.site_id.clone(),
            },
            state: InventoryState::Normal,
        };
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: subjects
                .iter()
                .map(|subject| MovementLine {
                    subject_id: subject.id,
                    quantity: 1,
                    from: from.clone(),
                    to: Place::External {
                        place: crate::edge::ExternalPlace::Customer,
                    },
                })
                .collect(),
            cause: MovementCause::Sale,
            reference_type: Some("SALE".into()),
            reference_id: Some(sale_id.to_string()),
            reason: "Store sale completed offline".into(),
            actor_id: request.actor_id.clone(),
            occurred_at,
        };
        let movement = self.append_command(&tx, &request.idempotency_key, &command)?;
        let shift_id = crate::edge::till::any_open_shift(&tx)?;
        tx.execute(
            // `pricing_trace_id` is written here, and it was not before: the
            // column existed, the engine produced the value, the fact carried
            // it to the centre, and the shop's own copy stayed null. So the one
            // node that can be asked "why was I charged this" with the customer
            // still at the counter — and offline, which is when it matters —
            // was the node that had thrown the answer away.
            "INSERT INTO sale(id,idempotency_key,status,total_minor,paid_minor,change_minor,movement_group_id,actor_id,completed_at,pricing_trace_id,shift_id) VALUES(?1,?2,'COMPLETED',?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                sale_id.to_string(),
                request.idempotency_key,
                payment.total_minor,
                payment.paid_minor,
                payment.change_minor,
                movement.movement_group_id.to_string(),
                request.actor_id,
                time_text(occurred_at),
                quoted.as_ref().map(|quote| quote.trace_id.clone()),
                // Which drawer took this money. NULL when no shift is open,
                // and the sale still completes: a till that refused to sell
                // because nobody pressed "open shift" is a queue, and the
                // shop's problem is then the paperwork rather than the
                // customer. The Z report counts what it can attribute.
                shift_id
            ],
        )
        .map_err(db)?;
        // Keyed by position, so a retry of this whole sale writes the same rows
        // rather than a second copy of each payment.
        for (seq, tender) in request.tenders.iter().enumerate() {
            tx.execute(
                "INSERT INTO sale_tender(sale_id,tender_seq,method,amount_minor,reference)
                 VALUES(?1,?2,?3,?4,?5)",
                params![
                    sale_id.to_string(),
                    i64::try_from(seq).unwrap_or(i64::MAX),
                    tender.method.as_str(),
                    tender.amount_minor,
                    tender.reference,
                ],
            )
            .map_err(db)?;
        }
        for (subject, line) in subjects.iter().zip(priced.iter()) {
            let PricedLine {
                charged_minor,
                base_minor,
                price_source,
                publication_version,
                ..
            } = line;
            tx.execute(
                // `base_unit_price_minor` is written here, and it was not
                // before: the engine produced it and the shop's own copy threw
                // it away, so a receipt could say what was charged and never
                // what the markdown was worth.
                "INSERT INTO sale_line
                     (sale_id,subject_id,epc,sku_code,unit_price_minor,quantity,
                      price_source,publication_version,base_unit_price_minor)
                 VALUES(?1,?2,?3,?4,?5,1,?6,?7,?8)",
                params![
                    sale_id.to_string(),
                    subject.id.to_string(),
                    subject.epc,
                    subject.sku_code,
                    charged_minor,
                    price_source,
                    publication_version,
                    base_minor
                ],
            )
            .map_err(db)?;
        }
        // The money leaves with the sale, in the same transaction.
        //
        // The stock side travels separately and in aggregate, as a pool
        // snapshot, so this is the ONLY line-level record of a sale the centre
        // ever sees: without it there is no revenue figure for the fleet at
        // all. `movement_group_id` carries the shop's local ledger reference
        // so an investigation can go back to the movements behind a sale.
        crate::edge::sync::enqueue_fact(
            &tx,
            sale_id,
            crate::cloud::domain::FACT_SALES_COMPLETED,
            &serde_json::json!({
                "sale_id": sale_id,
                "movement_group_id": movement.movement_group_id,
                "site_id": self.node.site_id.to_string(),
                "actor_id": request.actor_id,
                "occurred_at": occurred_at,
                "currency": "IDR",
                "total_minor": payment.total_minor,
                "paid_minor": payment.paid_minor,
                "change_minor": payment.change_minor,
                // What was charged, not what the unit cost at intake. The
                // centre re-sums these against the total and refuses a sale
                // that does not reconcile, so sending the intake price here
                // would have every sale rejected at the door the moment a price
                // book landed — and rejected sales are invisible revenue.
                "lines": subjects
                    .iter()
                    .zip(priced.iter())
                    .map(|(subject, line)| {
                        serde_json::json!({
                            "subject_id": subject.id,
                            "epc": subject.epc,
                            "sku_code": subject.sku_code,
                            "quantity": 1,
                            "unit_price_minor": quoted
                                .as_ref()
                                .and_then(|quote| {
                                    quote
                                        .lines
                                        .iter()
                                        .find(|q| q.sku_code == subject.sku_code)
                                        .map(|q| q.unit_price_minor)
                                })
                                .unwrap_or(subject.unit_price_minor),
                            "line_total_minor": line.charged_minor,
                            // What it cost before a clearance replaced the
                            // price. The centre keeps `price_source` and so can
                            // say a markdown applied; without this it cannot say
                            // what the markdown COST, and "what did the
                            // end-of-season take out of margin" has no answer
                            // while "what did the Lebaran rule cost" has one.
                            //
                            // Absent when no book was in force: the intake price
                            // is what the shop paid, not a price it ever asked.
                            "base_unit_price_minor": line.base_minor,
                            "markdown_id": line.markdown_id,
                            "price_source": line.price_source,
                            "publication_version": line.publication_version,
                        })
                    })
                    .collect::<Vec<_>>(),
                "discount_total_minor": quoted
                    .as_ref()
                    .map_or(0, |quote| quote.discount_total_minor),
                "points_earned": quoted.as_ref().map_or(0, |quote| quote.points_earned),
                "pricing_trace_id": quoted.as_ref().map(|quote| quote.trace_id.clone()),
                // Who bought it. Points travel without this and there is
                // nobody to credit them to.
                "customer_id": request.customer_id,
                // How it was settled. Only the amount travelled before, so the
                // centre could say what a shop took and never how — and a bank
                // reconciliation needs the how.
                "tenders": request.tenders.iter().enumerate().map(|(seq, tender)| serde_json::json!({
                    "tender_seq": seq,
                    "method": tender.method.as_str(),
                    "amount_minor": tender.amount_minor,
                    "reference": tender.reference,
                })).collect::<Vec<_>>(),
                // Which promotions actually came off, and what each was worth.
                // Only the total travelled before, so "what did the Lebaran
                // promo cost us" had no answer — and a coupon marked
                // single-use could be spent again at every other shop, because
                // nothing ever learned it had been spent once.
                "promotions": quoted
                    .as_ref()
                    .map(|quote| {
                        quote
                            .promotions
                            .iter()
                            .filter(|promotion| promotion.applied)
                            .map(|promotion| serde_json::json!({
                                "rule_id": promotion.rule_id,
                                "campaign_id": promotion.campaign_id,
                                "coupon_code": promotion.coupon_code,
                                "benefit_minor": promotion.benefit_minor,
                                // Which units it came off. Sent as subject ids
                                // rather than positions: a position is only
                                // meaningful against the basket that produced
                                // it, and the centre reads this fact on its own
                                // days later.
                                "lines": promotion
                                    .line_benefits
                                    .iter()
                                    .filter_map(|line| {
                                        subjects.get(line.line).map(|subject| {
                                            serde_json::json!({
                                                "subject_id": subject.id,
                                                "benefit_minor": line.benefit_minor,
                                            })
                                        })
                                    })
                                    .collect::<Vec<_>>(),
                            }))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default(),
            }),
        )
        .map_err(db)?;
        let response = SaleResult {
            sale_id,
            total_minor: payment.total_minor,
            paid_minor: payment.paid_minor,
            change_minor: payment.change_minor,
            movement_group_id: movement.movement_group_id,
            completed_at: occurred_at,
            promotions: quoted
                .as_ref()
                .map(|quote| quote.promotions.clone())
                .unwrap_or_default(),
            granted_lines: quoted
                .as_ref()
                .map(|quote| quote.granted_lines.clone())
                .unwrap_or_default(),
            points_earned: quoted.as_ref().map_or(0, |quote| quote.points_earned),
        };
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "SALE",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }

    fn list_pools(&self) -> Result<Vec<PoolBalance>, EdgeError> {
        let connection = self.lock()?;
        Self::collect_pool_balances(&connection, &self.node)
    }

    fn store_catalog(&self) -> Result<Vec<pricing::CatalogRow>, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "a catalogue is priced for a shop, and a DC does not sell".into(),
            ));
        }
        let connection = self.lock()?;
        pricing::store_catalog(
            &connection,
            self.node.site_id.as_str(),
            pricing::STORE_CHANNEL,
            Utc::now(),
        )
    }

    fn quote_basket(
        &self,
        request: super::contracts::QuoteRequest,
    ) -> Result<serde_json::Value, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "a basket is priced for a shop, and a DC does not sell".into(),
            ));
        }
        // Screened the way a sale screens them, because a preview that accepted
        // a basket the till will refuse is worse than no preview.
        let mut seen = HashSet::new();
        let epcs = request
            .epcs
            .iter()
            .map(|epc| Self::normalized_epc(epc))
            .collect::<Result<Vec<_>, _>>()?;
        if epcs.iter().any(|epc| !seen.insert(epc.clone())) {
            return Err(EdgeError::Validation(
                "a basket cannot contain duplicate EPCs".into(),
            ));
        }
        let mut connection = self.lock()?;
        // A read-only transaction, so the basket is priced against one
        // consistent state: a price book landing mid-quote must not show a
        // shopper two books' answers in one total.
        let tx = connection.transaction().map_err(db)?;
        let subjects = epcs
            .iter()
            .map(|epc| Self::subject_by_epc(&tx, epc))
            .collect::<Result<Vec<_>, _>>()?;
        let sku_codes: Vec<String> = subjects
            .iter()
            .map(|subject| subject.sku_code.clone())
            .collect();
        // The same call `complete_sale` makes, at the same instant resolution,
        // against the same resident book. If these two ever answer differently
        // the counter is quoting a price the till will not honour, which is the
        // one thing a preview must never do.
        let quoted = pricing::quote(
            &tx,
            self.node.site_id.as_str(),
            pricing::STORE_CHANNEL,
            Utc::now(),
            &sku_codes,
            &request.coupon_codes,
            request.customer_id.as_deref(),
        )?;
        Ok(match quoted {
            Some(quote) => serde_json::to_value(quote)
                .map_err(|error| EdgeError::Persistence(error.to_string()))?,
            // No book, or no price for these goods. Said plainly rather than
            // returned as an empty basket worth nothing: the till falls back to
            // the intake price in that case, and a preview that showed zero
            // would be the only screen in the shop that disagreed with the
            // drawer.
            None => serde_json::json!({
                "has_price_book": false,
                "lines": [],
                "promotions": [],
                "total_minor": null,
            }),
        })
    }

    /// Resolve many SKUs in ONE query, at any node role.
    ///
    /// The handheld asks this once per sweep with the DISTINCT SKUs it decoded
    /// locally — 49 tags on a rack are typically a dozen or so products — so
    /// the cost is one round trip and one indexed lookup, not one per tag. The
    /// EPC already carries its own SKU, so nothing here is on the path between
    /// reading a tag and showing what it is; this only adds the human-readable
    /// name.
    fn catalog_identities(&self, sku_codes: &[String]) -> Result<Vec<CatalogIdentity>, EdgeError> {
        if sku_codes.is_empty() {
            return Ok(Vec::new());
        }
        // Bounded so one malformed client cannot ask for the whole catalogue
        // through a query string.
        const MAX: usize = 500;
        if sku_codes.len() > MAX {
            return Err(EdgeError::Validation(format!(
                "ask for at most {MAX} SKUs at a time, not {}",
                sku_codes.len()
            )));
        }
        let connection = self.lock()?;
        let placeholders = std::iter::repeat("?")
            .take(sku_codes.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            // The catalogue's own picture first, then the DC's working copies.
            //
            // `catalog_item.image_url` is the centre's master, delivered with
            // the rest of what a product IS (migration 0025). The two
            // subqueries under it are a DC's copies of the same photograph,
            // frozen when the labels were printed or the order was placed —
            // and they are the only ones a shop was ever offered, which is why
            // a till answered 404 for every garment in the range. Keeping them
            // below rather than deleting them means a DC that has not yet been
            // sent a catalogue carrying pictures still shows the ones it has.
            "SELECT c.sku_code,c.name,c.article_code,c.division_code,c.barcode,
                    c.base_price_minor,c.tags_json,c.active,
                    COALESCE(
                        c.image_url,
                        (SELECT j.image_url FROM tagging_job j
                          WHERE j.article_code = c.article_code
                            AND j.image_url IS NOT NULL
                          ORDER BY j.issued_at DESC LIMIT 1),
                        (SELECT l.image_url FROM purchase_order_line l
                          WHERE l.article_code = c.article_code
                            AND l.image_url IS NOT NULL
                          LIMIT 1)
                    ) AS image_url
             FROM catalog_item c WHERE c.sku_code IN ({placeholders})",
        );
        let mut statement = connection.prepare(&sql).map_err(db)?;
        let params = rusqlite::params_from_iter(sku_codes.iter());
        let rows = statement
            .query_map(params, |row| {
                let tags: Option<String> = row.get(6)?;
                Ok(CatalogIdentity {
                    sku_code: row.get(0)?,
                    name: row.get(1)?,
                    article_code: row.get(2)?,
                    division_code: row.get(3)?,
                    barcode: row.get(4)?,
                    base_price_minor: row.get(5)?,
                    tags: tags
                        .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
                        .unwrap_or_default(),
                    active: row.get::<_, i64>(7)? == 1,
                    image_url: row.get(8)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)
    }

    fn store_catalog_page(
        &self,
        query: pricing::CatalogQuery,
    ) -> Result<pricing::CatalogPage, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "a catalogue is priced for a shop, and a DC does not sell".into(),
            ));
        }
        let connection = self.lock()?;
        pricing::store_catalog_page(
            &connection,
            self.node.site_id.as_str(),
            pricing::STORE_CHANNEL,
            Utc::now(),
            query,
        )
    }

    fn store_offers(&self) -> Result<pricing::StoreOffers, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "promotions are offered to shoppers, and a DC has none".into(),
            ));
        }
        let connection = self.lock()?;
        pricing::store_offers(
            &connection,
            self.node.site_id.as_str(),
            pricing::STORE_CHANNEL,
            Utc::now(),
        )
    }

    fn campaign_image_url(&self, campaign_id: &str) -> Result<Option<String>, EdgeError> {
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT image_url FROM commercial_campaign WHERE campaign_id=?1",
                [campaign_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(Option::flatten)
            .map_err(db)
    }

    fn sales_series(
        &self,
        query: super::reports::SalesSeriesQuery,
    ) -> Result<super::reports::SalesSeries, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "only a shop has takings; a DC does not sell".into(),
            ));
        }
        let connection = self.lock()?;
        super::reports::sales_series(&connection, self.node.site_id.as_str(), query)
    }

    fn sales_window(
        &self,
        query: super::reports::SalesWindowQuery,
    ) -> Result<super::reports::SalesWindow, EdgeError> {
        if self.node.role != EdgeRole::Store {
            return Err(EdgeError::Forbidden(
                "only a shop has takings; a DC does not sell".into(),
            ));
        }
        let connection = self.lock()?;
        super::reports::sales_window(&connection, self.node.site_id.as_str(), query)
    }

    fn list_official_counts(&self) -> Result<Vec<EdgeOfficialCountSummary>, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "only a DC Edge has Official Count work".into(),
            ));
        }
        let connection = self.lock()?;
        let count_ids = {
            let mut statement = connection
                .prepare(
                    "SELECT count_id FROM dc_official_count_work
                     WHERE site_id=?1 ORDER BY activated_at DESC,count_id",
                )
                .map_err(db)?;
            let ids = statement
                .query_map([self.node.site_id.as_str()], |row| row.get::<_, String>(0))
                .map_err(db)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(db)?;
            ids
        };
        count_ids
            .into_iter()
            .map(|count_id| parse_uuid(&count_id))
            .map(|count_id| count_id.and_then(|id| Self::official_count_summary(&connection, id)))
            .collect()
    }

    fn official_count(&self, count_id: Uuid) -> Result<EdgeOfficialCountDetail, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "only a DC Edge has Official Count work".into(),
            ));
        }
        let connection = self.lock()?;
        let detail = Self::official_count_detail(&connection, count_id)?;
        if detail.summary.site_id != self.node.site_id.as_str() {
            return Err(EdgeError::Forbidden(
                "Official Count belongs to a different DC".into(),
            ));
        }
        Ok(detail)
    }

    fn record_official_count_entries(
        &self,
        count_id: Uuid,
        request: OfficialCountEntriesRequest,
    ) -> Result<EdgeOfficialCountDetail, EdgeError> {
        self.record_official_count_entries_impl(count_id, request)
    }

    fn submit_official_count(
        &self,
        count_id: Uuid,
        request: OfficialCountSubmitRequest,
    ) -> Result<OfficialCountSubmitResult, EdgeError> {
        self.submit_official_count_impl(count_id, request)
    }

    fn open_purchase_lines(&self) -> Result<Vec<PurchaseWorkLine>, EdgeError> {
        self.open_purchase_lines_impl()
    }

    fn count_purchase(
        &self,
        request: PurchaseCountRequest,
    ) -> Result<PurchaseCountResult, EdgeError> {
        self.count_purchase_impl(request)
    }

    fn counts_awaiting_verification(
        &self,
    ) -> Result<Vec<PurchaseCountAwaitingVerification>, EdgeError> {
        self.counts_awaiting_verification_impl()
    }

    fn verify_purchase(
        &self,
        request: PurchaseVerifyRequest,
    ) -> Result<PurchaseVerifyResult, EdgeError> {
        self.verify_purchase_impl(request)
    }

    fn open_goods_receipt(
        &self,
        request: OpenGoodsReceiptRequest,
    ) -> Result<GoodsReceiptView, EdgeError> {
        self.open_goods_receipt_impl(request)
    }

    fn open_goods_receipts(&self) -> Result<Vec<GoodsReceiptView>, EdgeError> {
        self.open_goods_receipts_impl()
    }

    fn record_receipt_invoice(
        &self,
        request: RecordInvoiceRequest,
    ) -> Result<GoodsReceiptView, EdgeError> {
        self.record_receipt_invoice_impl(request)
    }

    fn store_invoice_document(
        &self,
        request: StoreInvoiceDocumentRequest,
    ) -> Result<InvoiceDocumentView, EdgeError> {
        self.store_invoice_document_impl(request)
    }

    fn invoice_document(&self, receipt_id: Uuid) -> Result<InvoiceDocument, EdgeError> {
        self.invoice_document_impl(receipt_id)
    }

    fn open_tagging_jobs(&self) -> Result<Vec<TaggingWorkJob>, EdgeError> {
        self.open_tagging_jobs_impl()
    }

    fn confirm_tagging(
        &self,
        request: TaggingConfirmRequest,
    ) -> Result<TaggingConfirmResult, EdgeError> {
        self.confirm_tagging_impl(request)
    }

    fn list_movements(&self, limit: usize) -> Result<Vec<MovementView>, EdgeError> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT m.id,m.movement_group_id,m.subject_id,s.epc,m.quantity,m.from_place_id,m.to_place_id,m.cause,m.reference_type,m.reference_id,m.actor_id,m.occurred_at FROM movement m JOIN inventory_subject s ON s.id=m.subject_id ORDER BY m.occurred_at DESC,m.id DESC LIMIT ?1",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([limit.clamp(1, 500) as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                ))
            })
            .map_err(db)?;
        rows.map(|row| {
            let (
                movement_id,
                group_id,
                subject_id,
                epc,
                quantity,
                from,
                to,
                cause,
                reference_type,
                reference_id,
                actor_id,
                occurred_at,
            ) = row.map_err(db)?;
            Ok(MovementView {
                movement_id: parse_uuid(&movement_id)?,
                movement_group_id: parse_uuid(&group_id)?,
                subject_id: SubjectId(parse_uuid(&subject_id)?),
                epc,
                quantity,
                from,
                to,
                cause: MovementCause::from_str(&cause)?,
                reference_type,
                reference_id,
                actor_id,
                occurred_at: parse_time(&occurred_at)?,
            })
        })
        .collect()
    }

    // ── The till's day ──────────────────────────────────────────────────

    fn open_shift(
        &self,
        request: crate::edge::till::OpenShiftRequest,
    ) -> Result<crate::edge::till::ShiftReport, EdgeError> {
        self.require_store("a cash shift")?;
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) =
            Self::load_idempotent(&tx, &request.idempotency_key, "SHIFT_OPEN", &request_json)?
        {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let report = crate::edge::till::open_shift(&tx, &request)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "SHIFT_OPEN",
            &request_json,
            &report,
        )?;
        tx.commit().map_err(db)?;
        Ok(report)
    }

    fn active_shift(
        &self,
        terminal_id: Option<&str>,
    ) -> Result<Option<crate::edge::till::ShiftReport>, EdgeError> {
        let connection = self.lock()?;
        let shift_id = match terminal_id {
            Some(terminal) => crate::edge::till::open_shift_id(&connection, terminal)?,
            None => crate::edge::till::any_open_shift(&connection)?,
        };
        shift_id
            .map(|shift_id| crate::edge::till::report(&connection, &shift_id))
            .transpose()
    }

    fn record_cash_movement(
        &self,
        shift_id: &str,
        request: crate::edge::till::CashMovementRequest,
    ) -> Result<crate::edge::till::ShiftReport, EdgeError> {
        self.require_store("a cash movement")?;
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "CASH_MOVEMENT",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let report = crate::edge::till::record_cash_movement(&tx, shift_id, &request)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "CASH_MOVEMENT",
            &request_json,
            &report,
        )?;
        tx.commit().map_err(db)?;
        Ok(report)
    }

    fn close_shift(
        &self,
        shift_id: &str,
        request: crate::edge::till::CloseShiftRequest,
    ) -> Result<crate::edge::till::ShiftReport, EdgeError> {
        self.require_store("a cash shift")?;
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) =
            Self::load_idempotent(&tx, &request.idempotency_key, "SHIFT_CLOSE", &request_json)?
        {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let report = crate::edge::till::close_shift(&tx, shift_id, &request)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "SHIFT_CLOSE",
            &request_json,
            &report,
        )?;
        tx.commit().map_err(db)?;
        Ok(report)
    }

    fn shift_report(&self, shift_id: &str) -> Result<crate::edge::till::ShiftReport, EdgeError> {
        let connection = self.lock()?;
        crate::edge::till::report(&connection, shift_id)
    }

    fn void_sale(
        &self,
        sale_id: &str,
        request: crate::edge::till::VoidSaleRequest,
    ) -> Result<crate::edge::till::VoidResult, EdgeError> {
        self.require_store("a void")?;
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        if request.reason.trim().is_empty() {
            return Err(EdgeError::Validation("a void needs a reason".into()));
        }
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) =
            Self::load_idempotent(&tx, &request.idempotency_key, "SALE_VOID", &request_json)?
        {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        // Who authorised it, before anything moves. A void nobody signed is a
        // void nobody can be asked about.
        let approved_by = crate::edge::till::verify_supervisor(&tx, Some(&request.supervisor))?;

        match crate::edge::till::sale_status(&tx, sale_id)?.as_str() {
            "COMPLETED" => {}
            other => {
                return Err(EdgeError::Conflict(format!(
                    "sale {sale_id} is already {other}"
                )))
            }
        }

        // Only what is still out with the customer. A unit already returned
        // came home on its own movement, and carrying it a second time would
        // put one garment on the floor twice.
        let outstanding: Vec<crate::edge::till::SoldLine> =
            crate::edge::till::sold_lines(&tx, sale_id)?
                .into_iter()
                .filter(|line| !line.already_returned)
                .collect();
        if outstanding.is_empty() {
            return Err(EdgeError::Conflict(format!(
                "every unit of sale {sale_id} has already come back"
            )));
        }

        let occurred_at = Utc::now();
        let floor = Place::Operational {
            pool: OperationalPool::StoreFloor {
                store_id: self.node.site_id.clone(),
            },
            state: InventoryState::Normal,
        };
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: outstanding
                .iter()
                .map(|line| {
                    Ok(MovementLine {
                        subject_id: SubjectId(parse_uuid(&line.subject_id)?),
                        quantity: 1,
                        from: Place::External {
                            place: crate::edge::ExternalPlace::Customer,
                        },
                        to: floor.clone(),
                    })
                })
                .collect::<Result<Vec<_>, EdgeError>>()?,
            cause: MovementCause::CustomerReturn,
            reference_type: Some("SALE_VOID".into()),
            reference_id: Some(sale_id.to_string()),
            reason: format!("Sale voided: {}", request.reason.trim()),
            actor_id: request.actor_id.clone(),
            occurred_at,
        };
        let movement = self.append_command(&tx, &request.idempotency_key, &command)?;
        crate::edge::till::mark_voided(&tx, sale_id, &request, &approved_by, occurred_at)?;

        let refund_minor = outstanding
            .iter()
            .try_fold(0_i64, |total, line| total.checked_add(line.charged_minor))
            .ok_or_else(|| EdgeError::Validation("void total overflow".into()))?;
        let result = crate::edge::till::VoidResult {
            sale_id: sale_id.to_string(),
            refund_minor,
            movement_group_id: movement.movement_group_id.to_string(),
            approved_by,
            voided_at: time_text(occurred_at),
            lines: outstanding
                .iter()
                .map(|line| crate::edge::till::ReturnedLine {
                    epc: line.epc.clone(),
                    sku_code: line.sku_code.clone(),
                    refund_minor: line.charged_minor,
                    disposition: "RESALEABLE".to_string(),
                })
                .collect(),
        };
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "SALE_VOID",
            &request_json,
            &result,
        )?;
        tx.commit().map_err(db)?;
        Ok(result)
    }

    fn return_sale(
        &self,
        request: crate::edge::till::ReturnRequest,
    ) -> Result<crate::edge::till::ReturnResult, EdgeError> {
        self.require_store("a return")?;
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        if request.lines.is_empty() {
            return Err(EdgeError::Validation(
                "a return needs at least one scanned unit".into(),
            ));
        }
        if request.reason.trim().is_empty() {
            return Err(EdgeError::Validation("a return needs a reason".into()));
        }
        crate::tender::PaymentMethod::from_str(&request.refund_method)
            .map_err(|error| EdgeError::Validation(error.to_string()))?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) =
            Self::load_idempotent(&tx, &request.idempotency_key, "SALE_RETURN", &request_json)?
        {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        let approved_by = crate::edge::till::verify_supervisor(&tx, Some(&request.supervisor))?;
        match crate::edge::till::sale_status(&tx, &request.sale_id)?.as_str() {
            "COMPLETED" => {}
            other => {
                return Err(EdgeError::Conflict(format!(
                    "sale {} is {other} and cannot be returned against",
                    request.sale_id
                )))
            }
        }

        let sold = crate::edge::till::sold_lines(&tx, &request.sale_id)?;
        let mut chosen: Vec<(crate::edge::till::SoldLine, String)> =
            Vec::with_capacity(request.lines.len());
        let mut seen: HashSet<String> = HashSet::new();
        for line in &request.lines {
            let epc = Self::normalized_epc(&line.epc)?;
            if !seen.insert(epc.clone()) {
                return Err(EdgeError::Validation(format!(
                    "EPC {epc} was scanned twice on one return"
                )));
            }
            let disposition = line.disposition.trim().to_ascii_uppercase();
            if !matches!(disposition.as_str(), "RESALEABLE" | "DAMAGED") {
                return Err(EdgeError::Validation(format!(
                    "unknown disposition {disposition}"
                )));
            }
            // The unit has to be one this sale sold. A garment returned
            // against the wrong receipt is a refund the shop cannot trace back
            // to money it ever took.
            let sold_line = sold
                .iter()
                .find(|candidate| candidate.epc == epc)
                .ok_or_else(|| {
                    EdgeError::Validation(format!(
                        "EPC {epc} was not sold on sale {}",
                        request.sale_id
                    ))
                })?;
            if sold_line.already_returned {
                return Err(EdgeError::Conflict(format!(
                    "EPC {epc} has already been returned"
                )));
            }
            chosen.push((sold_line.clone(), disposition));
        }

        let occurred_at = Utc::now();
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: chosen
                .iter()
                .map(|(line, disposition)| {
                    // Anything not fit to sell must not reach the rail by
                    // default: the reject pool is where it waits for a
                    // decision.
                    let pool = if disposition == "DAMAGED" {
                        OperationalPool::StoreReject {
                            store_id: self.node.site_id.clone(),
                        }
                    } else {
                        OperationalPool::StoreFloor {
                            store_id: self.node.site_id.clone(),
                        }
                    };
                    Ok(MovementLine {
                        subject_id: SubjectId(parse_uuid(&line.subject_id)?),
                        quantity: 1,
                        from: Place::External {
                            place: crate::edge::ExternalPlace::Customer,
                        },
                        to: Place::Operational {
                            pool,
                            state: InventoryState::Normal,
                        },
                    })
                })
                .collect::<Result<Vec<_>, EdgeError>>()?,
            cause: MovementCause::CustomerReturn,
            reference_type: Some("SALE_RETURN".into()),
            reference_id: Some(request.sale_id.clone()),
            reason: format!("Customer return: {}", request.reason.trim()),
            actor_id: request.actor_id.clone(),
            occurred_at,
        };
        let movement = self.append_command(&tx, &request.idempotency_key, &command)?;

        let shift_id = crate::edge::till::any_open_shift(&tx)?;
        let return_id = Uuid::new_v4().to_string();
        let result = crate::edge::till::record_return(
            &tx,
            &return_id,
            &request,
            &approved_by,
            shift_id.as_deref(),
            &movement.movement_group_id.to_string(),
            &chosen,
            occurred_at,
        )?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "SALE_RETURN",
            &request_json,
            &result,
        )?;
        tx.commit().map_err(db)?;
        Ok(result)
    }

    fn sale_receipt(
        &self,
        sale_id: &str,
    ) -> Result<crate::edge::escpos::ReceiptDocument, EdgeError> {
        let connection = self.lock()?;
        crate::edge::till::receipt_document(
            &connection,
            sale_id,
            &self.node.site_id.as_str().to_ascii_uppercase(),
            self.node.site_id.as_str(),
            Some(RECEIPT_FOOTER),
        )
    }

    fn print_sale_receipt(
        &self,
        sale_id: &str,
        request: crate::edge::till::PrintReceiptRequest,
    ) -> Result<serde_json::Value, EdgeError> {
        let document = {
            let connection = self.lock()?;
            crate::edge::till::receipt_document(
                &connection,
                sale_id,
                &self.node.site_id.as_str().to_ascii_uppercase(),
                self.node.site_id.as_str(),
                Some(RECEIPT_FOOTER),
            )?
        };
        // The socket is opened with the database lock RELEASED. A printer that
        // is switched off blocks for the connect timeout, and holding the one
        // connection for that long stops every other till operation on this
        // node — including the next sale.
        let bytes = crate::edge::till::print_receipt(&document, &request)?;
        Ok(serde_json::json!({
            "sale_id": sale_id,
            "receipt_no": document.receipt_no,
            "printer": format!("{}:{}", request.printer_host, request.printer_port),
            "bytes": bytes,
        }))
    }
}

fn now_text() -> String {
    time_text(Utc::now())
}

fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, EdgeError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| EdgeError::Persistence(error.to_string()))
}

fn parse_uuid(value: &str) -> Result<Uuid, EdgeError> {
    Uuid::parse_str(value).map_err(|error| EdgeError::Persistence(error.to_string()))
}

pub(super) fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edge::{ReceiveRequest, SiteId};

    fn node(role: EdgeRole, site_id: &str) -> NodeContext {
        NodeContext::new(
            format!("{site_id}-edge"),
            role,
            SiteId::new(site_id).unwrap_or_else(|error| panic!("site: {error}")),
        )
        .unwrap_or_else(|error| panic!("node: {error}"))
    }

    fn move_epc(edge: &SqliteEdge, epc: &str, from: &str, to: &str, key: &str) {
        edge.move_stock(MoveRequest {
            epc: epc.into(),
            quantity: 1,
            from: from.into(),
            to: to.into(),
            cause: MovementCause::NormalMove,
            reason: "Lifecycle test".into(),
            actor_id: "tester".into(),
            idempotency_key: key.into(),
            reference_type: None,
            reference_id: None,
        })
        .unwrap_or_else(|error| panic!("move {from} -> {to}: {error}"));
    }

    #[test]
    fn two_disconnected_edges_operate_from_unidentified_to_sale() {
        let dc = SqliteEdge::open_in_memory(node(EdgeRole::Dc, "dc-01"))
            .unwrap_or_else(|error| panic!("dc: {error}"));
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("store: {error}"));

        dc.intake_dc(IntakeRequest {
            epc: "EPC-OFFLINE-001".into(),
            sku_code: "SKU-001".into(),
            unit_price_minor: 150_000,
            actor_id: "dc-receiver".into(),
            idempotency_key: "dc-intake-001".into(),
        })
        .unwrap_or_else(|error| panic!("intake: {error}"));

        for (index, (from, to)) in [
            (
                "dc-01.pending.unidentified:on_hand",
                "dc-01.pending.untagged:on_hand",
            ),
            ("dc-01.pending.untagged:on_hand", "dc-01.warehouse:on_hand"),
        ]
        .into_iter()
        .enumerate()
        {
            move_epc(
                &dc,
                "EPC-OFFLINE-001",
                from,
                to,
                &format!("dc-move-{index}"),
            );
        }

        let receipt = ReceiveRequest {
            epc: "EPC-OFFLINE-001".into(),
            sku_code: "SKU-001".into(),
            unit_price_minor: 150_000,
            source_dc_id: Some(
                SiteId::new("dc-01").unwrap_or_else(|error| panic!("source DC: {error}")),
            ),
            shipment_reference: Some("SHIPMENT-PAPER-001".into()),
            actor_id: "store-receiver".into(),
            idempotency_key: "store-receive-001".into(),
        };
        let first_receipt = store
            .receive_store(receipt.clone())
            .unwrap_or_else(|error| panic!("receipt: {error}"));
        let retry_receipt = store
            .receive_store(receipt)
            .unwrap_or_else(|error| panic!("receipt retry: {error}"));
        assert_eq!(
            first_receipt.movement_group_id,
            retry_receipt.movement_group_id
        );

        move_epc(
            &store,
            "EPC-OFFLINE-001",
            "store-07.warehouse:on_hand",
            "store-07.floor:on_hand",
            "store-floor-001",
        );
        let sale = store
            .complete_sale(SaleRequest {
                coupon_codes: Vec::new(),
                customer_id: None,
                epcs: vec!["EPC-OFFLINE-001".into()],
                tenders: vec![crate::tender::SaleTender {
                    method: crate::tender::PaymentMethod::Cash,
                    amount_minor: 200_000,
                    reference: None,
                }],
                actor_id: "cashier-07".into(),
                idempotency_key: "store-sale-001".into(),
            })
            .unwrap_or_else(|error| panic!("sale: {error}"));
        assert_eq!(sale.total_minor, 150_000);
        assert_eq!(sale.change_minor, 50_000);

        let dc_warehouse = dc
            .list_pools()
            .unwrap_or_else(|error| panic!("dc pools: {error}"))
            .into_iter()
            .find(|pool| pool.pool_id == "dc-01.warehouse")
            .unwrap_or_else(|| panic!("DC Warehouse pool"));
        assert_eq!(dc_warehouse.stock, 1);

        let store_floor = store
            .list_pools()
            .unwrap_or_else(|error| panic!("store pools: {error}"))
            .into_iter()
            .find(|pool| pool.pool_id == "store-07.floor")
            .unwrap_or_else(|| panic!("Store Floor pool"));
        assert_eq!(store_floor.stock, 0);
        assert!(dc.list_movements(20).is_ok_and(|rows| rows.len() == 3));
        assert!(store.list_movements(20).is_ok_and(|rows| rows.len() == 3));
    }

    // ── The till's day ──────────────────────────────────────────────────

    /// A shop with one garment on the floor, sold, and a supervisor who can
    /// authorise taking it back.
    fn shop_with_one_sale(key: &str) -> (SqliteEdge, String) {
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("store: {error}"));
        store
            .receive_store(ReceiveRequest {
                epc: "EPC-TILL-001".into(),
                sku_code: "SKU-001".into(),
                unit_price_minor: 150_000,
                source_dc_id: Some(
                    SiteId::new("dc-01").unwrap_or_else(|error| panic!("source DC: {error}")),
                ),
                shipment_reference: None,
                actor_id: "store-receiver".into(),
                idempotency_key: format!("{key}-receive"),
            })
            .unwrap_or_else(|error| panic!("receive: {error}"));
        move_epc(
            &store,
            "EPC-TILL-001",
            "store-07.warehouse:on_hand",
            "store-07.floor:on_hand",
            &format!("{key}-floor"),
        );
        let sale = store
            .complete_sale(SaleRequest {
                coupon_codes: Vec::new(),
                customer_id: None,
                epcs: vec!["EPC-TILL-001".into()],
                tenders: vec![crate::tender::SaleTender {
                    method: crate::tender::PaymentMethod::Cash,
                    amount_minor: 200_000,
                    reference: None,
                }],
                actor_id: "siti".into(),
                idempotency_key: format!("{key}-sale"),
            })
            .unwrap_or_else(|error| panic!("sale: {error}"));
        (store, sale.sale_id.to_string())
    }

    /// A supervisor who really exists, because `verify_supervisor` checks
    /// against `edge_user` rather than trusting the caller.
    fn seed_supervisor(edge: &SqliteEdge, username: &str, password: &str) {
        let connection = edge
            .connection
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        let hash = crate::security::hash_password(password, 8)
            .unwrap_or_else(|error| panic!("hash: {error}"));
        connection
            .execute(
                "INSERT INTO edge_user(id,username,display_name,password_hash,role,active,
                                       auth_version,source,created_at,updated_at)
                 VALUES(?1,?2,?2,?3,'SUPERVISOR',1,1,'LOCAL',?4,?4)",
                params![Uuid::new_v4().to_string(), username, hash, now_text()],
            )
            .unwrap_or_else(|error| panic!("seed supervisor: {error}"));
    }

    fn supervisor(username: &str, password: &str) -> crate::edge::till::Supervisor {
        crate::edge::till::Supervisor {
            username: username.into(),
            password: password.into(),
        }
    }

    /// One terminal, one drawer. A second open shift on the same till would
    /// mean two cashiers each believing the other's cash was theirs.
    #[test]
    fn a_terminal_has_at_most_one_open_shift() {
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("store: {error}"));
        let open = |key: &str| crate::edge::till::OpenShiftRequest {
            terminal_id: "TILL-1".into(),
            opening_float_minor: 500_000,
            actor_id: "siti".into(),
            idempotency_key: key.into(),
        };
        store
            .open_shift(open("shift-1"))
            .unwrap_or_else(|error| panic!("first shift: {error}"));
        assert!(store.open_shift(open("shift-2")).is_err());
    }

    /// The float is a cash movement, not a second source of truth. A drawer
    /// whose arithmetic had two inputs would have one nobody looks at.
    #[test]
    fn the_opening_float_is_the_first_cash_movement() {
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("store: {error}"));
        let report = store
            .open_shift(crate::edge::till::OpenShiftRequest {
                terminal_id: "TILL-1".into(),
                opening_float_minor: 500_000,
                actor_id: "siti".into(),
                idempotency_key: "shift-float".into(),
            })
            .unwrap_or_else(|error| panic!("shift: {error}"));
        assert_eq!(report.movements.len(), 1);
        assert_eq!(report.movements[0].kind, "OPENING_FLOAT");
        assert_eq!(report.expected_cash_minor, 500_000);
    }

    /// The drawer holds the float plus what was taken in cash, LESS the change
    /// handed back. A till that forgot the change is long by exactly it, every
    /// evening.
    #[test]
    fn expected_cash_subtracts_the_change_given() {
        let (store, _) = shop_with_one_sale("expected");
        // The shift opens before the sale in a real shop; here the sale in the
        // fixture predates it, so open one and sell again to attribute money.
        store
            .open_shift(crate::edge::till::OpenShiftRequest {
                terminal_id: "TILL-1".into(),
                opening_float_minor: 100_000,
                actor_id: "siti".into(),
                idempotency_key: "expected-shift".into(),
            })
            .unwrap_or_else(|error| panic!("shift: {error}"));
        store
            .receive_store(ReceiveRequest {
                epc: "EPC-TILL-002".into(),
                sku_code: "SKU-001".into(),
                unit_price_minor: 150_000,
                source_dc_id: None,
                shipment_reference: None,
                actor_id: "store-receiver".into(),
                idempotency_key: "expected-receive-2".into(),
            })
            .unwrap_or_else(|error| panic!("receive: {error}"));
        move_epc(
            &store,
            "EPC-TILL-002",
            "store-07.warehouse:on_hand",
            "store-07.floor:on_hand",
            "expected-floor-2",
        );
        store
            .complete_sale(SaleRequest {
                coupon_codes: Vec::new(),
                customer_id: None,
                epcs: vec!["EPC-TILL-002".into()],
                tenders: vec![crate::tender::SaleTender {
                    method: crate::tender::PaymentMethod::Cash,
                    amount_minor: 200_000,
                    reference: None,
                }],
                actor_id: "siti".into(),
                idempotency_key: "expected-sale-2".into(),
            })
            .unwrap_or_else(|error| panic!("sale: {error}"));

        let report = store
            .active_shift(Some("TILL-1"))
            .unwrap_or_else(|error| panic!("active: {error}"))
            .unwrap_or_else(|| panic!("a shift is open"));
        assert_eq!(report.sale_count, 1);
        assert_eq!(report.cash_sales_minor, 200_000);
        assert_eq!(report.change_given_minor, 50_000);
        // 100_000 float + 200_000 taken - 50_000 change.
        assert_eq!(report.expected_cash_minor, 250_000);
    }

    /// A card sale is not in the drawer. A till that added it would report a
    /// shortage every evening for exactly the card takings.
    #[test]
    fn non_cash_stays_out_of_the_drawer() {
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("store: {error}"));
        store
            .open_shift(crate::edge::till::OpenShiftRequest {
                terminal_id: "TILL-1".into(),
                opening_float_minor: 100_000,
                actor_id: "siti".into(),
                idempotency_key: "card-shift".into(),
            })
            .unwrap_or_else(|error| panic!("shift: {error}"));
        store
            .receive_store(ReceiveRequest {
                epc: "EPC-CARD-001".into(),
                sku_code: "SKU-001".into(),
                unit_price_minor: 150_000,
                source_dc_id: None,
                shipment_reference: None,
                actor_id: "store-receiver".into(),
                idempotency_key: "card-receive".into(),
            })
            .unwrap_or_else(|error| panic!("receive: {error}"));
        move_epc(
            &store,
            "EPC-CARD-001",
            "store-07.warehouse:on_hand",
            "store-07.floor:on_hand",
            "card-floor",
        );
        store
            .complete_sale(SaleRequest {
                coupon_codes: Vec::new(),
                customer_id: None,
                epcs: vec!["EPC-CARD-001".into()],
                tenders: vec![crate::tender::SaleTender {
                    method: crate::tender::PaymentMethod::Card,
                    amount_minor: 150_000,
                    reference: Some("BCA-approval".into()),
                }],
                actor_id: "siti".into(),
                idempotency_key: "card-sale".into(),
            })
            .unwrap_or_else(|error| panic!("sale: {error}"));
        let report = store
            .active_shift(None)
            .unwrap_or_else(|error| panic!("active: {error}"))
            .unwrap_or_else(|| panic!("a shift is open"));
        assert_eq!(report.non_cash_minor, 150_000);
        assert_eq!(report.cash_sales_minor, 0);
        assert_eq!(report.expected_cash_minor, 100_000);
    }

    /// The fifth tender — and the migration that sat on disk with nothing
    /// applying it.
    ///
    /// This test fails at `complete_sale` rather than at an assertion when
    /// `0028` is unregistered: the CHECK `0020` wrote lists four methods,
    /// `VOUCHER` violates it, and the constraint failure rolls the basket back
    /// whole. That is what a shop saw — a till that offered the tender and
    /// then refused the sale.
    #[test]
    fn a_voucher_settles_a_basket_and_stays_out_of_the_drawer() {
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("store: {error}"));
        store
            .open_shift(crate::edge::till::OpenShiftRequest {
                terminal_id: "TILL-1".into(),
                opening_float_minor: 100_000,
                actor_id: "siti".into(),
                idempotency_key: "voucher-shift".into(),
            })
            .unwrap_or_else(|error| panic!("shift: {error}"));
        store
            .receive_store(ReceiveRequest {
                epc: "EPC-VOUCHER-001".into(),
                sku_code: "SKU-001".into(),
                unit_price_minor: 150_000,
                source_dc_id: None,
                shipment_reference: None,
                actor_id: "store-receiver".into(),
                idempotency_key: "voucher-receive".into(),
            })
            .unwrap_or_else(|error| panic!("receive: {error}"));
        move_epc(
            &store,
            "EPC-VOUCHER-001",
            "store-07.warehouse:on_hand",
            "store-07.floor:on_hand",
            "voucher-floor",
        );

        let sale = store
            .complete_sale(SaleRequest {
                coupon_codes: Vec::new(),
                customer_id: None,
                epcs: vec!["EPC-VOUCHER-001".into()],
                tenders: vec![crate::tender::SaleTender {
                    method: crate::tender::PaymentMethod::Voucher,
                    amount_minor: 150_000,
                    reference: Some("GIFT-0001".into()),
                }],
                actor_id: "siti".into(),
                idempotency_key: "voucher-sale".into(),
            })
            .unwrap_or_else(|error| panic!("sale: {error}"));
        assert_eq!(sale.total_minor, 150_000);
        // No money arrived at the counter, so none can be handed back.
        assert_eq!(sale.change_minor, 0);

        // And the drawer is untouched, which is the reason the voucher is its
        // own method rather than OTHER: the money arrived when the card was
        // sold, possibly at another shop and possibly last year.
        let report = store
            .active_shift(None)
            .unwrap_or_else(|error| panic!("active: {error}"))
            .unwrap_or_else(|| panic!("a shift is open"));
        assert_eq!(report.non_cash_minor, 150_000);
        assert_eq!(report.cash_sales_minor, 0);
        assert_eq!(report.expected_cash_minor, 100_000);
    }

    /// Blind: the declaration arrives with the request and the expectation is
    /// computed here, so the two cannot be reconciled afterwards into agreeing.
    #[test]
    fn closing_stores_both_numbers_and_their_difference() {
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("store: {error}"));
        let shift = store
            .open_shift(crate::edge::till::OpenShiftRequest {
                terminal_id: "TILL-1".into(),
                opening_float_minor: 500_000,
                actor_id: "siti".into(),
                idempotency_key: "close-shift".into(),
            })
            .unwrap_or_else(|error| panic!("shift: {error}"));
        let closed = store
            .close_shift(
                &shift.shift_id,
                crate::edge::till::CloseShiftRequest {
                    declared_cash_minor: 495_000,
                    note: Some("kurang 5rb".into()),
                    actor_id: "siti".into(),
                    idempotency_key: "close-1".into(),
                },
            )
            .unwrap_or_else(|error| panic!("close: {error}"));
        assert_eq!(closed.status, "CLOSED");
        assert_eq!(closed.declared_cash_minor, Some(495_000));
        assert_eq!(closed.expected_cash_minor, 500_000);
        assert_eq!(closed.variance_minor, Some(-5_000));
        // Closed once, and a second close is a conflict rather than a second
        // set of figures.
        assert!(store
            .close_shift(
                &shift.shift_id,
                crate::edge::till::CloseShiftRequest {
                    declared_cash_minor: 500_000,
                    note: None,
                    actor_id: "siti".into(),
                    idempotency_key: "close-2".into(),
                },
            )
            .is_err());
    }

    /// Money leaving the drawer is the direction somebody steals in.
    #[test]
    fn a_payout_needs_a_supervisor_and_a_drop_does_not() {
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("store: {error}"));
        seed_supervisor(&store, "budi", "rahasia-panjang");
        let shift = store
            .open_shift(crate::edge::till::OpenShiftRequest {
                terminal_id: "TILL-1".into(),
                opening_float_minor: 500_000,
                actor_id: "siti".into(),
                idempotency_key: "payout-shift".into(),
            })
            .unwrap_or_else(|error| panic!("shift: {error}"));

        store
            .record_cash_movement(
                &shift.shift_id,
                crate::edge::till::CashMovementRequest {
                    kind: "DROP".into(),
                    amount_minor: -200_000,
                    reason: "Setor ke brankas".into(),
                    actor_id: "siti".into(),
                    supervisor: None,
                    idempotency_key: "drop-1".into(),
                },
            )
            .unwrap_or_else(|error| panic!("drop: {error}"));

        assert!(store
            .record_cash_movement(
                &shift.shift_id,
                crate::edge::till::CashMovementRequest {
                    kind: "PAYOUT".into(),
                    amount_minor: -50_000,
                    reason: "Beli galon".into(),
                    actor_id: "siti".into(),
                    supervisor: None,
                    idempotency_key: "payout-unsigned".into(),
                },
            )
            .is_err());

        // The wrong password is refused the same way a missing supervisor is.
        assert!(store
            .record_cash_movement(
                &shift.shift_id,
                crate::edge::till::CashMovementRequest {
                    kind: "PAYOUT".into(),
                    amount_minor: -50_000,
                    reason: "Beli galon".into(),
                    actor_id: "siti".into(),
                    supervisor: Some(supervisor("budi", "salah")),
                    idempotency_key: "payout-wrong".into(),
                },
            )
            .is_err());

        let report = store
            .record_cash_movement(
                &shift.shift_id,
                crate::edge::till::CashMovementRequest {
                    kind: "PAYOUT".into(),
                    amount_minor: -50_000,
                    reason: "Beli galon".into(),
                    actor_id: "siti".into(),
                    supervisor: Some(supervisor("budi", "rahasia-panjang")),
                    idempotency_key: "payout-signed".into(),
                },
            )
            .unwrap_or_else(|error| panic!("payout: {error}"));
        assert_eq!(report.expected_cash_minor, 250_000);
        assert_eq!(
            report
                .movements
                .iter()
                .find(|movement| movement.kind == "PAYOUT")
                .and_then(|movement| movement.approved_by.clone()),
            Some("budi".to_string())
        );
    }

    /// A void is a reversal, not a delete: the sale keeps its total and the
    /// garment comes home on a movement of its own.
    #[test]
    fn a_void_returns_the_goods_and_keeps_the_sale() {
        let (store, sale_id) = shop_with_one_sale("void");
        seed_supervisor(&store, "budi", "rahasia-panjang");

        let result = store
            .void_sale(
                &sale_id,
                crate::edge::till::VoidSaleRequest {
                    reason: "Salah scan".into(),
                    supervisor: supervisor("budi", "rahasia-panjang"),
                    actor_id: "siti".into(),
                    idempotency_key: "void-1".into(),
                },
            )
            .unwrap_or_else(|error| panic!("void: {error}"));
        assert_eq!(result.refund_minor, 150_000);
        assert_eq!(result.lines.len(), 1);
        assert_eq!(result.approved_by, "budi");

        // The garment is back on the floor, and the sale still exists.
        let floor = store
            .list_pools()
            .unwrap_or_else(|error| panic!("pools: {error}"))
            .into_iter()
            .find(|pool| pool.pool_id == "store-07.floor")
            .unwrap_or_else(|| panic!("floor pool"));
        assert_eq!(floor.on_hand, 1);

        // Voiding it twice is a conflict, not a second refund.
        assert!(store
            .void_sale(
                &sale_id,
                crate::edge::till::VoidSaleRequest {
                    reason: "Salah scan".into(),
                    supervisor: supervisor("budi", "rahasia-panjang"),
                    actor_id: "siti".into(),
                    idempotency_key: "void-2".into(),
                },
            )
            .is_err());
    }

    /// The takings and the drawer are read off the same shop on the same
    /// screen, so they must not disagree about what a void is.
    ///
    /// `till::report` has always asked for `status='COMPLETED'`; the sales
    /// reports asked for nothing and counted the voided sale as money the shop
    /// took. A manager closing up saw a till that balanced and a day that did
    /// not, with no way to tell which one was lying.
    #[test]
    fn a_voided_sale_leaves_the_day_takings() {
        let (store, sale_id) = shop_with_one_sale("takings");
        seed_supervisor(&store, "budi", "rahasia-panjang");

        let today = Utc::now().date_naive();
        let window = |store: &SqliteEdge| {
            store
                .sales_window(crate::edge::reports::SalesWindowQuery {
                    from: today,
                    to: today,
                    utc_offset_minutes: Some(0),
                    limit: None,
                })
                .unwrap_or_else(|error| panic!("window: {error}"))
        };

        let before = window(&store);
        assert_eq!(before.sales.count, 1);
        assert_eq!(before.sales.gross_minor, 150_000);
        assert_eq!(before.sales.units_sold, 1);
        assert_eq!(before.receipts.len(), 1);

        store
            .void_sale(
                &sale_id,
                crate::edge::till::VoidSaleRequest {
                    reason: "Salah scan".into(),
                    supervisor: supervisor("budi", "rahasia-panjang"),
                    actor_id: "siti".into(),
                    idempotency_key: "void-takings".into(),
                },
            )
            .unwrap_or_else(|error| panic!("void: {error}"));

        let after = window(&store);
        assert_eq!(after.sales.count, 0, "a voided sale is not a sale");
        assert_eq!(after.sales.gross_minor, 0, "a voided sale is not money");
        assert_eq!(after.sales.units_sold, 0, "the garment came home");
        assert!(
            after.receipts.is_empty(),
            "a voided sale has no receipt to list"
        );
        // The tender split is read from the same rows and must go with them,
        // or cash and card add up to more than the day took.
        assert!(after.tenders.is_empty(), "{:?}", after.tenders);
    }

    /// A void nobody signed is a void nobody can be asked about.
    #[test]
    fn a_void_without_a_real_supervisor_is_refused() {
        let (store, sale_id) = shop_with_one_sale("unsigned");
        assert!(store
            .void_sale(
                &sale_id,
                crate::edge::till::VoidSaleRequest {
                    reason: "Salah scan".into(),
                    supervisor: supervisor("hantu", "apa-saja"),
                    actor_id: "siti".into(),
                    idempotency_key: "void-ghost".into(),
                },
            )
            .is_err());
        // And the sale is untouched.
        assert_eq!(
            store
                .sale_receipt(&sale_id)
                .unwrap_or_else(|error| panic!("receipt: {error}"))
                .stamp,
            None
        );
    }

    /// The unit is refunded at what it was charged on the day. Refunding at
    /// today's price is how a clearance turns into free money.
    #[test]
    fn a_return_refunds_the_price_that_was_charged() {
        let (store, sale_id) = shop_with_one_sale("return");
        seed_supervisor(&store, "budi", "rahasia-panjang");
        let result = store
            .return_sale(crate::edge::till::ReturnRequest {
                sale_id: sale_id.clone(),
                lines: vec![crate::edge::till::ReturnLineRequest {
                    epc: "EPC-TILL-001".into(),
                    disposition: "RESALEABLE".into(),
                }],
                refund_method: "CASH".into(),
                refund_reference: None,
                reason: "Ukuran tidak pas".into(),
                supervisor: supervisor("budi", "rahasia-panjang"),
                actor_id: "siti".into(),
                idempotency_key: "return-1".into(),
            })
            .unwrap_or_else(|error| panic!("return: {error}"));
        assert_eq!(result.refund_minor, 150_000);
        assert_eq!(result.remaining_lines, 0);

        // One garment cannot be returned twice — that is one shirt bought back
        // at retail twice.
        assert!(store
            .return_sale(crate::edge::till::ReturnRequest {
                sale_id,
                lines: vec![crate::edge::till::ReturnLineRequest {
                    epc: "EPC-TILL-001".into(),
                    disposition: "RESALEABLE".into(),
                }],
                refund_method: "CASH".into(),
                refund_reference: None,
                reason: "Lagi".into(),
                supervisor: supervisor("budi", "rahasia-panjang"),
                actor_id: "siti".into(),
                idempotency_key: "return-2".into(),
            })
            .is_err());
    }

    /// Anything not fit to sell must not reach the rail by default.
    #[test]
    fn a_damaged_return_goes_to_reject_not_the_floor() {
        let (store, sale_id) = shop_with_one_sale("damaged");
        seed_supervisor(&store, "budi", "rahasia-panjang");
        store
            .return_sale(crate::edge::till::ReturnRequest {
                sale_id,
                lines: vec![crate::edge::till::ReturnLineRequest {
                    epc: "EPC-TILL-001".into(),
                    disposition: "DAMAGED".into(),
                }],
                refund_method: "CASH".into(),
                refund_reference: None,
                reason: "Jahitan lepas".into(),
                supervisor: supervisor("budi", "rahasia-panjang"),
                actor_id: "siti".into(),
                idempotency_key: "return-damaged".into(),
            })
            .unwrap_or_else(|error| panic!("return: {error}"));
        let pools = store
            .list_pools()
            .unwrap_or_else(|error| panic!("pools: {error}"));
        let reject = pools
            .iter()
            .find(|pool| pool.pool_id == "store-07.reject")
            .unwrap_or_else(|| panic!("reject pool"));
        let floor = pools
            .iter()
            .find(|pool| pool.pool_id == "store-07.floor")
            .unwrap_or_else(|| panic!("floor pool"));
        assert_eq!(reject.on_hand, 1);
        assert_eq!(floor.on_hand, 0);
    }

    /// A garment handed back against the wrong receipt is a refund the shop
    /// cannot trace to money it ever took.
    #[test]
    fn a_unit_that_was_not_on_the_sale_is_refused() {
        let (store, sale_id) = shop_with_one_sale("stranger");
        seed_supervisor(&store, "budi", "rahasia-panjang");
        assert!(store
            .return_sale(crate::edge::till::ReturnRequest {
                sale_id,
                lines: vec![crate::edge::till::ReturnLineRequest {
                    epc: "EPC-NOT-SOLD".into(),
                    disposition: "RESALEABLE".into(),
                }],
                refund_method: "CASH".into(),
                refund_reference: None,
                reason: "Coba".into(),
                supervisor: supervisor("budi", "rahasia-panjang"),
                actor_id: "siti".into(),
                idempotency_key: "return-stranger".into(),
            })
            .is_err());
    }

    /// A voided sale still prints — that is what the customer is handed with
    /// their money back — but it prints stamped, so two copies in a drawer at
    /// the end of the day are not counted as two sales.
    #[test]
    fn a_receipt_says_when_a_sale_was_undone() {
        let (store, sale_id) = shop_with_one_sale("stamp");
        seed_supervisor(&store, "budi", "rahasia-panjang");
        let before = store
            .sale_receipt(&sale_id)
            .unwrap_or_else(|error| panic!("receipt: {error}"));
        assert_eq!(before.stamp, None);
        assert_eq!(before.total_minor, 150_000);
        assert_eq!(before.change_minor, 50_000);
        assert!(before.receipt_no.starts_with("STORE-07-"));

        store
            .void_sale(
                &sale_id,
                crate::edge::till::VoidSaleRequest {
                    reason: "Salah scan".into(),
                    supervisor: supervisor("budi", "rahasia-panjang"),
                    actor_id: "siti".into(),
                    idempotency_key: "stamp-void".into(),
                },
            )
            .unwrap_or_else(|error| panic!("void: {error}"));
        let after = store
            .sale_receipt(&sale_id)
            .unwrap_or_else(|error| panic!("receipt: {error}"));
        assert_eq!(after.stamp.as_deref(), Some("** BATAL **"));
    }

    /// A DC has no drawer, no customer and no receipt printer.
    #[test]
    fn a_dc_has_no_till() {
        let dc = SqliteEdge::open_in_memory(node(EdgeRole::Dc, "dc-01"))
            .unwrap_or_else(|error| panic!("dc: {error}"));
        assert!(dc
            .open_shift(crate::edge::till::OpenShiftRequest {
                terminal_id: "TILL-1".into(),
                opening_float_minor: 0,
                actor_id: "operator".into(),
                idempotency_key: "dc-shift".into(),
            })
            .is_err());
    }

    /// A retried void is the same void, not a second one. The till is offline
    /// half the time and a flaky link must not refund twice.
    #[test]
    fn a_retried_void_returns_the_first_answer() {
        let (store, sale_id) = shop_with_one_sale("retry");
        seed_supervisor(&store, "budi", "rahasia-panjang");
        let request = || crate::edge::till::VoidSaleRequest {
            reason: "Salah scan".into(),
            supervisor: supervisor("budi", "rahasia-panjang"),
            actor_id: "siti".into(),
            idempotency_key: "void-retry".into(),
        };
        let first = store
            .void_sale(&sale_id, request())
            .unwrap_or_else(|error| panic!("void: {error}"));
        let again = store
            .void_sale(&sale_id, request())
            .unwrap_or_else(|error| panic!("void retry: {error}"));
        assert_eq!(first.movement_group_id, again.movement_group_id);
        let floor = store
            .list_pools()
            .unwrap_or_else(|error| panic!("pools: {error}"))
            .into_iter()
            .find(|pool| pool.pool_id == "store-07.floor")
            .unwrap_or_else(|| panic!("floor pool"));
        assert_eq!(floor.on_hand, 1);
    }

    #[test]
    fn role_boundaries_are_enforced_locally() {
        let store = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-01"))
            .unwrap_or_else(|error| panic!("store: {error}"));
        assert!(store
            .intake_dc(IntakeRequest {
                epc: "EPC-WRONG-ROLE".into(),
                sku_code: "SKU-001".into(),
                unit_price_minor: 1,
                actor_id: "operator".into(),
                idempotency_key: "wrong-role".into(),
            })
            .is_err());
    }

    #[derive(Debug)]
    struct FactRow {
        generation: i64,
        seq: i64,
        event_id: String,
        event_type: String,
        payload: String,
    }

    fn facts(edge: &SqliteEdge) -> Vec<FactRow> {
        let connection = edge
            .connection
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        let mut statement = connection
            .prepare(
                "SELECT generation,seq,event_id,event_type,payload
                 FROM sync_fact_log ORDER BY generation,seq",
            )
            .unwrap_or_else(|error| panic!("prepare facts: {error}"));
        statement
            .query_map([], |row| {
                Ok(FactRow {
                    generation: row.get(0)?,
                    seq: row.get(1)?,
                    event_id: row.get(2)?,
                    event_type: row.get(3)?,
                    payload: row.get(4)?,
                })
            })
            .unwrap_or_else(|error| panic!("query facts: {error}"))
            .map(|row| row.unwrap_or_else(|error| panic!("fact row: {error}")))
            .collect()
    }

    /// Decode a snapshot row. Snapshots no longer accompany every movement —
    /// they are the periodic cross-check — so callers must pick the snapshot
    /// row rather than assuming the latest fact is one.
    fn snapshot(row: &FactRow) -> PoolSnapshotPayload {
        assert_eq!(row.event_type, INVENTORY_POOL_SNAPSHOT_V1);
        let payload: PoolSnapshotPayload = serde_json::from_str(&row.payload)
            .unwrap_or_else(|error| panic!("snapshot payload: {error}"));
        payload
            .validate()
            .unwrap_or_else(|error| panic!("valid snapshot: {error}"));
        payload
    }

    fn expected_pools(edge: &SqliteEdge) -> Vec<PoolSnapshotBalance> {
        edge.list_pools()
            .unwrap_or_else(|error| panic!("list pools: {error}"))
            .into_iter()
            .map(|pool| PoolSnapshotBalance {
                pool_id: pool.pool_id,
                stock: pool.stock,
                allotted: pool.allotted,
                on_hand: pool.on_hand,
                missing: pool.missing,
            })
            .collect()
    }

    fn intake_request(epc: &str, key: &str) -> IntakeRequest {
        IntakeRequest {
            epc: epc.into(),
            sku_code: "SKU-001".into(),
            unit_price_minor: 150_000,
            actor_id: "dc-receiver".into(),
            idempotency_key: key.into(),
        }
    }

    fn sync_position(edge: &SqliteEdge) -> (String, i64, i64) {
        let connection = edge
            .connection
            .lock()
            .unwrap_or_else(|error| panic!("connection: {error}"));
        connection
            .query_row(
                "SELECT origin_id,generation,next_seq FROM sync_origin",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or_else(|error| panic!("sync position: {error}"))
    }

    #[test]
    fn bootstrap_snapshot_exists_and_matches_zero_valued_base_pools() {
        let edge = SqliteEdge::open_in_memory(node(EdgeRole::Store, "store-07"))
            .unwrap_or_else(|error| panic!("edge: {error}"));
        let rows = facts(&edge);
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].generation, rows[0].seq), (1, 1));
        let payload = snapshot(&rows[0]);
        assert_eq!(payload.node_id, "store-07-edge");
        assert_eq!(payload.node_role, "STORE");
        assert_eq!(payload.site_id, "store-07");
        assert_eq!(payload.pools, expected_pools(&edge));
        assert_eq!(payload.pools.len(), 3);
        assert!(payload.pools.iter().all(|pool| pool.stock == 0));
    }

    #[test]
    fn capture_without_upload_configuration_is_exact_and_idempotent() {
        let edge = SqliteEdge::open_in_memory(node(EdgeRole::Dc, "dc-01"))
            .unwrap_or_else(|error| panic!("edge: {error}"));
        let request = intake_request("EPC-SNAPSHOT-001", "snapshot-intake-001");
        let first = edge
            .intake_dc(request.clone())
            .unwrap_or_else(|error| panic!("intake: {error}"));
        let rows = facts(&edge);
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[1].generation, rows[1].seq), (1, 2));
        assert_eq!(rows[1].event_id, first.movement_group_id.to_string());
        // The movement itself is what travels, carrying the identity of the
        // item that moved. The observed position is no longer emitted here —
        // it is the periodic cross-check (`capture_pool_snapshot`), because a
        // check that arrives with every fact it checks costs full price and
        // proves nothing the previous one did not.
        assert_eq!(rows[1].event_type, "inventory.movement");
        assert!(
            rows[1].payload.contains("subject_id"),
            "the centre cannot tell one physical item from another without it"
        );
        assert!(rows[1].payload.contains("\"cause\""));

        let retry = edge
            .intake_dc(request)
            .unwrap_or_else(|error| panic!("retry: {error}"));
        assert_eq!(retry.movement_group_id, first.movement_group_id);
        assert_eq!(facts(&edge).len(), 2);
        assert_eq!(sync_position(&edge).2, 2);
    }

    #[test]
    fn failed_command_rolls_back_fact_and_sequence_allocation() {
        let edge = SqliteEdge::open_in_memory(node(EdgeRole::Dc, "dc-01"))
            .unwrap_or_else(|error| panic!("edge: {error}"));
        edge.intake_dc(intake_request("EPC-ROLLBACK-001", "rollback-intake"))
            .unwrap_or_else(|error| panic!("intake: {error}"));
        let failed = edge.move_stock(MoveRequest {
            epc: "EPC-ROLLBACK-001".into(),
            quantity: 2,
            from: "dc-01.pending.unidentified:on_hand".into(),
            to: "dc-01.pending.untagged:on_hand".into(),
            cause: MovementCause::NormalMove,
            reason: "must roll back".into(),
            actor_id: "tester".into(),
            idempotency_key: "rollback-failed".into(),
            reference_type: None,
            reference_id: None,
        });
        assert!(matches!(failed, Err(EdgeError::Conflict(_))));
        assert_eq!(facts(&edge).len(), 2);
        assert_eq!(sync_position(&edge).2, 2);

        move_epc(
            &edge,
            "EPC-ROLLBACK-001",
            "dc-01.pending.unidentified:on_hand",
            "dc-01.pending.untagged:on_hand",
            "rollback-success",
        );
        let rows = facts(&edge);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[2].seq, 3);
        // The successful command left its own movement behind, at the very
        // sequence position the failed one released.
        assert_eq!(rows[2].event_type, "inventory.movement");
        assert!(
            rows[2].payload.contains("EPC-ROLLBACK-001") || rows[2].payload.contains("subject_id")
        );

        // And the position the shop would report still matches its ledger:
        // the rolled-back command left nothing behind in either.
        edge.capture_pool_snapshot()
            .unwrap_or_else(|error| panic!("snapshot: {error}"));
        let rows = facts(&edge);
        assert_eq!(snapshot(&rows[3]).pools, expected_pools(&edge));
    }

    #[test]
    fn existing_projection_without_origin_gets_one_current_bootstrap() {
        let path =
            std::env::temp_dir().join(format!("inventory-edge-legacy-{}.sqlite3", Uuid::new_v4()));
        let context = node(EdgeRole::Dc, "dc-01");
        let expected = {
            let edge = SqliteEdge::open(&path, context.clone())
                .unwrap_or_else(|error| panic!("open legacy seed: {error}"));
            edge.intake_dc(intake_request("EPC-LEGACY-001", "legacy-intake"))
                .unwrap_or_else(|error| panic!("legacy intake: {error}"));
            let expected = expected_pools(&edge);
            let connection = edge
                .connection
                .lock()
                .unwrap_or_else(|error| panic!("connection: {error}"));
            connection
                .execute("DELETE FROM sync_fact_log", [])
                .unwrap_or_else(|error| panic!("delete facts: {error}"));
            connection
                .execute("DELETE FROM sync_generation_bootstrap", [])
                .unwrap_or_else(|error| panic!("delete bootstrap marker: {error}"));
            connection
                .execute("DELETE FROM sync_origin", [])
                .unwrap_or_else(|error| panic!("delete origin: {error}"));
            expected
        };
        let reopened = SqliteEdge::open(&path, context)
            .unwrap_or_else(|error| panic!("reopen legacy: {error}"));
        let rows = facts(&reopened);
        assert_eq!(rows.len(), 1);
        assert_eq!(snapshot(&rows[0]).pools, expected);
        drop(reopened);
        remove_sqlite_files(&path);
    }

    #[test]
    fn file_reopen_preserves_origin_and_backlog_without_duplicate_bootstrap() {
        let path =
            std::env::temp_dir().join(format!("inventory-edge-reopen-{}.sqlite3", Uuid::new_v4()));
        let context = node(EdgeRole::Dc, "dc-01");
        {
            let edge = SqliteEdge::open(&path, context.clone())
                .unwrap_or_else(|error| panic!("open: {error}"));
            edge.intake_dc(intake_request("EPC-REOPEN-001", "reopen-intake"))
                .unwrap_or_else(|error| panic!("intake: {error}"));
            {
                let connection = edge
                    .connection
                    .lock()
                    .unwrap_or_else(|error| panic!("connection: {error}"));
                connection
                    .execute(
                        "INSERT INTO sync_watermark(origin_id,generation,durable_seq,updated_at)
                         VALUES ('dc-01-edge',1,2,?1)",
                        [now_text()],
                    )
                    .unwrap_or_else(|error| panic!("acknowledge generation one: {error}"));
            }
            edge.configure_sync_generation(2)
                .unwrap_or_else(|error| panic!("rollover: {error}"));
            assert_eq!(sync_position(&edge), ("dc-01-edge".into(), 2, 1));
        }
        {
            let edge =
                SqliteEdge::open(&path, context).unwrap_or_else(|error| panic!("reopen: {error}"));
            assert_eq!(sync_position(&edge), ("dc-01-edge".into(), 2, 1));
            assert_eq!(facts(&edge).len(), 3);
            let connection = edge
                .connection
                .lock()
                .unwrap_or_else(|error| panic!("connection: {error}"));
            assert_eq!(
                crate::edge::sync::backlog(&connection)
                    .unwrap_or_else(|error| panic!("backlog: {error}")),
                (0, 1, 0)
            );
        }
        remove_sqlite_files(&path);
    }

    #[test]
    fn purged_bootstrap_is_not_recreated_on_reopen() {
        let path = std::env::temp_dir().join(format!(
            "inventory-edge-purged-bootstrap-{}.sqlite3",
            Uuid::new_v4()
        ));
        let context = node(EdgeRole::Store, "store-07");
        {
            let edge = SqliteEdge::open(&path, context.clone())
                .unwrap_or_else(|error| panic!("open: {error}"));
            let connection = edge
                .connection
                .lock()
                .unwrap_or_else(|error| panic!("connection: {error}"));
            connection
                .execute(
                    "INSERT INTO sync_watermark(origin_id,generation,durable_seq,updated_at)
                     VALUES ('store-07-edge',1,1,?1)",
                    [now_text()],
                )
                .unwrap_or_else(|error| panic!("acknowledge bootstrap: {error}"));
            connection
                .execute(
                    "UPDATE sync_fact_log SET created_at='2000-01-01T00:00:00.000000Z'",
                    [],
                )
                .unwrap_or_else(|error| panic!("age bootstrap: {error}"));
            assert_eq!(
                crate::edge::sync::purge_synced(&connection, 0)
                    .unwrap_or_else(|error| panic!("purge bootstrap: {error}")),
                1
            );
            drop(connection);
            assert!(facts(&edge).is_empty());
        }
        {
            let edge =
                SqliteEdge::open(&path, context).unwrap_or_else(|error| panic!("reopen: {error}"));
            assert_eq!(sync_position(&edge), ("store-07-edge".into(), 1, 1));
            assert!(facts(&edge).is_empty());
            let connection = edge
                .connection
                .lock()
                .unwrap_or_else(|error| panic!("connection: {error}"));
            let markers: i64 = connection
                .query_row(
                    "SELECT count(*) FROM sync_generation_bootstrap",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_else(|error| panic!("bootstrap markers: {error}"));
            assert_eq!(markers, 1);
        }
        remove_sqlite_files(&path);
    }

    #[tokio::test]
    async fn generation_rollover_requires_ack_and_bootstraps_once() {
        use crate::sync::SyncStore;

        let edge = SqliteEdge::open_in_memory(node(EdgeRole::Dc, "dc-01"))
            .unwrap_or_else(|error| panic!("edge: {error}"));
        edge.intake_dc(intake_request("EPC-GENERATION-001", "generation-intake"))
            .unwrap_or_else(|error| panic!("intake: {error}"));
        assert!(matches!(
            edge.configure_sync_generation(2),
            Err(EdgeError::Conflict(_))
        ));
        assert_eq!(sync_position(&edge), ("dc-01-edge".into(), 1, 2));

        let store = crate::edge::SqliteSyncStore::new(edge.connection());
        store
            .settle_advance("dc-01-edge", 1, 2, &[])
            .await
            .unwrap_or_else(|error| panic!("acknowledge: {error}"));
        edge.configure_sync_generation(2)
            .unwrap_or_else(|error| panic!("rollover: {error}"));
        assert_eq!(sync_position(&edge), ("dc-01-edge".into(), 2, 1));
        let generation_two: Vec<_> = facts(&edge)
            .into_iter()
            .filter(|row| row.generation == 2)
            .collect();
        assert_eq!(generation_two.len(), 1);
        assert_eq!(generation_two[0].seq, 1);
        assert_eq!(snapshot(&generation_two[0]).pools, expected_pools(&edge));

        edge.configure_sync_generation(2)
            .unwrap_or_else(|error| panic!("same generation: {error}"));
        assert_eq!(sync_position(&edge), ("dc-01-edge".into(), 2, 1));
        assert_eq!(
            facts(&edge)
                .iter()
                .filter(|row| row.generation == 2)
                .count(),
            1
        );
        assert!(matches!(
            edge.configure_sync_generation(1),
            Err(EdgeError::Configuration(_))
        ));
    }

    fn remove_sqlite_files(path: &Path) {
        for suffix in ["", "-wal", "-shm"] {
            let candidate = std::path::PathBuf::from(format!("{}{suffix}", path.display()));
            let _ = std::fs::remove_file(candidate);
        }
    }
}

// These belong to `EdgeInventory` (the routers hold a trait object), and are
// kept in their own block only to stay near the purchase schema they use.
impl SqliteEdge {
    /// The lines this DC still owes a delivery against.
    ///
    /// A receiving clerk's work list. Received quantity is summed from this
    /// node's own receipt facts rather than kept as a column, for the same
    /// reason the centre does it that way: a counter and the facts behind it
    /// drift, and then nobody can say which one to believe.
    fn open_purchase_lines_impl(&self) -> Result<Vec<PurchaseWorkLine>, EdgeError> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                // NOT ordered_quantity. This is the checker's view, and a
                // count taken while looking at the number it is meant to
                // produce is not evidence of anything.
                "SELECT l.po_line_id, o.po_number, o.supplier_id, o.supplier_name,
                        l.line_number, l.article_code, l.article_name, l.image_url,
                        COALESCE((SELECT SUM(c.counted_quantity) FROM receiving_count c
                                  WHERE c.po_line_id = l.po_line_id AND c.status='ACCEPTED'), 0)
                 FROM purchase_order_line l
                 JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
                 ORDER BY o.po_number, l.line_number",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                Ok(PurchaseWorkLine {
                    po_line_id: parse_uuid_row(row.get::<_, String>(0)?)?,
                    po_number: row.get(1)?,
                    supplier_id: row.get(2)?,
                    supplier_name: row.get(3)?,
                    line_number: row.get(4)?,
                    article_code: row.get(5)?,
                    article_name: row.get(6)?,
                    image_url: row.get(7)?,
                    expected_stock_units: None,
                    received_stock_units: row.get(8)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)
    }

    /// The verifier's queue. Carries the order's own numbers beside the
    /// count, because deciding requires comparing and the checker's view
    /// deliberately withholds them.
    fn counts_awaiting_verification_impl(
        &self,
    ) -> Result<Vec<PurchaseCountAwaitingVerification>, EdgeError> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT c.count_id, c.po_line_id, o.po_number, o.supplier_id,
                        l.article_code, l.article_name, c.counted_quantity, c.counted_by,
                        c.counted_at, l.ordered_quantity,
                        l.unit_price_minor, c.status, c.receipt_id
                 FROM receiving_count c
                 JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
                 JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
                 WHERE c.status = 'AWAITING_VERIFICATION'
                 ORDER BY c.counted_at",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                let ordered: i64 = row.get(9)?;
                let counted: i64 = row.get(6)?;
                // Both sides are pieces, so there is nothing to convert.
                let expected = ordered;
                Ok(PurchaseCountAwaitingVerification {
                    count_id: parse_uuid_row(row.get::<_, String>(0)?)?,
                    receipt_id: parse_uuid_row(row.get::<_, String>(12)?)?,
                    po_line_id: parse_uuid_row(row.get::<_, String>(1)?)?,
                    po_number: row.get(2)?,
                    supplier_id: row.get(3)?,
                    article_code: row.get(4)?,
                    article_name: row.get(5)?,
                    counted_quantity: counted,
                    counted_by: row.get(7)?,
                    counted_at: parse_time_row(row.get::<_, String>(8)?)?,
                    expected_stock_units: expected,
                    variance: counted - expected,
                    unit_price_minor: row.get(10)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)
    }

    /// Record a blind count of what physically arrived.
    ///
    /// This writes a document and nothing else. No movement is posted and no
    /// fact travels, because a count is an observation and the goods are not
    /// yet anything the system holds — they are on the loading bay. They
    /// become stock when a verifier accepts the count, and not before.
    fn count_purchase_impl(
        &self,
        request: PurchaseCountRequest,
    ) -> Result<PurchaseCountResult, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "supplier deliveries are counted at a DC".into(),
            ));
        }
        if request.counted_quantity <= 0 {
            return Err(EdgeError::Validation(
                "a count of nothing is not a count; refuse the delivery instead".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "PURCHASE_COUNT",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }
        let known: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM purchase_order_line WHERE po_line_id = ?1",
                params![request.po_line_id.to_string()],
                |row| row.get(0),
            )
            .map_err(db)?;
        if known == 0 {
            return Err(EdgeError::NotFound(format!(
                "this DC holds no purchase order line {}; it cannot count against one it was never given",
                request.po_line_id
            )));
        }
        // A count belongs to a delivery, and a closed delivery has been
        // settled — counting into it afterwards would change a document
        // somebody has already acted on.
        let receipt_status: Option<String> = tx
            .query_row(
                "SELECT status FROM goods_receipt WHERE receipt_id = ?1",
                params![request.receipt_id.to_string()],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?;
        match receipt_status.as_deref() {
            Some("OPEN") => {}
            Some(other) => {
                return Err(EdgeError::Conflict(format!(
                    "delivery {} is {}; open a new one for goods arriving now",
                    request.receipt_id,
                    other.to_lowercase()
                )))
            }
            None => {
                return Err(EdgeError::NotFound(format!(
                    "no delivery {}: open the document when the lorry arrives, then count into it",
                    request.receipt_id
                )))
            }
        }
        let count_id = Uuid::new_v4();
        let counted_at = Utc::now();
        tx.execute(
            "INSERT INTO receiving_count
                 (count_id, receipt_id, po_line_id, counted_quantity, counted_by, counted_at,
                  status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'AWAITING_VERIFICATION')",
            params![
                count_id.to_string(),
                request.receipt_id.to_string(),
                request.po_line_id.to_string(),
                request.counted_quantity,
                request.actor_id,
                time_text(counted_at)
            ],
        )
        .map_err(db)?;
        let response = PurchaseCountResult {
            count_id,
            po_line_id: request.po_line_id,
            counted_quantity: request.counted_quantity,
            counted_by: request.actor_id.clone(),
            counted_at,
        };
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "PURCHASE_COUNT",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }
}

fn parse_time_row(value: String) -> Result<DateTime<Utc>, rusqlite::Error> {
    DateTime::parse_from_rfc3339(&value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
}

fn parse_uuid_row(value: String) -> Result<Uuid, rusqlite::Error> {
    Uuid::parse_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

impl SqliteEdge {
    /// Decide a counted delivery: accept it, or send it back to be counted
    /// again.
    ///
    /// Accepting is the moment the goods first exist. Until now they have been
    /// on the loading bay and the system has held only a piece of paper about
    /// them; here they enter the `unidentified` pool as a quantity of an
    /// article — no SKU, no tag, because nobody has worked out what they are
    /// yet. That is also the moment the centre is told anything, because the
    /// quantity a verifier accepted is what settles the supplier's invoice.
    ///
    /// The verifier approves the checker's number as it stands. There is no
    /// way to accept a different quantity: someone who could both approve a
    /// delivery and decide what it was would hold the entire control.
    ///
    /// What the system CANNOT check is the price. It never sees the supplier's
    /// invoice — only the verifier does, on paper. So the most it can do is
    /// put the ordered price in front of them and offer the amendment as an
    /// action beside the approval. A verifier who approves without looking
    /// leaves no trace of having not looked, and no code can change that.
    /// Read one delivery document back, with how far it has got.
    fn receipt_view(tx: &Transaction<'_>, receipt_id: Uuid) -> Result<GoodsReceiptView, EdgeError> {
        tx.query_row(
            "SELECT r.receipt_number, r.supplier_id, r.arrived_at, r.status, r.opened_by,
                    r.invoice_number, r.invoice_total_minor,
                    (SELECT count(*) FROM receiving_count c WHERE c.receipt_id = r.receipt_id),
                    (SELECT count(*) FROM receiving_count c
                     WHERE c.receipt_id = r.receipt_id AND c.status = 'ACCEPTED')
             FROM goods_receipt r WHERE r.receipt_id = ?1",
            params![receipt_id.to_string()],
            |row| {
                Ok(GoodsReceiptView {
                    receipt_id,
                    receipt_number: row.get(0)?,
                    supplier_id: row.get(1)?,
                    arrived_at: parse_time_row(row.get::<_, String>(2)?)?,
                    status: row.get(3)?,
                    opened_by: row.get(4)?,
                    invoice_number: row.get(5)?,
                    invoice_total_minor: row.get(6)?,
                    counted_lines: row.get(7)?,
                    accepted_lines: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("no delivery {receipt_id}")))
    }

    /// Open a delivery document when a lorry arrives.
    ///
    /// The number is minted here rather than at the centre. A warehouse must
    /// be able to receive with the network down, and a number handed out by
    /// the centre would make receiving wait for the one thing a loading bay
    /// cannot wait for. The site is inside the number, so two DCs numbering
    /// at the same moment cannot collide.
    fn open_goods_receipt_impl(
        &self,
        request: OpenGoodsReceiptRequest,
    ) -> Result<GoodsReceiptView, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "supplier deliveries are received at a DC".into(),
            ));
        }
        if request.supplier_id.trim().is_empty() {
            return Err(EdgeError::Validation(
                "a delivery must name the supplier it came from".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "GOODS_RECEIPT_OPEN",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        // Gapless per site. The number goes on a document a supplier will
        // quote back at you, so a hole in the sequence is a question somebody
        // has to answer.
        tx.execute(
            "INSERT INTO goods_receipt_counter (singleton, last_number) VALUES (1, 0)
             ON CONFLICT(singleton) DO NOTHING",
            [],
        )
        .map_err(db)?;
        let next: i64 = tx
            .query_row(
                "UPDATE goods_receipt_counter SET last_number = last_number + 1
                 WHERE singleton = 1 RETURNING last_number",
                [],
                |row| row.get(0),
            )
            .map_err(db)?;

        let receipt_id = Uuid::new_v4();
        let arrived_at = request.arrived_at.unwrap_or_else(Utc::now);
        let opened_at = Utc::now();
        let receipt_number = format!("GRN-{}-{next:06}", self.node.site_id);
        tx.execute(
            "INSERT INTO goods_receipt
                 (receipt_id, receipt_number, supplier_id, arrived_at, status, opened_by,
                  opened_at)
             VALUES (?1, ?2, ?3, ?4, 'OPEN', ?5, ?6)",
            params![
                receipt_id.to_string(),
                receipt_number,
                request.supplier_id.trim(),
                time_text(arrived_at),
                request.actor_id,
                time_text(opened_at)
            ],
        )
        .map_err(db)?;

        let view = Self::receipt_view(&tx, receipt_id)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "GOODS_RECEIPT_OPEN",
            &request_json,
            &view,
        )?;
        tx.commit().map_err(db)?;
        Ok(view)
    }

    /// Deliveries still being worked through.
    fn open_goods_receipts_impl(&self) -> Result<Vec<GoodsReceiptView>, EdgeError> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT receipt_id FROM goods_receipt WHERE status = 'OPEN' ORDER BY arrived_at",
            )
            .map_err(db)?;
        let ids: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .map_err(db)?
            .collect::<Result<_, _>>()
            .map_err(db)?;
        drop(statement);
        let tx = connection.unchecked_transaction().map_err(db)?;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let receipt_id = Uuid::parse_str(&id)
                .map_err(|error| EdgeError::Persistence(format!("stored receipt id: {error}")))?;
            out.push(Self::receipt_view(&tx, receipt_id)?);
        }
        Ok(out)
    }

    /// Record the supplier's invoice against a delivery.
    ///
    /// The verifier is holding the paper and the system is not. This is the
    /// only route by which it ever learns what was actually billed, which is
    /// also why the number is recorded rather than derived: an invoice that
    /// disagrees with the order is exactly the case worth catching, and a
    /// figure computed from the order could never disagree with it.
    fn record_receipt_invoice_impl(
        &self,
        request: RecordInvoiceRequest,
    ) -> Result<GoodsReceiptView, EdgeError> {
        if request.invoice_number.trim().is_empty() {
            return Err(EdgeError::Validation(
                "an invoice must have a number".into(),
            ));
        }
        if request.invoice_total_minor < 0 {
            return Err(EdgeError::Validation(
                "an invoice total cannot be negative".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "GOODS_RECEIPT_INVOICE",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        let recorded_at = Utc::now();
        let updated = tx
            .execute(
                "UPDATE goods_receipt
                 SET invoice_number = ?2, invoice_date = ?3, invoice_total_minor = ?4,
                     invoice_document_ref = ?5, invoice_recorded_by = ?6,
                     invoice_recorded_at = ?7
                 WHERE receipt_id = ?1",
                params![
                    request.receipt_id.to_string(),
                    request.invoice_number.trim(),
                    request.invoice_date,
                    request.invoice_total_minor,
                    request.invoice_document_ref,
                    request.actor_id,
                    time_text(recorded_at)
                ],
            )
            .map_err(db)?;
        if updated == 0 {
            return Err(EdgeError::NotFound(format!(
                "no delivery {}",
                request.receipt_id
            )));
        }

        crate::edge::sync::record_receipt_invoice(
            &tx,
            Uuid::new_v4(),
            request.receipt_id,
            request.invoice_number.trim(),
            request.invoice_date.as_deref(),
            request.invoice_total_minor,
            request.invoice_document_ref.as_deref(),
            &request.actor_id,
            recorded_at,
        )
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;

        let view = Self::receipt_view(&tx, request.receipt_id)?;
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "GOODS_RECEIPT_INVOICE",
            &request_json,
            &view,
        )?;
        tx.commit().map_err(db)?;
        Ok(view)
    }

    /// Keep the invoice page against the delivery it came with.
    ///
    /// No idempotency key, unlike every write beside it, and that is on
    /// purpose: this is not a fact and it moves nothing. Uploading the same
    /// page twice leaves one row either way, because the delivery is the
    /// primary key — the second upload is somebody who photographed a
    /// crumpled page and then a flat one, and they meant the flat one.
    fn store_invoice_document_impl(
        &self,
        request: StoreInvoiceDocumentRequest,
    ) -> Result<InvoiceDocumentView, EdgeError> {
        if request.bytes.is_empty() {
            return Err(EdgeError::Validation(
                "an empty file is not an invoice".into(),
            ));
        }
        // Eight megabytes is a generous photograph of a page and a mean
        // scanner PDF. The cap exists because this database sits on a machine
        // in a warehouse with no operator, and a node that fills its own disk
        // stops receiving goods.
        const LIMIT: usize = 8 * 1024 * 1024;
        if request.bytes.len() > LIMIT {
            return Err(EdgeError::Validation(format!(
                "an invoice page over {} MB is a scan setting, not a document",
                LIMIT / (1024 * 1024)
            )));
        }
        let filename = request.filename.trim();
        if filename.is_empty() {
            return Err(EdgeError::Validation(
                "an uploaded file must arrive with a name".into(),
            ));
        }
        let content_type = if request.content_type.trim().is_empty() {
            "application/octet-stream"
        } else {
            request.content_type.trim()
        };

        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let known: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM goods_receipt WHERE receipt_id = ?1",
                params![request.receipt_id.to_string()],
                |row| row.get(0),
            )
            .map_err(db)?;
        if known == 0 {
            return Err(EdgeError::NotFound(format!(
                "no delivery {}",
                request.receipt_id
            )));
        }

        let uploaded_at = Utc::now();
        let byte_count = request.bytes.len() as i64;
        tx.execute(
            "INSERT INTO goods_receipt_invoice_document
                 (receipt_id, filename, content_type, byte_count, bytes, uploaded_by, uploaded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(receipt_id) DO UPDATE SET
                 filename = excluded.filename,
                 content_type = excluded.content_type,
                 byte_count = excluded.byte_count,
                 bytes = excluded.bytes,
                 uploaded_by = excluded.uploaded_by,
                 uploaded_at = excluded.uploaded_at",
            params![
                request.receipt_id.to_string(),
                filename,
                content_type,
                byte_count,
                request.bytes,
                request.actor_id,
                time_text(uploaded_at)
            ],
        )
        .map_err(db)?;
        tx.commit().map_err(db)?;

        Ok(InvoiceDocumentView {
            receipt_id: request.receipt_id,
            filename: filename.to_string(),
            content_type: content_type.to_string(),
            byte_count,
            uploaded_by: request.actor_id,
            uploaded_at,
        })
    }

    /// The page back, for a verifier who wants to read it again.
    fn invoice_document_impl(&self, receipt_id: Uuid) -> Result<InvoiceDocument, EdgeError> {
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT filename, content_type, bytes
                 FROM goods_receipt_invoice_document WHERE receipt_id = ?1",
                params![receipt_id.to_string()],
                |row| {
                    Ok(InvoiceDocument {
                        filename: row.get(0)?,
                        content_type: row.get(1)?,
                        bytes: row.get(2)?,
                    })
                },
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => EdgeError::NotFound(format!(
                    "no invoice page on file for delivery {receipt_id}"
                )),
                other => db(other),
            })
    }

    /// The print queue: jobs given to this DC and not yet confirmed.
    fn open_tagging_jobs_impl(&self) -> Result<Vec<TaggingWorkJob>, EdgeError> {
        let connection = self.lock()?;
        let mut jobs_statement = connection
            .prepare(
                "SELECT job_id, article_code, article_name, image_url, total_quantity, issued_at
                 FROM tagging_job WHERE status = 'OPEN' ORDER BY issued_at",
            )
            .map_err(db)?;
        let jobs: Vec<(String, String, String, Option<String>, i64, String)> = jobs_statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })
            .map_err(db)?
            .collect::<Result<_, _>>()
            .map_err(db)?;

        let mut out = Vec::with_capacity(jobs.len());
        for (job_id, article_code, article_name, image_url, total_quantity, issued_at) in jobs {
            let mut line_statement = connection
                .prepare(
                    "SELECT sku_code, colour_label, size_label, quantity, qr_payload,
                            barcode_payload
                     FROM tagging_job_line WHERE job_id = ?1 ORDER BY sku_code",
                )
                .map_err(db)?;
            let rows: Vec<(String, String, String, i64, String, String)> = line_statement
                .query_map(params![job_id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })
                .map_err(db)?
                .collect::<Result<_, _>>()
                .map_err(db)?;

            let mut lines = Vec::with_capacity(rows.len());
            for (sku_code, colour_label, size_label, quantity, qr_payload, barcode_payload) in rows
            {
                let mut epc_statement = connection
                    .prepare(
                        "SELECT epc FROM tagging_job_epc
                         WHERE job_id = ?1 AND sku_code = ?2 ORDER BY epc",
                    )
                    .map_err(db)?;
                let epcs: Vec<String> = epc_statement
                    .query_map(params![job_id, sku_code], |row| row.get(0))
                    .map_err(db)?
                    .collect::<Result<_, _>>()
                    .map_err(db)?;
                lines.push(TaggingWorkLine {
                    sku_code,
                    colour_label,
                    size_label,
                    quantity,
                    qr_payload,
                    barcode_payload,
                    epcs,
                });
            }
            out.push(TaggingWorkJob {
                job_id: Uuid::parse_str(&job_id)
                    .map_err(|error| EdgeError::Persistence(format!("stored job id: {error}")))?,
                article_code,
                article_name,
                image_url,
                total_quantity,
                issued_at,
                lines,
            });
        }
        Ok(out)
    }

    /// The tags are on the goods.
    ///
    /// One confirmation for the whole job, given by the person who attached
    /// them. There is no second pair of eyes here and no batch scan — the two-
    /// person control in this system guards the moment goods first become
    /// stock, which already happened at verification. Nothing is created here;
    /// the same units gain the ability to be told apart.
    fn confirm_tagging_impl(
        &self,
        request: TaggingConfirmRequest,
    ) -> Result<TaggingConfirmResult, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden("tagging happens at a DC".into()));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "TAGGING_CONFIRM",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        let (session_id, status): (String, String) = tx
            .query_row(
                "SELECT session_id, status FROM tagging_job WHERE job_id = ?1",
                params![request.job_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db)?
            .ok_or_else(|| EdgeError::NotFound(format!("no tagging job {}", request.job_id)))?;
        if status != "OPEN" {
            return Err(EdgeError::Conflict(format!(
                "tagging job {} was already confirmed",
                request.job_id
            )));
        }

        let mut line_statement = tx
            .prepare(
                "SELECT sku_code, quantity, base_price_minor, subject_id
                 FROM tagging_job_line WHERE job_id = ?1 ORDER BY sku_code",
            )
            .map_err(db)?;
        let lines: Vec<(String, i64, i64, Option<String>)> = line_statement
            .query_map(params![request.job_id.to_string()], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(db)?
            .collect::<Result<_, _>>()
            .map_err(db)?;
        drop(line_statement);
        if lines.is_empty() {
            return Err(EdgeError::Conflict(format!(
                "tagging job {} has no lines",
                request.job_id
            )));
        }

        let occurred_at = Utc::now();
        let created_at = time_text(occurred_at);
        let mut movement_lines = Vec::new();
        let mut completed_lines = Vec::new();
        let mut tagged_units = 0i64;

        for (sku_code, quantity, base_price_minor, subject_id) in &lines {
            let subject_id = subject_id.as_deref().ok_or_else(|| {
                EdgeError::Persistence(format!("tagging line {sku_code} has no goods behind it"))
            })?;
            let subject_uuid = Uuid::parse_str(subject_id)
                .map_err(|error| EdgeError::Persistence(format!("stored subject id: {error}")))?;

            // The labels for this line, exactly as the centre minted them.
            let mut epc_statement = tx
                .prepare(
                    "SELECT epc FROM tagging_job_epc
                     WHERE job_id = ?1 AND sku_code = ?2 ORDER BY epc",
                )
                .map_err(db)?;
            let epcs: Vec<String> = epc_statement
                .query_map(params![request.job_id.to_string(), sku_code], |row| {
                    row.get(0)
                })
                .map_err(db)?
                .collect::<Result<_, _>>()
                .map_err(db)?;
            drop(epc_statement);
            if epcs.len() as i64 != *quantity {
                return Err(EdgeError::Persistence(format!(
                    "line {sku_code} needs {quantity} labels but holds {}",
                    epcs.len()
                )));
            }

            // The whole quantity leaves as one anonymous lot...
            movement_lines.push(MovementLine {
                subject_id: SubjectId(subject_uuid),
                quantity: *quantity,
                from: Place::Operational {
                    pool: OperationalPool::DcPendingUntagged {
                        dc_id: self.node.site_id.clone(),
                    },
                    state: InventoryState::Normal,
                },
                to: Place::System {
                    place: SystemPlace::Identification,
                },
            });

            // ...and comes back as that many things that can be told apart.
            for epc in &epcs {
                let unit_subject = Uuid::new_v4();
                tx.execute(
                    "INSERT INTO inventory_subject
                         (id, subject_type, article_code, epc, sku_code, quantity,
                          unit_price_minor, created_at)
                     SELECT ?1, 'UNIT', article_code, ?2, ?3, 1, ?4, ?5
                     FROM inventory_subject WHERE id = ?6",
                    params![
                        unit_subject.to_string(),
                        epc,
                        sku_code,
                        base_price_minor,
                        created_at,
                        subject_id
                    ],
                )
                .map_err(db)?;
                tx.execute(
                    "UPDATE tagging_job_epc SET subject_id = ?2 WHERE epc = ?1",
                    params![epc, unit_subject.to_string()],
                )
                .map_err(db)?;
                movement_lines.push(MovementLine {
                    subject_id: SubjectId(unit_subject),
                    quantity: 1,
                    from: Place::System {
                        place: SystemPlace::Identification,
                    },
                    to: Place::Operational {
                        pool: OperationalPool::DcWarehouse {
                            dc_id: self.node.site_id.clone(),
                        },
                        state: InventoryState::Normal,
                    },
                });
            }

            tagged_units += quantity;
            completed_lines.push(serde_json::json!({
                "sku_code": sku_code,
                "quantity": quantity,
            }));
        }

        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: movement_lines,
            cause: MovementCause::Tagging,
            reference_type: Some("TAGGING_JOB".into()),
            reference_id: Some(request.job_id.to_string()),
            reason: format!("Tagging selesai oleh {}", request.actor_id),
            actor_id: request.actor_id.clone(),
            occurred_at,
        };
        let movement = self.append_command(&tx, &request.idempotency_key, &command)?;

        tx.execute(
            "UPDATE tagging_job
             SET status='TAGGED', confirmed_by=?2, confirmed_at=?3, movement_group_id=?4
             WHERE job_id=?1",
            params![
                request.job_id.to_string(),
                request.actor_id,
                created_at,
                movement.movement_group_id.to_string()
            ],
        )
        .map_err(db)?;

        // The centre hears that the job is done. It does not hear the EPCs:
        // those are already travelling on the movement above, and asking for
        // them twice would create a second version of the truth.
        crate::edge::sync::enqueue_fact(
            &tx,
            request.job_id,
            crate::cloud::domain::FACT_TAGGING_COMPLETED,
            &serde_json::json!({
                "job_id": request.job_id,
                "session_id": Uuid::parse_str(&session_id).map_err(|error| {
                    EdgeError::Persistence(format!("stored session id: {error}"))
                })?,
                "movement_group_id": movement.movement_group_id,
                "confirmed_by": request.actor_id,
                "confirmed_at": occurred_at,
                "lines": completed_lines,
            }),
        )
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;

        let result = TaggingConfirmResult {
            job_id: request.job_id,
            movement_group_id: movement.movement_group_id,
            tagged_units,
            confirmed_by: request.actor_id.clone(),
            confirmed_at: occurred_at,
        };
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "TAGGING_CONFIRM",
            &request_json,
            &result,
        )?;
        tx.commit().map_err(db)?;
        Ok(result)
    }

    fn verify_purchase_impl(
        &self,
        request: PurchaseVerifyRequest,
    ) -> Result<PurchaseVerifyResult, EdgeError> {
        if self.node.role != EdgeRole::Dc {
            return Err(EdgeError::Forbidden(
                "supplier deliveries are verified at a DC".into(),
            ));
        }
        if request.decision == PurchaseVerifyDecision::Recount
            && request
                .note
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
        {
            return Err(EdgeError::Validation(
                "a recount request must say what to look at again".into(),
            ));
        }
        Self::validate_command_identity(&request.idempotency_key, &request.verifier_actor_id)?;
        let request_json = Self::encode_idempotent_request(&request)?;
        let mut connection = self.lock()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        if let Some(response) = Self::load_idempotent(
            &tx,
            &request.idempotency_key,
            "PURCHASE_VERIFY",
            &request_json,
        )? {
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        let (po_line_id, counted_by, counted_quantity, status, article_code): (
            String,
            String,
            i64,
            String,
            String,
        ) = tx
            .query_row(
                "SELECT c.po_line_id, c.counted_by, c.counted_quantity, c.status, l.article_code
                 FROM receiving_count c
                 JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
                 WHERE c.count_id = ?1",
                params![request.count_id.to_string()],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(db)?
            .ok_or_else(|| EdgeError::NotFound(format!("no count {}", request.count_id)))?;
        if status != "AWAITING_VERIFICATION" {
            return Err(EdgeError::Conflict(format!(
                "count {} was already {}",
                request.count_id,
                status.to_lowercase().replace('_', " ")
            )));
        }
        if self.segregation.requires_two_people()
            && counted_by.trim() == request.verifier_actor_id.trim()
        {
            return Err(EdgeError::Forbidden(format!(
                "{counted_by} counted this delivery and cannot also approve it; verification needs a second person"
            )));
        }
        let po_line_id = Uuid::parse_str(&po_line_id)
            .map_err(|error| EdgeError::Persistence(format!("stored line id: {error}")))?;
        let decided_at = Utc::now();

        if request.decision == PurchaseVerifyDecision::Recount {
            tx.execute(
                "UPDATE receiving_count
                 SET status='RECOUNT_REQUESTED', verified_by=?2, verified_at=?3, verifier_note=?4
                 WHERE count_id=?1",
                params![
                    request.count_id.to_string(),
                    request.verifier_actor_id,
                    time_text(decided_at),
                    request.note
                ],
            )
            .map_err(db)?;
            let response = PurchaseVerifyResult {
                count_id: request.count_id,
                po_line_id,
                decision: PurchaseVerifyDecision::Recount,
                counted_by,
                verified_by: request.verifier_actor_id.clone(),
                accepted_quantity: None,
                movement_group_id: None,
                price_amendment_request_id: None,
                decided_at,
            };
            Self::save_idempotent(
                &tx,
                &request.idempotency_key,
                "PURCHASE_VERIFY",
                &request_json,
                &response,
            )?;
            tx.commit().map_err(db)?;
            return Ok(response);
        }

        // Accepted. The goods come into existence as a quantity of an article
        // — the only thing anyone yet knows about them.
        let subject_id = SubjectId::new();
        tx.execute(
            "INSERT INTO inventory_subject
                 (id, subject_type, article_code, epc, sku_code, quantity,
                  unit_price_minor, created_at)
             VALUES (?1, 'QUANTITY', ?2, NULL, NULL, ?3, 0, ?4)",
            params![
                subject_id.to_string(),
                article_code,
                counted_quantity,
                time_text(decided_at)
            ],
        )
        .map_err(db)?;
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: vec![MovementLine {
                subject_id,
                quantity: counted_quantity,
                from: Place::System {
                    place: SystemPlace::Opening,
                },
                to: Place::Operational {
                    pool: OperationalPool::DcPendingUnidentified {
                        dc_id: self.node.site_id.clone(),
                    },
                    state: InventoryState::Normal,
                },
            }],
            cause: MovementCause::Opening,
            reference_type: Some("PURCHASE_ORDER_LINE".into()),
            reference_id: Some(po_line_id.to_string()),
            reason: format!(
                "Penerimaan {article_code} disetujui {}",
                request.verifier_actor_id
            ),
            actor_id: request.verifier_actor_id.clone(),
            occurred_at: decided_at,
        };
        let movement = self.append_command(&tx, &request.idempotency_key, &command)?;
        // Accepting is what turns a count into a line of the delivery
        // document, and it is what head office will later open a setup
        // session against. Both happen in one statement because the CHECK
        // ties them together: a count is accepted exactly when it has a line.
        let receipt_line_id = Uuid::new_v4();
        tx.execute(
            "UPDATE receiving_count
             SET status='ACCEPTED', verified_by=?2, verified_at=?3, movement_group_id=?4,
                 receipt_line_id=?5
             WHERE count_id=?1",
            params![
                request.count_id.to_string(),
                request.verifier_actor_id,
                time_text(decided_at),
                movement.movement_group_id.to_string(),
                receipt_line_id.to_string()
            ],
        )
        .map_err(db)?;
        // A price that disagrees with the invoice is reported, not obeyed and
        // not waited on. The goods are already going in above; this only asks
        // the buyer to settle what the company will pay. Quantity and price
        // are different questions, and a correct delivery should not sit on
        // the loading bay while a billing dispute is argued.
        let mut price_amendment_request_id = None;
        if let Some(invoiced) = request.invoiced_price_minor {
            if invoiced < 0 {
                return Err(EdgeError::Validation(
                    "an invoiced price cannot be negative".into(),
                ));
            }
            let agreed: Option<i64> = tx
                .query_row(
                    "SELECT unit_price_minor FROM purchase_order_line WHERE po_line_id = ?1",
                    params![po_line_id.to_string()],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db)?
                .flatten();
            // Only a genuine disagreement is worth a query. An invoice that
            // matches is the ordinary case and needs nobody's attention.
            if agreed.is_some_and(|agreed| agreed != invoiced) {
                let query_id = Uuid::new_v4();
                let note = request
                    .note
                    .as_deref()
                    .map(str::trim)
                    .filter(|note| !note.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        format!(
                            "Invoice supplier {invoiced} per {}, PO {}",
                            "unit",
                            agreed.unwrap_or_default()
                        )
                    });
                tx.execute(
                    "INSERT INTO purchase_price_amendment
                         (request_id, po_line_id, count_id, invoiced_price_minor, note,
                          requested_by, requested_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        query_id.to_string(),
                        po_line_id.to_string(),
                        request.count_id.to_string(),
                        invoiced,
                        note,
                        request.verifier_actor_id,
                        time_text(decided_at)
                    ],
                )
                .map_err(db)?;
                crate::edge::sync::enqueue_fact(
                    &tx,
                    query_id,
                    crate::cloud::domain::FACT_PRICE_AMENDMENT_REQUESTED,
                    &serde_json::json!({
                        "request_id": query_id,
                        "po_line_id": po_line_id,
                        "count_id": request.count_id,
                        "invoiced_price_minor": invoiced,
                        "note": note,
                        "requested_by": request.verifier_actor_id,
                        "requested_at": decided_at,
                    }),
                )
                .map_err(db)?;
                price_amendment_request_id = Some(query_id);
            }
        }
        crate::edge::sync::record_accepted_receipt_line(
            &tx,
            receipt_line_id,
            request.count_id,
            po_line_id,
            movement.movement_group_id,
            counted_quantity,
            &counted_by,
            &request.verifier_actor_id,
            decided_at,
        )
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;

        let response = PurchaseVerifyResult {
            count_id: request.count_id,
            po_line_id,
            decision: PurchaseVerifyDecision::Accept,
            counted_by,
            verified_by: request.verifier_actor_id.clone(),
            accepted_quantity: Some(counted_quantity),
            movement_group_id: Some(movement.movement_group_id),
            price_amendment_request_id,
            decided_at,
        };
        Self::save_idempotent(
            &tx,
            &request.idempotency_key,
            "PURCHASE_VERIFY",
            &request_json,
            &response,
        )?;
        tx.commit().map_err(db)?;
        Ok(response)
    }
}
