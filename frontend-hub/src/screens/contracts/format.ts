import type { GaContractRow } from "@itulah/contract"
import { EMPTY, count, monthYear } from "@/lib/format"
import { useSupplierName } from "@/screens/procurement/supplier-name"

/// Words the register and the hub both print, kept out of `parts.tsx` because
/// that file exports components and react-refresh allows no functions beside
/// them. Pure word-work only.

/// "2026-09-01" → the month a person reads: "Sep 2026".
///
/// Shared by the register's usage column and the hub's usage chart, because
/// both draw a METER month and printing the first-of-the-month date would
/// repeat "01" down every row.
export function monthLabel(period: string | null): string {
  if (period === null) return EMPTY
  const label = monthYear(period)
  return label === EMPTY ? period : label
}

/// The party a contract names — a supplier when one is on the record, the
/// free-text counterparty when the deal is with somebody who is not one (the
/// tenant renting our space, a co-operative). Every surface prints the same
/// words, so they decide once, here.
export function partyOf(row: GaContractRow): string {
  return row.supplier_name ?? row.counterparty_name ?? EMPTY
}

/// The same, with a supplier written in full, "Maju Jaya, UD". For anything
/// that draws the party.
export function useContractParty(): (row: GaContractRow) => string {
  const supplierName = useSupplierName()
  return (row) =>
    row.supplier_id === null && row.supplier_name === null
      ? partyOf(row)
      : supplierName(row.supplier_id, row.supplier_name)
}

/// The place the contract applies to, or the SCOPE when it applies to more
/// than one: one contract CAN cover the estate (brief §13), and a scope is a
/// fact about the deal, not a blank site column.
export function siteOf(row: GaContractRow): string {
  if (row.site_id !== null) return row.site_id
  return row.site_scope === "ALL_STORES"
    ? "All stores"
    : row.site_scope === "ALL_SITES"
      ? "All sites"
      : EMPTY
}

/// Where a contract stands, in the words and the tone every surface prints:
/// `Status` in the register and on a phone card, the one `Pill` in the sheet.
///
/// A living contract reads its window, which the server computes per contract
/// from `reminder_days` (`domain::ga::contract_standing`): "Expires in 37 days"
/// is the sentence that starts the renewal conversation this week, and an
/// expired one is a problem until somebody decides, so it is `bad` — a permit
/// that ran out is not a quiet fact.
///
/// An ended contract (the register's `archived`) says how it ended, as far as
/// the record can tell: stopped by a termination, run out past its end, or
/// ended before its end without one. All three are history, so all are quiet.
export function standingOf(row: GaContractRow): {
  word: string
  tone: "ok" | "warn" | "bad" | "neutral"
} {
  if (row.archived) {
    if (row.standing === "DIHENTIKAN" || row.status === "TERMINATED")
      return { word: "Terminated", tone: "neutral" }
    if (row.standing === "HABIS") return { word: "Expired", tone: "neutral" }
    return { word: "Ended early", tone: "neutral" }
  }
  switch (row.standing) {
    case "AKTIF":
      return { word: "Active", tone: "ok" }
    case "SEGERA_HABIS":
      return {
        word:
          row.days_to_end === null
            ? "Expiring soon"
            : row.days_to_end === 1
              ? "Expires in 1 day"
              : `Expires in ${count(row.days_to_end)} days`,
        tone: "warn",
      }
    case "HABIS":
      return { word: "Expired", tone: "bad" }
    case "BELUM_MULAI":
      return { word: "Not started", tone: "neutral" }
    case "DIHENTIKAN":
      return { word: "Terminated", tone: "neutral" }
    default:
      return { word: "Draft", tone: "warn" }
  }
}
