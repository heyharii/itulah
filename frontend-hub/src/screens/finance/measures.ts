import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"

import { count } from "@/lib/format"
import {
  financeKeys,
  goodsInTransitQuery,
  openDeliveriesQuery,
  payablesAgingQuery,
  stockVsLedgerQuery,
  unbilledReceipts,
  type GoodsInTransitRow,
  type StockLedgerUnitRow,
} from "@/lib/queries/finance"
import { todayIso } from "@/screens/finance/chart"
import type { AgingBuckets } from "@itulah/contract"

/// The figures Finance quotes on more than one screen, each defined ONCE.
///
/// Two screens that draw the same word from two different reads will, one
/// day, draw two different numbers; the audit of 6 Oct 2026 found exactly that
/// (the Overview said "Total payables Rp 0 / Nothing is late" over an ageing
/// card that said Rp 52,9 jt). So a measure is a hook in this file, a screen
/// calls the hook, and the sentence below says what the number is.
///
/// # Total payables
///
/// What the company owes its suppliers as at a day, for all units or one:
/// the posted supplier bills that are still unpaid, plus the goods received
/// that no bill covers yet (the receipt is the debt until its bill arrives —
/// `payables_aging`'s `open_receipt` leg). Held bills are left out and
/// counted on their own (`on_hold_*`); a giro that has been issued is left
/// out too, because issuing it moved the debt from the supplier to the
/// instrument. The figure is `PayablesAging.total.total_minor` and nothing
/// else: no screen adds up a bill list and calls it payables.
///
/// # Overdue
///
/// The part of Total payables whose due date has passed: everything but the
/// "not due" bucket. A bill falling due today is not yet overdue.
///
/// # Open items
///
/// What the count beside Total payables counts — a bill, or a delivery still
/// waiting for its bill. Never "bills": the rig owes Rp 52.946.430 on 13 open
/// items and has no supplier bill at all.
///
/// # Inventory value
///
/// What the stock is worth at cost, each piece counted once: set-up stock on
/// hand, plus what is received and waiting to be set up, plus what is in
/// transit (sent, not yet counted in, or short at the count).

// ── payables ─────────────────────────────────────────────────────────────

/// The ageing's five columns, worded once. `label` is the full word, `short`
/// the table-header form; both say "90+", never "> 90".
export const AGEING_BUCKETS = [
  { key: "not_due_minor", label: "Not due", short: "Not due" },
  { key: "days_1_30_minor", label: "1–30 days", short: "1–30" },
  { key: "days_31_60_minor", label: "31–60 days", short: "31–60" },
  { key: "days_61_90_minor", label: "61–90 days", short: "61–90" },
  { key: "days_over_90_minor", label: "90+ days", short: "90+" },
] as const satisfies readonly {
  key: keyof Omit<AgingBuckets, "total_minor">
  label: string
  short: string
}[]

/// Overdue: the part of the total that has fallen due.
export function overdueMinor(buckets: AgingBuckets): number {
  return buckets.total_minor - buckets.not_due_minor
}

/// "13 open items" — see the header for why it is never "bills".
export function openItemsText(n: number): string {
  return `${count(n)} open ${n === 1 ? "item" : "items"}`
}

/// Total payables, as the server's ageing. Asked for an explicit day (the
/// browser's today unless a screen picks another) so every screen that reads
/// "today" holds one cache entry and one answer.
export function usePayables(options: { unit?: string; asOf?: string } = {}) {
  const asOf = options.asOf ?? todayIso()
  const unit = options.unit ?? ""
  return useQuery(payablesAgingQuery(asOf, unit || null))
}

/// The deliveries inside Total payables, one row each — the open goods
/// receipts of the payment ledger. Pair of `usePayables`: together with the
/// posted bills they are the ageing's population.
export function useOpenDeliveries(
  options: { unit?: string; asOf?: string; enabled?: boolean } = {}
) {
  const asOf = options.asOf ?? todayIso()
  const unit = options.unit ?? ""
  return useQuery({
    ...openDeliveriesQuery(asOf, unit || null),
    enabled: options.enabled ?? true,
  })
}

/// A delivery's own number — the goods receipt, "GRN-HO-GUDANG-000014" — for
/// the ledger item that carries only its journal number. Falls back to that
/// journal number while the list is on its way or when the receipt is not on
/// it, so a row never reads as nothing.
export function useDeliveryNumber(): (
  receiptId: string,
  journalNumber: string | null
) => string {
  const unbilled = useQuery({
    queryKey: financeKeys.unbilled(),
    queryFn: ({ signal }) => unbilledReceipts(signal),
  })
  const byId = useMemo(
    () =>
      new Map(
        (unbilled.data ?? []).map((row) => [row.receipt_id, row.receipt_number])
      ),
    [unbilled.data]
  )
  return useCallback(
    (receiptId, journalNumber) =>
      byId.get(receiptId) ?? journalNumber ?? "Delivery",
    [byId]
  )
}

// ── inventory ────────────────────────────────────────────────────────────

/// Inventory value, from the two small reads that already carry its parts —
/// not the article-by-article valuation, which is thousands of rows. The
/// Valuation screen sums its own rows to the same three parts; the two agree
/// because both read the same stock facts, and `Stock vs Ledger` / `Goods in
/// Transit` are the screens that show how each part is made.
///
/// Counted once: Stock vs Ledger's own in-transit columns are not used here,
/// because the sender and the receiver of a box each carry it until it is
/// counted in, and adding the units would count every box twice.
export function useInventoryValue() {
  const stock = useQuery(stockVsLedgerQuery())
  const road = useQuery(goodsInTransitQuery())
  return inventoryValueOf(stock, road)
}

/// The same measure for a screen that reads the two inside a `<Suspense>`
/// (the Overview): the figure is always there, never pending.
export function useInventoryValueNow() {
  const stock = useSuspenseQuery(stockVsLedgerQuery())
  const road = useSuspenseQuery(goodsInTransitQuery())
  return inventoryValueOf(stock, road)
}

function inventoryValueOf(
  stock: {
    data: StockLedgerUnitRow[] | undefined
    isPending: boolean
    isError: boolean
  },
  road: {
    data: GoodsInTransitRow[] | undefined
    isPending: boolean
    isError: boolean
  }
) {
  const pending = stock.isPending || road.isPending
  const failed = stock.isError || road.isError
  if (stock.data === undefined || road.data === undefined)
    return {
      pending,
      failed,
      onHand: undefined,
      awaiting: undefined,
      inTransit: undefined,
      value: undefined,
    }
  const onHand = stock.data.reduce((sum, row) => sum + row.on_hand_minor, 0)
  const awaiting = stock.data.reduce(
    (sum, row) => sum + row.awaiting_setup_minor,
    0
  )
  const inTransit = road.data.reduce((sum, row) => sum + row.value_minor, 0)
  return {
    pending,
    failed,
    onHand,
    awaiting,
    inTransit,
    value: onHand + awaiting + inTransit,
  }
}

// ── number cards ─────────────────────────────────────────────────────────

/// One number card. `change` is the percentage since last month, when the
/// card has one.
export interface NumberCard {
  readonly label: string
  readonly value: number | undefined
  readonly change: number | null
  readonly pending: boolean
}

/// The four cards with nothing in them yet: what a boundary draws while the
/// figures are read, so the row is already the size it will be.
export const PENDING_CARDS: readonly NumberCard[] = [
  "Money in the bank",
  "Total payables",
  "Cash flow this month",
  "Expenses this month",
].map((label) => ({ label, value: undefined, change: null, pending: true }))
