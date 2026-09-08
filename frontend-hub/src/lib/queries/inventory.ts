import { node } from "@/lib/api"
import type { MovementCause } from "@itulah/contract"

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
  readonly quantity: number
  readonly site_id: string
  readonly origin_pool: string
  readonly pool_label: string
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

export interface ReconciliationList {
  readonly as_of: string
  readonly summary: ReconciliationSummary
  readonly items: readonly Reconciliation[]
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
  readonly projection_difference_count: number
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

/// What the allotment is for. The three are not variations on a theme: each
/// has its own legal source pool and its own legal destination, checked by
/// `validate_create_line` on the server.
export type AllotmentType = "TO_STORE" | "RETURN_TO_DC" | "RETURN_TO_SUPPLIER"

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

export interface AllotmentRow extends AllotmentStages {
  readonly id: string
  readonly allotment_number: string
  readonly type: AllotmentType
  readonly status: AllotmentStatus
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
  readonly sku_id: string
  readonly sku_code: string
  readonly article_code: string
  readonly article_name: string
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
  readonly cancellation_requested_quantity: number | null
  readonly cancellation_actual_cancelled_quantity: number | null
  /// What the DC could not cancel because it had already been picked.
  readonly cancellation_blocked_picked_quantity: number | null
  readonly received_breakdown_quantity: number
  /// False when the received counter and the matched tags disagree. Shown
  /// rather than reconciled: the two numbers coming apart is the finding.
  readonly received_projection_consistent: boolean
  readonly received_breakdown: readonly ReceivedUnit[]
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

export interface AllotmentDetail extends AllotmentStages {
  readonly id: string
  readonly allotment_number: string
  readonly type: AllotmentType
  readonly status: AllotmentStatus
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

/// One counted subject. `subject_id` is **absent** on an edge-owned count:
/// those lines are the DC's verbatim result fact, and the DC speaks in EPCs
/// and SKU codes, not in cloud UUIDs.
export interface CountLine {
  readonly subject_id?: string
  readonly epc: string
  readonly sku_code: string
  readonly expected_quantity: number
  readonly found_quantity: number
}

export interface CountScope {
  readonly sku_ids: readonly string[]
  /// Filled in at activation, not at creation — empty on a draft.
  readonly sku_codes: readonly string[]
  readonly epcs: readonly string[]
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

/// The books and the reader disagree about where something is.
///
/// `automatic_inventory_effect` is a hardcoded `false`, and that is the load-
/// bearing claim of the whole observation surface: a sighting is evidence, not
/// a movement. The ledger is never silently corrected — somebody has to post a
/// placement correction, which is why the two screens sit next to each other.
export interface ObservationAnomaly {
  readonly type: "PLACEMENT_MISMATCH"
  readonly subject_id: string
  readonly epc: string
  readonly ledger_pool: string
  readonly observed_pool: string
  readonly quantity: number
  readonly last_observed_at: string
  readonly device_id: string
  readonly automatic_inventory_effect: false
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
  availability: (poolId: string, search: string, cursor: string) =>
    ["inventory", "availability", poolId, search, cursor] as const,
  poolAvailability: (poolId: string) =>
    ["inventory", "availability", "whole", poolId] as const,
  asOf: (at: string, siteId: string, poolId: string) =>
    ["inventory", "as-of", at, siteId, poolId] as const,
  reconciliations: () => ["inventory", "reconciliations"] as const,

  allotments: () => ["inventory", "allotments"] as const,
  allotmentList: (type: string, status: string) =>
    ["inventory", "allotments", "list", type, status] as const,
  allotment: (id: string) => ["inventory", "allotments", "detail", id] as const,
  allotmentsByStore: (storeId: string) =>
    ["inventory", "allotments", "by-store", storeId] as const,

  counts: () => ["inventory", "counts"] as const,
  count: (id: string) => ["inventory", "counts", id] as const,

  observations: (poolId: string, epc: string) =>
    ["inventory", "observations", poolId, epc] as const,
  anomalies: () => ["inventory", "observation-anomalies"] as const,

  missing: () => ["inventory", "missing"] as const,

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
) {
  return node.get<PoolList>(
    `/api/v1/inventory/as-of${search({ at, site_id: siteId, pool_id: poolId })}`,
    { signal }
  )
}

export function availability(
  sourcePoolId: string,
  query: string,
  cursor: string,
  signal?: AbortSignal
) {
  return node.get<Availability>(
    `/api/v1/inventory/availability${search({
      source_pool_id: sourcePoolId,
      q: query,
      cursor,
      limit: 200,
    })}`,
    { signal }
  )
}

/// The whole pool, not the first page of it.
///
/// The availability endpoint pages on a SKU-code cursor and caps a page at 500
/// — it is written for a list somebody reads a screenful at a time. The
/// allotment matrix is not that: its rows are the axis a person scans down
/// while typing quantities across, and a matrix that stops at row 500 with a
/// "next page" button is a matrix you cannot total. So the pages are walked
/// here, in one query, and the caller gets one answer.
///
/// Cheap in practice — the seed's 2,740 SKUs come back in six requests and
/// under a third of a second, because the expensive part is the ledger fold
/// PostgreSQL does once per page over an index.
///
/// `PAGE_CAP` is a stop, not a limit anybody should reach: a server that
/// returned a cursor it had already returned would otherwise loop forever, and
/// an infinite `while` in a query function takes the tab with it.
const PAGE_CAP = 60

export async function poolAvailability(
  sourcePoolId: string,
  signal?: AbortSignal
): Promise<Availability> {
  const pages: Availability[] = []
  let cursor = ""
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const answer = await node.get<Availability>(
      `/api/v1/inventory/availability${search({
        source_pool_id: sourcePoolId,
        cursor,
        limit: 500,
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

/// The count board — drafts, active, needs review, history — already
/// partitioned by the server.
export function listCounts(signal?: AbortSignal) {
  return node.get<CountBoard>("/api/v1/inventory/counts", { signal })
}

export function countDetail(id: string, signal?: AbortSignal) {
  return node.get<CountDetail>(`/api/v1/inventory/counts/${id}`, { signal })
}

export function listObservations(
  poolId: string,
  epc: string,
  signal?: AbortSignal
) {
  return node
    .get<{ items: Observation[] }>(
      `/api/v1/inventory/observations${search({ pool_id: poolId, epc, limit: 300 })}`,
      { signal }
    )
    .then((body) => body.items)
}

export function observationAnomalies(signal?: AbortSignal) {
  return node
    .get<{ items: ObservationAnomaly[] }>(
      "/api/v1/inventory/observation-anomalies",
      { signal }
    )
    .then((body) => body.items)
}

export function listMissing(signal?: AbortSignal) {
  return node
    .get<{ items: MissingItem[] }>("/api/v1/inventory/missing", { signal })
    .then((body) => body.items)
}

export function listReconciliations(signal?: AbortSignal) {
  return node.get<ReconciliationList>("/api/v1/inventory/reconciliations", {
    signal,
  })
}

export function controlStatus(signal?: AbortSignal) {
  return node.get<ControlStatus>("/api/v1/inventory/control", { signal })
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
