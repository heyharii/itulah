import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { Filter } from "@/lib/filters"
import type {
  AllotmentCloseShortRequest,
  ArticleHistory,
  MovementCause,
  UnfilledLine,
  UnfilledList,
} from "@itulah/contract"

/// Inventory reads and writes, and the keys they are held under.
///
/// **Every route under `/api/v1/inventory` answers with a `json!()` literal**
/// built in `backend/src/cloud/postgres/{queries,allotments,counts,
/// observations,movements,control,time_machine}.rs` rather than serialised
/// from a struct, so ts-rs generates nothing for them and `@itulah/contract`
/// cannot check these shapes at build time. Every interface below is
/// transcribed from those literals — if a field moves, this file is where it
/// goes stale, and it is the first place to look when a column reads
/// `undefined`. `MovementCause` is the one exception: the mover's cause enum
/// *is* generated, so it is imported rather than retyped.
///
/// Two conventions the cloud's inventory routes hold to and the purchasing
/// routes do not:
///
///  1. **The idempotency key travels in the body**, not the `Idempotency-Key`
///     header. The server stores the key beside a digest of the request and
///     replays its first answer, so a double-clicked Create allots the same
///     goods once and hands back the same receipt twice.
///  2. **Every write names its actor.** `actor_id` is the signed-in username;
///     the ledger records who moved the stock, and there is no default.

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/// One operational pool, with its balances.
///
/// This is the row `GET /inventory/pools`, `/fleet-pools` and `/as-of` all
/// share; the fleet read decorates it with the ownership fields below.
export interface Pool {
  /// The canonical pool id — `dc.warehouse`, `dc.reject.store-01`,
  /// `store-01.floor`. The server parses this string back into a place, so it
  /// is an identifier and never a label.
  readonly id: string
  readonly site_id: string
  readonly site_name: string | null
  /// `DC` · `STORE`.
  readonly site_kind: string
  /// PENDING · WAREHOUSE · OUTBOUND · REJECT · STORE_INVENTORY
  readonly group: string
  /// UNIDENTIFIED · UNTAGGED · WAREHOUSE · PICKING · PICKED · PACKED ·
  /// SHIPMENT · LOADED · IN_TRANSIT · DC_REJECT · STORE_REJECT · FLOOR ·
  /// REJECT
  readonly pool_code: string
  readonly label: string
  readonly store_origin_site_id: string | null
  readonly display_order: number
  /// A rollup is a sum of other pools, not a place goods can sit in. Nothing
  /// can be allotted out of one, and the fleet total excludes them so the
  /// same piece is not counted twice.
  readonly is_rollup: boolean
  readonly is_outbound_leaf: boolean
  readonly outbound_stage: string | null
  readonly destination_store_id: string | null
  /// Stock = On Hand + Allotted + Missing, as the server states in the same
  /// response. `allotted` is null on the pools the equation does not apply to.
  readonly stock: number
  readonly allotted: number | null
  readonly on_hand: number
  readonly missing: number
  /// Distinct tags seen in the observation window. Null on Edge-derived rows:
  /// Cloud holds the fact positions but not the sightings behind them.
  readonly observed: number | null
  /// Confirmed lost during the window over (opening balance + inbound). The
  /// server states the formula in the same response.
  readonly lost_rate: number | null
  readonly lost_quantity: number | null
  readonly exposure: number | null
  /// When this pool was last counted, and **null when it never has been.**
  ///
  /// Three of the fleet's hundred and twelve pools have ever been counted. A
  /// zero or an epoch here would put a number on that absence and read as
  /// "counted, and found nothing", which is the one thing it does not mean.
  ///
  /// Optional rather than always present: `/inventory/pools` and `/as-of`
  /// carry it, the fleet read's Edge-derived rows have no count history to
  /// carry.
  readonly last_counted_at?: string | null
}

/// Who owns a pool's number, and whether Cloud may write to it.
///
/// The distinction the fleet read exists to make: an exact-site Edge fact
/// position *shadows* the Cloud row for the same site, so the Cloud row is
/// still shown but is excluded from the total. Reading the two together
/// without this is how a fleet double-counts a store.
export interface PoolAuthority {
  readonly owner_site_id: string
  readonly owner_origin_id: string
  readonly owner_role: string
  readonly source: string
  /// CLOUD_WRITABLE · SHADOWED_READ_ONLY · OWNER_NODE_ONLY ·
  /// DERIVED_READ_ONLY
  readonly write_policy: string
  readonly cloud_writable: boolean
  readonly included_in_fleet_total: boolean
  readonly shadowed_by_origin_id: string | null
  readonly derived: boolean
}

export interface FleetPool extends Pool {
  readonly origin_id: string
  readonly origin_role: string
  readonly owner_label: string | null
  /// `CLOUD_LEDGER` or `EDGE_FACT_POSITION`.
  readonly source_type: string
  readonly fact_generation: number | null
  readonly fact_applied_seq: number | null
  readonly checkpoint_age_seconds: number | null
  /// MISSING · STALE · CURRENT — null on a Cloud-native row, which has no
  /// checkpoint to be stale.
  readonly checkpoint_status: string | null
  readonly sync_applied_at: string | null
  readonly sync_age_seconds: number | null
  /// LOCAL · WAITING · STALE · CURRENT
  readonly sync_status: string
  readonly authority: PoolAuthority
}

export interface PoolList {
  readonly as_of: string
  /// True when the answer is a historical read and must not be acted on.
  readonly read_only: boolean
  readonly observed_window_hours: number
  readonly lost_risk_window_days: number
  readonly inventory_equation: string
  readonly items: readonly Pool[]
}

/// One value a filter can take, and how many rows carry it.
///
/// Counted over what the SEARCH leaves and deliberately not over the filters
/// already applied, so the number reads "how many of these there are" rather
/// than "how many survive what you already ticked". Every inventory list
/// answers with these; the generated `InventoryFacet` in `@itulah/contract` is
/// the authority.
export interface InventoryFacet {
  readonly value: string
  /// What to draw when it differs from the value — a site's name against its
  /// id. Null when the value is already the label.
  readonly label: string | null
  readonly count: number
}

/// The envelope `GET /inventory/pools` and `GET /inventory/as-of` answer with.
///
/// `PoolList` above is the same answer with `rows` renamed to `items`, which
/// is what `inventoryAsOf` hands the screens that already read a list. Anything
/// that wants the total, the facets or a page reads this.
export interface PoolPage {
  readonly as_of: string
  readonly read_only: boolean
  readonly observed_window_hours: number
  readonly lost_risk_window_days: number
  readonly inventory_equation: string
  readonly outbound_rollup_equation: string
  readonly lost_risk_formula: string
  readonly rows: readonly Pool[]
  /// Opaque. Pass it back as `cursor`; null means this was the last page.
  readonly next_cursor: string | null
  /// Every pool the search and the filters match, not just this page.
  ///
  /// **Null means NOT COUNTED, never none.** The route takes `?count=0` and
  /// answers without this and without the facets; a screen reading it has to
  /// draw the absence as an absence — an em dash — rather than as a zero.
  readonly total: number | null
  readonly facets: {
    readonly sites: readonly InventoryFacet[]
    readonly groups: readonly InventoryFacet[]
    /// COUNTED and NEVER. Three of the fleet's hundred and twelve pools have
    /// ever been counted, and NEVER is not a zero — see `Pool.last_counted_at`.
    readonly counted: readonly InventoryFacet[]
  } | null
}

export interface FleetTotalDiagnostics {
  readonly base_stock_before_overlap: number
  /// DC In Transit already signed for by a store, deducted once so a piece in
  /// two places at once is counted in neither twice.
  readonly overlap_deduction: number
  readonly calculated_total: number
  readonly included_row_count: number
  readonly excluded_rollup_count: number
  readonly shadowed_cloud_site_ids: readonly string[]
  readonly stale_edge_origins: readonly string[]
  readonly missing_edge_origins: readonly string[]
  /// STALE_EDGE_CHECKPOINT · MISSING_EDGE_CHECKPOINT ·
  /// UNRESOLVED_STORE_RECEIPT_EVIDENCE. Empty means certified.
  readonly certification_reasons: readonly string[]
}

export interface ReconciliationSummary {
  readonly matched: number
  readonly matched_attributed: number
  readonly matched_unattributed: number
  readonly dc_only: number
  readonly store_only: number
  readonly unresolved: number
  readonly conflicts: number
}

export interface FleetPoolList {
  readonly as_of: string
  readonly read_only: boolean
  readonly observed_window_hours: number
  readonly lost_risk_window_days: number
  readonly inventory_equation: string
  readonly aggregation_policy: string
  /// **Null when the fleet is uncertified.** The server refuses to publish a
  /// number it cannot stand behind rather than publishing a wrong one, so a
  /// screen must render the absence and the reasons, never a zero.
  readonly fleet_total: number | null
  /// CERTIFIED · UNCERTIFIED
  readonly fleet_total_status: string
  readonly reconciliation_summary: ReconciliationSummary
  readonly fleet_total_diagnostics: FleetTotalDiagnostics
  readonly items: readonly FleetPool[]
}

/// One tagged or bulk subject sitting in a pool.
export interface PoolItem {
  readonly subject_id: string
  readonly subject_type: string
  readonly epc: string | null
  readonly barcode: string | null
  readonly quantity: number
  readonly sku_code: string | null
  readonly article_code: string | null
  readonly article_name: string | null
}

export interface PoolCount {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly reason: string
  readonly created_at: string
  readonly activated_at: string | null
  readonly submitted_at: string | null
  readonly closed_at: string | null
}

export interface PoolDetail {
  /// The same row the list carries, re-derived rather than passed in.
  readonly summary: Pool
  /// Capped at 200 by the server — the tail is not a page, it is absent.
  readonly items: readonly PoolItem[]
  readonly missing: readonly MissingItem[]
  readonly observations: readonly Observation[]
  readonly movements: readonly Movement[]
  readonly counts: readonly PoolCount[]
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

/// One posted ledger movement. Double-entry: `from` and `to` are place ids
/// (`<pool>:on_hand`, `<pool>:missing`, `system/lost`, `external/disposal`).
export interface Movement {
  readonly movement_id: string
  readonly movement_group_id: string
  readonly subject_id: string
  readonly epc: string | null
  readonly sku_code: string | null
  readonly article_name: string | null
  readonly quantity: number
  readonly from: string
  readonly to: string
  readonly cause: MovementCause
  readonly reference_type: string | null
  readonly reference_id: string | null
  readonly allotment_line_id: string | null
  readonly allotment_id: string | null
  readonly destination_type: string | null
  readonly destination_id: string | null
  readonly actor_id: string
  readonly occurred_at: string
  readonly recorded_at: string
}

/// What every movement write answers with. `idempotent_replay` is the server
/// saying "you already sent this" — the same receipt, and no second movement.
export interface MovementReceipt {
  readonly movement_group_id: string
  readonly movement_ids: readonly string[]
  readonly line_count: number
  readonly cause: MovementCause
  readonly occurred_at: string
  readonly idempotent_replay: boolean
}

/// One side of a correction. `subject_id` or `epc` — one of the two, and the
/// server refuses a line carrying neither. Both keys are written out as `null`
/// rather than omitted, here and in every request below: the server's structs
/// name them, and an explicit null is the shape they were written for.
export interface MovementLineRequest {
  readonly subject_id: string | null
  readonly epc: string | null
  readonly quantity: number
  readonly from: string
  readonly to: string
}

/// Move stock that was never where the ledger says it was.
///
/// Not a general movement: the server forces `cause = PLACEMENT_CORRECTION`
/// and refuses an empty `evidence_reference`, because a correction with no
/// evidence behind it is indistinguishable from an adjustment somebody made
/// up. One line only.
export interface CorrectPlacementRequest {
  readonly idempotency_key: string
  readonly actor_id: string
  readonly occurred_at: string | null
  readonly reason: string
  readonly evidence_reference: string
  readonly notes: string | null
  readonly line: MovementLineRequest
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/// What one pool can still promise, per SKU.
///
/// `on_hand_qty` is Stock minus Allotted — the goods nobody has spoken for. It
/// is the number a new allotment eats into, and it can go negative, which is
/// the pool having promised more than it holds.
export interface AvailabilityItem {
  readonly sku_id: string
  readonly sku_code: string
  readonly article_id: string
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string | null
  readonly image_url: string | null
  readonly tags: readonly string[]
  /// Every order this article has arrived on — several, not one: an article
  /// ordered again is the same article, and the second order brought in stock
  /// too.
  readonly purchase_order_ids: readonly string[]
  readonly colour: string | null
  readonly size: string | null
  readonly stock_qty: number
  readonly allotted_qty: number
  readonly on_hand_qty: number
  readonly missing_qty: number
}

export interface Availability {
  readonly source_site_id: string
  readonly source_pool_id: string
  readonly source_pool_label: string
  readonly source_place_id: string
  readonly as_of: string
  /// Over the whole matching set, not the page — so it answers "how much is in
  /// this pool", not "how much is on screen".
  readonly total_items: number
  readonly stock_qty: number
  readonly allotted_qty: number
  readonly on_hand_qty: number
  readonly missing_qty: number
  readonly inventory_equation: string
  readonly limit: number
  /// A SKU-code cursor, stable across inserts. Null on the last page.
  readonly next_cursor: string | null
  readonly items: readonly AvailabilityItem[]
}

// ---------------------------------------------------------------------------
// Missing
// ---------------------------------------------------------------------------

/// One subject the ledger has moved into a pool's `:missing` state.
///
/// The id is `subject_uuid@pool_id` — a composite, because "missing" is a
/// position rather than a record, and the same subject can be missing from
/// two pools.
export interface MissingItem {
  readonly id: string
  readonly subject_id: string
  readonly subject_type: string
  readonly epc: string | null
  readonly barcode: string | null
  readonly sku_code: string | null
  readonly article_name: string | null
  readonly quantity: number
  readonly site_id: string
  readonly origin_pool: string
  readonly pool_label: string
  /// The cause and document of the movement that first carried it into
  /// Missing — where it went missing.
  readonly missing_cause: string | null
  readonly missing_reference_type: string | null
  readonly missing_reference_id: string | null
  readonly missing_since: string | null
  /// Hours since it went missing. The decision metric: an hour is a mislaid
  /// box, a fortnight is a write-off nobody has taken.
  readonly age_hours: number | null
  readonly last_observation: string | null
  readonly latest_count_id: string | null
  readonly latest_count_status: CountStatus | null
  /// Always the literal `MISSING`. There is no missing-status enum: the list
  /// *is* the set of positive balances in `:missing` places, and resolving one
  /// removes the row rather than restatusing it.
  readonly status: "MISSING"
}

/// Found, lost or disposed. All three post a movement out of `:missing`, so
/// all three answer with a `MovementReceipt`.
///
/// `quantity: null` means the whole missing balance — the server replays the
/// movements in and out of `{pool}:missing` to find it, and 404s if that
/// balance is not positive. `destination_pool_id` is read by Found only, and
/// is how a jumper found on the shop floor goes back to the floor rather than
/// to the stockroom it was lost from.
export interface MissingResolutionRequest {
  readonly actor_id: string
  readonly idempotency_key: string
  readonly quantity: number | null
  readonly destination_pool_id: string | null
  readonly reason: string
  /// Becomes `reference_id` on the movement, and forces
  /// `reference_type = MISSING_RESOLUTION`.
  readonly reference: string | null
}

// ---------------------------------------------------------------------------
// Transfer reconciliation
// ---------------------------------------------------------------------------

export interface TransferEvidence {
  readonly event_id: string
  readonly origin_id: string
  readonly generation: number
  readonly seq: number
  readonly sku_code: string
  readonly quantity: number
  readonly movement_group_id: string
  readonly receipt_id: string | null
  readonly occurred_at: string
}

export interface TransferAttribution {
  readonly in_transit_event_id: string
  readonly koli_id: string
  readonly allotment_id: string
  readonly allotment_line_id: string
  readonly matched_at: string
}

/// One EPC claimed by a DC despatch, a store receipt, or both.
///
/// `MATCHED` is the healthy case. `DC_ONLY` is still in the air. **`STORE_ONLY`
/// is the one that matters**: a store signed for a tag no DC says it sent, and
/// with `UNRESOLVED` and `CONFLICT` it is what stops the fleet total being
/// certified.
export interface Reconciliation {
  readonly status:
    "MATCHED" | "DC_ONLY" | "STORE_ONLY" | "UNRESOLVED" | "CONFLICT"
  readonly source_dc_id: string | null
  readonly destination_store_id: string
  readonly shipment_reference: string | null
  readonly epc: string
  readonly sku_code: string | null
  readonly sku_codes: readonly string[]
  readonly in_transit_claim_count: number
  readonly received_claim_count: number
  /// A matched receipt still has to be tied back to the allotment line that
  /// promised it. Unattributed means the goods arrived but nothing knows what
  /// they were sent against.
  readonly attributed: boolean
  readonly attribution: TransferAttribution | null
  readonly in_transit: TransferEvidence | null
  readonly received: TransferEvidence | null
}

/// What the reconciliation report can be asked for — every parameter
/// `GET /api/v1/inventory/reconciliations` answers.
export interface ReconciliationScope {
  /// Free text over the tag, the SKU, the shipment and both ends of the route.
  readonly q?: string
  /// One status, or `ATTENTION` for the three that block certification.
  readonly status?: string
  readonly destination_store_id?: string
  /// The sending node's OWN site id — `dc-01`, not the centre's `dc`.
  readonly source_dc_id?: string
  /// `status` (the house order: attention first), `destination`, `epc` or
  /// `occurred_at`.
  readonly sort?: string
  readonly desc?: boolean
  /// From a previous page's `next_cursor`.
  readonly cursor?: string
}

/// A page of the report. `summary` is the whole fleet's, unaffected by the
/// filters; `total` and `facets` are over what the search matches.
export interface ReconciliationPage {
  readonly as_of: string
  readonly summary: ReconciliationSummary
  readonly rows: readonly Reconciliation[]
  readonly next_cursor: string | null
  readonly total: number
  readonly facets: {
    readonly statuses: readonly InventoryFacet[]
    readonly destinations: readonly InventoryFacet[]
    readonly sources: readonly InventoryFacet[]
  }
}

// ---------------------------------------------------------------------------
// Ledger control
// ---------------------------------------------------------------------------

/// One (subject, place) row where the movement ledger and the projection it
/// is supposed to have produced disagree. `difference` is ledger minus
/// projection, so a positive number is stock the projection has lost.
export interface ProjectionDifference {
  readonly subject_id: string
  readonly place_id: string
  readonly ledger_quantity: number
  readonly projection_quantity: number
  readonly difference: number
}

/// The same disagreement at the outbound stage rollup: a stage total that
/// does not equal the sum of its destination leaves.
export interface RollupDifference {
  readonly parent_pool_id: string
  readonly state: string
  readonly ledger_quantity: number
  readonly projection_quantity: number
  readonly difference: number
}

export interface ControlStatus {
  readonly ledger_fact_count: number
  /// **Null means NOT COUNTED** — the caller passed `?count=0` — and never
  /// none. `ledger_health` beside it is never null: whether the two agree at
  /// all is answered by whether the first page of differences is empty, which
  /// the server gets for nothing.
  readonly projection_difference_count: number | null
  readonly outbound_rollup_status: "MATCH" | "DIFFERENCE"
  readonly outbound_rollup_difference_count: number
  /// HEALTHY when both the row-level and the rollup comparisons match.
  readonly ledger_health: "HEALTHY" | "DIFFERENCE"
  readonly last_replay: {
    readonly id: string
    readonly status: string
    readonly difference_count: number
    readonly ran_at: string
  } | null
  readonly last_repost: {
    readonly id: string
    readonly projection_rows: number
    readonly ran_at: string
  } | null
  readonly differences: readonly ProjectionDifference[]
  readonly outbound_rollup_differences: readonly RollupDifference[]
}

/// What the route actually sends. The differences are an envelope — paged,
/// with their own total — and `controlStatus` unwraps them into the flat array
/// the screen reads. `projection_difference_count` beside it is the SAME
/// number as `differences.total`, and is the count rather than the page.
export interface ControlAnswer extends Omit<ControlStatus, "differences"> {
  readonly differences: {
    readonly rows: readonly ProjectionDifference[]
    readonly next_cursor: string | null
    readonly total: number | null
    readonly facets: {
      readonly pools: readonly InventoryFacet[]
      readonly sites: readonly InventoryFacet[]
    } | null
  }
}

/// Narrows what replay and repost look at. All three fields optional; absent
/// means the whole ledger.
export interface ReplayScope {
  readonly site_id?: string
  readonly pool_id?: string
  readonly subject_id?: string
}

/// Replay re-folds the ledger and compares. It writes nothing (`read_only`),
/// which is why it takes no idempotency key.
export interface ReplayResult {
  readonly run_id: string
  readonly status: "MATCH" | "DIFFERENCE"
  readonly scope: ReplayScope
  readonly ledger_fact_count: number
  readonly difference_count: number
  readonly differences: readonly ProjectionDifference[]
  readonly outbound_rollup_status: "MATCH" | "DIFFERENCE"
  readonly outbound_rollup_difference_count: number
  readonly outbound_rollup_differences: readonly RollupDifference[]
  readonly read_only: boolean
  readonly ran_at: string
}

/// Repost rebuilds the projection from the ledger inside one transaction, and
/// aborts if the ledger moved underneath it. It creates no ledger facts —
/// `ledger_facts_created` is always 0, which is the guarantee, not a stat.
export interface RepostResult {
  readonly run_id: string
  readonly status: "REPAIRED"
  readonly scope: ReplayScope
  readonly differences_before: number
  readonly differences_after: number
  readonly outbound_rollup_status: "MATCH"
  readonly outbound_rollup_differences_before: number
  readonly outbound_rollup_differences_after: number
  readonly projection_rows_rebuilt: number
  readonly ledger_fact_count_before: number
  readonly ledger_fact_count_after: number
  readonly ledger_facts_created: number
}

/// Deliberately break one projection row so the repair path can be watched
/// working. Refused with the server's own sentence unless the node was
/// started with `INVENTORY_ENABLE_TEST_CONTROLS=true`, which production is
/// not.
export interface CorruptProjectionRequest {
  readonly subject_id: string
  readonly place_id: string
  readonly delta: number
}

export interface CorruptProjectionResult {
  readonly warning: string
  readonly subject_id: string
  readonly place_id: string
  readonly new_projection_quantity: number
  readonly ledger_changed: boolean
}

// ---------------------------------------------------------------------------
// Time machine
// ---------------------------------------------------------------------------

/// The ledger folded up to a given `fact_sequence`. Sequence rather than a
/// clock, so a backdated `occurred_at` cannot change what "then" meant.
export interface TimeMachineState {
  readonly as_of_fact_sequence: number | null
  readonly events_applied: number
  readonly state_hash: string
  readonly items: readonly {
    readonly subject_id: string
    readonly place_id: string
    readonly quantity: number
    readonly last_fact_sequence: number
  }[]
  readonly violations: readonly TimeMachineViolation[]
  /// The timeline hit the server's 100 000-row cap. The state below it is
  /// still exact; what is above it is simply absent.
  readonly truncated: boolean
  readonly read_only: boolean
}

export interface TimeMachineViolation {
  readonly fact_sequence: number
  readonly subject_id: string
  readonly place_id: string
  readonly invariant: string
  readonly detail: string
}

export interface TimeMachineDelta {
  readonly subject_id: string
  readonly place_id: string
  readonly diffs: readonly {
    readonly field: string
    readonly ledger: unknown
    readonly projection: unknown
  }[]
  readonly ledger_history?: readonly {
    readonly fact_sequence: number
    readonly quantity_delta: number
    readonly occurred_at: string
    readonly origin: string
  }[]
}

export interface TimeMachineDivergence {
  readonly status: "MATCH" | "DIVERGENCE"
  readonly ledger_events: number
  readonly divergent_subjects: number
  /// The first 25, each with its full canonical history. Past that the count
  /// is the answer and the histories are not.
  readonly reported: readonly TimeMachineDelta[]
  readonly reported_truncated: boolean
  readonly ledger_violations: readonly TimeMachineViolation[]
  readonly ledger_truncated: boolean
  readonly read_only: boolean
}

/// The edge's own fact log against what Cloud ingested from it, event by
/// event. `EMPTY` means neither log holds this stream — usually a generation
/// typed one too high, not a fault.
export interface SyncDivergence {
  readonly status: "MATCH" | "DIVERGENCE" | "EMPTY"
  readonly origin_id: string
  readonly generation: number
  readonly detail?: string
  readonly edge_events?: number
  readonly cloud_events?: number
  readonly edge_last_fact_seq?: number
  readonly cloud_last_fact_seq?: number
  readonly rejected_tombstones?: readonly unknown[]
  readonly first_divergence_fact_seq?: number
  readonly subject_id?: string
  readonly place_id?: string
  readonly summary?: string
  readonly also_divergent?: readonly {
    readonly subject_id: string
    readonly place_id: string
  }[]
  readonly minimal_fixture?: {
    readonly faithful: boolean
    readonly total_events: number
  }
  readonly read_only?: boolean
}

export interface WhatIfLine {
  readonly subject_id: string
  readonly place_id: string
  readonly quantity_delta: number
}

export interface WhatIfRequest {
  readonly scope?: ReplayScope
  readonly hypothetical: readonly WhatIfLine[]
}

/// "Would this movement reconcile the two?" — evaluated on a cloned world.
/// Writes nothing, so it is safe to press repeatedly.
export interface WhatIfResult {
  readonly resolves_projection: boolean
  readonly remaining_divergences: readonly TimeMachineDelta[]
  readonly changed_subjects: readonly TimeMachineDelta[]
  readonly new_violations: readonly {
    readonly invariant: string
    readonly detail: string
  }[]
  readonly read_only: boolean
}

// ---------------------------------------------------------------------------
// Allotments
// ---------------------------------------------------------------------------

/// The three fulfillment statuses the UI contract may show (allotment V1 §8,
/// §12). Legacy storage (`IN_PROGRESS`, `DC_COMPLETED`, `CANCELLED`,
/// `REJECTED`) is mapped to one of these three when read, never written —
/// `AllotmentStatus` below stays the legacy wire shape for the screens that
/// have not moved onto this yet.
export type FulfillmentStatus = "ACTIVE" | "COMPLETED" | "CLOSED"

/// The commitment arithmetic's five travelling stages, plus the two totals
/// that close the invariant (allotment V1 §3, §12's "quantity pipeline, not a
/// stepper"). Read straight off the server's canonical view — never
/// recomputed here (ALT-INV-16): no screen may subtract `received` and
/// `cancelled` from `quantity` to guess `to_receive`.
///
/// `receiving_gap_qty` is the receiving difference (§3 ALT-INV-01) — not a
/// fulfillment stage, never a pipeline column (§14 #6). MD's own "Shipment"
/// figure is `at_shipment_qty + at_loaded_qty` (ALT-D06); `at_loaded_qty`
/// stays its own field here so a screen can do that merge rather than losing
/// it.
export interface FulfillmentStages {
  readonly to_pack_qty: number
  readonly at_packed_qty: number
  readonly at_shipment_qty: number
  readonly at_loaded_qty: number
  readonly at_in_transit_qty: number
  readonly received_qty: number
  readonly closed_short_qty: number
  readonly to_receive_qty: number
  readonly receiving_gap_qty: number
}

/// What the allotment is for. The three are not variations on a theme: each
/// has its own legal source pool and its own legal destination, checked by
/// `validate_create_line` on the server.
/// `TO_SITE` is what the cloud now writes for the first; it is the same thing.
export type AllotmentType =
  "TO_STORE" | "TO_SITE" | "RETURN_TO_DC" | "RETURN_TO_SUPPLIER"

export type DestinationType = "STORE" | "DC" | "SUPPLIER"

/// `ACTIVE` — allotted, nothing picked. `IN_PROGRESS` — something picked, and
/// the cloud-native flow never gets past it. `DC_COMPLETED` — the DC is done
/// but the store has not signed. `COMPLETED` — received. `CANCELLED` —
/// released with nothing ever picked. `REJECTED` — the DC refused activation.
export type AllotmentStatus =
  | "ACTIVE"
  | "IN_PROGRESS"
  | "DC_COMPLETED"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"

/// How the activation command sent to an edge node is getting on. `PENDING` is
/// the state in which an allotment exists here and nowhere else.
export type EdgeApplicationStatus = "PENDING" | "ACCEPTED" | "REJECTED"

/// What the DC did with a cancellation request. `PARTIALLY_APPLIED` is the
/// honest case worth showing: some of it was already picked and could not be
/// taken back.
export type EdgeCancellationStatus =
  "PENDING" | "APPLIED" | "PARTIALLY_APPLIED" | "REJECTED"

/// The stage counters, in the order goods actually travel. A database CHECK
/// enforces `received ≤ in_transit ≤ dispatched ≤ shipment ≤ packed ≤ picked`,
/// so the numbers only ever fall left to right — and where they fall is where
/// the goods currently are.
export interface AllotmentStages {
  readonly total_quantity: number
  /// The number everything else is measured against. An allotment a DC owns
  /// counts as nothing until that DC accepts it, so 300 ordered and 0 accepted
  /// is a real state, and 0 is what can be picked.
  readonly total_accepted_quantity: number
  readonly total_picked_quantity: number
  readonly total_packed_quantity: number
  readonly total_shipment_quantity: number
  readonly total_dispatched_quantity: number
  readonly total_in_transit_quantity: number
  readonly total_received_quantity: number
  readonly total_cancelled_quantity: number
  /// Accepted minus picked minus cancelled: what is still reserved and has not
  /// moved. This is the number holding stock out of everybody else's reach.
  readonly remaining_quantity: number
}

export interface AllotmentRow extends AllotmentStages, FulfillmentStages {
  readonly id: string
  readonly allotment_number: string
  /// The size of the thing, counted three ways, because "a hundred pieces" is
  /// a different delivery when it is one SKU to one shop and when it is forty
  /// SKUs to thirteen. Counted by the server over the allotment's own lines.
  readonly line_count: number
  readonly sku_count: number
  readonly destination_count: number
  /// How many distinct articles the allotment's lines name — the UI
  /// contract's own "Articles" column (§12), never `sku_count` (a colourway
  /// is not a garment).
  readonly article_count: number
  /// Who the goods came from, as words — several, comma-joined, when the
  /// articles came in from more than one. Null when none can be traced.
  /// Absent from a cloud older than this field.
  readonly supplier_names?: string | null
  /// The stores the lines go to, by name, in name order.
  readonly destination_names?: readonly string[]
  readonly type: AllotmentType
  readonly status: AllotmentStatus
  /// When MD cancelled it (10 Oct 2026); null for anything else.
  readonly cancelled_at?: string | null
  /// The V1 status (§8) — Active · Completed · Closed. The only status the
  /// UI contract may show (§8); `status` above is the legacy field.
  readonly fulfillment_status: FulfillmentStatus
  /// `to_pack_qty + at_packed_qty + at_shipment_qty + at_loaded_qty == 0` — a
  /// milestone, not a status (§8 "DC_FULFILLED is a milestone, not a status").
  readonly dc_fulfilled: boolean
  readonly edge_application_status: EdgeApplicationStatus | null
  /// Set when a DC owns this allotment — see `AllotmentDetail`'s own field of
  /// the same name.
  readonly activation_target_origin_id: string | null
  readonly edge_cancellation_status: EdgeCancellationStatus | null
  readonly created_by: string
  readonly notes: string | null
  readonly created_at: string
  readonly updated_at: string
}

/// Every destination, across every allotment — **not** only the ones on the
/// list. The server computes this over the whole table rather than over the
/// filtered rows, so it answers "what is owed to this store", not "what is on
/// screen". Worth knowing before reading it as a total of the table.
export interface DestinationRollup extends AllotmentStages {
  readonly destination_type: DestinationType
  readonly destination_id: string
  readonly destination_name: string | null
}

/// An SKU promised out of a pool that does not hold it.
///
/// On Hand is Stock minus Allotted, so a negative On Hand means the allotments
/// standing against this pool add up to more than the goods in it. The server
/// reports it rather than preventing it: allotting is a promise, and the
/// warehouse is allowed to find out it cannot keep one.
export interface AllotmentShortage extends AvailabilityItem {
  readonly shortage_qty: number
}

/// One article, summed across every allotment line that has ever named it.
///
/// The stage counters carry the same `total_*` names an allotment row does, so
/// one bar draws both: what is being measured — how far pieces have travelled
/// — is the same measurement whether the pieces are grouped by paperwork or by
/// garment.
export interface ArticleRollup extends AllotmentStages {
  readonly article_id: string
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string | null
  readonly image_url: string | null
  /// How many of the article's SKUs appear, and how many places it has been
  /// sent to — the two numbers that say whether a row is one size to one shop
  /// or a whole size run to the fleet.
  readonly sku_count: number
  readonly destination_count: number
  /// The UI contract's own "By article" figure (§12) — read off the
  /// canonical view, never derived from `total_quantity` (ALT-INV-16).
  readonly to_receive_qty: number
  readonly receiving_gap_qty: number
}

export interface ArticleAllotmentList {
  readonly items: readonly ArticleRollup[]
}

export interface AllotmentList {
  readonly items: readonly AllotmentRow[]
  readonly limit: number
  readonly by_destination: readonly DestinationRollup[]
  /// Computed against `dc.warehouse` unless the query named another source
  /// pool, and independently of the type/status filters.
  readonly shortages: readonly AllotmentShortage[]
}

export interface StoreSkuSummary {
  readonly sku_id: string
  readonly sku_code: string
  readonly quantity: number
  readonly accepted_quantity: number
  readonly picked_quantity: number
  readonly packed_quantity: number
  readonly shipment_quantity: number
  readonly dispatched_quantity: number
  readonly in_transit_quantity: number
  readonly received_quantity: number
  readonly cancelled_quantity: number
  readonly remaining_quantity: number
  /// The fulfillment-stage reading of the same lifetime pipeline (allotment
  /// V1 §3, §12's "By store" contract) — read off the canonical view, beside
  /// the legacy counters above rather than in place of them.
  readonly to_pack_qty: number
  readonly at_packed_qty: number
  readonly at_shipment_qty: number
  readonly at_loaded_qty: number
  readonly at_in_transit_qty: number
  readonly closed_short_qty: number
  readonly to_receive_qty: number
  readonly receiving_gap_qty: number
}

/// The same list scoped to one store, plus that store's **lifetime** per-SKU
/// pipeline — `sku_summary` spans every allotment ever addressed to it, not
/// the 500 rows in `items`.
export interface StoreAllotmentList extends AllotmentList {
  readonly destination_type: "STORE"
  readonly destination_id: string
  readonly destination_name: string
  readonly sku_summary: readonly StoreSkuSummary[]
}

/// One EPC that arrived at the store and was matched back to this line.
/// Individual tags rather than a count, because the count is a projection and
/// this is the evidence under it.
export interface ReceivedUnit {
  readonly epc: string
  readonly sku_code: string
  readonly koli_id: string
  readonly source_dc_id: string | null
  readonly destination_store_id: string
  readonly shipment_reference: string | null
  readonly receipt_id: string | null
  readonly received_at: string
  readonly matched_at: string
}

export interface AllotmentLine {
  readonly id: string
  readonly source_site_id: string
  readonly source_pool_id: string
  readonly destination_type: DestinationType
  readonly destination_id: string
  /// The destination's own name, for the sheet's line matrix — never the raw
  /// id (§14 #17).
  readonly destination_name: string | null
  readonly sku_id: string
  readonly sku_code: string
  readonly article_id: string
  readonly article_code: string
  readonly article_name: string
  readonly image_url: string | null
  readonly colour: string | null
  readonly size: string | null
  readonly quantity: number
  readonly accepted_quantity: number
  readonly picked_quantity: number
  readonly packed_quantity: number
  readonly shipment_quantity: number
  readonly dispatched_quantity: number
  readonly in_transit_quantity: number
  readonly received_quantity: number
  readonly cancelled_quantity: number
  readonly remaining_allotted: number
  /// The fulfillment-stage reading of this same line (allotment V1 §3), read
  /// off the canonical view rather than derived from the legacy counters
  /// above.
  readonly to_pack_qty: number
  readonly at_packed_qty: number
  readonly at_shipment_qty: number
  readonly at_loaded_qty: number
  readonly at_in_transit_qty: number
  readonly closed_short_qty: number
  readonly to_receive_qty: number
  readonly receiving_gap_qty: number
  readonly cancellation_requested_quantity: number | null
  readonly cancellation_actual_cancelled_quantity: number | null
  /// What the DC could not cancel because it had already been picked.
  readonly cancellation_blocked_picked_quantity: number | null
  readonly received_breakdown_quantity: number
  /// False when the received counter and the matched tags disagree. Shown
  /// rather than reconciled: the two numbers coming apart is the finding.
  readonly received_projection_consistent: boolean
  readonly received_breakdown: readonly ReceivedUnit[]
  /// What has left the warehouse on this line, in pieces: on a delivery note
  /// or beyond. The floor an edit cannot take the line under. Optional until
  /// every cloud answers it (outbound cancel / edit, 9 Oct 2026).
  readonly sent_quantity?: number
  /// What MD wants the line to be now, net of edits and closes: `quantity`
  /// less what MD took out, plus what MD added. The "Was" an edit shows.
  readonly target_quantity?: number
  /// Pieces MD took out that still sit in an unsent carton, waiting for the
  /// warehouse to move them back.
  readonly takeout_pending_quantity?: number
}

export type AllotmentEventType =
  | "ALLOTMENT_CREATED"
  | "ALLOTMENT_EXECUTED"
  | "ALLOTMENT_CANCELLATION_REQUESTED"
  | "ALLOTMENT_CANCELLED"
  | "ALLOTMENT_SHORTAGE"
  | "ALLOTMENT_PICKED"
  | "ALLOTMENT_PARTIALLY_PICKED"

export interface AllotmentEvent {
  readonly id: string
  readonly sequence: number
  readonly event_type: AllotmentEventType
  readonly sku_id: string | null
  readonly source_pool_id: string | null
  readonly destination_type: DestinationType | null
  readonly destination_id: string | null
  readonly quantity: number
  /// How this event changed what is still reserved; negative releases it.
  /// A *requested* cancellation carries 0 — the promise is not released until
  /// the DC's own result comes back, and rendering it as released is the bug
  /// this field exists to prevent.
  readonly remaining_delta: number
  readonly movement_group_id: string | null
  readonly reference_type: string | null
  readonly reference_id: string | null
  readonly actor_id: string
  readonly occurred_at: string
  readonly recorded_at: string
}

export interface AllotmentCancellation {
  readonly cancellation_id: string
  readonly command_id: string | null
  readonly status: EdgeCancellationStatus | null
  readonly requested_by: string
  readonly reason: string
  readonly requested_at: string
  readonly received_at: string | null
  readonly outcome: "APPLIED" | "PARTIALLY_APPLIED" | "REJECTED" | null
  readonly result_reason: string | null
  readonly requested_quantity: number
  readonly cancelled_quantity: number | null
  readonly blocked_picked_quantity: number | null
}

/// One edit or cancel MD made on an allotment (`allotment_amendment`, 0938).
/// The detail may carry them, oldest first or newest first — read by date.
export interface AllotmentAmendment {
  readonly id: string
  readonly kind: "REDUCE" | "ADD" | "CANCEL"
  readonly allotment_line_id?: string
  readonly reason: string | null
  readonly actor_id: string
  readonly created_at: string
}

export interface AllotmentDetail extends AllotmentStages, FulfillmentStages {
  readonly id: string
  readonly allotment_number: string
  readonly type: AllotmentType
  readonly status: AllotmentStatus
  /// The V1 status (§8) — Active · Completed · Closed; see `AllotmentRow`.
  readonly fulfillment_status: FulfillmentStatus
  readonly article_count: number
  /// `to_pack_qty + at_packed_qty + at_shipment_qty + at_loaded_qty == 0` —
  /// see `AllotmentRow`.
  readonly dc_fulfilled: boolean
  readonly created_by: string
  readonly notes: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly cancelled_at: string | null
  readonly activation_command_id: string | null
  /// Set when a DC owns this allotment: the command went out to that node and
  /// the picking happens there. Null means the centre itself moves the stock —
  /// and is the only case in which `execute` is accepted.
  readonly activation_target_origin_id: string | null
  readonly edge_application_status: EdgeApplicationStatus | null
  readonly edge_cancellation_status: EdgeCancellationStatus | null
  readonly cancellation: AllotmentCancellation | null
  readonly total_received_breakdown_quantity: number
  readonly received_projection_consistent: boolean
  readonly remaining_allotted: number
  readonly lines: readonly AllotmentLine[]
  readonly events: readonly AllotmentEvent[]
  /// MD's edits and cancels, when the cloud lists them (absent from one that
  /// does not): who, why and when behind "Cancelled" and "300 → 250".
  readonly amendments?: readonly AllotmentAmendment[]
  /// The warehouse saying it has seen MD's changes, one per store (10 Oct 2026:
  /// "Got it" on the board). Absent from a cloud that does not list them.
  readonly acknowledgements?: readonly {
    readonly destination_id: string
    readonly by: string
    readonly at: string
  }[]
  /// The warehouse moving pieces back off MD's change (Move back), and when.
  readonly move_backs?: readonly {
    readonly by: string
    readonly at: string
    readonly pieces: number
  }[]
  /// The true ledger effect. An edge-owned allotment can have a full set of
  /// stage counters and an empty array here, because the physical facts live
  /// on the DC node.
  readonly movements: readonly Movement[]
}

export interface CreateAllotmentLine {
  readonly source_site_id: string
  readonly source_pool_id: string
  readonly destination_type: DestinationType
  readonly destination_id: string
  readonly sku_id: string
  readonly quantity: number
}

export interface CreateAllotmentRequest {
  readonly type: AllotmentType
  readonly lines: readonly CreateAllotmentLine[]
  readonly notes: string | null
  readonly actor_id: string
  readonly idempotency_key: string
}

export interface CancelAllotmentRequest {
  readonly reason: string
  readonly actor_id: string
  readonly idempotency_key: string
}

export interface ExecuteAllotmentRequest {
  readonly allotment_line_id: string
  readonly quantity: number
  readonly actor_id: string
  readonly idempotency_key: string
}

/// The create receipt. `execution_authority` is the branch everything else
/// follows: `EDGE_DC` means nothing was reserved here, a command is on its way
/// to that node, and every accepted counter stays 0 until it answers.
export interface CreateAllotmentResult {
  readonly id: string
  readonly allotment_number: string
  readonly type: AllotmentType
  readonly status: "ACTIVE"
  readonly total_quantity: number
  readonly remaining_quantity: number
  readonly edge_application_status: "PENDING" | null
  readonly activation_command_id: string | null
  readonly activation_target_origin_id: string | null
  readonly execution_authority: "EDGE_DC" | "CLOUD"
}

/// Cancel answers in two shapes. A DC-owned allotment gets 202 and a request
/// that has not released anything yet (`edge_cancellation_status: PENDING`);
/// a cloud-owned one gets 200 and `cancellation_status: APPLIED`, with the
/// remaining quantity released on the spot. Neither moves stock: what was
/// already picked stays picked.
export interface CancelAllotmentResult {
  readonly id: string
  readonly allotment_number: string
  readonly status: AllotmentStatus
  readonly cancellation_status?: "APPLIED"
  readonly edge_cancellation_status: EdgeCancellationStatus | null
  readonly cancelled_quantity: number
  readonly total_cancelled_quantity?: number
  readonly requested_cancellation_quantity?: number
  readonly blocked_picked_quantity?: number | null
  readonly remaining_quantity: number
  /// A cloud-owned cancel (outbound cancel / edit, 9 Oct 2026): what was
  /// released at once, and what the warehouse now has to move back — picked
  /// pieces back to the racks, packed pieces out of their cartons.
  readonly released_total?: number
  readonly owed_total?: number
  readonly owed_picked?: number
  readonly owed_packed?: number
}

/// The reasons MD gives when an allotment is cancelled or edited. One word
/// each; the dialog asks for one when cancelling, an edit takes one or none.
export const ALLOTMENT_CHANGE_REASONS = [
  "Wrong quantity",
  "Wrong store",
  "Stock problem",
  "Supplier",
  "Other",
] as const

/// A line of the Still needed list: `UnfilledLine` plus what the outbound
/// board work (9 Oct 2026) adds to it — the target, what has gone, and why the
/// picker could not finish. Optional while the cloud lands.
export type StillNeededLine = UnfilledLine & {
  /// What MD wants the store to get, net.
  readonly target?: number
  /// Already sent: on a delivery note or beyond.
  readonly sent?: number
  /// A `ShortReason` code, when a picker reported one.
  readonly short_reason?: string | null
}

export type StillNeededList = Omit<UnfilledList, "open"> & {
  readonly open: readonly StillNeededLine[]
}

export interface ExecuteAllotmentResult {
  readonly id: string
  readonly allotment_number: string
  readonly status: AllotmentStatus
  readonly allotment_line_id: string
  readonly picked_quantity: number
  readonly total_picked_quantity: number
  readonly remaining_quantity: number
  readonly movement_group_id: string
  readonly movement_ids: readonly string[]
  /// A sentence, not an object: `"dc.warehouse:on_hand -> dc.outbound.picked.
  /// store-01:on_hand"`. The same key is an object on create and cancel.
  readonly inventory_effect: string
}

// ---------------------------------------------------------------------------
// Official counts
// ---------------------------------------------------------------------------

/// `DRAFT → ACTIVE → REVIEW → CLOSED`, and nothing else: the server's
/// `validate_count_transition` permits exactly those three edges.
export type CountStatus = "DRAFT" | "ACTIVE" | "REVIEW" | "CLOSED"

export type CountKind = "FULL" | "CYCLE" | "TARGETED"

/// Who actually counts. `EDGE_DC` means a DC node owns the site: the cloud
/// snapshots nothing, issues a command, and waits — entries and submission
/// from here are refused with the server's own sentence.
export type ExecutionAuthority = "EDGE_DC" | "CLOUD"

export interface CountSummary {
  readonly expected: number
  readonly found: number
  readonly match_subjects: number
  readonly shortage_subjects: number
  readonly gain_subjects: number
}

export interface CountRow {
  readonly id: string
  readonly site_id: string
  readonly pool_id: string
  readonly kind: CountKind
  readonly status: CountStatus
  readonly reason: string
  readonly created_by: string
  readonly created_at: string
  readonly activated_at: string | null
  readonly submitted_at: string | null
  readonly closed_at: string | null
  readonly expected: number
  readonly found: number
  readonly execution_authority: ExecutionAuthority
  readonly comparison_authority: "EDGE_RESULT_FACT" | "CLOUD_COUNT_RECORD"
  readonly edge_result_id: string | null
  readonly adjustment_id: string | null
  readonly edge_adjustment_status: "PENDING" | "APPLIED" | "REJECTED" | null
}

/// The list is a board, not an array: the server partitions one read into the
/// four states, which is exactly how the work is looked at.
export interface CountBoard {
  readonly drafts: readonly CountRow[]
  readonly active: readonly CountRow[]
  readonly needs_review: readonly CountRow[]
  readonly history: readonly CountRow[]
}

/// The envelope `GET /inventory/counts` answers with. `listCounts` folds it
/// back into a `CountBoard`; the four buckets are the `statuses` facet now.
export interface CountPage {
  readonly rows: readonly CountRow[]
  readonly next_cursor: string | null
  readonly total: number
  readonly facets: {
    readonly statuses: readonly InventoryFacet[]
    readonly sites: readonly InventoryFacet[]
    readonly pools: readonly InventoryFacet[]
    readonly kinds: readonly InventoryFacet[]
  }
}

/// One counted subject. `subject_id` is **absent** on an edge-owned count:
/// those lines are the DC's verbatim result fact, and the DC speaks in EPCs
/// and SKU codes, not in cloud UUIDs.
export interface CountLine {
  readonly subject_id?: string
  readonly epc: string
  readonly sku_code: string
  readonly article_name?: string | null
  readonly expected_quantity: number
  readonly found_quantity: number
}

export interface CountScope {
  readonly sku_ids: readonly string[]
  /// **Optional on the wire, and it has to be.** Both are written into the
  /// stored scope at ACTIVATION — `counts.rs` resolves each `sku_id` to its
  /// code there — so a count whose scope was written before that step, or by
  /// a seed, comes back as `{"sku_ids": []}` and nothing else. Typed as
  /// present, `data.scope.sku_codes.length` threw and took the whole count
  /// sheet down with it; every read of these has to survive the absence.
  readonly sku_codes?: readonly string[]
  readonly epcs?: readonly string[]
}

export interface CountDetail {
  readonly id: string
  readonly site_id: string
  readonly pool_id: string
  readonly kind: CountKind
  readonly status: CountStatus
  readonly scope: CountScope
  readonly reason: string
  readonly created_by: string
  readonly created_at: string
  readonly activated_at: string | null
  readonly submitted_at: string | null
  readonly closed_at: string | null
  readonly execution_authority: ExecutionAuthority
  readonly comparison_authority: "EDGE_RESULT_FACT" | "CLOUD_COUNT_RECORD"
  readonly activation_command_id: string | null
  readonly activation_target_origin_id: string | null
  readonly edge_result_id: string | null
  readonly edge_result_received_at: string | null
  readonly adjustment_id: string | null
  readonly edge_adjustment_status: "PENDING" | "APPLIED" | "REJECTED" | null
  readonly edge_adjustment_received_at: string | null
  readonly summary: CountSummary
  readonly lines: readonly CountLine[]
}

export interface CreateCountRequest {
  readonly site_id: string
  /// Must be the canonical pool id **and** belong to `site_id` — the server
  /// round-trips it through its own parser and refuses anything else.
  readonly pool_id: string
  readonly kind: CountKind
  readonly sku_ids: readonly string[]
  readonly epcs: readonly string[]
  readonly reason: string
  readonly actor_id: string
  readonly idempotency_key: string
}

/// Activate, submit and approve all take the same two fields. What they mean
/// differs entirely, which is why they are three routes and not one.
export interface CountCommandRequest {
  readonly actor_id: string
  readonly idempotency_key: string
}

export interface CountEntryInput {
  readonly subject_id: string | null
  readonly epc: string | null
  readonly found_quantity: number
}

export interface CountEntriesRequest {
  readonly actor_id: string
  readonly idempotency_key: string
  readonly entries: readonly CountEntryInput[]
}

/// Activation is the fork in the whole feature: with no DC owner the cloud
/// freezes an expectation here and reports how many subjects it snapshotted;
/// with one, both snapshot fields come back null and a command goes out.
export interface ActivateCountResult {
  readonly id: string
  readonly status: "ACTIVE"
  readonly expected_subjects: number | null
  readonly expected_snapshot_at: string | null
  readonly activation_command_id: string | null
  readonly activation_target_origin_id: string | null
  readonly execution_authority: ExecutionAuthority
}

/// Approval, in two shapes. Cloud-owned posts the real ledger work and closes:
/// shortages move `on_hand → missing` as `COUNT_SHORTAGE`, gains arrive as
/// `COUNT_GAIN`. Edge-owned stays at `REVIEW` and only *requests* the
/// adjustment — `CLOSED` comes later, when the DC reports back.
export interface ApproveCountResult {
  readonly id: string
  readonly status: "CLOSED" | "REVIEW"
  readonly execution_authority: ExecutionAuthority
  readonly movement_group_ids?: readonly string[]
  readonly movement_count?: number
  readonly allotment_shortage_event_count?: number
  readonly edge_adjustment_status?: "PENDING"
  readonly adjustment_id?: string
  readonly summary: CountSummary
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

/// One consolidated RFID sighting. `subject_id` is null when the tag matches
/// no inventory subject the centre knows — an unknown tag is still a fact.
export interface Observation {
  readonly observation_id: string
  readonly subject_id: string | null
  readonly epc: string
  readonly sku_code: string | null
  readonly site_id: string
  readonly pool_id: string
  readonly first_seen_at: string
  readonly last_seen_at: string
  readonly received_at: string
  readonly device_id: string
  readonly reader_session_id: string
  /// Always `RFID_HANDHELD` — the database constrains it.
  readonly method: string
  readonly read_count: number
  readonly best_rssi: number | null
  readonly antenna: string | null
}

export interface RfidRead {
  readonly epc: string
  readonly antenna: string | null
  readonly rssi: number | null
  readonly phase: number | null
  readonly frequency: number | null
  readonly read_count: number
}

/// A reader's batch. The field is `pool`, not `pool_id` — the one place in
/// this surface where it is spelled short.
///
/// The route is closed on any node started with a JWT secret: production
/// readers submit device-signed batches to their own Edge, and Cloud receives
/// them through authenticated sync. Pressing it there returns that sentence,
/// which is the right thing for the screen to show.
export interface ObservationBatchRequest {
  readonly site_id: string
  readonly pool: string
  readonly device_id: string
  readonly reader_session_id: string
  readonly observed_at: string
  readonly idempotency_key: string
  readonly observations: readonly RfidRead[]
}

export interface IngestObservationsResult {
  readonly idempotency_key: string
  readonly raw_read_count: number
  readonly consolidated_sighting_count: number
  readonly inserted: number
  /// Folded into a sighting already open for this device, session, pool and
  /// tag. A handheld sweeping a rack reads the same tag forty times; that is
  /// one sighting, not forty.
  readonly merged_into_burst: number
  readonly observation_ids: readonly string[]
  readonly observed_at: string
  readonly received_at: string
  /// Both counts are hardcoded zero — a contract statement, not a statistic:
  /// ingesting RFID has no ledger effect at all.
  readonly inventory_effect: {
    readonly movement_count: number
    readonly missing_created: number
  }
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/// Keys live beside the function that fetches them. The first segment is the
/// domain namespace, so signing out can drop a whole module's answers by
/// prefix without naming every key.
export const inventoryKeys = {
  all: ["inventory"] as const,
  fleet: () => ["inventory", "fleet-pools"] as const,
  pool: (id: string) => ["inventory", "pools", id] as const,
  availability: (poolId: string, search: string, shortfall: boolean) =>
    ["inventory", "availability", poolId, search, shortfall] as const,
  /// `held` is part of the key and not a detail of the fetch: the held answer
  /// is a few dozen rows and the whole-catalogue answer is a few thousand, and
  /// a screen that asked for one must never be handed the other out of cache.
  poolAvailability: (poolId: string, held = false) =>
    ["inventory", "availability", "whole", poolId, held] as const,
  asOf: (at: string, siteId: string, poolId: string) =>
    ["inventory", "as-of", at, siteId, poolId] as const,
  reconciliations: (scope?: ReconciliationScope) =>
    scope === undefined
      ? (["inventory", "reconciliations"] as const)
      : (["inventory", "reconciliations", scope] as const),

  allotments: () => ["inventory", "allotments"] as const,
  allotmentList: (type: string, status: string) =>
    ["inventory", "allotments", "list", type, status] as const,
  allotment: (id: string) => ["inventory", "allotments", "detail", id] as const,
  allotmentsUnfilled: () => ["inventory", "allotments", "unfilled"] as const,
  /// What a cancel would cost, by stage — under the allotments prefix, so an
  /// edit or a cancel that invalidates the book drops it too.
  allotmentWork: (id: string) =>
    ["inventory", "allotments", "work", id] as const,
  allotmentsByStore: (storeId: string) =>
    ["inventory", "allotments", "by-store", storeId] as const,
  allotmentsByArticle: (destinationId: string) =>
    ["inventory", "allotments", "by-article", destinationId] as const,
  /// The book narrowed to one source pool — what the Allotted column on that
  /// pool is made of.
  allotmentsByPool: (poolId: string) =>
    ["inventory", "allotments", "by-pool", poolId] as const,

  counts: () => ["inventory", "counts"] as const,
  /// The book under the question that was asked of it, under the same prefix
  /// as the board so one invalidation drops both.
  countsScoped: (scope: CountBookScope) =>
    ["inventory", "counts", "scoped", scope] as const,
  count: (id: string) => ["inventory", "counts", id] as const,

  observations: (scope: SightingScope) =>
    ["inventory", "observations", scope] as const,

  missing: (scope?: MissingScope) =>
    scope === undefined
      ? (["inventory", "missing"] as const)
      : (["inventory", "missing", "scoped", scope] as const),

  /// The ledger, under the question that was asked of it. Scoped and unscoped
  /// spellings share a prefix, so one `invalidateQueries` on `movements()`
  /// still drops every narrowed page a screen is holding.
  movements: (scope?: MovementScope) =>
    scope === undefined
      ? (["inventory", "movements"] as const)
      : (["inventory", "movements", "scoped", scope] as const),

  articleHistory: (articleCode: string) =>
    ["inventory", "article-history", articleCode] as const,

  control: () => ["inventory", "control"] as const,
  timeMachineState: (seq: string, poolId: string) =>
    ["inventory", "time-machine", "state", seq, poolId] as const,
  timeMachineDivergence: (poolId: string) =>
    ["inventory", "time-machine", "divergence", poolId] as const,
  syncDivergence: (originId: string, generation: number) =>
    [
      "inventory",
      "time-machine",
      "sync-divergence",
      originId,
      generation,
    ] as const,
}

/// A key that must not be reused across two different intents. `crypto` is on
/// `window` in every browser this app runs in.
export function idempotencyKey(): string {
  return crypto.randomUUID()
}

function search(
  params: Readonly<Record<string, string | number | undefined>>
): string {
  const parameters = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") parameters.set(name, String(value))
  }
  const text = parameters.toString()
  return text === "" ? "" : `?${text}`
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// Cloud's own ledger *and* every Edge node's fact positions, deduplicated.
/// The only read that can answer "how much stock does the business hold".
export function fleetPools(signal?: AbortSignal) {
  return node.get<FleetPoolList>("/api/v1/inventory/fleet-pools", { signal })
}

/// The fleet read as a query: what every screen that names a pool asks first,
/// and what the prefetcher asks for (`screens/inventory/prefetch.ts`).
export const fleetPoolsQuery = () =>
  queryOptions({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

export function poolDetail(id: string, signal?: AbortSignal) {
  return node.get<PoolDetail>(
    `/api/v1/inventory/pools/${encodeURIComponent(id)}`,
    {
      signal,
    }
  )
}

/// The same pool rows, folded to a moment in the past. `read_only` comes back
/// true whenever `at` is more than two seconds ago, and the screen has to
/// honour it: these numbers are history and nothing may be posted against them.
export function inventoryAsOf(
  at: string,
  siteId: string,
  poolId: string,
  signal?: AbortSignal
): Promise<PoolList> {
  return node
    .get<PoolPage>(
      `/api/v1/inventory/as-of${search({ at, site_id: siteId, pool_id: poolId })}`,
      { signal }
    )
    .then((page) => ({ ...page, items: page.rows }))
}

/// One page of a pool's availability, in SKU-code order, walking the SKU-code
/// `next_cursor`. `shortfall` keeps only the SKUs promised beyond what the
/// pool holds — narrowed by the server, so it is every one of them.
export function availability(
  scope: {
    readonly sourcePoolId: string
    readonly query: string
    readonly shortfall: boolean
    readonly cursor?: string
  },
  signal?: AbortSignal
) {
  return node.get<Availability>(
    `/api/v1/inventory/availability${search({
      source_pool_id: scope.sourcePoolId,
      q: scope.query,
      cursor: scope.cursor,
      limit: 200,
      shortfall: scope.shortfall ? "true" : undefined,
    })}`,
    { signal }
  )
}

/// The shelf the On Hand & Shortfall screen opens on.
export const AVAILABILITY_OPENING_POOL = "dc.warehouse"

/// One pool's availability a page at a time, as the screen holds it. Shared
/// with the prefetcher, so the key and the cursor walk cannot drift.
export const availabilityQuery = (
  poolId: string,
  needle: string,
  shortfall: boolean
) =>
  infiniteQueryOptions({
    queryKey: inventoryKeys.availability(poolId, needle, shortfall),
    queryFn: ({ pageParam, signal }) =>
      availability(
        {
          sourcePoolId: poolId,
          query: needle,
          shortfall,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

/// The whole pool, not the first page of it.
///
/// The availability endpoint pages on a SKU-code cursor — it is written for a
/// list somebody reads a screenful at a time. The
/// allotment matrix is not that: its rows are the axis a person scans down
/// while typing quantities across, and a matrix that stops at row 500 with a
/// "next page" button is a matrix you cannot total. So the pages are walked
/// here, in one query, and the caller gets one answer.
///
/// Ask for the whole catalogue in one page, and walk the cursor only if the
/// catalogue is bigger than that.
///
/// The old reading — "cheap, six requests, a third of a second" — was measured
/// against a node on the same machine, and it was wrong about why. A page is
/// not a slice of work: the server folds the whole ledger for the pool and
/// runs the totals over every row on EVERY page, then discards everything
/// before the cursor. Six pages was six folds and six round trips, and against
/// a hosted node that is where the screen sat waiting.
///
/// `PAGE_SIZE` is the server's own maximum. Asking for more is not an error —
/// the server clamps — but asking for exactly it keeps the two numbers
/// visibly the same thing.
///
/// `PAGE_CAP` is a stop, not a limit anybody should reach: a server that
/// returned a cursor it had already returned would otherwise loop forever, and
/// an infinite `while` in a query function takes the tab with it.
const PAGE_SIZE = 5000
const PAGE_CAP = 60

export async function poolAvailability(
  sourcePoolId: string,
  options: { held?: boolean } = {},
  signal?: AbortSignal
): Promise<Availability> {
  const pages: Availability[] = []
  let cursor = ""
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const answer = await node.get<Availability>(
      `/api/v1/inventory/availability${search({
        source_pool_id: sourcePoolId,
        cursor,
        limit: PAGE_SIZE,
        ...(options.held === true ? { held: "true" } : {}),
      })}`,
      { signal }
    )
    pages.push(answer)
    if (answer.next_cursor === null || answer.items.length === 0) break
    cursor = answer.next_cursor
  }
  // The totals are the server's, computed over the whole matching set rather
  // than over a page, so the first answer's are already the right ones — only
  // the rows have to be joined back together.
  const first = pages[0]
  return {
    ...first,
    next_cursor: null,
    items: pages.flatMap((page) => page.items),
  }
}

/// The allotment book. `type` and `status` must be the exact wire spellings or
/// axum refuses the request before it reaches the handler, which is why an
/// empty filter is dropped rather than sent blank.
export function listAllotments(
  type: string,
  status: string,
  signal?: AbortSignal
) {
  return node.get<AllotmentList>(
    `/api/v1/inventory/allotments${search({ type, status, limit: 500 })}`,
    { signal }
  )
}

/// The allotment book under a type and a status, as a query. Stock reads the
/// whole book (`""`, `""`) for the road card, and so does its prefetcher.
export const allotmentListQuery = (type: string, status: string) =>
  queryOptions({
    queryKey: inventoryKeys.allotmentList(type, status),
    queryFn: ({ signal }) => listAllotments(type, status, signal),
  })

/// Every allotment that is over: received, and the ones closed short or
/// cancelled, which the server only returns under `CANCELLED`. Two reads
/// merged newest first, so a screen shows one list.
export async function listFinishedAllotments(
  type: string,
  signal?: AbortSignal
): Promise<AllotmentList> {
  const [done, closed] = await Promise.all([
    listAllotments(type, "COMPLETED", signal),
    listAllotments(type, "CANCELLED", signal),
  ])
  const seen = new Set(done.items.map((one) => one.id))
  const items = [
    ...done.items,
    ...closed.items.filter((one) => !seen.has(one.id)),
  ].sort((left, right) => right.created_at.localeCompare(left.created_at))
  return { ...done, items }
}

/// The same book, narrowed to what one shelf has been promised out of.
///
/// Narrowed at the server rather than here: the filter is a clause on the
/// allotment *lines*, and an allotment carrying three source pools matches on
/// one of them without its other two lines being any of this pool's business.
/// Fetching five hundred and filtering in the browser would get that wrong in
/// a way that looks right.
export function allotmentsByPool(poolId: string, signal?: AbortSignal) {
  return node.get<AllotmentList>(
    `/api/v1/inventory/allotments${search({ source_pool_id: poolId, limit: 200 })}`,
    { signal }
  )
}

/// Lines the warehouse cannot fill after the count, and the ones already closed
/// short. Every open row is actionable: the server lists a line only once the
/// RFID count has booked its pieces Missing.
export function allotmentsUnfilled(signal?: AbortSignal) {
  return node.get<UnfilledList>("/api/v1/inventory/allotments/unfilled", {
    signal,
  })
}

/// Close short on named lines of one allotment.
export function closeShortAllotment(
  id: string,
  request: AllotmentCloseShortRequest
) {
  return node.post<unknown>(
    `/api/v1/inventory/allotments/${id}/close-short`,
    request
  )
}

export function allotmentDetail(id: string, signal?: AbortSignal) {
  return node.get<AllotmentDetail>(`/api/v1/inventory/allotments/${id}`, {
    signal,
  })
}

export function allotmentsByStore(storeId: string, signal?: AbortSignal) {
  return node.get<StoreAllotmentList>(
    `/api/v1/inventory/allotments/by-store/${encodeURIComponent(storeId)}`,
    { signal }
  )
}

/// The book read down the other axis: not "what did this allotment carry" but
/// "where has this garment been sent". Rolled up on the server because the
/// answer spans every allotment line in the table, and assembling it here
/// would mean opening each allotment in turn.
export function allotmentsByArticle(
  destinationId: string,
  signal?: AbortSignal
) {
  return node.get<ArticleAllotmentList>(
    `/api/v1/inventory/allotments/by-article${search({ destination_id: destinationId })}`,
    { signal }
  )
}

/// The count board — drafts, active, needs review, history.
///
/// The server used to hand the four buckets over already partitioned; it
/// answers with one envelope and a `statuses` facet now, which is the same
/// information with the partition as a filter somebody can change rather than
/// one baked into the route. The four arrays are rebuilt here, so every screen
/// that reads a board still reads a board — one place unwraps the envelope
/// rather than four.
///
/// A screen that wants the total, the facets or a page asks
/// `GET /inventory/counts` for `CountPage` itself.
export function listCounts(signal?: AbortSignal): Promise<CountBoard> {
  return node
    .get<CountPage>("/api/v1/inventory/counts", { signal })
    .then((page) => ({
      drafts: page.rows.filter((row) => row.status === "DRAFT"),
      active: page.rows.filter((row) => row.status === "ACTIVE"),
      needs_review: page.rows.filter((row) => row.status === "REVIEW"),
      history: page.rows.filter((row) => row.status === "CLOSED"),
    }))
}

/// The count board as a query (Stock's cards and the Pools table's "last
/// counted" column), shared with the prefetcher.
export const countsBoardQuery = () =>
  queryOptions({
    queryKey: inventoryKeys.counts(),
    queryFn: ({ signal }) => listCounts(signal),
  })

/// What the count book can be asked for.
///
/// Every field is a parameter `GET /api/v1/inventory/counts` answers.
export interface CountBookScope {
  /// Free text over the pool id, the reason, and who opened it.
  readonly q?: string
  /// `DRAFT`, `ACTIVE`, `REVIEW` or `CLOSED`.
  readonly status?: string
  readonly site_id?: string
  readonly pool_id?: string
  /// `FULL`, `CYCLE` or `TARGETED`.
  readonly kind?: string
  /// `created_at` (the house order), `pool`, `status`, `variance` or
  /// `closed_at`.
  readonly sort?: string
  readonly desc?: boolean
  readonly limit?: number
  readonly cursor?: string
}

/// The chips as the parameters the endpoint answers. See
/// `movementScopeFromFilters` for why this lives beside the fetcher.
export function countScopeFromFilters(
  filters: readonly Filter[]
): CountBookScope {
  const scope: { -readonly [K in keyof CountBookScope]: CountBookScope[K] } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "status") scope.status = values[0]
    else if (column === "kind") scope.kind = values[0]
    else if (column === "site_id") scope.site_id = values[0]
    else if (column === "pool_id") scope.pool_id = values[0]
  }
  return scope
}

/// The count book: searched, filtered, sorted and paged by the server.
///
/// `listCounts` above folds the same envelope back into the four buckets the
/// board used to be, for the screens that read a board. This is the envelope
/// itself, for the screen that draws the list — the total, the facets and the
/// cursor are the three things folding it throws away.
export function countsPage(scope: CountBookScope, signal?: AbortSignal) {
  return node.get<CountPage>(
    `/api/v1/inventory/counts${search({
      q: scope.q,
      status: scope.status,
      site_id: scope.site_id,
      pool_id: scope.pool_id,
      kind: scope.kind,
      sort: scope.sort,
      dir: scope.desc === true ? "desc" : undefined,
      limit: scope.limit,
      cursor: scope.cursor,
    })}`,
    { signal }
  )
}

/// The count book as the Counts screen opens: every status, no chips, the
/// deepest shortage first (its `SORTS.difference`, ascending). The prefetcher
/// asks this; if the screen's default sort moves, this moves with it.
export const COUNTS_OPENING_SCOPE: CountBookScope = {
  sort: "variance",
  desc: false,
}

/// The count book a page at a time, under the question the screen built.
export const countsBookQuery = (scope: CountBookScope) =>
  infiniteQueryOptions({
    queryKey: inventoryKeys.countsScoped(scope),
    queryFn: ({ pageParam, signal }) =>
      countsPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

export function countDetail(id: string, signal?: AbortSignal) {
  return node.get<CountDetail>(`/api/v1/inventory/counts/${id}`, { signal })
}

/// What the sighting list can be asked for — every parameter
/// `GET /api/v1/inventory/observations` answers.
export interface SightingScope {
  /// The centre's pool id. An outbound rollup also matches its leaves.
  readonly pool_id?: string
  /// One tag, exactly.
  readonly epc?: string
  /// Free text over the tag, the SKU code, the reader and its session.
  readonly q?: string
  readonly device_id?: string
  readonly site_id?: string
  /// `last_seen_at` (the house order, newest first), `first_seen_at`,
  /// `received_at`, `read_count` or `epc`.
  readonly sort?: string
  /// The house order is already newest first, so on `last_seen_at` this asks
  /// for the list read the OTHER way — as the ledger's does.
  readonly desc?: boolean
  readonly limit?: number
  /// From a previous page's `next_cursor`.
  readonly cursor?: string
}

/// A page of sightings, and the exact shape of everything it was drawn from.
export interface SightingPage {
  readonly rows: readonly Observation[]
  /// Null at the end of the list.
  readonly next_cursor: string | null
  /// Every sighting the pool, the tag, the search and the filters match.
  readonly total: number
  readonly facets: {
    readonly pools: readonly InventoryFacet[]
    readonly devices: readonly InventoryFacet[]
    readonly methods: readonly InventoryFacet[]
  }
}

/// One page of the sweep list. The server clamps at 500.
export const SIGHTINGS_PAGE = 200

/// The sightings: searched, filtered, sorted and paged by the server, walked
/// with `next_cursor`.
export function sightingsPage(scope: SightingScope, signal?: AbortSignal) {
  return node.get<SightingPage>(
    `/api/v1/inventory/observations${search({
      pool_id: scope.pool_id,
      epc: scope.epc,
      q: scope.q,
      device_id: scope.device_id,
      site_id: scope.site_id,
      sort: scope.sort,
      // Only the word the server looks for; anything else is the house order.
      dir: scope.desc === true ? "desc" : undefined,
      limit: scope.limit ?? SIGHTINGS_PAGE,
      cursor: scope.cursor,
    })}`,
    { signal }
  )
}

/// What the ledger can be asked for.
///
/// Every field is a parameter `GET /api/v1/inventory/movements` answers, and
/// that is the whole contract of this type: a scope the request cannot carry
/// is a control that claims to narrow a list and does not. **There is no date
/// range in here because the endpoint has none** — the ledger is walked newest
/// first instead, a page at a time.
export interface MovementScope {
  /// Free text, tried by the server against the tag, the SKU code, who posted
  /// it, both place ids and the reference.
  readonly q?: string
  /// One pool, matched against EITHER side of the posting — a movement is
  /// double-entry, so a transfer between two pools appears once in each rather
  /// than twice in one.
  ///
  /// The CENTRE’s spelling (`dc.warehouse`, never the edge’s `dc-01.warehouse`):
  /// every place id in this table is written by the centre’s own ledger, so a
  /// caller holding the edge’s vocabulary matches nothing, silently.
  readonly pool_id?: string
  /// One cause — `SALE`, `NORMAL_MOVE`, `CONFIRMED_LOST`.
  readonly cause?: string
  readonly actor_id?: string
  /// `occurred_at` (the house order), `recorded_at`, `quantity` or `cause`.
  readonly sort?: string
  /// The house order is already newest first, so this asks for the ledger read
  /// the OTHER way — see the note on the server’s `movements_page`.
  readonly desc?: boolean
  readonly limit?: number
  /// From a previous page’s `next_cursor`.
  readonly cursor?: string
}

/// What the ledger can be narrowed by, counted by the server over everything
/// the search matches rather than over the page in hand.
export interface MovementFacets {
  readonly causes: readonly InventoryFacet[]
  readonly actors: readonly InventoryFacet[]
}

/// A page of the ledger, and the shape of everything it was drawn from.
export interface MovementPage {
  readonly rows: readonly Movement[]
  /// Feed it back as `cursor` for the next page. Null at the end of the log.
  readonly next_cursor: string | null
  /// Every posting the search and the chips match. **Null means NOT COUNTED**
  /// — the caller passed `count=0` — which is a different statement from
  /// nought and must never be drawn as one.
  readonly total: number | null
  readonly facets: MovementFacets | null
  readonly limit: number
}

/// The chips as the parameters the endpoint answers.
///
/// Beside the fetcher rather than in the screen, like `orderScopeFromFilters`
/// in `queries/procurement.ts` and for the same reason: this function is the
/// statement of what the endpoint can be asked, and every operator the fields
/// offer has a case here.
export function movementScopeFromFilters(
  filters: readonly Filter[]
): MovementScope {
  const scope: { -readonly [K in keyof MovementScope]: MovementScope[K] } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    // One value each, because the endpoint compares one column to one value.
    // Every field is declared `single`, so no chip can offer a second.
    if (column === "pool_id") scope.pool_id = values[0]
    else if (column === "cause") scope.cause = values[0]
    else if (column === "actor_id") scope.actor_id = values[0]
  }
  return scope
}

/// The ledger: searched, filtered, sorted and paged by the server.
///
/// The endpoint has been there since the ledger was written and nothing in
/// this app had ever asked it: movements reached the screen only as the tail
/// carried on a pool’s own detail, capped at whatever that read decides.
///
/// The screen used to ask for 300 rows and sift them in the browser, which put
/// a banner over the table explaining that the figures under it were not
/// totals. Both are gone: the question goes to the server now, and the answer
/// walks with `next_cursor`.
export function movementsPage(scope: MovementScope, signal?: AbortSignal) {
  return node.get<MovementPage>(
    `/api/v1/inventory/movements${search({
      q: scope.q,
      pool_id: scope.pool_id,
      cause: scope.cause,
      actor_id: scope.actor_id,
      sort: scope.sort,
      // Only the word the server looks for. Anything else — `asc` included —
      // is the house order, so sending it would be a parameter that means
      // nothing.
      dir: scope.desc === true ? "desc" : undefined,
      limit: scope.limit ?? MOVEMENTS_LIMIT,
      cursor: scope.cursor,
    })}`,
    { signal }
  )
}

/// The ledger a page at a time, under the question the screen built.
export const movementsLedgerQuery = (scope: MovementScope) =>
  infiniteQueryOptions({
    queryKey: inventoryKeys.movements(scope),
    queryFn: ({ pageParam, signal }) =>
      movementsPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line.
    placeholderData: (previous) => previous,
  })

/// The whole history of one article, newest first, in one answer — ordered,
/// allotted, and every movement of its SKUs. No paging: an article is bought
/// once, so it is short.
export function articleHistory(articleCode: string, signal?: AbortSignal) {
  return node.get<ArticleHistory>(
    `/api/v1/inventory/articles/${encodeURIComponent(articleCode)}/history`,
    { signal }
  )
}

/// How many movements one page of the log asks for.
///
/// A hundred, not the three hundred this screen used to ask for in one breath:
/// the list pages now, so this is the size of a step rather than a ceiling
/// dressed up as an answer. The server clamps anything above 500.
export const MOVEMENTS_LIMIT = 100

/// The ledger as the Movements screen opens: no chips, newest first. `desc` is
/// false because the server's house order on `occurred_at` is already newest
/// first (see `movements.tsx`, where the scope is built from the sort state).
export const MOVEMENTS_OPENING_SCOPE: MovementScope = {
  sort: "occurred_at",
  desc: false,
  limit: MOVEMENTS_LIMIT,
}

/// What the missing list can be asked for — every parameter
/// `GET /api/v1/inventory/missing` answers.
export interface MissingScope {
  /// Free text over the tag, the barcode, the SKU code, the pool id and label.
  readonly q?: string
  /// The centre's pool id.
  readonly pool_id?: string
  readonly site_id?: string
  /// `COUNTED` or `NEVER` — whether any official count has ever held it.
  readonly counted?: string
  /// `missing_since` (the house order, oldest first), `quantity`, `pool`,
  /// `last_observation` or `epc`.
  readonly sort?: string
  readonly desc?: boolean
  readonly limit?: number
  /// From a previous page's `next_cursor`.
  readonly cursor?: string
}

/// A page of what cannot be found, and the exact shape of all of it.
export interface MissingPage {
  readonly rows: readonly MissingItem[]
  /// Null at the end of the list.
  readonly next_cursor: string | null
  /// Every missing subject the search and the filters match.
  readonly total: number
  readonly facets: {
    readonly pools: readonly InventoryFacet[]
    readonly sites: readonly InventoryFacet[]
    readonly counted: readonly InventoryFacet[]
  }
}

/// One page of what is missing: searched, filtered, sorted and paged by the
/// server, walked with `next_cursor`. The server clamps at 500.
export function missingPage(scope: MissingScope, signal?: AbortSignal) {
  return node.get<MissingPage>(
    `/api/v1/inventory/missing${search({
      q: scope.q,
      pool_id: scope.pool_id,
      site_id: scope.site_id,
      counted: scope.counted,
      sort: scope.sort,
      dir: scope.desc === true ? "desc" : undefined,
      limit: scope.limit ?? 200,
      cursor: scope.cursor,
    })}`,
    { signal }
  )
}

/// One page of the transfer reconciliation report, walking `next_cursor`.
export function reconciliationsPage(
  scope: ReconciliationScope,
  signal?: AbortSignal
) {
  return node.get<ReconciliationPage>(
    `/api/v1/inventory/reconciliations${search({
      q: scope.q,
      status: scope.status,
      destination_store_id: scope.destination_store_id,
      source_dc_id: scope.source_dc_id,
      sort: scope.sort,
      dir: scope.desc === true ? "desc" : undefined,
      limit: 200,
      cursor: scope.cursor,
    })}`,
    { signal }
  )
}

/// The ledger's health, and where it and the projection disagree.
///
/// `projection_difference_count` is a COUNT now rather than the length of the
/// page. It used to be `differences.length` over a query capped at a thousand,
/// so a ledger with twelve hundred broken rows reported exactly a thousand and
/// nothing in the answer said it was a ceiling.
export function controlStatus(signal?: AbortSignal): Promise<ControlStatus> {
  return node
    .get<ControlAnswer>("/api/v1/inventory/control", { signal })
    .then((answer) => ({ ...answer, differences: answer.differences.rows }))
}

export function timeMachineState(
  seq: string,
  poolId: string,
  signal?: AbortSignal
) {
  return node.get<TimeMachineState>(
    `/api/v1/inventory/time-machine/state${search({ seq, pool_id: poolId })}`,
    { signal }
  )
}

export function timeMachineDivergence(poolId: string, signal?: AbortSignal) {
  return node.get<TimeMachineDivergence>(
    `/api/v1/inventory/time-machine/divergence${search({ pool_id: poolId })}`,
    { signal }
  )
}

export function syncDivergence(
  originId: string,
  generation: number,
  signal?: AbortSignal
) {
  return node.get<SyncDivergence>(
    `/api/v1/inventory/time-machine/sync-divergence${search({
      origin_id: originId,
      generation,
    })}`,
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/// Put a subject where the evidence says it actually is.
export function correctPlacement(request: CorrectPlacementRequest) {
  return node.post<MovementReceipt>(
    "/api/v1/inventory/movements/correct",
    request
  )
}

/// Promise goods out of a pool. Prices and places are the server's: it checks
/// each line against the fact-derived availability and refuses to allot more
/// than the pool holds.
export function createAllotment(request: CreateAllotmentRequest) {
  return node.post<CreateAllotmentResult>(
    "/api/v1/inventory/allotments",
    request
  )
}

export function createAllotmentBatch(items: readonly CreateAllotmentRequest[]) {
  return node.post<{
    items: CreateAllotmentResult[]
    failed_index: number | null
    problem: string | null
  }>("/api/v1/inventory/allotments/batch", { items })
}

/// Release what is still reserved — whole-allotment, never per line. On a
/// DC-owned allotment this only *asks*: the answer comes back `PENDING`, and
/// what was already picked is reported afterwards as blocked.
export function cancelAllotment(id: string, request: CancelAllotmentRequest) {
  return node.post<CancelAllotmentResult>(
    `/api/v1/inventory/allotments/${id}/cancel`,
    request
  )
}

/// Pick against a line, here at the centre.
///
/// Only legal when no DC owns the allotment — the server refuses otherwise,
/// and it is right to: picking is the warehouse's act, and the centre raising
/// a movement nobody made would be inventing stock history. Partial picks are
/// expected; call again with a fresh key until nothing remains.
export function executeAllotment(id: string, request: ExecuteAllotmentRequest) {
  return node.post<ExecuteAllotmentResult>(
    `/api/v1/inventory/allotments/${id}/execute`,
    request
  )
}

export function createCount(request: CreateCountRequest) {
  return node.post<{ id: string; status: "DRAFT" }>(
    "/api/v1/inventory/counts",
    request
  )
}

/// Freeze the expectation and start counting — or hand the job to the DC that
/// owns the site. Which of the two happened is in the answer.
export function activateCount(id: string, request: CountCommandRequest) {
  return node.post<ActivateCountResult>(
    `/api/v1/inventory/counts/${id}/activate`,
    request
  )
}

/// Record what was found. Upsert per subject: sending the same subject twice
/// replaces its quantity rather than adding to it.
export function addCountEntries(id: string, request: CountEntriesRequest) {
  return node.post<{ id: string; status: "ACTIVE"; entries_recorded: number }>(
    `/api/v1/inventory/counts/${id}/entries`,
    request
  )
}

export function submitCount(id: string, request: CountCommandRequest) {
  return node.post<{ id: string; status: "REVIEW"; summary: CountSummary }>(
    `/api/v1/inventory/counts/${id}/submit`,
    request
  )
}

/// Accept the difference. Cloud-owned, this posts the shortage and gain
/// movements and closes the count; DC-owned, it only asks the DC to adjust and
/// the count stays in review until that answer arrives.
export function approveCount(id: string, request: CountCommandRequest) {
  return node.post<ApproveCountResult>(
    `/api/v1/inventory/counts/${id}/approve`,
    request
  )
}

/// Submit a reader batch. Accepted (202) rather than applied: consolidation
/// and burst-merging happen server-side, and no ledger movement follows.
export function ingestObservations(request: ObservationBatchRequest) {
  return node.post<IngestObservationsResult>(
    "/api/v1/inventory/observations",
    request
  )
}

export function resolveMissing(
  id: string,
  outcome: "found" | "lost" | "dispose",
  request: MissingResolutionRequest
) {
  return node.post<MovementReceipt>(
    `/api/v1/inventory/missing/${encodeURIComponent(id)}/${outcome}`,
    request
  )
}

/// Compare, and record the comparison. Writes a `replay_run` row but touches
/// neither the ledger nor the projection.
export function runReplay(scope: ReplayScope, actorId: string) {
  return node.post<ReplayResult>("/api/v1/inventory/replay", {
    scope,
    actor_id: actorId,
  })
}

/// Rebuild the projection from the ledger. Idempotency-keyed in the body: a
/// retried repost replays its first answer rather than rebuilding twice.
export function runRepost(scope: ReplayScope, actorId: string, key: string) {
  return node.post<RepostResult>("/api/v1/inventory/repost", {
    scope,
    actor_id: actorId,
    idempotency_key: key,
  })
}

export function corruptProjection(request: CorruptProjectionRequest) {
  return node.post<CorruptProjectionResult>(
    "/api/v1/inventory/control/corrupt-projection",
    request
  )
}

export function timeMachineWhatIf(request: WhatIfRequest) {
  return node.post<WhatIfResult>(
    "/api/v1/inventory/time-machine/what-if",
    request
  )
}
