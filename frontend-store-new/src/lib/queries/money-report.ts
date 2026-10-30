import type { ShiftReturn } from "@itulah/contract"
import { queryOptions, useQueries } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import { node } from "@/lib/api"
import { isoDay } from "@/lib/queries"
import {
  shiftSalesKey,
  type SaleWithPieces,
} from "@/lib/queries/money-declaration"
import { sessionsQuery, usePeople } from "@/lib/queries/sessions"
import { tenderOf } from "@/screens/money/format"

/// The three Finance reports — Sales, Transactions, Payments — read from one
/// set of rows: every sale of every cashier session in a window of days.
///
/// ## Where the rows come from
///
/// Nothing new on the node. The days' sessions are `GET /shifts?business_date=`
/// and each session's sales are `GET /shifts/{id}/sales` (`ShiftSale`: receipt
/// number, time, cashier, total, change, refunded since, and the tenders). Both
/// are the queries the Money declaration already reads, so a page that has
/// been open warm costs no round trip.
///
/// ## What the node has no place for (yet)
///
///  - **Discount** — a sale carries its total, not what was taken off it.
///  - **Pieces** — read from `pcs` when the node sends it (the declaration
///    types it as optional); a sale without it counts as no pieces.
///
/// ## A return (Hari, 30 Oct 2026)
///
/// A transaction of its own, read from `GET /shifts/{id}/returns`: its own
/// receipt number, at the time and drawer it was made, the pieces out less the
/// pieces back, and as net only what the customer paid on top — 0 when the
/// replacement was cheaper or there was none. The struk the pieces came from
/// is never touched, and the replacement sale is not listed again.

/// The longest window read at once: one request per day plus one per session.
export const MAX_DAYS = 31

// ── The filters, shared by the three screens ────────────────────────────────

export interface ReportFilters {
  readonly from: string
  readonly to: string
  readonly cashier: string | null
  readonly payment: string | null
}

let filters: ReportFilters = {
  from: isoDay(new Date()),
  to: isoDay(new Date()),
  cashier: null,
  payment: null,
}
const listeners = new Set<() => void>()

/// Kept in this module, not in a screen, so the period and the cashier survive
/// a move between Sales, Transactions and Payments.
export function setReportFilters(next: Partial<ReportFilters>) {
  filters = { ...filters, ...next }
  for (const listener of listeners) listener()
}

export function useReportFilters(): ReportFilters {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => filters,
    () => filters,
  )
}

// ── The rows ────────────────────────────────────────────────────────────────

export interface Tender {
  /// "Cash", "Debit", "Credit", "QRIS" — as the declaration names them.
  readonly label: string
  readonly cash: boolean
  /// The credit a return carried into its replacement. It is not money: the
  /// till never pays a return out in cash (`runExchange` in the POS), it
  /// records the value back against the replacement sale as an `OTHER`
  /// tender, printed "Return" on the struk. Counting it as EDC and taking the
  /// return off cash is what made Sales show Rp 248.850 less cash than the
  /// drawer held on 30 Oct 2026.
  readonly credit: boolean
  readonly minor: number
}

/// One line of the Transactions list: a sale, or the return made against one.
export interface Tx {
  readonly key: string
  readonly saleId: string
  /// A return opens by its own receipt number: one with no replacement has
  /// no sale to open.
  readonly receiptNo: string | null
  readonly code: string
  readonly kind: "Sale" | "Return"
  /// Local calendar day, `YYYY-MM-DD`.
  readonly day: string
  readonly at: string
  readonly shiftId: string
  readonly cashier: string
  /// The payment column: the one tender, or "A + B" when a basket was split.
  readonly payment: string
  /// What each tender took (cash net of change). A return carries only what
  /// was paid on top; the credit of the pieces back is not money.
  readonly tenders: readonly Tender[]
  readonly pieces: number
  /// Null: the node does not send what was taken off a sale.
  readonly discount: number | null
  /// On a return, what was paid on top of the pieces back.
  readonly net: number
}

export interface ReportRows {
  readonly rows: readonly Tx[]
  /// Distinct shifts that traded, by id, with the day and cashier of each.
  readonly shifts: ReadonlyMap<string, { day: string; cashier: string }>
  readonly loading: boolean
  readonly error: unknown
  readonly blind: boolean
  /// The window was longer than `MAX_DAYS` and only the latest days were read.
  readonly capped: boolean
  readonly from: string
  readonly to: string
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  const cursor = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (cursor <= end) {
    days.push(isoDay(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

const salesOf = (shiftId: string) =>
  queryOptions({
    queryKey: shiftSalesKey(shiftId),
    queryFn: ({ signal }) =>
      node.get<SaleWithPieces[]>(
        `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/sales`,
        { signal },
      ),
    staleTime: 0,
  })

const returnsOf = (shiftId: string) =>
  queryOptions({
    queryKey: [...shiftSalesKey(shiftId), "returns"],
    queryFn: ({ signal }) =>
      node.get<ShiftReturn[]>(
        `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/returns`,
        { signal },
      ),
    staleTime: 0,
  })

function tendersOf(sale: SaleWithPieces): Tender[] {
  let change = sale.change_minor
  return sale.tenders.map((tender) => {
    const cash = tender.method === "CASH"
    // The exchange credit the till puts on a replacement sale. It discharges
    // the return, so it is neither cash in the drawer nor an acquirer's money.
    const credit = tender.method === "OTHER"
    const word = credit
      ? "Return credit"
      : tender.method === "CARD"
        ? tender.card_kind === "CREDIT"
          ? "Credit"
          : "Debit"
        : tenderOf(tender.method).word
    // Change is given out of the cash tender.
    const given = cash ? Math.min(change, tender.amount_minor) : 0
    change -= given
    return {
      label: word,
      cash: cash && !credit,
      credit,
      minor: tender.amount_minor - given,
    }
  })
}

/// Every sale and return of the days in the window, newest first.
export function useReportRows(from: string, to: string): ReportRows {
  const people = usePeople()
  const all = daysBetween(from, to)
  const days = all.slice(-MAX_DAYS)
  const sessions = useQueries({
    queries: days.map((day) => ({
      ...sessionsQuery(day),
      refetchInterval: 30_000,
    })),
  })
  const shifts = sessions.flatMap((one, index) =>
    (one.data?.sessions ?? []).map((session) => ({
      id: session.report.shift_id,
      day: days[index],
      login: session.report.opened_by,
    })),
  )
  const sales = useQueries({
    queries: shifts.map((shift) => ({
      ...salesOf(shift.id),
      refetchInterval: 30_000,
    })),
  })

  const returns = useQueries({
    queries: shifts.map((shift) => ({
      ...returnsOf(shift.id),
      refetchInterval: 30_000,
    })),
  })
  const allSales = new Map(
    sales.flatMap((one) => one.data ?? []).map((sale) => [sale.sale_id, sale]),
  )
  // A replacement sale is its return's row, never a sale of its own.
  const replacements = new Set(
    returns.flatMap((one) =>
      (one.data ?? []).flatMap((back) =>
        back.replacement_sale_id === null ? [] : [back.replacement_sale_id],
      ),
    ),
  )

  const rows: Tx[] = []
  const trading = new Map<string, { day: string; cashier: string }>()
  sales.forEach((one, index) => {
    const shift = shifts[index]
    const cashierOf = people.nameOf(shift.login)
    trading.set(shift.id, { day: shift.day, cashier: cashierOf })
    for (const sale of one.data ?? []) {
      if (sale.status === "VOIDED") continue
      if (replacements.has(sale.sale_id)) continue
      const tenders = tendersOf(sale)
      const payment = tenders.map((tender) => tender.label).join(" + ")
      const base = {
        saleId: sale.sale_id,
        receiptNo: null,
        code: sale.receipt_no,
        day: shift.day,
        at: sale.completed_at,
        shiftId: shift.id,
        cashier: cashierOf,
        payment: payment === "" ? "—" : payment,
        discount: null,
      }
      rows.push({
        ...base,
        key: sale.sale_id,
        kind: "Sale",
        tenders,
        pieces: sale.pcs ?? 0,
        net: sale.total_minor,
      })
    }
    for (const back of returns[index]?.data ?? []) {
      const replacement =
        back.replacement_sale_id === null
          ? undefined
          : allSales.get(back.replacement_sale_id)
      const tenders =
        replacement === undefined
          ? []
          : tendersOf(replacement).filter((tender) => !tender.credit)
      const payment = tenders.map((tender) => tender.label).join(" + ")
      rows.push({
        key: back.return_id,
        saleId: back.replacement_sale_id ?? "",
        receiptNo: back.receipt_no,
        code: back.receipt_no,
        kind: "Return",
        day: shift.day,
        at: back.occurred_at,
        shiftId: shift.id,
        cashier: cashierOf,
        payment: payment === "" ? "—" : payment,
        tenders,
        pieces: back.out_pcs - back.back_pcs,
        discount: null,
        net: back.paid_minor,
      })
    }
  })
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  return {
    rows,
    shifts: trading,
    loading:
      sessions.some((one) => one.isPending) ||
      sales.some((one) => one.isPending) ||
      returns.some((one) => one.isPending),
    error: [...sessions, ...sales].find((one) => one.isError)?.error ?? null,
    blind: sessions.some((one) => one.data?.blind === true),
    capped: all.length > MAX_DAYS,
    from: days[0] ?? from,
    to,
  }
}
