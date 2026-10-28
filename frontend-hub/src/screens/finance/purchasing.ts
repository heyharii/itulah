import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo } from "react"

import { label, type Tone } from "@/lib/format"
import {
  financeKeys,
  listBills,
  listGiros,
  listPayments,
  openPayables,
  partyMovements,
  projectionBillsQuery,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { useSuppliers } from "@/screens/finance/hooks"
import { useDeliveryNumber } from "@/screens/finance/measures"
import type { GiroRow, PartyMovements, SupplierBill } from "@itulah/contract"

/// What 7Soft's Pembelian menus say about a bill, said from the hub's own
/// facts (Faktur Pembelian 4.4, Info Pembelian 4.1, Laporan Pembelian 4.6).
///
/// 7Soft has two bill words, NEW and LUNAS. The hub knows a third thing the
/// paper never did — a bill can be recorded and held back from the books — so
/// those two stay as the hub says them (Draft, Matched) and every bill that is
/// in the books carries 7Soft's payment word: New while nothing has been paid,
/// Part paid, then Lunas. The word is derived on every read from
/// `payment_state`, which the server derives from the allocations of posted
/// payments; nothing here is stored.

export const NEW = "New"
export const PART_PAID = "Part paid"
export const LUNAS = "Lunas"

/// The words a status filter can pick, and the server status each one asks
/// for. New, Part paid and Lunas are all POSTED bills; the browser narrows
/// them further, the server is only asked for the slice it can answer.
export const SERVER_STATUS_OF_WORD: Readonly<Record<string, string>> = {
  [NEW]: "POSTED",
  [PART_PAID]: "POSTED",
  [LUNAS]: "POSTED",
  Draft: "DRAFT",
  Matched: "MATCHED",
  Posted: "POSTED",
}

export function billStatus(
  bill: Pick<SupplierBill, "status" | "payment_state">
): { readonly word: string; readonly tone: Tone } {
  const status = bill.status.toUpperCase()
  if (status !== "POSTED") {
    return {
      word: label(status),
      tone: status === "DRAFT" ? "warn" : "neutral",
    }
  }
  switch (bill.payment_state.toUpperCase()) {
    case "PAID":
      return { word: LUNAS, tone: "ok" }
    case "PARTIALLY_PAID":
      return { word: PART_PAID, tone: "info" }
    default:
      return { word: NEW, tone: "neutral" }
  }
}

/// Invoice Retur Beli's status is 7Soft's: New while the return is owed back
/// to us, Lunas once the money has come. A note that is in the books and has
/// not been refunded is still a credit nobody has collected, so it is New —
/// the same word a bill carries until it is paid. A draft is not in the books
/// at all, which 7Soft has no word for, so it keeps the hub's.
export function noteStatus(status: string): {
  readonly word: string
  readonly tone: Tone
} {
  const key = status.toUpperCase()
  return key === "DRAFT"
    ? { word: "Draft", tone: "warn" }
    : key === "REFUNDED"
      ? { word: "Lunas", tone: "ok" }
      : { word: "New", tone: "neutral" }
}

/// What 7Soft's Tipe Invoice says about a bill. MATCHING is a bill tied to
/// the deliveries it answers (somebody matched it, so it has item lines);
/// STANDARD is every other bill, an expense or a bill nobody has matched.
/// UANG MUKA is an advance, which the hub keeps as its own document
/// (`supplier-advances`) and not as a bill, so no bill reads so.
export function invoiceType(bill: Pick<SupplierBill, "matched_at">): string {
  return bill.matched_at === null ? "STANDARD" : "MATCHING"
}

/// 7Soft's Lokasi and Gudang for a site: the unit it belongs to, and the
/// site's own name. A unit that keeps one site names both the same.
export function useSiteParts(): {
  readonly lokasi: (siteId: string | null | undefined) => string
  readonly gudang: (siteId: string | null | undefined) => string
} {
  const units = useUnits()
  return useMemo(() => {
    const find = (siteId: string | null | undefined) => {
      for (const unit of units.data ?? [])
        for (const site of unit.sites)
          if (site.id === siteId) return { unit, site }
      return null
    }
    return {
      lokasi: (siteId) => find(siteId)?.unit.name ?? "—",
      gudang: (siteId) => find(siteId)?.site.name ?? "—",
    }
  }, [units.data])
}

/// The giro each supplier payment was written on, by payment id: 7Soft's Giro
/// No and Giro JTempo on a Pelunasan row. A payment by cash or transfer has
/// none.
export function useGiroOfPayment(): ReadonlyMap<string, GiroRow> {
  const giros = useQuery({
    queryKey: [...financeKeys.all, "giros", "out", "all"],
    queryFn: ({ signal }) =>
      listGiros({ direction: "OUT", limit: 500 }, signal),
    staleTime: 60_000,
  })
  return useMemo(
    () =>
      new Map(
        (giros.data ?? []).flatMap((giro) =>
          giro.supplier_payment_id === null
            ? []
            : [[giro.supplier_payment_id, giro] as const]
        )
      ),
    [giros.data]
  )
}

/// The calendar day of an ISO date or timestamp.
const dayOf = (iso: string): string => iso.slice(0, 10)

/// Jangka waktu, the way 7Soft names a term: T21 is twenty-one days from the
/// invoice date to the due date. A bill has no term of its own on the wire, so
/// it is read off the two dates it does carry.
export function termOf(
  bill: Pick<SupplierBill, "invoice_date" | "due_date">
): string | null {
  if (bill.due_date === null) return null
  const days = Math.round(
    (Date.parse(dayOf(bill.due_date)) - Date.parse(dayOf(bill.invoice_date))) /
      86_400_000
  )
  return Number.isFinite(days) && days >= 0 ? `T${days}` : null
}

/// PPN as 7Soft's list shows it: the tax code (PPN0, PPN10), here the code the
/// rate implies — a bill carries the tax in rupiah, not the code it was keyed
/// under.
export function ppnCode(
  bill: Pick<SupplierBill, "subtotal_minor" | "discount_minor" | "tax_minor">
): string {
  const base = bill.subtotal_minor - bill.discount_minor
  if (bill.tax_minor === 0 || base <= 0) return "PPN0"
  return `PPN${Math.round((bill.tax_minor / base) * 100)}`
}

/// The bills whose invoice date falls in a window, newest first, read as far
/// back as the window needs and no further. `GET /finance/bills` takes no date
/// range, so the register is read a page at a time in date order and the
/// window is cut from it here; reading stops at the first page that reaches
/// past `from`.
export function useBillsInWindow(supplier: string, from: string, to: string) {
  const query = useInfiniteQuery({
    queryKey: [...financeKeys.bills(null), "window", supplier],
    queryFn: ({ pageParam, signal }) =>
      listBills(
        {
          supplier: supplier === "" ? undefined : supplier,
          sort: "date",
          dir: "desc",
          limit: 100,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const loaded = query.data?.pages.flatMap((page) => page.rows) ?? []
  const oldest = loaded.length === 0 ? null : loaded[loaded.length - 1]
  const reached = oldest !== null && dayOf(oldest.invoice_date) < from
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !reached) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, reached, fetchNextPage])
  const rows = loaded.filter((bill) => {
    const date = dayOf(bill.invoice_date)
    return date >= from && date <= to
  })
  return {
    query,
    rows,
    /// Whether every bill the window can hold has been read.
    complete: !hasNextPage || reached,
  }
}

/// One supplier's movements over a window, for every supplier the company
/// has: 7Soft's Summary Hutang is one row of these per supplier.
///
/// The supplier book is a few dozen rows, so each is asked for its own ledger
/// (`GET /payment-ledger/SUPPLIER/{code}/movements`) — the figures are the
/// ledger's and nothing is added up from bills here.
export interface SupplierMovement {
  readonly code: string
  readonly name: string
  readonly movements: PartyMovements | undefined
}

export function useSupplierMovements(
  from: string,
  to: string,
  unit: string
): { readonly rows: readonly SupplierMovement[]; readonly pending: boolean } {
  const suppliers = useSuppliers()
  const book = suppliers.data ?? []
  return useQueries({
    queries: book.map((supplier) => ({
      queryKey: financeKeys.partyMovements(
        "SUPPLIER",
        supplier.supplier_code,
        from,
        to,
        unit === "" ? null : unit
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        partyMovements(
          "SUPPLIER",
          supplier.supplier_code,
          { from, to, unit: unit === "" ? undefined : unit },
          signal
        ),
      staleTime: 60_000,
      enabled: from <= to,
    })),
    combine: (results) => ({
      rows: results.map((result, index) => ({
        code: book[index].supplier_code,
        name: book[index].name,
        movements: result.data,
      })),
      pending: suppliers.isPending || results.some((r) => r.isPending),
    }),
  })
}

/// Where a payment, bill or supplier is opened from this screen: the bills and
/// payments screens own their sheets, so these go to them.
export function useInfoOpeners() {
  const navigate = useNavigate()
  return {
    bill: (id: string) =>
      navigate({
        to: "/finance/payables/bills",
        search: { bill: id },
      } as never),
    payment: (id: string) =>
      navigate({
        to: "/finance/payables/payments",
        search: { payment: id },
      } as never),
    giro: () => navigate({ to: "/finance/cash-bank/giro" } as never),
    /// 7Soft's Nota Pembelian Baru and Retur Pembelian Baru: the two screens
    /// that write them, opened on a blank form. `bill=new` is the sheet key
    /// those screens already read for a record, here meaning "a new one".
    newInvoice: () =>
      navigate({
        to: "/finance/payables/purchase-invoice",
        search: { bill: "new" },
      } as never),
    newReturn: () =>
      navigate({
        to: "/finance/payables/credit-notes",
        search: { bill: "new" },
      } as never),
    newSupplier: () => navigate({ to: "/master/suppliers" } as never),
  }
}

/// One bill settled by one payment — 7Soft's Pelunasan row: voucher, invoice,
/// bank, the invoice's value, the discount (Potongan) and what was paid.
export interface SettlementLine {
  readonly id: string
  readonly date: string
  readonly voucher: string
  readonly invoice: string
  readonly invoiceId: string
  readonly bank: string
  readonly supplierId: string
  readonly supplierName: string | null
  readonly invoiceTotal: number
  readonly discount: number
  readonly paid: number
  readonly reference: string
  readonly paymentId: string
}

/// The posted payments of a window, a page at a time, as one row per bill they
/// settled. `supplier` narrows on the allocations — one bank line settling two
/// suppliers is an ordinary Friday — so it is applied again to the rows here.
export function useSettlementLines(
  supplier: string,
  from: string,
  to: string,
  /// Read every page, for a report that is drawn whole.
  all = false
) {
  const query = useInfiniteQuery({
    queryKey: [
      ...financeKeys.payments(
        "POSTED",
        null,
        supplier === "" ? null : supplier
      ),
      "settlements",
      from,
      to,
    ],
    queryFn: ({ pageParam, signal }) =>
      listPayments(
        {
          status: "POSTED",
          supplier: supplier === "" ? undefined : supplier,
          from,
          to,
          sort: "date",
          dir: "desc",
          limit: 100,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: from <= to,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (all && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [all, hasNextPage, isFetchingNextPage, fetchNextPage])
  const rows = useMemo<SettlementLine[]>(
    () =>
      (query.data?.pages ?? []).flatMap((page) =>
        page.rows.flatMap((payment) =>
          payment.allocations
            .filter((one) => supplier === "" || one.supplier_id === supplier)
            .map((one) => ({
              id: `${payment.payment_id}:${one.invoice_id}`,
              date: payment.payment_date,
              voucher: payment.payment_number,
              invoice: one.invoice_number,
              invoiceId: one.invoice_id,
              bank: payment.account_name ?? payment.method,
              supplierId: one.supplier_id,
              supplierName: one.supplier_name,
              invoiceTotal: one.invoice_total_minor,
              discount: one.discount_minor,
              paid: one.amount_minor - one.discount_minor,
              reference: payment.reference ?? "",
              paymentId: payment.payment_id,
            }))
        )
      ),
    [query.data, supplier]
  )
  return { query, rows }
}

/// One open item of the payables as at a day: a bill, or a delivery whose bill
/// has not come.
export interface OpenItem {
  readonly id: string
  readonly supplierId: string
  readonly supplierName: string | null
  readonly number: string
  readonly date: string
  readonly due: string | null
  readonly total: number
  readonly paid: number
  readonly left: number
  /// Days past due as at the day asked; negative when not yet due.
  readonly age: number
}

/// Everything owed to suppliers as at a day, one row per bill or delivery. The
/// amounts and ages are the payment ledger's, wound back to `asOf`; the number
/// of a bill is looked up in the posted register, and a delivery's in the
/// unbilled list.
export function useOpenItems(asOf: string, unit: string) {
  const ledger = useQuery({
    queryKey: [...financeKeys.all, "open-payables", asOf, unit],
    queryFn: ({ signal }) =>
      openPayables(
        { as_of: asOf, unit: unit === "" ? undefined : unit },
        signal
      ),
  })
  const bills = useQuery(projectionBillsQuery("POSTED"))
  const deliveryNumber = useDeliveryNumber()
  const items = useMemo<OpenItem[]>(() => {
    const numbers = new Map(
      (bills.data ?? []).map((bill) => [bill.invoice_id, bill.invoice_number])
    )
    return (ledger.data?.items ?? [])
      .filter((entry) => entry.outstanding_minor !== 0)
      .map((entry) => ({
        id: entry.entry_id,
        supplierId: entry.party_id,
        supplierName: entry.party_name,
        number:
          entry.voucher_kind === "SUPPLIER_INVOICE"
            ? (numbers.get(entry.voucher_id) ?? entry.entry_number ?? "—")
            : deliveryNumber(entry.voucher_id, entry.entry_number),
        date: entry.posting_date,
        due: entry.due_date,
        total: entry.amount_minor,
        paid: entry.settled_minor,
        left: entry.outstanding_minor,
        age: entry.age_days,
      }))
  }, [ledger.data, bills.data, deliveryNumber])
  return { ledger, items, pending: ledger.isPending || bills.isPending }
}

// ---------------------------------------------------------------------------
// The Bills and Suppliers registers (the final Finance prototype)
// ---------------------------------------------------------------------------

/// Is money still owed on it: in the books and not paid in full.
export const isOpenBill = (bill: SupplierBill): boolean =>
  bill.status.toUpperCase() === "POSTED" && bill.outstanding_minor > 0

/// Late, and still owed.
export const isOverdueBill = (bill: SupplierBill): boolean =>
  isOpenBill(bill) && bill.days_overdue > 0

/// Due within the next seven days, not yet late.
export const isDueThisWeek = (bill: SupplierBill): boolean =>
  isOpenBill(bill) && bill.days_overdue <= 0 && bill.days_overdue >= -7

/// The register's filter keys.
export type BillKey = "new" | "part" | "lunas" | "bounced" | "overdue" | "draft"

/// The prototype's bill state, in the order it decides: a bounced giro first,
/// then paid, part paid, late, new. A bill not yet in the books is a draft.
export function billKey(
  bill: SupplierBill,
  bounced: ReadonlySet<string>
): BillKey {
  if (bill.status.toUpperCase() !== "POSTED") return "draft"
  if (bounced.has(bill.invoice_id) && bill.outstanding_minor > 0)
    return "bounced"
  if (bill.outstanding_minor <= 0) return "lunas"
  if (bill.paid_minor > 0) return "part"
  if (bill.overdue || bill.days_overdue > 0) return "overdue"
  return "new"
}

export function billWord(
  bill: SupplierBill,
  bounced: ReadonlySet<string>
): { readonly word: string; readonly tone: Tone; readonly key: BillKey } {
  const key = billKey(bill, bounced)
  switch (key) {
    case "bounced":
      return { word: "Giro bounced", tone: "bad", key }
    case "lunas":
      return { word: LUNAS, tone: "ok", key }
    case "part":
      return { word: PART_PAID, tone: "warn", key }
    case "overdue":
      return { word: "Overdue", tone: "bad", key }
    case "draft":
      return { ...billStatus(bill), key }
    default:
      return { word: NEW, tone: "info", key }
  }
}

/// Every bill, newest first, every page read: the register filters, ticks
/// and totals in the browser, so it needs the whole book. Reads again every
/// 10 seconds while looked at.
export function useAllBills() {
  const query = useInfiniteQuery({
    queryKey: [...financeKeys.bills(null), "register-all"],
    queryFn: ({ pageParam, signal }) =>
      listBills(
        { sort: "date", dir: "desc", limit: 200, cursor: pageParam },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: 10_000,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.rows) ?? [],
    [query.data]
  )
  return { query, rows, complete: !hasNextPage }
}

/// The payment register, the latest two hundred: what paid a bill, and which
/// bills a bounced giro left open.
export function usePaymentBook() {
  return useQuery({
    queryKey: financeKeys.payments(null, null, null),
    queryFn: ({ signal }) =>
      listPayments({ limit: 200 }, signal).then((page) => page.rows),
    staleTime: 30_000,
  })
}

/// The invoices a rejected giro had paid and that are still owed.
export function useBouncedInvoices(): ReadonlySet<string> {
  const payments = usePaymentBook()
  const giroOf = useGiroOfPayment()
  return useMemo(() => {
    const out = new Set<string>()
    for (const payment of payments.data ?? []) {
      const giro = giroOf.get(payment.payment_id)
      if (giro !== undefined && giro.status.toUpperCase() === "REJECTED")
        for (const one of payment.allocations) out.add(one.invoice_id)
    }
    return out
  }, [payments.data, giroOf])
}

/// Pay opens the BKK form with the supplier and the bills ticked. The form
/// reads `supplier` and `bills` (comma-separated invoice ids) when it can.
export function usePayBills() {
  const navigate = useNavigate()
  return (supplierCode: string, invoiceIds: readonly string[]) =>
    navigate({
      to: "/finance/cash-bank/bkk/new",
      search: { supplier: supplierCode, bills: invoiceIds.join(",") },
    } as never)
}
