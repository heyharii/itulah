/// What the inventory endpoints answer, declared here because nothing
/// generates it.
///
/// ## Why this file exists
///
/// Every read in Finance and People is typed from `@itulah/contract`, which
/// `ts-rs` generates from the Rust struct the handler serialises. **Not one
/// cloud inventory handler serialises a struct.** All of them return
/// `Result<Json<serde_json::Value>, AppError>` and build the body with a
/// `json!{}` literal in `backend/src/cloud/postgres/{queries,movements,counts,
/// observations,control,time_machine,allotments}.rs`, so there is nothing for
/// the generator to run on — not "nobody has run it".
///
/// So these interfaces are **transcribed from those literals and checked by
/// nothing.** If a key moves on the server this file goes stale silently and a
/// column reads `undefined`. It is the same exception `modules/commercial/wire.ts`
/// makes for the fourteen commercial GETs, and the same one `Attention` in
/// `modules/finance/overview.tsx` makes — named rather than hidden, because a
/// reader is entitled to know which of the types on a screen the compiler is
/// actually holding.
///
/// ## The two generated types that look right and are not
///
/// `PoolBalance` and `MovementView` ARE in the contract, and importing them
/// here would be the worst of both worlds. They are the **edge** node's
/// structs, exported from `backend/src/edge/contracts.rs`, and the cloud's
/// rows are wider: a cloud pool row carries `site_kind`, `group`, `label`,
/// `observed`, `lost_rate`, `exposure` and an `authority` block that the edge
/// has no concept of, and a cloud movement row adds `sku_code`, `recorded_at`
/// and the allotment it belongs to. A screen typed against the edge's version
/// compiles and then reads six fields that are not on the object.
///
/// `MovementCause` is a real generated union and is still not used below, for
/// a narrower reason: it is the EDGE's list of causes, and a cloud cause it has
/// not met would be a value TypeScript says cannot exist. `cause` is a string
/// here and the screen draws an unknown one as itself — see `labels.ts`.
///
/// ## No money anywhere
///
/// There is no valuation field on any of these types, and that is not an
/// omission in the transcription: **the inventory ledger holds pieces and
/// nothing prices them.** No cost, no retail, no currency, on any inventory
/// route. Every figure on every screen in this module is a count of things.

// ── pools ──────────────────────────────────────────────────────────────────

/// Who speaks for a shelf, and whether this node may post against it.
///
/// The block that makes the fleet read readable. Cloud keeps a native ledger
/// **and** projects each Edge node's fact positions, so a warehouse an Edge
/// node owns arrives twice — once from each source. Exactly one of the pair
/// carries `included_in_fleet_total`, and reading the two without that
/// distinction is precisely how a fleet counts a store twice.
export interface PoolAuthority {
  /// `CLOUD_LEDGER` or `EDGE_FACT_POSITION`.
  readonly source: string
  readonly owner_origin_id: string
  readonly owner_role: string
  readonly owner_site_id: string
  /// Whether THIS node may write here. False for a shelf an Edge node owns.
  readonly cloud_writable: boolean
  readonly included_in_fleet_total: boolean
  /// A rollup: a sum of the rows beneath it rather than a place anything
  /// stands in.
  readonly derived: boolean
  /// `CLOUD_WRITABLE`, `OWNER_NODE_ONLY`, `SHADOWED_READ_ONLY`,
  /// `DERIVED_READ_ONLY`.
  readonly write_policy: string
  /// The origin that has taken this shelf over, on the Cloud row it shadows.
  ///
  /// **This field is the whole of the `dc` / `dc-01` mapping.** The centre
  /// spells the distribution centre `dc`; the Edge box standing in it runs as
  /// site `dc-01` and spells the same shelf `dc-01.warehouse`. A Cloud row
  /// naming `dc-01-edge` here is telling us which site that origin is standing
  /// in, and it is the only place either app can learn it without hardcoding
  /// the pair.
  readonly shadowed_by_origin_id: string | null
}

/// A pool as the plain `/pools` and `/as-of` reads return it: balances, no
/// authority, no origin. One node's own account of its own shelves.
export interface Pool {
  readonly id: string
  readonly site_id: string
  readonly site_name: string | null
  /// `DC` or `STORE`.
  readonly site_kind: string
  /// `WAREHOUSE`, `STORE_INVENTORY`, `OUTBOUND`, `REJECT`, `PENDING`.
  readonly group: string
  readonly pool_code: string
  readonly label: string
  readonly display_order: number
  readonly is_rollup: boolean
  readonly is_outbound_leaf: boolean
  readonly outbound_stage: string | null
  readonly destination_store_id: string | null
  readonly store_origin_site_id: string | null
  /// `Stock = On Hand + Allotted + Missing`, stated by the server in the same
  /// response.
  readonly stock: number
  readonly on_hand: number
  /// Null where the question does not apply rather than nought: an Edge-derived
  /// row models no allotments at all.
  readonly allotted: number | null
  readonly missing: number
  /// Distinct tags a reader saw in the observation window. Evidence, not a
  /// balance — and null where there was never anything to sight.
  readonly observed: number | null
  readonly lost_rate: number | null
  readonly lost_quantity: number | null
  readonly exposure: number | null
}

/// The same pool on the FLEET read, which adds where the row came from.
export interface FleetPool extends Pool {
  readonly origin_id: string
  readonly origin_role: string
  /// What the box is called — "DC Jakarta" — as against `site_name`, which is
  /// what the place is called.
  readonly owner_label: string | null
  readonly source_type: string
  /// `LOCAL`, `WAITING` (never reported), `STALE`, `OK`.
  readonly sync_status: string
  readonly sync_applied_at: string | null
  readonly sync_captured_at: string | null
  readonly sync_age_seconds: number | null
  readonly fact_generation: number | null
  readonly fact_applied_seq: number | null
  readonly snapshot_generation: number | null
  readonly snapshot_seq: number | null
  readonly checkpoint_status: string | null
  readonly checkpoint_applied_at: string | null
  readonly checkpoint_captured_at: string | null
  readonly checkpoint_age_seconds: number | null
  readonly source_capture_age_seconds: number | null
  readonly authority: PoolAuthority
}

/// Why the server will not certify a fleet total.
///
/// It answers `fleet_total: null` and then explains itself here, in lists of
/// origins rather than in a sentence. Every name in them is an Edge node whose
/// number the centre does not have or does not trust.
export interface FleetTotalDiagnostics {
  /// The arithmetic the server itself did. A real number — it is the
  /// certification that is withheld, not the sum.
  readonly calculated_total: number
  readonly base_stock_before_overlap: number
  readonly overlap_deduction: number
  readonly included_row_count: number
  readonly excluded_rollup_count: number
  readonly certification_reasons: readonly string[]
  /// Boxes that have never reported at all.
  readonly unreported_edge_origins: readonly string[]
  /// Boxes whose last checkpoint is too old to stand for now.
  readonly stale_edge_origins: readonly string[]
  readonly missing_edge_origins: readonly string[]
  readonly shadowed_cloud_site_ids: readonly string[]
  readonly ambiguous_canonical_dc_origins: readonly string[]
  readonly routes: readonly unknown[]
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

/// `GET /api/v1/inventory/fleet-pools` — no parameters, no cap, no cursor.
export interface FleetPoolList {
  readonly as_of: string
  readonly read_only: boolean
  readonly observed_window_hours: number
  readonly lost_risk_window_days: number
  readonly inventory_equation: string
  readonly aggregation_policy: string
  /// **Null when the server declines to certify**, which on this database it
  /// always is. Never fall back to a browser-side sum: see the diagnostics.
  readonly fleet_total: number | null
  /// `CERTIFIED` or `UNCERTIFIED`.
  readonly fleet_total_status: string
  readonly fleet_total_diagnostics: FleetTotalDiagnostics
  readonly reconciliation_summary: ReconciliationSummary
  readonly items: readonly FleetPool[]
}

/// `GET /api/v1/inventory/as-of?at=…` — the same pools folded to a moment.
export interface AsOfList {
  readonly as_of: string
  readonly inventory_equation: string
  readonly items: readonly Pool[]
}

/// One piece standing in a pool. `GET /inventory/pools/{id}`, `LIMIT 200`.
export interface PoolItem {
  readonly subject_id: string
  readonly subject_type: string
  readonly epc: string | null
  readonly barcode: string | null
  readonly sku_code: string | null
  readonly article_code: string | null
  readonly article_name: string | null
  readonly quantity: number
}

/// A count of this pool, as the pool's own page lists it. `LIMIT 20`.
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

/// `GET /api/v1/inventory/pools/{id}`.
///
/// Every sub-list is capped in the SQL and **none of the caps is settable**:
/// items 200, missing 200, observations 100, movements 100, counts 20. A screen
/// drawing any of them has to say so — there is no total and no cursor to ask
/// for the rest with.
export interface PoolDetail {
  readonly summary: Pool
  readonly items: readonly PoolItem[]
  readonly missing: readonly MissingItem[]
  readonly observations: readonly Observation[]
  readonly movements: readonly Movement[]
  readonly counts: readonly PoolCount[]
}

// ── movements ──────────────────────────────────────────────────────────────

/// One posting that moved a piece. Double-entry: both halves are on the row.
///
/// `from` and `to` are *places* — `<pool>:on_hand`, `<pool>:missing`,
/// `system/lost`, `external/disposal` — so a piece going missing is not a
/// deletion, it is a move to the missing place of the same pool.
export interface Movement {
  readonly movement_id: string
  readonly movement_group_id: string
  readonly subject_id: string
  readonly epc: string | null
  readonly sku_code: string | null
  readonly quantity: number
  readonly from: string
  readonly to: string
  /// A string, not the generated `MovementCause` — see the head of this file.
  readonly cause: string
  readonly reference_type: string | null
  readonly reference_id: string | null
  readonly allotment_id: string | null
  readonly allotment_line_id: string | null
  readonly destination_type: string | null
  readonly destination_id: string | null
  readonly actor_id: string
  /// When it happened, as the poster claims it.
  readonly occurred_at: string
  /// When the ledger heard about it. The two differ for anything synced.
  readonly recorded_at: string | null
}

/// `GET /api/v1/inventory/movements` — `{ items, limit }`, no cursor, no total.
export interface MovementList {
  readonly items: readonly Movement[]
  /// The clamp the server applied: `limit.unwrap_or(100).clamp(1, 500)`.
  readonly limit: number
}

// ── sightings ──────────────────────────────────────────────────────────────

/// A tag a reader saw. **Evidence, never a movement.**
export interface Observation {
  readonly observation_id: string
  readonly subject_id: string | null
  readonly epc: string
  readonly sku_code: string | null
  readonly pool_id: string | null
  readonly site_id: string | null
  readonly device_id: string | null
  readonly antenna: number | null
  readonly method: string | null
  readonly read_count: number
  readonly best_rssi: number | null
  readonly first_seen_at: string
  readonly last_seen_at: string
  readonly reader_session_id: string | null
  readonly received_at: string | null
}

/// A tag last seen somewhere the books do not have it.
export interface ObservationAnomaly {
  /// Always `PLACEMENT_MISMATCH` today; drawn as itself if that changes.
  readonly type: string
  readonly subject_id: string
  readonly epc: string | null
  readonly quantity: number
  readonly ledger_pool: string
  readonly observed_pool: string
  readonly device_id: string | null
  readonly last_observed_at: string | null
  /// **Hardcoded `false` by the server**, and the claim this module rests on:
  /// no amount of reading a tag in the wrong aisle moves it in the ledger.
  readonly automatic_inventory_effect: boolean
}

// ── missing ────────────────────────────────────────────────────────────────

/// A positive balance sitting in a pool's `:missing` place.
///
/// There is no missing *status* to filter by — this list **is** that set, and
/// resolving one removes the row rather than restatusing it.
export interface MissingItem {
  /// `subject_uuid@pool_id`. The server parses it back apart on resolution.
  readonly id: string
  readonly subject_id: string
  readonly subject_type: string
  readonly epc: string | null
  readonly barcode: string | null
  readonly sku_code: string | null
  readonly quantity: number
  readonly origin_pool: string
  readonly pool_label: string
  readonly site_id: string
  readonly status: string
  readonly missing_since: string | null
  readonly age_hours: number | null
  readonly last_observation: string | null
  readonly latest_count_id: string | null
  readonly latest_count_status: string | null
}

// ── counts ─────────────────────────────────────────────────────────────────

/// One official count on the board.
export interface CountRow {
  readonly id: string
  readonly pool_id: string
  readonly site_id: string
  /// `FULL`, `CYCLE`, `TARGETED`.
  readonly kind: string
  /// `DRAFT` → `ACTIVE` → `REVIEW` → `CLOSED`, and nothing else.
  readonly status: string
  readonly reason: string
  readonly created_by: string
  readonly created_at: string
  readonly activated_at: string | null
  readonly submitted_at: string | null
  readonly closed_at: string | null
  readonly expected: number
  readonly found: number
  /// `CLOUD` or `EDGE_DC` — **who does the counting**, decided at activation.
  /// With a DC owner the cloud snapshots nothing, sends a command, and every
  /// later step is that node's.
  readonly execution_authority: string
  readonly comparison_authority: string
  readonly adjustment_id: string | null
  readonly adjustment_command_id: string | null
  readonly edge_result_id: string | null
  readonly edge_adjustment_status: string | null
  readonly edge_adjustment_completion_id: string | null
}

/// `GET /api/v1/inventory/counts` — four buckets, **not** an `items` array.
/// Each is `LIMIT 200` in the SQL and no parameter changes that.
export interface CountBoard {
  readonly drafts: readonly CountRow[]
  readonly active: readonly CountRow[]
  readonly needs_review: readonly CountRow[]
  readonly history: readonly CountRow[]
}

export interface CountLine {
  readonly subject_id: string
  readonly epc: string | null
  readonly sku_code: string | null
  readonly expected_quantity: number
  readonly found_quantity: number
}

export interface CountSummary {
  readonly expected: number
  readonly found: number
  readonly match_subjects: number
  readonly shortage_subjects: number
  readonly gain_subjects: number
}

/// `GET /api/v1/inventory/counts/{id}`.
export interface CountDetail extends CountRow {
  readonly summary: CountSummary
  readonly lines: readonly CountLine[]
  readonly scope: { readonly sku_ids: readonly string[] } | null
  readonly activation_command_id: string | null
  readonly activation_target_origin_id: string | null
  readonly adjustment_target_origin_id: string | null
  readonly edge_result_received_at: string | null
  readonly edge_adjustment_received_at: string | null
}

// ── transfer reconciliation ────────────────────────────────────────────────

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
export interface Reconciliation {
  /// `MATCHED` | `DC_ONLY` | `STORE_ONLY` | `UNRESOLVED` | `CONFLICT`.
  readonly status: string
  readonly source_dc_id: string | null
  readonly destination_store_id: string
  readonly shipment_reference: string | null
  readonly epc: string
  readonly sku_code: string | null
  readonly sku_codes: readonly string[]
  readonly in_transit_claim_count: number
  readonly received_claim_count: number
  /// A matched receipt still has to be tied back to the allotment line that
  /// promised it. Unattributed means the goods arrived and nothing knows what
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

// ── ledger control ─────────────────────────────────────────────────────────

/// One (subject, place) row where the ledger and the projection it is supposed
/// to have produced disagree. `difference` is ledger minus projection, so a
/// positive number is stock the projection has lost.
export interface ProjectionDifference {
  readonly subject_id: string
  readonly place_id: string
  readonly ledger_quantity: number
  readonly projection_quantity: number
  readonly difference: number
}

/// The same disagreement at an outbound stage rollup: a stage total that does
/// not equal the sum of its destination leaves.
export interface RollupDifference {
  readonly parent_pool_id: string
  readonly state: string
  readonly ledger_quantity: number
  readonly projection_quantity: number
  readonly difference: number
}

/// `GET /api/v1/inventory/control`.
export interface ControlStatus {
  readonly ledger_fact_count: number
  readonly projection_difference_count: number
  readonly outbound_rollup_status: string
  readonly outbound_rollup_difference_count: number
  /// `HEALTHY` when both the row-level and the rollup comparisons match.
  readonly ledger_health: string
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

// ── time machine ───────────────────────────────────────────────────────────

export interface TimeMachineViolation {
  readonly fact_sequence: number
  readonly subject_id: string
  readonly place_id: string
  readonly invariant: string
  readonly detail: string
}

export interface TimeMachinePosition {
  readonly subject_id: string
  readonly place_id: string
  readonly quantity: number
  readonly last_fact_sequence: number
}

/// `GET /api/v1/inventory/time-machine/state?seq=…` — the ledger folded up to a
/// fact SEQUENCE rather than a clock, so a backdated `occurred_at` cannot
/// quietly change what "then" meant.
export interface TimeMachineState {
  readonly as_of_fact_sequence: number | null
  readonly events_applied: number
  /// The whole world's fingerprint at that point.
  readonly state_hash: string
  readonly items: readonly TimeMachinePosition[]
  readonly violations: readonly TimeMachineViolation[]
  /// The timeline hit the server's 100 000-row cap. What is below it is still
  /// exact; what is above it is simply absent.
  readonly truncated: boolean
  readonly read_only: boolean
}

export interface TimeMachineDelta {
  readonly subject_id: string
  readonly place_id: string
  readonly diffs: readonly {
    readonly field: string
    readonly ledger: unknown
    readonly projection: unknown
  }[]
}

/// `GET /api/v1/inventory/time-machine/divergence`.
export interface TimeMachineDivergence {
  /// `MATCH` or `DIVERGENCE`.
  readonly status: string
  readonly ledger_events: number
  readonly divergent_subjects: number
  /// The first 25, each with its canonical history. Past that the COUNT is the
  /// answer and the histories are not.
  readonly reported: readonly TimeMachineDelta[]
  readonly reported_truncated: boolean
  readonly ledger_violations: readonly TimeMachineViolation[]
  readonly ledger_truncated: boolean
  readonly read_only: boolean
}

/// `GET /api/v1/inventory/time-machine/sync-divergence` — **both `origin_id`
/// and `generation` are required**; the route 400s without either, which is why
/// the screen does not ask until it has both.
export interface SyncDivergence {
  /// `MATCH`, `DIVERGENCE`, or `EMPTY` — neither log holds this stream, which
  /// is usually a generation typed one too high rather than a fault.
  readonly status: string
  readonly origin_id: string
  readonly generation: number
  readonly detail?: string
  readonly edge_events?: number
  readonly cloud_events?: number
  readonly edge_last_fact_seq?: number
  readonly cloud_last_fact_seq?: number
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

// ── availability ───────────────────────────────────────────────────────────

/// What one pool can still promise, for one SKU.
export interface AvailabilityItem {
  readonly sku_id: string
  readonly sku_code: string
  readonly article_id: string
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string | null
  readonly image_url: string | null
  readonly tags: readonly string[]
  readonly purchase_order_ids: readonly string[]
  readonly colour: string | null
  readonly size: string | null
  readonly stock_qty: number
  readonly allotted_qty: number
  /// The decision figure, and the one that can go negative: allotting is a
  /// promise, and a pool is allowed to find out it has promised more than it
  /// holds.
  readonly on_hand_qty: number
  readonly missing_qty: number
}

/// `GET /api/v1/inventory/availability` — the **only** keyset-paged inventory
/// route: `cursor` on `sku_code`, `q` on the server, and a `total_items` from
/// a `COUNT(*) OVER()` rather than a page count.
export interface Availability {
  readonly source_site_id: string
  readonly source_pool_id: string
  readonly source_pool_label: string
  readonly source_place_id: string
  readonly as_of: string
  readonly inventory_equation: string
  /// Over every SKU that MATCHES, not over the page.
  readonly total_items: number
  readonly stock_qty: number
  readonly allotted_qty: number
  readonly on_hand_qty: number
  readonly missing_qty: number
  readonly limit: number
  /// The last row's `sku_code`, or null on the final page.
  readonly next_cursor: string | null
  readonly items: readonly AvailabilityItem[]
}
