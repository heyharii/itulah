import type { UseQueryResult } from "@tanstack/react-query"
import type { UnfilledList } from "@itulah/contract"
import { useMemo } from "react"

import type { AllotmentList, AllotmentRow } from "@/lib/queries/inventory"
import { sku as skuNumber } from "@/lib/format"

/// Problems: allotments that will not, or did not, arrive in full.
///
/// Gathered from what the Allotments page already reads — no read of its own:
///
/// - **Unfilled** — a store's share the warehouse cannot fill after the count
///   (`/allotments/unfilled`, open lines), still waiting for a Close short;
/// - **Closed short** — the same, once closed (its closed lines);
/// - **Short at store** — an allotment whose store received fewer than were
///   sent (`receiving_gap_qty` on the book's rows);
/// - **Over-promised** — an SKU allotted past what the warehouse holds (the
///   book's `shortages`). It has no allotment of its own, so it names the SKU.

export type ProblemKind =
  "Unfilled" | "Closed short" | "Short at store" | "Over-promised"

export interface ProblemRow {
  readonly key: string
  /// The allotment the sheet opens on; null for an over-promised SKU.
  readonly allotmentId: string | null
  readonly allotment: string
  readonly store: string
  readonly supplier: string
  readonly kind: ProblemKind
  /// The pieces that will not arrive, as a positive number.
  readonly short: number
  /// What was allotted on the rows this problem is about.
  readonly pieces: number
  /// The SKU, for a problem that has no allotment.
  readonly detail: string | null
}

/// Every problem, in the order they want acting on: what can still be closed
/// short first, then what a store found missing, then what is settled.
export function useProblems(
  enabled: boolean,
  unfilled: UseQueryResult<UnfilledList>,
  active: UseQueryResult<AllotmentList>,
  completed: UseQueryResult<AllotmentList>
): readonly ProblemRow[] {
  return useMemo(() => {
    if (!enabled) return []
    const book = [
      ...(active.data?.items ?? []),
      ...(completed.data?.items ?? []),
    ]
    const byId = new Map<string, AllotmentRow>(book.map((one) => [one.id, one]))
    const supplierOf = (id: string) => byId.get(id)?.supplier_names ?? "—"

    /// Lines folded to one row per allotment and store.
    const fold = (
      kind: ProblemKind,
      lines: readonly {
        allotment_id: string
        allotment_number: string
        destination_id: string
        destination_name: string | null
        allotted: number
        short: number
      }[]
    ) => {
      const rows = new Map<string, ProblemRow>()
      for (const line of lines) {
        const key = `${kind}|${line.allotment_id}|${line.destination_id}`
        const was = rows.get(key)
        rows.set(key, {
          key,
          allotmentId: line.allotment_id,
          allotment: line.allotment_number,
          store: line.destination_name ?? line.destination_id,
          supplier: supplierOf(line.allotment_id),
          kind,
          short: (was?.short ?? 0) + line.short,
          pieces: (was?.pieces ?? 0) + line.allotted,
          detail: null,
        })
      }
      return [...rows.values()]
    }

    const open = fold(
      "Unfilled",
      (unfilled.data?.open ?? []).map((one) => ({
        ...one,
        short: one.unfilled,
      }))
    )
    const closed = fold(
      "Closed short",
      (unfilled.data?.closed ?? []).map((one) => ({
        ...one,
        short: one.closed_short,
      }))
    )
    const atStore: ProblemRow[] = book
      .filter((one) => one.receiving_gap_qty > 0)
      .map((one) => ({
        key: `Short at store|${one.id}`,
        allotmentId: one.id,
        allotment: one.allotment_number,
        store: (one.destination_names ?? []).join(", ") || "—",
        supplier: one.supplier_names ?? "—",
        kind: "Short at store",
        short: one.receiving_gap_qty,
        pieces: one.total_quantity,
        detail: null,
      }))
    const over: ProblemRow[] = (active.data?.shortages ?? []).map((one) => ({
      key: `Over-promised|${one.sku_id}`,
      allotmentId: null,
      allotment: "—",
      store: "—",
      supplier: "—",
      kind: "Over-promised",
      short: one.shortage_qty,
      pieces: one.allotted_qty,
      detail: `${one.article_name} · ${skuNumber(one.sku_code)}`,
    }))
    return [...open, ...atStore, ...over, ...closed]
  }, [enabled, unfilled.data, active.data, completed.data])
}
