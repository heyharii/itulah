import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { useCallback, useMemo, useState } from "react"

import { day, label } from "@/lib/format"
import {
  accountLinksQuery,
  assetClassesQuery,
  financeKeys,
  listBills,
  listLineCategories,
  periodsQuery,
  unitAccounts,
  type AssetClass,
  type LineCategory,
} from "@/lib/queries/finance"
import { unitLabel } from "@/lib/queries/organisation"
import { listSuppliers, procurementKeys } from "@/lib/queries/procurement"
import {
  findSupplier,
  withLegalForm,
} from "@/screens/procurement/supplier-format"
import {
  categoryFamilyLabel,
  categoryFamilyOrder,
  defaultWindow,
  todayIso,
} from "@/screens/finance/chart"

/// The module's shared reads, and the two shapes of date question it asks.
///
/// A separate file from `parts.tsx` for one blunt reason: a module that exports
/// both components and hooks loses fast refresh, and the lint rule that says so
/// is right — editing `<AccountPicker>` would remount every screen holding one
/// of these hooks. `parts.tsx` is the components; this is what they and the
/// screens both call.
///
/// Nothing here fetches anything a screen was not already fetching. Every query
/// key is one some screen in this module owns, so a unit select on six screens
/// is one request, and the date default reuses the calendar the sidebar badge
/// already holds.

/// The units the books are kept for: head office and each store (0605).
///
/// Read off `GET /account-links`, which carries them as `locations` beside the
/// roles the posting rules name — the same list the Account links screen and
/// the readiness matrix draw their columns from. Every caller shares that
/// screen's key, so a module full of unit pickers is still one request.
///
/// Held for five minutes: the client opens a store about once a year.
export function useLocations() {
  return useQuery(accountLinksQuery())
}

/// A `unit_id` as the client says it: "C007 · Brebes", never `store-07`.
///
/// While the list is on its way an id reads as "…"; after, an id the list
/// does not carry reads as itself — the only honest thing to draw for a unit
/// the links do not know, and inventing a label for an id nobody recognises
/// would be worse. A SITE id (a bill's, an asset's) is not a unit id: those
/// are `useSiteLabel` in `@/lib/queries/organisation`.
export function useUnitName(): (unitId: string | null | undefined) => string {
  const map = useLocations()
  const byId = useMemo(() => {
    const table = new Map<string, string>()
    for (const location of map.data?.locations ?? []) {
      table.set(location.unit_id, unitLabel(location))
    }
    return table
  }, [map.data])
  const loading = map.isPending

  return (unitId) =>
    unitId === null || unitId === undefined || unitId === ""
      ? "—"
      : (byId.get(unitId) ?? (loading ? "…" : unitId))
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
  supplierId: string | null | undefined,
  name?: string | null
) => string {
  const suppliers = useSuppliers()
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
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
      // Bills, advances and payments carry the supplier's CODE in their
      // `supplier_id`, not the register's uuid — without this a whole AP
      // screen read "SUP-001, SUP-002".
      table.set(supplier.supplier_code, supplier.name)
    }
    return table
  }, [bills.data, suppliers.data])

  // `name` is the bare name the row itself carried (a bill's recorded name):
  // preferred over the register's, but written with the register's legal form.
  // A row with no id of its own (an accrual) is matched on that bare name.
  return useCallback(
    (supplierId: string | null | undefined, name?: string | null) => {
      const book = suppliers.data ?? []
      const hasId = supplierId !== null && supplierId !== undefined
      if ((!hasId || supplierId === "") && (name == null || name === ""))
        return "—"
      const found = findSupplier(book, hasId ? supplierId : null, name)
      const bare =
        name != null && name !== "" && name !== supplierId
          ? name
          : hasId
            ? (byId.get(supplierId) ?? supplierId)
            : ""
      return withLegalForm(bare, found?.legal_form)
    },
    [byId, suppliers.data]
  )
}

// ---------------------------------------------------------------------------
// Line categories
// ---------------------------------------------------------------------------

/// The categories one family offers, in the order the client reads them.
///
/// 138 categories across 16 families, and the spread is wide: `item_class`
/// has two, `expense_category` has 51. One request per family and not one per
/// picker — a journal with six expense lines opens six category boxes, all of
/// them `expense_category`, and they share a key. Held for five minutes: the
/// families are seeded with the chart and change about as often.
///
/// `family` of `null` asks for every family at once, which is what the
/// reference screen reads; the picker never passes it, because a picker with
/// no account chosen has no box to fill.
export function useLineCategories(family: string | null) {
  const query = useQuery({
    queryKey: financeKeys.lineCategories(family),
    queryFn: ({ signal }) => listLineCategories(family, signal),
    // A picker with no account chosen yet has no family, and asking for every
    // category to fill a box nobody opened is a request for nothing.
    enabled: family !== null,
    staleTime: 5 * 60 * 1000,
  })
  const rows = useMemo(() => {
    const all = [...(query.data?.categories ?? [])]
    // The client's own order first, then their own name — never the code,
    // which is ours and is not what anybody is scanning for.
    all.sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.name.localeCompare(b.name, "id-ID")
    )
    return all as readonly LineCategory[]
  }, [query.data])
  return { ...query, rows }
}

/// Every category, every family, for the reference screen.
///
/// Its own hook rather than `useLineCategories(null)` with the guard lifted,
/// because the two have different keys and different shapes of answer: this
/// one groups, and grouping in the screen would put the same `reduce` in
/// front of every reader of this list.
export function useCategoriesByFamily() {
  const query = useQuery({
    queryKey: financeKeys.lineCategories(null),
    queryFn: ({ signal }) => listLineCategories(null, signal),
    staleTime: 5 * 60 * 1000,
  })
  const families = useMemo(() => {
    const table = new Map<string, LineCategory[]>()
    for (const row of query.data?.categories ?? []) {
      const held = table.get(row.family)
      if (held === undefined) table.set(row.family, [row])
      else held.push(row)
    }
    for (const rows of table.values()) {
      rows.sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.name.localeCompare(b.name, "id-ID")
      )
    }
    return (
      [...table.entries()]
        .map(([family, rows]) => ({
          family,
          label: categoryFamilyLabel(family),
          rows: rows as readonly LineCategory[],
        }))
        // The accounts' own order, not the alphabet. See `CATEGORY_FAMILIES`.
        .sort(
          (a, b) =>
            categoryFamilyOrder(a.family) - categoryFamilyOrder(b.family) ||
            a.family.localeCompare(b.family)
        )
    )
  }, [query.data])
  return { ...query, families }
}

/// A `category_code` as the client's chart says it.
///
/// Falls back to the code, which is the only honest thing to draw for a
/// category this browser has not read — the same bargain `useUnitName` makes,
/// and for the same reason.
export function useCategoryName(): (code: string | null | undefined) => string {
  const all = useCategoriesByFamily()
  const byCode = useMemo(() => {
    const table = new Map<string, string>()
    for (const group of all.families)
      for (const row of group.rows) table.set(row.category_code, row.name)
    return table
  }, [all.families])

  return (code) =>
    code === null || code === undefined || code === ""
      ? "—"
      : (byCode.get(code) ?? code)
}

/// The client's asset classes.
///
/// Here rather than in a module of its own because it is the sibling of the
/// list above: the accounts that take no category — 1601, 1609, 7101 — are
/// the ones whose identity is an asset, and its class is what a reader of the
/// categories screen will look for next.
export function useAssetClasses() {
  const query = useQuery(assetClassesQuery())
  const rows = useMemo(
    () => (query.data?.classes ?? []) as readonly AssetClass[],
    [query.data]
  )
  return { ...query, rows }
}

// ---------------------------------------------------------------------------
// Meanings
// ---------------------------------------------------------------------------

/// A `semantic_key` as a person says it: "Bank — giro", not `bank_giro`.
///
/// The labels are the server's own, generated from the posting rules and
/// carried in `roles`, so a meaning added to a rule is readable here
/// without anybody remembering to add it to a list in the browser. Falls back
/// to `label()`, which turns the key into a sentence — an honest last resort
/// for a key the rules stopped requiring but a stored payment still names.
export function useMeaningLabel(): (key: string | null | undefined) => string {
  const map = useLocations()
  const byKey = useMemo(() => {
    const table = new Map<string, string>()
    for (const doc of map.data?.roles ?? []) table.set(doc.key, doc.label)
    return table
  }, [map.data])

  return (key) =>
    key === null || key === undefined || key === ""
      ? "—"
      : (byKey.get(key) ?? label(key))
}

/// The meanings money can leave a unit's books by, and which accounts they
/// resolve to there.
///
/// Derived from the mappings rather than from a hard-coded list of four keys,
/// so a payment can only be offered an account somebody has actually mapped —
/// the alternative is a select full of meanings whose posting will be refused
/// the moment it is tried, which is the refusal the account links exist to stop
/// anybody meeting.
///
/// The qualifier is part of the identity and not a note: `bank_savings` in one
/// unit's books legitimately has one link per bank, and "which bank the money
/// left by" is exactly what somebody recording a payment is choosing.
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

export function useMoneyAccounts(unitId: string): readonly MoneyAccount[] {
  return useMoneyAccountChoices(unitId).accounts
}

/// The same list, and whether it is still being read.
///
/// Reading it takes a few seconds on a chart with every unit mapped, and a
/// field that said "nothing is mapped here" for those seconds was telling the
/// person to go and fix a mapping that was fine.
export function useMoneyAccountChoices(unitId: string): {
  accounts: readonly MoneyAccount[]
  pending: boolean
} {
  // What each money role resolves to in this unit's books — resolved by the
  // server, most specific link winning, and not by this browser walking the
  // links.
  const resolved = useQuery({
    queryKey: financeKeys.unitAccounts(unitId),
    queryFn: ({ signal }) => unitAccounts(unitId, signal),
    enabled: unitId !== "",
    staleTime: 5 * 60 * 1000,
  })
  const accounts = useMemo(() => {
    if (unitId === "") return []
    return (resolved.data ?? [])
      .filter((row) => MONEY_KEYS.includes(row.role))
      .map((row) => ({
        account_key: row.role,
        account_qualifier: row.source_id,
        account_code: row.account_code,
        account_name: row.account_name,
      }))
      .sort(
        (a, b) =>
          MONEY_KEYS.indexOf(a.account_key) -
            MONEY_KEYS.indexOf(b.account_key) ||
          a.account_qualifier.localeCompare(b.account_qualifier)
      )
  }, [resolved.data, unitId])
  return { accounts, pending: unitId !== "" && resolved.isPending }
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

  const periods = useQuery(periodsQuery())

  const fallback = useMemo(
    () => defaultWindow(periods.data ?? []),
    [periods.data]
  )

  const value = draft ?? fallback

  return {
    from: value.from,
    to: value.to,
    setFrom: (from) => setDraft({ ...value, from }),
    setTo: (to) => setDraft({ ...value, to }),
    chip: `${day(value.from)} – ${day(value.to)}`,
  }
}

/// The same window, for a screen that reads it inside a `<Suspense>`: the
/// calendar is read with `useSuspenseQuery`, so the first render already holds
/// the month the books are open in and the screen's own question is asked once,
/// under the right dates. `useWindow` asks the calendar with a plain query and
/// opens on the calendar month until it lands, which asks twice.
///
/// A screen warmed by `prefetch.ts` uses this one, because the prefetcher
/// computes the window the same way (`defaultWindow`) from the same calendar.
export function useSettledWindow(): DateWindow {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)
  const periods = useSuspenseQuery(periodsQuery())
  const fallback = useMemo(() => defaultWindow(periods.data), [periods.data])
  const value = draft ?? fallback
  return {
    from: value.from,
    to: value.to,
    setFrom: (from) => setDraft({ ...value, from }),
    setTo: (to) => setDraft({ ...value, to }),
    chip: `${day(value.from)} – ${day(value.to)}`,
  }
}
