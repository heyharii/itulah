import { dateText } from "@/lib/format"
import type { Tx } from "@/lib/queries/money-report"
import { money, units } from "@itulah/contract/money"

/// The arithmetic and the words the three Finance reports share. Everything is
/// a sum over the rows `useReportRows` read; nothing is estimated.

const at = (iso: string) => new Date(`${iso}T00:00:00`)

/// "29 Oct".
export const dayShort = (iso: string) =>
  dateText(at(iso), { day: "2-digit", month: "short" })

/// "27 Oct – 29 Oct", or one day alone.
export const rangeWords = (from: string, to: string) =>
  from === to ? dayShort(from) : `${dayShort(from)} – ${dayShort(to)}`

/// "29 Oct 21:37".
export const stampWords = (iso: string) =>
  dateText(new Date(iso), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(",", "")

/// A rupiah figure with its sign on it: a return is "−Rp 36.000".
export const signedMoney = (minor: number) =>
  minor < 0 ? `−${money(-minor)}` : money(minor)

export const piecesWords = (n: number) => `${units(n)} pcs`

export interface Figures {
  readonly sales: number
  readonly pieces: number
  readonly returns: number
  /// Null while no sale carries a discount figure.
  readonly discount: number | null
  readonly cash: number
  readonly edc: number
  readonly net: number
}

export function figuresOf(rows: readonly Tx[]): Figures {
  let discount: number | null = null
  const total = {
    sales: 0,
    pieces: 0,
    returns: 0,
    cash: 0,
    edc: 0,
    net: 0,
  }
  for (const row of rows) {
    // A return is counted, not subtracted (Hari, 30 Oct 2026): its row holds
    // only what was paid on top, so its tenders are money like a sale's.
    if (row.kind === "Sale") total.sales += 1
    else total.returns += 1
    total.pieces += row.pieces
    for (const tender of row.tenders) {
      // The credit of the pieces back is not money.
      if (tender.credit) continue
      if (tender.cash) total.cash += tender.minor
      else total.edc += tender.minor
    }
    if (row.discount !== null) discount = (discount ?? 0) + row.discount
    total.net += row.net
  }
  return { ...total, discount }
}

/// The distinct values of a column, with how many rows each has.
export function countBy(
  rows: readonly Tx[],
  of: (row: Tx) => readonly string[],
): { readonly name: string; readonly count: number }[] {
  const by = new Map<string, number>()
  for (const row of rows)
    for (const name of new Set(of(row))) by.set(name, (by.get(name) ?? 0) + 1)
  return [...by.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const cashiersOf = (row: Tx): readonly string[] => [row.cashier]
/// The ways of paying a row really used. The exchange credit on a replacement
/// sale is not one of them — it is the return coming back — so it is left out
/// of the picker and out of the Payments table.
export const paymentsOf = (row: Tx): readonly string[] =>
  row.tenders.filter((tender) => !tender.credit).map((tender) => tender.label)

export function narrow(
  rows: readonly Tx[],
  cashier: string | null,
  payment: string | null,
): Tx[] {
  return rows.filter(
    (row) =>
      (cashier === null || row.cashier === cashier) &&
      (payment === null || paymentsOf(row).includes(payment)),
  )
}

/// A share of what was sold: refunds are left out so a method cannot pass 100%.
export function share(part: number, of: number): string {
  if (of <= 0) return "—"
  return `${new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format((part / of) * 100)}%`
}
