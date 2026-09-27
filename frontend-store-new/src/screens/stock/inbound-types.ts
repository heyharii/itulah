/// The store Edge's inbound read — `GET /api/v1/store/inbound` and
/// `GET /api/v1/store/inbound/{delivery_id}` — declared by hand.
///
/// TEMPORARY. These are generated from the Rust (`ts-rs`) into
/// `frontend-contract/src/contract/StoreInbound*.ts` once the backend lands;
/// when they appear, delete this file and import the same names from
/// `@itulah/contract`. They are written field for field against that contract
/// so the switch is an import line and nothing else.

export type StoreInboundStatus = "IN_TRANSIT" | "RECEIVED"

/// What the handheld's count came to, against what was packed. Null while the
/// delivery is in transit: the shop counts blind, and the node does not send
/// the packed quantities until the count is in.
export type StoreInboundResult = {
  expected_units: number
  received_units: number
  missing_units: number
  extra_units: number
}

export type StoreInboundDelivery = {
  delivery_id: string
  /// The surat jalan number, when the DC gave one.
  shipment_reference: string | null
  source_site_id: string
  departed_at: string
  status: StoreInboundStatus
  koli_count: number
  received_at: string | null
  received_by: string | null
  result: StoreInboundResult | null
}

export type StoreInboundList = { deliveries: Array<StoreInboundDelivery> }

/// One SKU of a received delivery. Empty while in transit, for the same reason
/// the result is null.
export type StoreInboundLine = {
  sku_code: string
  name: string | null
  expected: number
  received: number
  missing: number
  extra: number
  missing_epcs: Array<string>
  extra_epcs: Array<string>
}

export type StoreInboundDetail = {
  delivery: StoreInboundDelivery
  lines: Array<StoreInboundLine>
  /// Tags the handheld read that were not counted either way.
  skipped_epcs: Array<string>
}

// `StoreInboundReceiveRequest` is deliberately not declared: it is what the
// handheld sends when it finishes a sweep, and this app never sends it.
