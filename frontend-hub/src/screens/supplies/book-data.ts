import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"
import {
  BedDouble,
  Home,
  Package,
  Phone,
  Plug,
  Printer,
  Store,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { gaKeys, gaSupplyBook, gaSupplyCategories } from "@/lib/queries/ga"
import type { UnitOfMeasure } from "@/lib/queries/units"
import type { GaSupplyRequestRow } from "@itulah/contract"

/// How many requests one page of the register asks for.
export const PAGE = 100

/// The most the server answers in one page of this book. The overdue figure
/// reads the requests still waiting on somebody in one go, because a count over
/// the pages a person happened to scroll would change with the scroll.
const WHOLE_BOOK = 1000

// ── stages ──────────────────────────────────────────────────────────────────

/// The three tabs. Open is every request still on its way; Completed is what
/// reached Finance; Rejected is the one exit.
export type SupplyTab = "OPEN" | "DONE" | "REJECTED"

/// The stage a request is on, in the words of whoever has it now. The figures
/// and the stage chips speak this one vocabulary.
export type SupplyStage = "approve" | "procurement" | "bill"

/// What each stage is made of, as the server names the states.
export const STAGE_STATUSES: Readonly<Record<SupplyStage, readonly string[]>> =
  {
    approve: ["REQUESTED"],
    procurement: ["APPROVED", "ORDERED"],
    bill: ["RECEIVED"],
  }

/// The states a request is open in.
export const OPEN_STATUSES: readonly string[] = [
  "REQUESTED",
  "APPROVED",
  "ORDERED",
  "RECEIVED",
]

/// The states a request can be late in: it has not reached the shop yet.
/// Received is somebody else's wait, not a need that went unmet.
export const BEFORE_RECEIPT: readonly string[] = [
  "REQUESTED",
  "APPROVED",
  "ORDERED",
]

/// The states a tab holds.
export const TAB_STATUSES: Readonly<Record<SupplyTab, readonly string[]>> = {
  OPEN: OPEN_STATUSES,
  DONE: ["BILLED"],
  REJECTED: ["REJECTED"],
}

/// The one word a state is read as, in every list and sheet of this screen.
export function supplyStageWords(status: string): string {
  switch (status) {
    case "REQUESTED":
      return "Submitted"
    case "APPROVED":
      return "Approved"
    case "ORDERED":
      return "PO created"
    case "RECEIVED":
      return "Received"
    case "BILLED":
      return "Billed"
    default:
      return "Rejected"
  }
}

/// The dot a state wears: amber while it waits for a decision, sky once
/// Procurement has the order, green when it is done, red when it was refused.
export function supplyStageTone(
  status: string
): "warn" | "neutral" | "info" | "ok" | "bad" {
  switch (status) {
    case "REQUESTED":
      return "warn"
    case "ORDERED":
      return "info"
    case "BILLED":
      return "ok"
    case "REJECTED":
      return "bad"
    default:
      return "neutral"
  }
}

/// Whether the ask is past the day it was needed and has not reached the shop.
export function isOverdue(
  row: Pick<GaSupplyRequestRow, "needed_by" | "status">,
  today: string
): boolean {
  return (
    row.needed_by !== null &&
    BEFORE_RECEIPT.includes(row.status) &&
    row.needed_by < today
  )
}

// ── categories ──────────────────────────────────────────────────────────────

/// The mark each of the seven GA categories wears, in the chips, the form's
/// tiles and the first cell of a row. A category the table adds later falls
/// back to the parcel until somebody picks it a mark.
const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  ATK: Printer,
  RUMAH_TANGGA: Home,
  TOKO_KANTOR: Store,
  LISTRIK: Plug,
  TOOLS: Wrench,
  TELEPON: Phone,
  MESS: BedDouble,
}

export function categoryIcon(code: string): LucideIcon {
  return CATEGORY_ICONS[code] ?? Package
}

/// The seven GA categories, with the account each one proposes. The server's own
/// list: the request is validated against this very table, so the form and the
/// validator cannot disagree. Shared by the chips and the form.
export const supplyCategoriesQuery = () =>
  queryOptions({
    queryKey: gaKeys.supplyCategories(),
    queryFn: ({ signal }) => gaSupplyCategories(signal),
    staleTime: Infinity,
  })

// ── the register ────────────────────────────────────────────────────────────

/// What the bar narrows the register by, asked of the server: the place, the
/// search and the states. The category and the overdue switch are read off the
/// rows (the server has no facet for them).
export interface SupplyScope {
  readonly q?: string
  readonly site?: string
  /// Comma-separated, as the server takes several.
  readonly status: string
}

/// The register of supply requests, a page at a time as its foot nears view.
/// Shared with the prefetcher (`prefetch.ts`) so the server's answer is the
/// screen's own.
export const supplyBookQuery = (scope: SupplyScope) =>
  infiniteQueryOptions({
    // The search rides in the key: the shared `gaKeys.supplies` leaves it out,
    // and a list that did would serve one search's answer to the next.
    queryKey: [
      ...gaKeys.supplies({ site: scope.site, status: scope.status }),
      "pages",
      scope.q ?? null,
    ] as const,
    queryFn: ({ pageParam, signal }) =>
      gaSupplyBook(
        {
          site: scope.site,
          status: scope.status,
          q: scope.q,
          limit: PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The page the screen opens on: the Open tab, nothing narrowed.
export const OPENING_SCOPE: SupplyScope = { status: OPEN_STATUSES.join(",") }

/// How the whole register splits by stage, asked as a page of one row: the
/// server's stage counts are the answer. Under the register's prefix, so a
/// write that invalidates the register refreshes the figures with it.
export const supplyCountQuery = () =>
  queryOptions({
    queryKey: [...gaKeys.supplies({}), "count"] as const,
    queryFn: ({ signal }) => gaSupplyBook({ limit: 1 }, signal),
  })

/// Every request that has not reached the shop, whole: the overdue figure is a
/// count over these.
export const supplyDueQuery = () =>
  queryOptions({
    queryKey: [
      ...gaKeys.supplies({ status: BEFORE_RECEIPT.join(",") }),
      "due",
    ] as const,
    queryFn: ({ signal }) =>
      gaSupplyBook(
        { status: BEFORE_RECEIPT.join(","), limit: WHOLE_BOOK },
        signal
      ),
  })

// ── quantities ──────────────────────────────────────────────────────────────

/// A number the way an Indonesian types it: "1.000" is a thousand, "2,5" is two
/// and a half, and "2.5" (a dot with fewer than three digits after it) is two
/// and a half as well. A dot followed by exactly three digits is a thousands
/// mark, so "1.000" is never read as one.
///
/// This is the reading the server's own parser does not do: it takes the dot as
/// a decimal point, so a request typed "1.000 pcs" was filed as 1.
export function readQuantityNumber(text: string): number | null {
  const typed = text.trim()
  if (typed === "") return null
  let clean: string
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(typed)) {
    clean = typed.replace(/\./g, "").replace(",", ".")
  } else if (/^\d+(,\d+)?$/.test(typed)) {
    clean = typed.replace(",", ".")
  } else if (/^\d+\.\d{1,2}$/.test(typed)) {
    clean = typed
  } else {
    return null
  }
  const value = Number(clean)
  return Number.isFinite(value) ? value : null
}

/// A quantity as the list and the sheet say it: "1.000 Piece", "2,5 Liter". The
/// number is read out of the text the person typed, not out of the server's
/// reading of it, which took "1.000" for one. A text that is not a number and a
/// unit is shown as it was typed.
export function quantityWords(
  row: Pick<GaSupplyRequestRow, "quantity" | "unit_code">,
  units: readonly Pick<UnitOfMeasure, "code" | "label" | "aliases">[]
): string | null {
  const typed = row.quantity?.trim() ?? ""
  if (typed === "") return null
  const at = typed.lastIndexOf(" ")
  if (at === -1) return typed
  const value = readQuantityNumber(typed.slice(0, at))
  const word = typed.slice(at + 1).trim()
  if (value === null || word === "") return typed
  const unit =
    units.find((one) => one.code === row.unit_code) ??
    units.find(
      (one) =>
        one.code.toLowerCase() === word.toLowerCase() ||
        one.aliases.includes(word.toLowerCase())
    )
  const figure = value.toLocaleString("id-ID", { maximumFractionDigits: 2 })
  return `${figure} ${unit?.label ?? word}`
}
