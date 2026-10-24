import { queryOptions, useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import { cloud } from "@/lib/cloud"

/// What Merchandise asked this shop to send back to head office.
///
/// Hand-written against the store-returns contract in
/// `docs/goods-flow-build-2026-10.md`; the shop never starts a return, it only
/// answers one with **Sent**.

export interface StoreReturnLine {
  readonly sku_code: string
  readonly name: string | null
  readonly quantity: number
}

export interface StoreReturnAsk {
  readonly allotment_id: string
  readonly allotment_number: string
  readonly requested_at: string
  readonly quantity: number
  readonly lines: readonly StoreReturnLine[]
}

export interface StoreReturnSent {
  readonly shipment_number: string
  readonly quantity: number
}

export const returnsKey = () => ["store", "returns"] as const

export function fetchReturns(signal?: AbortSignal): Promise<StoreReturnAsk[]> {
  return node
    .get<{ items: StoreReturnAsk[] }>("/api/v1/store/return-requests", { signal })
    .then((body) => body.items)
}

/// Picks, packs, seals and dispatches the whole request in one act.
/// `tripNote` is who carries it — courier, plate, driver — as one note.
export function sendReturn(
  allotmentId: string,
  idempotencyKey: string,
  tripNote?: string,
  signal?: AbortSignal,
): Promise<StoreReturnSent> {
  return node.post<StoreReturnSent>(
    `/api/v1/store/return-requests/${encodeURIComponent(allotmentId)}/send`,
    { idempotency_key: idempotencyKey, trip_note: tripNote ?? null },
    { signal },
  )
}

export const returnsQuery = () =>
  queryOptions({
    queryKey: returnsKey(),
    queryFn: ({ signal }) => fetchReturns(signal),
  })

export function useReturns() {
  return useQuery({ ...returnsQuery(), refetchInterval: 30_000 })
}

/// Open requests, for the sidebar's badge.
export function useOpenReturns(): number {
  return useReturns().data?.length ?? 0
}

/// The return a shop's Send of its reject stands on, raised at head office
/// through the node's relay (`POST /api/v1/inventory/store-returns/reject`).
/// The site is the node's own; the activation then reaches this node like any
/// return, and the shop sends it with `sendReturn`.
export interface RaisedReturn {
  readonly id: string
  readonly allotment_number: string
}

/// To be returned's three pockets, as the centre names them.
export type ToReturnPocket = "reject" | "over_delivery" | "return_ho"

export function raiseRejectReturn(
  pocket: ToReturnPocket,
  lines: readonly { sku_code: string; quantity: number }[],
  idempotencyKey: string,
): Promise<RaisedReturn> {
  return cloud.post<RaisedReturn>("/api/v1/inventory/store-returns/reject", {
    pocket,
    lines,
    idempotency_key: idempotencyKey,
  })
}
