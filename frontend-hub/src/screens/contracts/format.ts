import type { GaContractRow } from "@itulah/contract"
import { useSupplierName } from "@/screens/procurement/supplier-name"

/// Words the register and the hub both print, kept out of `parts.tsx` because
/// that file exports components and react-refresh allows no functions beside
/// them. Pure word-work only.

/// "2026-09-01" → the month a person reads: "Sep 2026".
///
/// Shared by the register's usage column and the hub's usage chart, because
/// both draw a METER month and printing the first-of-the-month date would
/// repeat "01" down every row. Kept here rather than promoted into
/// `lib/format` until a third module asks the same question.
export function monthLabel(period: string | null): string {
  if (period === null) return "—"
  const parsed = new Date(`${period}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return period
  return new Intl.DateTimeFormat("id-ID", {
    month: "short",
    year: "numeric",
  }).format(parsed)
}

/// The party a contract names — a supplier when one is on the record, the
/// free-text counterparty when the deal is with somebody who is not one (the
/// tenant renting our space, a co-operative). Every surface prints the same
/// words, so they decide once, here.
export function partyOf(row: GaContractRow): string {
  return row.supplier_name ?? row.counterparty_name ?? "—"
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
      : "—"
}
