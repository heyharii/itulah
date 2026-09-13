import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { day, label } from "@/lib/format"
import {
  accountMap,
  financeKeys,
  listBills,
  listPeriods,
  type AccountMapView,
} from "@/lib/queries/finance"
import { listSuppliers, procurementKeys } from "@/lib/queries/procurement"
import { isoDay, todayIso } from "@/screens/finance/chart"

/// The module's shared reads, and the two shapes of date question it asks.
///
/// A separate file from `parts.tsx` for one blunt reason: a module that exports
/// both components and hooks loses fast refresh, and the lint rule that says so
/// is right — editing `<AccountPicker>` would remount every screen holding one
/// of these hooks. `parts.tsx` is the components; this is what they and the
/// screens both call.
///
/// Nothing here fetches anything a screen was not already fetching. Every query
/// key is one some screen in this module owns, so a location select on six
/// screens is one request, and the date default reuses the calendar the sidebar
/// badge already holds.

/// The locations the books are kept for.
///
/// `GET /account-map` is the only endpoint that answers this, and it answers it
/// from the chart itself rather than from the list of places a delivery can
/// reach — a location the books are kept for is one that has accounts scoped to
/// it. Every caller here shares the key the Account map screen and the overview
/// already use, so a module full of location pickers is still one request.
///
/// Held for five minutes: the client opens a shop about once a year.
export function useLocations() {
  return useQuery({
    queryKey: financeKeys.accountMap(null),
    queryFn: ({ signal }) => accountMap(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
}

/// A `site_id` as the client says it: "Store 07", not `store-07`.
///
/// Falls back to the id, which is the only honest thing to draw for a location
/// the account map does not carry — inventing a label for an id nobody
/// recognises would be worse than showing the id.
export function useSiteName(): (siteId: string | null | undefined) => string {
  const map = useLocations()
  const byId = useMemo(() => {
    const table = new Map<string, string>()
    for (const location of map.data?.locations ?? []) {
      table.set(location.site_id, location.name)
    }
    return table
  }, [map.data])

  return (siteId) =>
    siteId === null || siteId === undefined || siteId === ""
      ? "—"
      : (byId.get(siteId) ?? siteId)
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

/// Who the client buys from — the master list, not the ones finance happens to
/// hold a bill for.
///
/// This module used to read supplier names off the bill list and nothing else,
/// on the argument that it already had them. It did, for the suppliers it had
/// been billed by; every other screen holding a bare `supplier_id` — an
/// unbilled delivery, a payment's allocations — drew the uuid instead. And a
/// form asking somebody to *choose* a supplier cannot be built out of a list of
/// the ones already invoiced at all.
///
/// `GET /suppliers` is thirty rows and answers both. Under Procurement's own
/// key, because it is Procurement's list: a supplier picked here and a supplier
/// edited there are one cache entry, and finance does not get a second, staler
/// copy of the same thirty names.
///
/// Held for five minutes: the client adds a supplier about once a month.
export function useSuppliers() {
  return useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
}

/// A `supplier_id` as the client says it.
///
/// The master list first, then the bill list, then the id. The second is not
/// redundant: a bill carries the name it was recorded under, which is the name
/// on the paper, and it is the right answer for a supplier that has since been
/// archived out of the list. The id is the last resort and, with `GET
/// /suppliers` behind this, one that no longer happens in practice — it stays
/// because inventing a label for an id nothing recognises would be worse than
/// showing the id.
export function useSupplierName(): (
  supplierId: string | null | undefined
) => string {
  const suppliers = useSuppliers()
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal),
    staleTime: 60_000,
  })

  const byId = useMemo(() => {
    const table = new Map<string, string>()
    for (const bill of bills.data ?? []) {
      if (bill.supplier_name !== null)
        table.set(bill.supplier_id, bill.supplier_name)
    }
    for (const supplier of suppliers.data ?? []) {
      table.set(supplier.supplier_id, supplier.name)
    }
    return table
  }, [bills.data, suppliers.data])

  return (supplierId) =>
    supplierId === null || supplierId === undefined || supplierId === ""
      ? "—"
      : (byId.get(supplierId) ?? supplierId)
}

// ---------------------------------------------------------------------------
// Meanings
// ---------------------------------------------------------------------------

/// A `semantic_key` as a person says it: "Bank — giro", not `bank_giro`.
///
/// The labels are the server's own, generated from the posting rules and
/// carried in `required_keys`, so a meaning added to a rule is readable here
/// without anybody remembering to add it to a list in the browser. Falls back
/// to `label()`, which turns the key into a sentence — an honest last resort
/// for a key the rules stopped requiring but a stored payment still names.
export function useMeaningLabel(): (key: string | null | undefined) => string {
  const map = useLocations()
  const byKey = useMemo(() => {
    const table = new Map<string, string>()
    for (const doc of map.data?.required_keys ?? [])
      table.set(doc.key, doc.label)
    return table
  }, [map.data])

  return (key) =>
    key === null || key === undefined || key === ""
      ? "—"
      : (byKey.get(key) ?? label(key))
}

/// The meanings money can leave a location by, and which accounts they resolve
/// to there.
///
/// Derived from the mappings rather than from a hard-coded list of four keys,
/// so a payment can only be offered an account somebody has actually mapped —
/// the alternative is a select full of meanings whose posting will be refused
/// the moment it is tried, which is the refusal the account map exists to stop
/// anybody meeting.
///
/// The qualifier is part of the identity and not a note: `bank_savings` at one
/// site legitimately has one mapping per bank, and "which bank the money left
/// by" is exactly what somebody recording a payment is choosing.
export interface MoneyAccount {
  readonly account_key: string
  readonly account_qualifier: string
  readonly account_code: string
  readonly account_name: string
}

/// The four the payment endpoint accepts. Hard-coded because it is the
/// server's own list — `RecordPaymentRequest` names them — and a fifth meaning
/// appearing here without the server accepting it would be a select that can
/// only 400.
const MONEY_KEYS: readonly string[] = [
  "bank_giro",
  "bank_savings",
  "cash",
  "petty_cash",
]

export function useMoneyAccounts(siteId: string): readonly MoneyAccount[] {
  const map = useLocations()
  return useMemo(() => {
    if (siteId === "") return []
    return (map.data?.rows ?? [])
      .filter(
        (row) => row.site_id === siteId && MONEY_KEYS.includes(row.semantic_key)
      )
      .map((row) => ({
        account_key: row.semantic_key,
        account_qualifier: row.qualifier,
        account_code: row.account_code,
        account_name: row.account_name,
      }))
      .sort(
        (a, b) =>
          MONEY_KEYS.indexOf(a.account_key) -
            MONEY_KEYS.indexOf(b.account_key) ||
          a.account_qualifier.localeCompare(b.account_qualifier)
      )
  }, [map.data, siteId])
}

/// The value a `<Select>` carries for one of these, and the way back.
///
/// A select's value is a string, and this pair is two. Joined on a tab because
/// a qualifier is the client's own text — a bank's name — and every other
/// separator worth reading is a character a bank name can contain.
export function moneyAccountValue(account: {
  account_key: string
  account_qualifier: string
}): string {
  return `${account.account_key}\t${account.account_qualifier}`
}

export function parseMoneyAccountValue(value: string): {
  account_key: string
  account_qualifier: string
} {
  const [key, qualifier = ""] = value.split("\t")
  return { account_key: key, account_qualifier: qualifier }
}

/// Re-exported so a screen can name the shape `useLocations()` answers with
/// without reaching into `lib/queries` for a type it only holds.
export type { AccountMapView }

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/// The two shapes of date question finance asks, and nothing else.
///
/// A balance is a moment: *what is this worth as at a date*. A movement is a
/// window: *what happened between two*. Before these, six screens each had a
/// pair of bare `<input type="date">` boxes left blank, every one of them
/// relying on a different server-side default, and none of them saying on the
/// page what date they were actually reporting. Blank is the problem: the
/// reader cannot tell "today" from "the server picked something" from "I
/// forgot to fill this in", and all three look identical.
///
/// So the boxes arrive filled, and the effective answer is always echoed in
/// words. The server's own defaults are untouched — these send what is on
/// screen, which is what the screen says it is sending.
export interface AsOf {
  readonly value: string
  readonly set: (value: string) => void
  /// "As at 02 Sep 2026" — for the screen's existing muted chip.
  readonly chip: string
}

export function useAsOf(): AsOf {
  const [value, setValue] = useState(todayIso)
  return { value, set: setValue, chip: `As at ${day(value)}` }
}

export interface DateWindow {
  readonly from: string
  readonly to: string
  readonly setFrom: (value: string) => void
  readonly setTo: (value: string) => void
  /// "01 Aug 2026 – 02 Sep 2026".
  readonly chip: string
}

/// A window, defaulting to the month the books are actually being worked in.
///
/// Not the current calendar month: on the third of September an accountant is
/// usually still in August, and the system already knows which month that is —
/// the most recent period somebody opened and has not sealed. Falling back to
/// the first of the current month is right when no period is open at all,
/// because then nothing can be posted anywhere and the calendar is the only
/// honest guess.
///
/// The default follows the periods query until somebody edits a box, and stops
/// the moment they do. No effect and no reset: an answer that rewrites itself
/// under a reader half a second after a list arrives is worse than a stale one.
export function useWindow(): DateWindow {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
    staleTime: 60_000,
  })

  const fallback = useMemo(() => {
    const now = new Date()
    const open = (periods.data ?? [])
      .filter((row) => row.status.toUpperCase() === "OPEN")
      .sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))[0]
    const start =
      open === undefined
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(open.year, open.month - 1, 1)
    return { from: isoDay(start), to: isoDay(now) }
  }, [periods.data])

  const value = draft ?? fallback

  return {
    from: value.from,
    to: value.to,
    setFrom: (from) => setDraft({ ...value, from }),
    setTo: (to) => setDraft({ ...value, to }),
    chip: `${day(value.from)} – ${day(value.to)}`,
  }
}
